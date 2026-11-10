/**
 * 账号服务：注册 / 登录 / 登出黑名单 / me / 注销级联清理。
 * - 密码 bcryptjs 加盐哈希，≥8 位含字母+数字；
 * - JWT 7 天含 jti，登出写 revoked_tokens（旧 token 立即 401）；
 * - 连续 5 次错误锁 5 分钟，返回 429 + data.lockedUntil；
 * - 注销级联清理简历 / 资料 / 分享 / 配置 / 上传文件。
 */
import fs from 'node:fs/promises';
import {
  AppError,
  CODE,
  LOCK_ATTEMPTS,
  LOCK_DURATION_MS,
  getUploadsDir,
} from '../domain/contracts.js';
import { repo } from '../store/repository.js';
import { generateId, hashPassword, verifyPassword, signToken } from '../utils/security.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[\w\u4e00-\u9fa5.-]{2,30}$/u;

function nowIso() {
  return new Date().toISOString();
}

/** 对外安全的用户视图，绝不包含 password_hash / salt。 */
export function toSafeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    status: user.status,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

function assertPassword(password) {
  const value = String(password || '');
  if (value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new AppError(CODE.UNPROCESSABLE, '密码需至少 8 位且包含字母与数字', {
      errKey: 'WEAK_PASSWORD',
      field: 'password',
    });
  }
}

/** 注册。 */
export async function register(dto) {
  const email = String(dto?.email || '').trim().toLowerCase();
  const username = String(dto?.username || '').trim();
  const password = String(dto?.password || '');
  const confirmPassword = String(dto?.confirmPassword || '');

  if (!EMAIL_RE.test(email)) {
    throw new AppError(CODE.UNPROCESSABLE, '邮箱格式不正确', { errKey: 'INVALID_EMAIL', field: 'email' });
  }
  if (!USERNAME_RE.test(username)) {
    throw new AppError(CODE.UNPROCESSABLE, '用户名需为 2~30 位中英文、数字、点、短横线或下划线', {
      errKey: 'INVALID_USERNAME',
      field: 'username',
    });
  }
  assertPassword(password);
  if (password !== confirmPassword) {
    throw new AppError(CODE.UNPROCESSABLE, '两次输入的密码不一致', {
      errKey: 'PASSWORD_MISMATCH',
      field: 'confirmPassword',
    });
  }

  const byEmail = await repo.findOne('users', (u) => String(u.email).toLowerCase() === email);
  if (byEmail) {
    throw new AppError(CODE.CONFLICT, '该邮箱已被注册', { errKey: 'EMAIL_EXISTS', field: 'email' });
  }
  const byUsername = await repo.findOne('users', (u) => u.username === username);
  if (byUsername) {
    throw new AppError(CODE.CONFLICT, '该用户名已被使用', { errKey: 'USERNAME_EXISTS', field: 'username' });
  }

  const { password_hash, salt } = hashPassword(password);
  const timestamp = nowIso();
  const user = await repo.insert('users', {
    id: generateId(),
    email,
    username,
    password_hash,
    salt,
    status: 'active',
    failed_attempts: 0,
    locked_until: '',
    created_at: timestamp,
    updated_at: timestamp,
  });
  const session = signToken(user);
  return { user: toSafeUser(user), token: session.token, expiresIn: session.expiresIn };
}

/**
 * 登录：支持邮箱或用户名；连续 5 次错误锁 5 分钟。
 * 未锁定前 1~4 次返回 401；第 5 次及锁定期内返回 429 + data.lockedUntil。
 */
export async function login(dto) {
  const account = String(dto?.account || '').trim();
  const password = String(dto?.password || '');
  if (!account || !password) {
    throw new AppError(CODE.UNPROCESSABLE, '请填写账号与密码', { errKey: 'MISSING_CREDENTIALS' });
  }

  const normalized = account.toLowerCase();
  const user = await repo.findOne(
    'users',
    (u) => String(u.email).toLowerCase() === normalized || u.username === account,
  );
  if (!user) {
    throw new AppError(CODE.UNAUTHORIZED, '账号或密码错误', { errKey: 'BAD_CREDENTIALS' });
  }

  const lockedUntilMs = user.locked_until ? Date.parse(user.locked_until) : 0;
  if (Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now()) {
    throw new AppError(CODE.RATE_LIMITED, '错误次数过多，账号已临时锁定，请 5 分钟后重试', {
      errKey: 'ACCOUNT_LOCKED',
      lockedUntil: user.locked_until,
    });
  }

  if (!verifyPassword(password, user.password_hash)) {
    const attempts = Number(user.failed_attempts || 0) + 1;
    const shouldLock = attempts >= LOCK_ATTEMPTS;
    const lockedUntil = shouldLock
      ? new Date(Date.now() + LOCK_DURATION_MS).toISOString()
      : '';
    await repo.update('users', user.id, {
      failed_attempts: shouldLock ? LOCK_ATTEMPTS : attempts,
      locked_until: lockedUntil,
      status: shouldLock ? 'locked' : 'active',
      updated_at: nowIso(),
    });
    if (shouldLock) {
      throw new AppError(CODE.RATE_LIMITED, '连续 5 次密码错误，账号已锁定 5 分钟', {
        errKey: 'ACCOUNT_LOCKED',
        lockedUntil,
      });
    }
    throw new AppError(CODE.UNAUTHORIZED, `账号或密码错误，还可尝试 ${LOCK_ATTEMPTS - attempts} 次`, {
      errKey: 'BAD_CREDENTIALS',
    });
  }

  // 登录成功：清零失败计数并解除锁定。
  const refreshed = await repo.update('users', user.id, {
    failed_attempts: 0,
    locked_until: '',
    status: 'active',
    updated_at: nowIso(),
  });
  const session = signToken(refreshed);
  return { user: toSafeUser(refreshed), token: session.token, expiresIn: session.expiresIn };
}

/** 登出：jti 写入黑名单，并惰性清理已过期项。 */
export async function logout(jti, exp) {
  if (!jti) return;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expired = await repo.find('revoked_tokens', (item) => Number(item.exp || 0) <= nowSeconds);
  for (const item of expired) {
    await repo.remove('revoked_tokens', item.id);
  }
  const exists = await repo.findOne('revoked_tokens', (item) => item.jti === jti);
  if (exists) return;
  await repo.insert('revoked_tokens', {
    jti,
    exp: Number(exp || nowSeconds + 7 * 24 * 3600),
    created_at: nowIso(),
  });
}

/** 供测试与中间件复用：判断 jti 是否已进入黑名单。 */
export async function isTokenRevoked(jti) {
  if (!jti) return false;
  const item = await repo.findOne('revoked_tokens', (entry) => entry.jti === jti);
  return Boolean(item);
}

/** 当前用户信息。 */
export async function me(userId) {
  const user = await repo.findOne('users', (u) => u.id === userId);
  if (!user) throw new AppError(CODE.NOT_FOUND, '账号不存在');
  return toSafeUser(user);
}

/**
 * 注销账号：级联清理简历、资料、分享链接、模型配置、上传文件与用户本身。
 * revoked_tokens 不含 user_id，由调用方把当前 token 加入黑名单。
 */
export async function deleteAccount(userId) {
  const resumes = await repo.findByUser('resumes', userId);
  const materials = await repo.findByUser('materials', userId);
  const shares = await repo.findByUser('share_links', userId);
  const configs = await repo.findByUser('model_configs', userId);

  for (const share of shares) await repo.remove('share_links', share.id);
  for (const config of configs) await repo.remove('model_configs', config.id);
  for (const material of materials) await repo.remove('materials', material.id);
  for (const resume of resumes) await repo.remove('resumes', resume.id);

  try {
    await fs.rm(getUploadsDir(userId), { recursive: true, force: true });
  } catch {
    // 文件清理失败不阻塞账号注销。
  }

  const user = await repo.findOne('users', (u) => u.id === userId);
  if (user) await repo.remove('users', user.id);
  return { deleted: true };
}
