/**
 * 全局共享契约：统一响应码、AppError、状态枚举、环境变量读取与常量。
 * 说明：所有环境读取都在「调用时」进行，保证测试可以动态修改 process.env。
 */
import path from 'node:path';

/** 统一响应码（HTTP 状态码与 code 一致，0 表示成功）。 */
export const CODE = {
  OK: 0,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** 业务异常：携带 code 与结构化 data。 */
export class AppError extends Error {
  constructor(code, message, data = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.data = data;
  }
}

/** 资料解析状态。 */
export const PARSE_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

/** 简历状态。 */
export const RESUME_STATUS = {
  DRAFT: 'draft',
  FINAL: 'final',
};

/** 生成方式（content_json.meta.generatedMode 也复用 manual）。 */
export const GENERATION_MODE = {
  AI: 'ai',
  RULE: 'rule',
  MANUAL: 'manual',
};

/** 本次解析到的密钥来源。 */
export const CONFIG_SOURCE = {
  USER: 'user',
  ENV: 'env',
  NONE: 'none',
};

/** 资料类型。 */
export const MATERIAL_TYPE = {
  TEXT: 'text',
  TXT: 'txt',
  MD: 'md',
  PDF: 'pdf',
  DOCX: 'docx',
  DOC: 'doc',
  IMAGE: 'image',
};

/** 上传扩展名白名单（含点号，小写比较）。 */
export const ALLOWED_EXTENSIONS = [
  '.txt', '.md', '.pdf', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.webp',
];

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

/** 账号锁定与会话常量。 */
export const LOCK_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 5 * 60 * 1000;
export const DEFAULT_JWT_EXPIRES_IN = '7d';
export const DEFAULT_LLM_TIMEOUT = 30000;
export const DEFAULT_TEST_CONNECT_TIMEOUT = 10000;

/** 读取环境变量，空串视为未配置。 */
export function getEnv(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

/** 数据目录绝对路径。 */
export function getDataDir() {
  // 惰性 require 路径模块，避免浏览器端复用本文件常量时产生副作用。
  return resolvePath(getEnv('DATA_DIR', './data'));
}

/** 某个用户的上传目录（不使用任何用户可控文件名拼接）。 */
export function getUploadsDir(userId) {
  return joinPath(getDataDir(), 'uploads', String(userId || 'anonymous'));
}

// ── 路径工具（仅依赖 node:path，保持本文件为纯 ESM） ──────────────
function resolvePath(input) {
  return path.resolve(process.cwd(), input);
}

function joinPath(...parts) {
  return path.join(...parts);
}

/** 单文件字节上限。 */
export function getMaxFileSizeBytes() {
  const mb = Number(getEnv('MAX_FILE_SIZE_MB', '10'));
  return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024;
}

/** 单用户资料上限。 */
export function getMaxMaterialsPerUser() {
  const n = Number(getEnv('MAX_MATERIALS_PER_USER', '50'));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 50;
}

/** JWT 签名密钥。 */
export function getJwtSecret() {
  return getEnv('JWT_SECRET', 'dev-only-change-me');
}

/** JWT 有效期。 */
export function getJwtExpiresIn() {
  return getEnv('JWT_EXPIRES_IN', DEFAULT_JWT_EXPIRES_IN);
}

/** 二维码链接前缀，去掉末尾斜杠。 */
export function getPublicBaseUrl() {
  return getEnv('PUBLIC_BASE_URL', 'http://localhost:5173').replace(/\/+$/, '');
}

/** 生成调用超时（ms）。 */
export function getLlmTimeout() {
  const n = Number(getEnv('LLM_TIMEOUT', String(DEFAULT_LLM_TIMEOUT)));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LLM_TIMEOUT;
}

/** 测试连接超时（ms），CR-001 要求 10s 内返回。 */
export function getTestConnectTimeout() {
  const n = Number(getEnv('TEST_CONNECT_TIMEOUT', String(DEFAULT_TEST_CONNECT_TIMEOUT)));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TEST_CONNECT_TIMEOUT;
}

/** 内存限流参数。 */
export function getRateLimitConfig() {
  const windowMs = Number(getEnv('RATE_LIMIT_WINDOW_MS', '60000'));
  const max = Number(getEnv('RATE_LIMIT_MAX', '120'));
  return {
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60000,
    max: Number.isFinite(max) && max > 0 ? max : 120,
  };
}

/** 启动日志用的端口。 */
export function getPort() {
  const n = Number(getEnv('PORT', '3001'));
  return Number.isFinite(n) && n > 0 ? n : 3001;
}
