/**
 * 简历服务：CRUD、另存版本、模板切换、生成落库并留痕。
 * 约定：
 *  - 任何写入 resumes.content_json 的路径都先过 normalizeContent()；
 *  - 模板切换只改 template_id，绝不触碰 content_json；
 *  - 生成时把资料 parsed_text「复制」进 content_json，删除资料不影响简历；
 *  - generation_mode / config_source 与 content_json.meta 同步留痕，禁止错标。
 */
import { AppError, CODE, PARSE_STATUS, RESUME_STATUS, GENERATION_MODE, CONFIG_SOURCE } from '../domain/contracts.js';
import { normalizeContent } from '../domain/contentSchema.js';
import { BUILTIN_TEMPLATES } from '../domain/templates.js';
import { repo } from '../store/repository.js';
import { generateStructured } from './aiService.js';

function nowIso() {
  return new Date().toISOString();
}

/** 默认模板 schema（数据库缺失时的兜底）。 */
function fallbackSchema() {
  return BUILTIN_TEMPLATES[0].schema_json;
}

/** 校验模板 id 存在且可用。 */
async function assertTemplate(templateId) {
  const template = await repo.findOne('templates', (item) => item.id === templateId);
  if (!template) {
    throw new AppError(CODE.UNPROCESSABLE, '所选模板不存在', { errKey: 'TEMPLATE_NOT_FOUND' });
  }
  return template;
}

/** 组装前端详情视图：content + template(schema_json)。 */
async function toDetail(resume) {
  const template = (await repo.findOne('templates', (item) => item.id === resume.template_id))
    || (await repo.findOne('templates', (item) => item.code === 'simple'));
  const { content_json, ...rest } = resume;
  return {
    ...rest,
    content: normalizeContent(content_json),
    template: template?.schema_json || fallbackSchema(),
  };
}

/** 我的简历列表（倒序，含分享状态与生成来源）。 */
export async function list(userId) {
  const rows = await repo.findByUser('resumes', userId);
  const templates = await repo.find('templates');
  const links = await repo.findByUser('share_links', userId);
  const templateMap = new Map(templates.map((item) => [item.id, item.code]));
  const activeResumeIds = new Set(
    links.filter((link) => link.is_enabled).map((link) => link.resume_id),
  );
  return rows
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .map((item) => ({
      id: item.id,
      title: item.title,
      templateCode: templateMap.get(item.template_id) || 'simple',
      status: item.status || RESUME_STATUS.DRAFT,
      shareStatus: activeResumeIds.has(item.id) ? '分享中' : '未分享',
      generationMode: item.generation_mode || GENERATION_MODE.MANUAL,
      configSource: item.config_source || CONFIG_SOURCE.NONE,
      updatedAt: item.updated_at,
      createdAt: item.created_at,
    }));
}

/** 新建空白简历。 */
export async function create(userId, dto) {
  const templateId = String(dto?.templateId || '').trim();
  if (!templateId) {
    throw new AppError(CODE.UNPROCESSABLE, '请选择模板', { errKey: 'MISSING_TEMPLATE_ID' });
  }
  await assertTemplate(templateId);
  const timestamp = nowIso();
  const content = normalizeContent(null);
  content.meta.generatedMode = GENERATION_MODE.MANUAL;
  content.meta.configSource = CONFIG_SOURCE.NONE;
  content.meta.updatedAt = timestamp;
  const resume = await repo.insert('resumes', {
    user_id: userId,
    template_id: templateId,
    title: String(dto?.title || '').trim() || '我的简历',
    content_json: content,
    status: RESUME_STATUS.DRAFT,
    generation_mode: GENERATION_MODE.MANUAL,
    config_source: CONFIG_SOURCE.NONE,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return toDetail(resume);
}

/** 读取详情（跨用户 403）。 */
export async function get(userId, id) {
  const resume = await repo.getOwned('resumes', userId, id);
  return toDetail(resume);
}

/** 更新：标题 / 模板 / 内容 / 状态。模板切换不动 content。 */
export async function update(userId, id, dto) {
  await repo.getOwned('resumes', userId, id);
  const patch = { updated_at: nowIso() };

  if (dto?.title !== undefined) {
    const title = String(dto.title).trim();
    if (!title) {
      throw new AppError(CODE.UNPROCESSABLE, '简历标题不能为空', { errKey: 'EMPTY_TITLE' });
    }
    patch.title = title;
  }
  if (dto?.templateId !== undefined) {
    await assertTemplate(String(dto.templateId));
    patch.template_id = String(dto.templateId);
  }
  if (dto?.status !== undefined) {
    const status = String(dto.status);
    if (![RESUME_STATUS.DRAFT, RESUME_STATUS.FINAL].includes(status)) {
      throw new AppError(CODE.UNPROCESSABLE, '简历状态不合法', { errKey: 'INVALID_STATUS' });
    }
    patch.status = status;
  }
  if (dto?.content !== undefined) {
    // 手动编辑也必须规范化，且保留原有生成来源留痕。
    const previous = await repo.getOwned('resumes', userId, id);
    const previousMeta = previous.content_json?.meta || {};
    const content = normalizeContent(dto.content);
    content.meta.schemaVersion = 1;
    content.meta.generatedMode = previousMeta.generatedMode || content.meta.generatedMode;
    content.meta.configSource = previousMeta.configSource || content.meta.configSource;
    content.meta.updatedAt = patch.updated_at;
    patch.content_json = content;
  }

  const updated = await repo.update('resumes', id, patch);
  return toDetail(updated);
}

/** 另存为新版本：内容快照也必须先过 normalizeContent()。 */
export async function copy(userId, id, dto) {
  const source = await repo.getOwned('resumes', userId, id);
  const timestamp = nowIso();
  const content = normalizeContent(source.content_json);
  content.meta.updatedAt = timestamp;
  const resume = await repo.insert('resumes', {
    user_id: userId,
    template_id: source.template_id,
    title: String(dto?.title || '').trim() || `${source.title}（副本）`,
    content_json: content,
    status: RESUME_STATUS.DRAFT,
    generation_mode: source.generation_mode || GENERATION_MODE.MANUAL,
    config_source: source.config_source || CONFIG_SOURCE.NONE,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return toDetail(resume);
}

/** 删除简历：级联禁用其所有分享链接，资料不受影响。 */
export async function remove(userId, id) {
  await repo.getOwned('resumes', userId, id);
  const links = await repo.findByUser('share_links', userId, (link) => link.resume_id === id);
  for (const link of links) {
    if (link.is_enabled) {
      await repo.update('share_links', link.id, {
        is_enabled: 0,
        revoked_at: nowIso(),
      });
    }
  }
  await repo.remove('resumes', id);
  return { deleted: true };
}

/**
 * 一键生成：汇总本人已成功解析的资料文本 → generateStructured() → 落库留痕。
 * 失败降级仍返回 200；响应体带 generationMode / configSource / degradedReason。
 */
export async function generate(userId, id, dto) {
  await repo.getOwned('resumes', userId, id);

  let materials = await repo.findByUser(
    'materials',
    userId,
    (item) => item.parse_status === PARSE_STATUS.SUCCESS && String(item.parsed_text || '').trim() !== '',
  );
  if (Array.isArray(dto?.materialIds) && dto.materialIds.length > 0) {
    const wanted = new Set(dto.materialIds.map(String));
    materials = materials.filter((item) => wanted.has(String(item.id)));
  }
  const texts = materials.map((item) => String(item.parsed_text || '')).filter(Boolean);

  const result = await generateStructured(userId, texts);
  const timestamp = nowIso();
  const content = normalizeContent(result.content);
  content.meta.schemaVersion = 1;
  content.meta.generatedMode = result.generationMode;
  content.meta.configSource = result.configSource;
  content.meta.updatedAt = timestamp;

  const updated = await repo.update('resumes', id, {
    content_json: content,
    generation_mode: result.generationMode,
    config_source: result.configSource,
    updated_at: timestamp,
  });

  return {
    resume: await toDetail(updated),
    generationMode: result.generationMode,
    configSource: result.configSource,
    ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
  };
}
