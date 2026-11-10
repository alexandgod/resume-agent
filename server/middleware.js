/**
 * 中间件层：统一响应、异步包装、错误归一化、内存限流、JWT 鉴权（含 jti 黑名单）。
 * 统一响应体恒为 {code, message, data}；code=0 表示成功。
 */
import { AppError, CODE, getRateLimitConfig } from './domain/contracts.js';
import { verifyToken } from './utils/security.js';
import { repo } from './store/repository.js';

/** 挂载 res.ok / res.fail。 */
export function attachResponseHelpers(req, res, next) {
  res.ok = (data = {}, message = 'ok') => {
    res.status(200).type('application/json; charset=utf-8').json({ code: CODE.OK, message, data });
  };
  res.fail = (code, message, data = {}) => {
    const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : CODE.INTERNAL;
    res.status(status).type('application/json; charset=utf-8').json({ code: status, message, data });
  };
  next();
}

/** 包裹异步路由处理函数，把 rejection 交给错误归一化。 */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/** /api 下未匹配路由统一 404（JSON 响应）。 */
export function apiNotFound(req, res) {
  res.fail(CODE.NOT_FOUND, '接口不存在');
}

/**
 * 错误归一化：AppError → 6.1 错误码表；其余异常 → 500 且不回显堆栈/密钥。
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.fail(err.code, err.message, err.data || {});
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.fail(CODE.BAD_REQUEST, '请求 JSON 格式不正确', { errKey: 'BAD_JSON' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.fail(CODE.UNPROCESSABLE, '单个文件不得超过 10MB', { errKey: 'FILE_TOO_LARGE' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.fail(CODE.UNPROCESSABLE, '请求体过大', { errKey: 'BODY_TOO_LARGE' });
  }

  // 异常日志脱敏：只打印错误名，绝不打印 message / 请求体 / 密钥。
  console.error('[服务异常]', err && err.name ? err.name : 'UnknownError');
  return res.fail(CODE.INTERNAL, '服务器开小差了，请稍后重试', { errKey: 'INTERNAL_ERROR' });
}

/**
 * 内存限流（单进程）。命中上限返回 429。
 * 仅按 IP 计数，不记录任何请求体内容。
 */
export function createRateLimiter(windowMs, max) {
  const config = getRateLimitConfig();
  const effectiveWindow = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : config.windowMs;
  const effectiveMax = Number.isFinite(max) && max > 0 ? max : config.max;
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const buckets = new Map();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + effectiveWindow };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    // 惰性清理，避免 Map 无限增长。
    if (buckets.size > 2000) {
      for (const [ip, item] of buckets) {
        if (now >= item.resetAt) buckets.delete(ip);
      }
    }

    if (bucket.count > effectiveMax) {
      return res.fail(CODE.RATE_LIMITED, '请求过于频繁，请稍后再试', { errKey: 'RATE_LIMITED' });
    }
    return next();
  };
}

/**
 * 私有接口鉴权：解析 Bearer JWT → 校验 jti 黑名单 → 注入 req.user。
 * req.user = { id, jti, exp }；所有下游查询必须带 user_id 过滤。
 */
export async function requireAuth(req, res, next) {
  try {
    const header = String(req.headers.authorization || '');
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      throw new AppError(CODE.UNAUTHORIZED, '请先登录');
    }
    const payload = verifyToken(match[1]);
    if (!payload || !payload.sub || !payload.jti) {
      throw new AppError(CODE.UNAUTHORIZED, '登录状态已失效，请重新登录');
    }
    const revoked = await repo.findOne('revoked_tokens', (item) => item.jti === payload.jti);
    if (revoked) {
      throw new AppError(CODE.UNAUTHORIZED, '登录状态已失效，请重新登录');
    }
    req.user = { id: String(payload.sub), jti: String(payload.jti), exp: Number(payload.exp || 0) };
    return next();
  } catch (error) {
    return next(error instanceof AppError ? error : new AppError(CODE.UNAUTHORIZED, '请先登录'));
  }
}

/** 从请求头提取 Bearer token（仅鉴权中间件内部使用）。 */
export function extractBearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || '').trim());
  return match ? match[1] : '';
}
