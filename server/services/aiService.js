/**
 * AI 生成编排（Strategy + Fallback Orchestrator）。
 * 严格按 6.7 节：
 *   resolveModelConfig(userId) → 无配置 → rule / none；
 *   有配置 → Node 内置 fetch 调 {base_url}/chat/completions（AbortSignal.timeout）；
 *   成功 → normalizeContent() → ai / (user|env)；
 *   失败 / 超时 / 非法 JSON → 本次直接降级 rule，**保留被选来源 configSource，绝不换源**。
 * 任何情况下响应体、日志、异常都不含密钥明文或掩码。
 */
import { CONFIG_SOURCE, GENERATION_MODE } from '../domain/contracts.js';
import { normalizeContent } from '../domain/contentSchema.js';
import { resolveModelConfig } from './modelConfigService.js';
import { ruleBasedGenerate } from './ruleGenerator.js';
import { scrubSecret } from '../utils/crypto.js';

const SYSTEM_PROMPT = [
  '你是专业的中文简历整理助手。请把用户提供的零散履历资料整理成结构化 JSON。',
  '只输出一个 JSON 对象，不要输出解释文字或 Markdown 代码块。',
  '顶层字段固定为：basic, education, work, project, skill, certificate, summary, meta。',
  'basic 含 name, gender, birthDate, phone, email, location, jobTarget, avatarUrl, links(label,url)。',
  'education 元素含 school, degree, major, startDate, endDate, description。',
  'work 元素含 company, position, location, startDate, endDate, highlights(字符串数组)。',
  'project 元素含 name, role, startDate, endDate, description, highlights(字符串数组), link。',
  'skill 元素含 category, items(字符串数组), level。',
  'certificate 元素含 name, issuer, date, description。',
  'summary 含 content, highlights(字符串数组)。',
  '所有字段可为空字符串或空数组；不得编造资料中不存在的信息；日期使用 YYYY-MM 格式。',
].join('\n');

/** 从模型输出中稳健地提取 JSON 对象（支持 ```json 包裹）。 */
export function extractJson(rawText) {
  let text = String(rawText || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('模型未返回 JSON 对象');
  }
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模型返回内容不是合法 JSON 对象');
  }
  // 兼容模型把结果包在 content / resume / data / result 里的情况。
  for (const key of ['content', 'resume', 'data', 'result']) {
    const nested = parsed[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return nested;
    }
  }
  return parsed;
}

/** 错误脱敏：只返回可读中文原因，绝不携带密钥或原始异常堆栈。 */
export function safeReason(error) {
  const detail = String(error?.message || '');
  const name = String(error?.name || '');
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|abort/i.test(detail)) {
    return '模型调用超时，已自动降级为规则化生成';
  }
  if (/HTTP\s*(401|403)/.test(detail)) {
    return '密钥无效或无权限，已自动降级为规则化生成';
  }
  if (/HTTP\s*404|接口地址不可达/.test(detail)) {
    return '接口地址不可达，已自动降级为规则化生成';
  }
  if (/JSON/.test(detail)) {
    return '模型返回内容不是合法 JSON，已自动降级为规则化生成';
  }
  return '模型调用失败，已自动降级为规则化生成';
}

/**
 * 调用 OpenAI 兼容 /chat/completions（不引入任何 SDK，厂商无关）。
 * @param {object} cfg resolveModelConfig 的结果
 * @param {string[]} texts 资料文本
 * @returns {Promise<object>} 结构化 JSON 对象
 */
export async function callCompatible(cfg, texts) {
  const baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '');
  const body = JSON.stringify({
    model: cfg.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `请把以下资料整理成简历 JSON：\n\n${(Array.isArray(texts) ? texts : [texts])
          .map((item) => String(item || ''))
          .join('\n\n---\n\n')
          .slice(0, 60000)}`,
      },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body,
    signal: AbortSignal.timeout(cfg.timeout),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const safe = scrubSecret(String(detail || '').slice(0, 200), cfg.apiKey);
    throw new Error(`HTTP ${response.status}: ${safe}`);
  }

  const payload = await response.json();
  const rawText = payload?.choices?.[0]?.message?.content;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('模型未返回内容');
  }
  return extractJson(rawText);
}

/**
 * 生成结构化简历（唯一编排入口）。
 * @param {string} userId 当前用户 id
 * @param {string[]} texts 已解析资料文本
 * @returns {Promise<{content: object, generationMode: string, configSource: string, degradedReason?: string}>}
 */
export async function generateStructured(userId, texts) {
  const normalizedTexts = Array.isArray(texts) ? texts.map((item) => String(item || '')) : [];
  let cfg = null;
  try {
    cfg = await resolveModelConfig(userId);
  } catch {
    // 配置解析异常（如密文损坏）：本次直接降级，不泄露任何密钥信息。
    return {
      content: normalizeContent(ruleBasedGenerate(normalizedTexts)),
      generationMode: GENERATION_MODE.RULE,
      configSource: CONFIG_SOURCE.NONE,
      degradedReason: '配置解析失败，已自动降级为规则化生成',
    };
  }

  if (!cfg) {
    return {
      content: normalizeContent(ruleBasedGenerate(normalizedTexts)),
      generationMode: GENERATION_MODE.RULE,
      configSource: CONFIG_SOURCE.NONE,
    };
  }

  try {
    const raw = await callCompatible(cfg, normalizedTexts);
    return {
      content: normalizeContent(raw),
      generationMode: GENERATION_MODE.AI,
      configSource: cfg.source,
    };
  } catch (error) {
    // ★ 不自动切换到另一密钥来源，避免账单归属混淆。
    return {
      content: normalizeContent(ruleBasedGenerate(normalizedTexts)),
      generationMode: GENERATION_MODE.RULE,
      configSource: cfg.source,
      degradedReason: safeReason(error),
    };
  }
}
