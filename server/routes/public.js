/**
 * 公开路由（唯一公开前缀 /api/public，独立文件、不挂鉴权、不 import 任何私有 service）。
 * 只读取 share_links.snapshot_json，且只返回 4 个白名单字段：
 *   {title, content, template, publishedAt}
 * 绝不返回 user_id / email / phone / file_url / raw_text / parsed_text /
 * 任何密钥或掩码 / 配置名称 / view_count / 任何生成来源信息。
 */
import express from 'express';
import { AppError, CODE } from '../domain/contracts.js';
import { repo } from '../store/repository.js';

/**
 * 公开读取唯一入口（5.3 节逻辑照抄，因写队列为 Promise 故改为 async/await）。
 * @param {string} token 分享 token
 * @returns {Promise<{title: string, content: object, template: object, publishedAt: string}>}
 */
export async function readPublicSnapshot(token) {
  if (!/^[A-Za-z0-9_-]{22,}$/.test(token || '')) {
    throw new AppError(CODE.UNPROCESSABLE, '链接格式不正确');
  }
  const link = await repo.findOne('share_links', (item) => item.token === token);
  const invalid = !link
    || !link.is_enabled
    || (link.expire_at && Date.now() > Date.parse(link.expire_at));
  if (invalid) {
    // 统一提示，不泄露「该链接是否存在过」。
    throw new AppError(CODE.NOT_FOUND, '链接已失效');
  }
  const resume = await repo.findOne('resumes', (item) => item.id === link.resume_id);
  if (!resume) {
    throw new AppError(CODE.NOT_FOUND, '链接已失效');
  }
  await repo.update('share_links', link.id, { view_count: (link.view_count || 0) + 1 });
  // 快照自包含 template，无需再查私有模板接口。
  const snapshot = link.snapshot_json || {};
  return {
    title: snapshot.title,
    content: snapshot.content,
    template: snapshot.template,
    publishedAt: snapshot.publishedAt,
  };
}

/** 创建公开路由（无鉴权中间件）。 */
export function createPublicRouter() {
  const router = express.Router();
  router.get('/share/:token', (req, res, next) => {
    readPublicSnapshot(req.params.token)
      .then((data) => res.ok(data))
      .catch(next);
  });
  return router;
}
