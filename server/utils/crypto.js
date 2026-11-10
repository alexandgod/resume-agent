/**
 * CR-001 独立加解密工具（#43，T03）—— 只依赖 Node 内置 crypto，零依赖零编译。
 *
 * 职责：AES-256-GCM 加解密（随机 12 字节 IV + 认证 tag）、末 4 位掩码、
 *       由 MODEL_CONFIG_SECRET 或 JWT_SECRET 派生加密密钥、错误体密钥脱敏。
 * 职责边界：认证原语（bcryptjs / JWT / 分享 token / 公开 URL）留在 security.js。
 *
 * 硬性约定（v1.1 §6.7.1 S5 / S9 / S10）：
 *  - 库内只存 api_key_encrypted（密文）与 api_key_mask（掩码），永无明文；
 *  - 明文密钥只在本次请求内存存在，绝不写入 console/日志/异常 message/
 *    错误响应/简历记录/分享快照/任何落库字段；
 *  - decrypt 失败抛 AppError(500,'密钥解析失败')，异常信息不含任何明文；
 *  - 本文件不内置任何真实密钥，不绑定厂商、不做厂商专有分支。
 */
import crypto from 'node:crypto';
import { AppError, CODE, getJwtSecret } from '../domain/contracts.js';

/**
 * 加密密钥：
 * - 优先取 MODEL_CONFIG_SECRET（服务端环境变量，由 dotenv 从 .env 读入，不入库）；
 * - 未配置时由 JWT_SECRET 经 scrypt 派生（仍是服务端密钥、不入库，保证零配置可跑）。
 * @returns {Buffer} 32 字节密钥
 */
export function getEncryptionKey() {
  const configured = String(process.env.MODEL_CONFIG_SECRET || '').trim();
  if (configured) {
    return crypto.createHash('sha256').update(configured, 'utf8').digest();
  }
  return crypto.scryptSync(getJwtSecret(), 'ra-model-cfg', 32);
}

/**
 * AES-256-GCM 加密。
 * @param {string} plain 明文密钥（只在调用方本次请求内存中存在）
 * @returns {string} base64(iv).base64(tag).base64(cipher)，iv 为 12 字节随机值
 */
export function encrypt(plain) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plain), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

/**
 * 解密；失败一律收敛为 AppError(500,'密钥解析失败')，绝不把明文写入异常。
 * @param {string} payload 密文串
 * @returns {string} 明文（仅服务端本次请求内存使用）
 */
export function decrypt(payload) {
  try {
    const parts = String(payload || '').split('.');
    if (parts.length !== 3) throw new Error('密文格式错误');
    const [ivText, tagText, cipherText] = parts;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivText, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherText, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    throw new AppError(CODE.INTERNAL, '密钥解析失败');
  }
}

/**
 * 掩码：取前缀 `sk-` 或前 2 位 + 16 个星号 + 末 4 位，
 * 形如 `sk-****************3f9a`；明文过短时只返回星号，不泄露任何字符。
 * @param {string} plain
 */
export function mask(plain) {
  const value = String(plain || '');
  if (value.length < 4) return '*'.repeat(20);
  const prefix = value.startsWith('sk-') ? 'sk-' : value.slice(0, 2);
  const suffix = value.slice(-4);
  return `${prefix}${'*'.repeat(16)}${suffix}`;
}

/**
 * 把外部错误文本中可能回显的密钥明文替换为占位符（S9 不回显密钥）。
 * @param {string} text 外部响应文本（会被截断后传入）
 * @param {string} secret 本次使用的明文密钥
 * @returns {string} 脱敏文本
 */
export function scrubSecret(text, secret) {
  const raw = String(text || '');
  if (!secret) return raw;
  return raw.split(String(secret)).join('[已隐藏]');
}
