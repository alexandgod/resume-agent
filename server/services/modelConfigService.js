/**
 * CR-001 用户级 LLM 配置服务（架构 v1.1）。
 *
 * - 唯一密钥解析入口：resolveModelConfig(userId) —— user > env > null（§6.7 / S1/S2）；
 * - 配置接口语义：GET/PUT/DELETE /api/settings/llm 与 POST /api/settings/llm/test（§5.1）；
 *   GET 返回 {configured, config(掩码安全视图)|null, effectiveSource}，不再有独立 /status 接口；
 * - 密钥加解密全部委托 server/utils/crypto.js（#43），本文件不实现任何密码学原语；
 * - 全部查询按 user_id 强制隔离，显式按配置 id 校验时跨用户 403（S6）；
 * - 明文密钥只在本次请求内存存在，绝不落库/日志/异常 message/错误响应（S5/S9）。
 */
import {
  AppError,
  CODE,
  CONFIG_SOURCE,
  getEnv,
  getLlmTimeout,
  getTestConnectTimeout,
} from '../domain/contracts.js';
import { repo } from '../store/repository.js';
import { encrypt, decrypt, mask, scrubSecret } from '../utils/crypto.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

function nowIso() {
  return new Date().toISOString();
}

/**
 * S2：LLM_API_KEY 为空即视为「无配置」，不发任何网络请求直接走 rule/none；
 * LLM_BASE_URL / LLM_MODEL 缺失只用默认值（启动日志提示）。
 */
export function envLlmConfigured() {
  return Boolean((process.env.LLM_API_KEY || '').trim());
}

/**
 * 校验 OpenAI 兼容接口地址（Q3 建议默认值）：
 * 允许 https://；允许本机 http://localhost 与 http://127.0.0.1，其余公网 http 拒绝 422。
 */
export function validateBaseUrl(input) {
  let parsed;
  try {
    parsed = new URL(String(input || '').trim());
  } catch {
    throw new AppError(CODE.UNPROCESSABLE, '接口地址格式不正确', {
      errKey: 'INVALID_BASE_URL',
      field: 'base_url',
    });
  }
  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  const allowed = protocol === 'https:' || (protocol === 'http:' && isLocal);
  if (!allowed) {
    throw new AppError(CODE.UNPROCESSABLE, '接口地址须为 HTTPS，或本机 http://localhost / http://127.0.0.1', {
      errKey: 'INVALID_BASE_URL',
      field: 'base_url',
    });
  }
  return parsed.toString().replace(/\/+$/, '');
}

/** 对外安全视图（S5）：只回 6 个字段 + 掩码，绝不含密文或完整密钥。 */
export function toSafeConfig(config) {
  return {
    config_name: config?.config_name || '',
    base_url: config?.base_url || '',
    model: config?.model || '',
    api_key_mask: config?.api_key_mask || '',
    is_enabled: Boolean(config?.is_enabled),
    last_tested_at: config?.last_tested_at || '',
  };
}

/** 按配置 id 读取并强制归属校验：不存在 404，跨用户 403（S6）。 */
export async function assertConfigOwner(userId, configId) {
  if (!configId) return null;
  const config = await repo.findOne('model_configs', (item) => item.id === configId);
  if (!config) throw new AppError(CODE.NOT_FOUND, '配置不存在');
  if (config.user_id !== userId) {
    throw new AppError(CODE.FORBIDDEN, '无权限访问该配置');
  }
  return config;
}

/** 读取内部配置文档（含密文），仅服务端使用；按 user_id 隔离。 */
async function getConfigDoc(userId) {
  return repo.findOne('model_configs', (item) => item.user_id === userId);
}

/** 读取已启用配置：走 idx(user_id, is_enabled) 复合索引（v1.1 M-04）。 */
async function findEnabledConfigDoc(userId) {
  return repo.findOneByComposite('model_configs', [userId, 1]);
}

/**
 * 读取当前用户配置的安全视图（内部/测试用；不存在返回 null，不再以 404 为主路径）。
 * @returns {Promise<object|null>}
 */
export async function getConfig(userId) {
  const config = await getConfigDoc(userId);
  return config ? toSafeConfig(config) : null;
}

/**
 * 当前生效来源状态（内部使用；v1.1 已无独立 /status 接口，语义并入 GET 的 effectiveSource）。
 * 不含任何密钥或掩码。
 */
export async function getStatus(userId) {
  const config = await findEnabledConfigDoc(userId);
  if (config) {
    return {
      source: CONFIG_SOURCE.USER,
      generationModeHint: 'ai',
      configName: config.config_name,
      model: config.model,
      baseUrl: config.base_url,
      lastTestedAt: config.last_tested_at || '',
    };
  }
  if (envLlmConfigured()) {
    return {
      source: CONFIG_SOURCE.ENV,
      generationModeHint: 'ai',
      configName: '部署配置',
      model: getEnv('LLM_MODEL', DEFAULT_MODEL),
      baseUrl: getEnv('LLM_BASE_URL', DEFAULT_BASE_URL),
      lastTestedAt: '',
    };
  }
  return { source: CONFIG_SOURCE.NONE, generationModeHint: 'rule' };
}

/** GET /api/settings/llm 的响应体（§5.1 / S5）。 */
export async function getSettings(userId) {
  const config = await getConfigDoc(userId);
  const status = await getStatus(userId);
  return {
    configured: Boolean(config),
    config: config ? toSafeConfig(config) : null,
    effectiveSource: status.source,
  };
}

/** 生效来源字符串（DELETE 响应使用）。 */
export async function getEffectiveSource(userId) {
  const status = await getStatus(userId);
  return status.source;
}

/**
 * PUT /api/settings/llm：新增或更新用户级配置。
 * 请求体 {config_name, base_url, api_key, model, is_enabled}；
 * 编辑已有配置时 api_key 可省略（掩码回显场景沿用已存密文）。
 * @returns {Promise<object>} 掩码安全视图
 */
export async function upsertConfig(userId, dto) {
  const configName = String(dto?.config_name || '').trim();
  const model = String(dto?.model || '').trim();
  const rawKey = String(dto?.api_key || '').trim();
  const baseUrl = validateBaseUrl(dto?.base_url || DEFAULT_BASE_URL);

  if (!configName) {
    throw new AppError(CODE.UNPROCESSABLE, '请填写配置名称', { errKey: 'MISSING_CONFIG_NAME', field: 'config_name' });
  }
  if (!model) {
    throw new AppError(CODE.UNPROCESSABLE, '请填写模型名称', { errKey: 'MISSING_MODEL', field: 'model' });
  }

  const existing = await getConfigDoc(userId);
  if (!existing && !rawKey) {
    throw new AppError(CODE.UNPROCESSABLE, '请填写 API 密钥', { errKey: 'MISSING_API_KEY', field: 'api_key' });
  }

  // 明文只存在于本次请求内存，绝不写入日志、异常或响应（S9）。
  const plainKey = rawKey || decrypt(existing.api_key_encrypted);
  const isEnabled = dto?.is_enabled === undefined ? true : Boolean(dto.is_enabled);
  const timestamp = nowIso();
  const patch = {
    user_id: userId,
    config_name: configName,
    base_url: baseUrl,
    api_key_encrypted: encrypt(plainKey),
    api_key_mask: mask(plainKey),
    model,
    is_enabled: isEnabled ? 1 : 0,
    last_tested_at: String(dto?.last_tested_at || existing?.last_tested_at || ''),
    updated_at: timestamp,
  };

  let saved;
  if (existing) {
    saved = await repo.update('model_configs', existing.id, patch);
  } else {
    saved = await repo.insert('model_configs', { ...patch, created_at: timestamp });
  }
  return toSafeConfig(saved);
}

/** DELETE /api/settings/llm：密文清除且不可恢复；未配置时 404。 */
export async function deleteConfig(userId, configId) {
  const owned = await assertConfigOwner(userId, configId);
  const config = owned || (await getConfigDoc(userId));
  if (!config) throw new AppError(CODE.NOT_FOUND, '尚未配置模型');
  if (config.user_id !== userId) {
    throw new AppError(CODE.FORBIDDEN, '无权限访问该配置');
  }
  await repo.remove('model_configs', config.id);
  return { deleted: true };
}

/**
 * POST /api/settings/llm/test：POST {base_url}/chat/completions，max_tokens=1，10s 超时。
 * 请求体 {config_name?, base_url, api_key?, model}；未传 api_key 时复用本人已存密文。
 * 不落库、不生成简历、不记录明文；失败返回可读原因且不回显密钥（S5/S9）。
 */
export async function testConnection(userId, dto) {
  const existing = await getConfigDoc(userId);
  const baseUrl = validateBaseUrl(dto?.base_url || existing?.base_url || DEFAULT_BASE_URL);
  const model = String(dto?.model || existing?.model || DEFAULT_MODEL).trim();
  if (!model) {
    throw new AppError(CODE.UNPROCESSABLE, '请填写模型名称', { errKey: 'MISSING_MODEL', field: 'model' });
  }

  const providedKey = String(dto?.api_key || '').trim();
  let apiKey = providedKey;
  if (!apiKey) {
    if (existing) {
      apiKey = decrypt(existing.api_key_encrypted);
    } else {
      throw new AppError(CODE.UNPROCESSABLE, '请填写 API 密钥后再测试连接', {
        errKey: 'MISSING_API_KEY',
        field: 'api_key',
      });
    }
  }

  const startedAt = Date.now();
  const timeout = getTestConnectTimeout();
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeout),
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const safeDetail = scrubSecret(String(detail || '').slice(0, 160), apiKey);
      return {
        ok: false,
        latencyMs,
        message: `连接失败（HTTP ${response.status}）：${safeDetail || '接口返回异常'}`,
      };
    }
    return { ok: true, latencyMs, message: '连接成功' };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const name = String(error?.name || '');
    const message = name === 'TimeoutError' || /timeout/i.test(String(error?.message || ''))
      ? `连接超时（${Math.round(timeout / 1000)}s），请检查接口地址与网络`
      : '接口地址不可达或网络异常，请检查配置';
    return { ok: false, latencyMs, message };
  }
}

/**
 * 服务端唯一密钥解析入口（6.7 节 / S1）。
 * 返回 null 表示两级来源均无 → 规则化降级（rule / none）。
 */
export async function resolveModelConfig(userId) {
  const config = await findEnabledConfigDoc(userId);
  if (config) {
    return {
      source: CONFIG_SOURCE.USER,
      baseUrl: config.base_url,
      apiKey: decrypt(config.api_key_encrypted),
      model: config.model,
      timeout: getLlmTimeout(),
    };
  }
  if (envLlmConfigured()) {
    return {
      source: CONFIG_SOURCE.ENV,
      baseUrl: getEnv('LLM_BASE_URL', DEFAULT_BASE_URL),
      apiKey: String(process.env.LLM_API_KEY).trim(),
      model: getEnv('LLM_MODEL', DEFAULT_MODEL),
      timeout: getLlmTimeout(),
    };
  }
  return null;
}
