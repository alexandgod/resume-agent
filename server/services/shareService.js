/**
 * 分享服务：幂等开启、脱敏只读快照、重新发布、撤销失效、访问计数、二维码。
 * 隐私基线：
 *  - buildSnapshot() 复制 content 并剔除 basic.email / basic.phone（同时清除 meta 生成来源与
 *    mailto/tel 链接），快照自包含 templateSchema，公开页无需查私有模板接口；
 *  - 关闭后重新开启必须生成全新 token，旧链接永不复活；
 *  - republish 沿用原 token 只更新快照；
 *  - 公开读取的失效判定在 server/routes/public.js 独立实现（此处不 import 私有 service）。
 */
import QRCode from 'qrcode';
import { AppError, CODE } from '../domain/contracts.js';
import { normalizeContent } from '../domain/contentSchema.js';
import { BUILTIN_TEMPLATES } from '../domain/templates.js';
import { repo } from '../store/repository.js';
import { generateShareToken, buildPublicUrl } from '../utils/security.js';

function nowIso() {
  return new Date().toISOString();
}

async function ownedResume(userId, resumeId) {
  return repo.getOwned('resumes', userId, resumeId);
}

async function activeLink(resumeId) {
  return repo.findOne('share_links', (link) => link.resume_id === resumeId && link.is_enabled);
}

async function templateSchemaFor(resume) {
  const template = (await repo.findOne('templates', (item) => item.id === resume.template_id))
    || (await repo.findOne('templates', (item) => item.code === 'simple'));
  return template?.schema_json || BUILTIN_TEMPLATES[0].schema_json;
}

/**
 * 生成脱敏只读快照。
 * 任何写入快照的 content 都先过 normalizeContent()；快照只含必要展示字段。
 */
export function buildSnapshot(resume, templateSchema) {
  const content = normalizeContent(resume?.content_json);
  delete content.basic.email;
  delete content.basic.phone;
  delete content.meta;
  content.basic.links = (content.basic.links || []).filter(
    (link) => !/^(mailto:|tel:)/i.test(String(link?.url || '')),
  );
  return {
    title: String(resume?.title || '我的简历'),
    content,
    template: templateSchema,
    publishedAt: nowIso(),
    schemaVersion: 1,
  };
}

/** 私有接口返回的分享视图（不含任何密钥字段）。 */
function toShareView(link) {
  if (!link || !link.is_enabled) {
    return {
      enabled: false,
      url: '',
      token: '',
      viewCount: Number(link?.view_count || 0),
      createdAt: link?.created_at || '',
      revokedAt: link?.revoked_at || '',
    };
  }
  return {
    enabled: true,
    url: buildPublicUrl(link.token),
    token: link.token,
    viewCount: Number(link.view_count || 0),
    createdAt: link.created_at || '',
    revokedAt: link.revoked_at || '',
  };
}

/** 查询分享状态。 */
export async function getShare(userId, resumeId) {
  await ownedResume(userId, resumeId);
  const active = await activeLink(resumeId);
  if (active) return toShareView(active);
  const history = await repo.findByUser('share_links', userId, (link) => link.resume_id === resumeId);
  history.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return toShareView(history[0] || null);
}

/** 开启分享：已开启则幂等返回；否则生成全新 token + 脱敏快照。 */
export async function enable(userId, resumeId) {
  const resume = await ownedResume(userId, resumeId);
  const active = await activeLink(resumeId);
  if (active) return toShareView(active);

  const snapshot = buildSnapshot(resume, await templateSchemaFor(resume));
  const link = await repo.insert('share_links', {
    resume_id: resumeId,
    user_id: userId,
    token: generateShareToken(),
    snapshot_json: snapshot,
    is_enabled: 1,
    expire_at: null,
    view_count: 0,
    created_at: nowIso(),
    revoked_at: '',
  });
  return toShareView(link);
}

/** 重新发布：沿用原 token 更新快照；未开启返回 409。 */
export async function republish(userId, resumeId) {
  const resume = await ownedResume(userId, resumeId);
  const active = await activeLink(resumeId);
  if (!active) {
    throw new AppError(CODE.CONFLICT, '尚未开启分享，无法重新发布', { errKey: 'SHARE_NOT_ENABLED' });
  }
  const snapshot = buildSnapshot(resume, await templateSchemaFor(resume));
  const updated = await repo.update('share_links', active.id, { snapshot_json: snapshot });
  return toShareView(updated);
}

/** 关闭分享：is_enabled=0 + revoked_at，链接立即失效。 */
export async function disable(userId, resumeId) {
  await ownedResume(userId, resumeId);
  const links = await repo.findByUser(
    'share_links',
    userId,
    (link) => link.resume_id === resumeId && link.is_enabled,
  );
  let last = null;
  for (const link of links) {
    last = await repo.update('share_links', link.id, {
      is_enabled: 0,
      revoked_at: nowIso(),
    });
  }
  return toShareView(last);
}

/** 生成二维码 PNG dataURL（仅私有接口可调用）。 */
export async function qrcode(userId, resumeId, size) {
  await ownedResume(userId, resumeId);
  const active = await activeLink(resumeId);
  if (!active) {
    throw new AppError(CODE.CONFLICT, '尚未开启分享，无法生成二维码', { errKey: 'SHARE_NOT_ENABLED' });
  }
  const url = buildPublicUrl(active.token);
  const width = Number(size) > 0 ? Math.min(Number(size), 1024) : 320;
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    width,
    margin: 2,
  });
  return { dataUrl, url };
}
