/**
 * 私有路由（前缀 /api）：auth / settings/llm / materials / templates / resumes / share。
 * register、login 无需鉴权；其余路由统一经 requireAuth 注入 req.user.id。
 * 所有业务查询由服务层强制 user_id 过滤，跨用户返回 403。
 */
import express from 'express';
import { AppError, CODE } from '../domain/contracts.js';
import { asyncHandler, requireAuth } from '../middleware.js';
import { repo } from '../store/repository.js';
import * as authService from '../services/authService.js';
import * as modelConfigService from '../services/modelConfigService.js';
import * as materialService from '../services/materialService.js';
import * as resumeService from '../services/resumeService.js';
import * as shareService from '../services/shareService.js';

/** 把 multer 的错误归一化为统一响应码。 */
function normalizeUploadError(error) {
  if (error instanceof AppError) return error;
  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return new AppError(CODE.UNPROCESSABLE, '单个文件不得超过 10MB', { errKey: 'FILE_TOO_LARGE' });
  }
  if (error && error.code === 'LIMIT_FILE_COUNT') {
    return new AppError(CODE.UNPROCESSABLE, '单次最多上传 20 个文件', { errKey: 'TOO_MANY_FILES' });
  }
  return new AppError(CODE.BAD_REQUEST, '上传请求格式不正确', { errKey: 'BAD_UPLOAD' });
}

export function createPrivateRouter() {
  const router = express.Router();
  const upload = materialService.createUploadMiddleware();

  // ── 认证（公开） ────────────────────────────────────────────────
  router.post('/auth/register', asyncHandler(async (req, res) => {
    res.ok(await authService.register(req.body || {}));
  }));
  router.post('/auth/login', asyncHandler(async (req, res) => {
    res.ok(await authService.login(req.body || {}));
  }));

  // ── 以下全部为私有接口 ─────────────────────────────────────────
  router.use(requireAuth);

  router.post('/auth/logout', asyncHandler(async (req, res) => {
    await authService.logout(req.user.jti, req.user.exp);
    res.ok({ revoked: true });
  }));
  router.get('/auth/me', asyncHandler(async (req, res) => {
    res.ok({ user: await authService.me(req.user.id) });
  }));
  router.delete('/auth/me', asyncHandler(async (req, res) => {
    await authService.deleteAccount(req.user.id);
    // 注销后当前 token 也立即进入黑名单，避免旧 token 继续访问。
    await authService.logout(req.user.jti, req.user.exp);
    res.ok({ deleted: true });
  }));

  // ── CR-001 模型配置 /api/settings/llm*（4 个接口全部私有、按 user_id 隔离，S6） ──
  // 可选 ?id= / body.config_id 用于显式触发配置归属校验：跨用户读取/使用一律 403。
  const settingsConfigId = (req) => String(req.query.id || req.body?.config_id || req.body?.id || '');
  const assertSettingsOwner = async (req) => {
    await modelConfigService.assertConfigOwner(req.user.id, settingsConfigId(req));
  };

  router.post('/settings/llm/test', asyncHandler(async (req, res) => {
    await assertSettingsOwner(req);
    // 返回 {ok, latencyMs, message}；10s 超时、不落库、不生成简历、不回显密钥。
    res.ok(await modelConfigService.testConnection(req.user.id, req.body || {}));
  }));
  router.get('/settings/llm', asyncHandler(async (req, res) => {
    await assertSettingsOwner(req);
    // 未配置返回 configured:false + effectiveSource（200），不返回 404 作为主路径。
    res.ok(await modelConfigService.getSettings(req.user.id));
  }));
  router.put('/settings/llm', asyncHandler(async (req, res) => {
    await assertSettingsOwner(req);
    await modelConfigService.upsertConfig(req.user.id, req.body || {});
    res.ok(await modelConfigService.getSettings(req.user.id));
  }));
  router.delete('/settings/llm', asyncHandler(async (req, res) => {
    await assertSettingsOwner(req);
    await modelConfigService.deleteConfig(req.user.id, settingsConfigId(req));
    res.ok({
      configured: false,
      effectiveSource: await modelConfigService.getEffectiveSource(req.user.id),
    });
  }));

  // ── 资料 ───────────────────────────────────────────────────────
  router.post('/materials/upload', (req, res, next) => {
    upload.array('files', 20)(req, res, (error) => {
      if (error) return next(normalizeUploadError(error));
      return next();
    });
  }, asyncHandler(async (req, res) => {
    res.ok(await materialService.addUploads(req.user.id, req.files || []));
  }));

  router.get('/materials', asyncHandler(async (req, res) => {
    const items = await materialService.list(req.user.id);
    res.ok({ items, total: items.length });
  }));
  router.post('/materials/text', asyncHandler(async (req, res) => {
    res.ok({ material: await materialService.addText(req.user.id, req.body || {}) });
  }));
  router.get('/materials/:id', asyncHandler(async (req, res) => {
    res.ok({ material: await materialService.get(req.user.id, req.params.id) });
  }));
  router.put('/materials/:id', asyncHandler(async (req, res) => {
    res.ok({ material: await materialService.update(req.user.id, req.params.id, req.body || {}) });
  }));
  router.delete('/materials/:id', asyncHandler(async (req, res) => {
    res.ok(await materialService.remove(req.user.id, req.params.id));
  }));
  router.post('/materials/:id/reparse', asyncHandler(async (req, res) => {
    res.ok({ material: await materialService.reparse(req.user.id, req.params.id) });
  }));

  // ── 模板（只读，含完整 schema_json） ────────────────────────────
  router.get('/templates', asyncHandler(async (req, res) => {
    const items = await repo.find('templates', (item) => item.status === 'active');
    items.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    res.ok({ items });
  }));

  // ── 分享（放在 /resumes/:id 之前注册，避免路径歧义） ─────────────
  router.get('/resumes/:id/share/qrcode', asyncHandler(async (req, res) => {
    res.ok(await shareService.qrcode(req.user.id, req.params.id, req.query.size));
  }));
  router.get('/resumes/:id/share', asyncHandler(async (req, res) => {
    res.ok({ share: await shareService.getShare(req.user.id, req.params.id) });
  }));
  router.post('/resumes/:id/share/republish', asyncHandler(async (req, res) => {
    res.ok({ share: await shareService.republish(req.user.id, req.params.id) });
  }));
  router.post('/resumes/:id/share', asyncHandler(async (req, res) => {
    res.ok({ share: await shareService.enable(req.user.id, req.params.id) });
  }));
  router.delete('/resumes/:id/share', asyncHandler(async (req, res) => {
    res.ok({ share: await shareService.disable(req.user.id, req.params.id) });
  }));

  // ── 简历 ───────────────────────────────────────────────────────
  router.get('/resumes', asyncHandler(async (req, res) => {
    res.ok({ items: await resumeService.list(req.user.id) });
  }));
  router.post('/resumes', asyncHandler(async (req, res) => {
    res.ok({ resume: await resumeService.create(req.user.id, req.body || {}) });
  }));
  router.get('/resumes/:id', asyncHandler(async (req, res) => {
    res.ok({ resume: await resumeService.get(req.user.id, req.params.id) });
  }));
  router.put('/resumes/:id', asyncHandler(async (req, res) => {
    res.ok({ resume: await resumeService.update(req.user.id, req.params.id, req.body || {}) });
  }));
  router.post('/resumes/:id/copy', asyncHandler(async (req, res) => {
    res.ok({ resume: await resumeService.copy(req.user.id, req.params.id, req.body || {}) });
  }));
  router.delete('/resumes/:id', asyncHandler(async (req, res) => {
    res.ok(await resumeService.remove(req.user.id, req.params.id));
  }));
  router.post('/resumes/:id/generate', asyncHandler(async (req, res) => {
    const result = await resumeService.generate(req.user.id, req.params.id, req.body || {});
    // 失败降级仍返回 200，前端按 generationMode 展示来源标识。
    res.ok(result);
  }));

  return router;
}
