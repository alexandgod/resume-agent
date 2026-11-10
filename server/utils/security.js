/**
 * 认证原语工具（v1.1：密钥加解密已拆至 server/utils/crypto.js #43）。
 * 只负责：bcryptjs 密码哈希/校验、JWT 签发/验证（含 jti）、
 * ≥128bit 高熵分享 token、公开链接 URL 拼装、UUID 生成。
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  AppError,
  CODE,
  getJwtSecret,
  getJwtExpiresIn,
  getPublicBaseUrl,
} from '../domain/contracts.js';

/** 密码加盐哈希，返回 password_hash 与 salt（明文不落库）。 */
export function hashPassword(plainPassword) {
  const salt = bcrypt.genSaltSync(10);
  return {
    password_hash: bcrypt.hashSync(String(plainPassword), salt),
    salt,
  };
}

/** 校验密码；任何异常都视为校验失败，不泄露细节。 */
export function verifyPassword(plainPassword, passwordHash) {
  try {
    return bcrypt.compareSync(String(plainPassword), String(passwordHash || ''));
  } catch {
    return false;
  }
}

/**
 * 签发 JWT：载荷含 sub(user.id) 与 jti，默认 7 天过期。
 * @returns {{token: string, jti: string, exp: number, expiresIn: string}}
 */
export function signToken(user) {
  const jti = crypto.randomUUID();
  const expiresIn = getJwtExpiresIn();
  const token = jwt.sign({ sub: user.id, jti }, getJwtSecret(), { expiresIn });
  const decoded = jwt.decode(token);
  return {
    token,
    jti,
    exp: typeof decoded?.exp === 'number' ? decoded.exp : 0,
    expiresIn,
  };
}

/** 验证 JWT，失败统一抛 401（前端清 token 并跳登录）。 */
export function verifyToken(token) {
  try {
    return jwt.verify(String(token), getJwtSecret());
  } catch {
    throw new AppError(CODE.UNAUTHORIZED, '登录状态已失效，请重新登录');
  }
}

/** 生成 UUID（所有集合 id）。 */
export function generateId() {
  return crypto.randomUUID();
}

/** 生成 ≥128bit 高熵分享 token（base64url，22 字符）。 */
export function generateShareToken() {
  return crypto.randomBytes(16).toString('base64url');
}

/** 拼装公开链接：${PUBLIC_BASE_URL}/s/${token}。 */
export function buildPublicUrl(token) {
  return `${getPublicBaseUrl()}/s/${token}`;
}
