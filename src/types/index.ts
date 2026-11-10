/**
 * 全端共享类型（跨端复用，不依赖任何框架）。
 * 字段与 docs/02-ARCHITECTURE.md 第 3 节数据模型一一对应。
 */

/** 统一响应体。 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 用户（对外安全视图）。 */
export interface User {
  id: string;
  email: string;
  username: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** 生成方式。 */
export type GenerationMode = 'ai' | 'rule' | 'manual';
/** 密钥来源。 */
export type ConfigSource = 'user' | 'env' | 'none';
/** 资料解析状态。 */
export type ParseStatus = 'pending' | 'success' | 'failed' | 'skipped';
/** 简历状态。 */
export type ResumeStatus = 'draft' | 'final';

// ── content_json ─────────────────────────────────────────────────
export interface ContentLink {
  label: string;
  url: string;
}

export interface BasicInfo {
  name: string;
  gender: string;
  birthDate: string;
  phone: string;
  email: string;
  location: string;
  jobTarget: string;
  avatarUrl: string;
  links: ContentLink[];
}

export interface EducationItem {
  id: string;
  school: string;
  degree: string;
  major: string;
  startDate: string;
  endDate: string;
  description: string;
}

export interface WorkItem {
  id: string;
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  highlights: string[];
}

export interface ProjectItem {
  id: string;
  name: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
  highlights: string[];
  link: string;
}

export interface SkillItem {
  id: string;
  category: string;
  items: string[];
  level: string;
}

export interface CertificateItem {
  id: string;
  name: string;
  issuer: string;
  date: string;
  description: string;
}

export interface Summary {
  content: string;
  highlights: string[];
}

export interface ContentMeta {
  schemaVersion: number;
  generatedMode: GenerationMode;
  configSource: ConfigSource;
  updatedAt: string;
}

/** 7 个业务分区 + meta。 */
export interface ContentJson {
  basic: BasicInfo;
  education: EducationItem[];
  work: WorkItem[];
  project: ProjectItem[];
  skill: SkillItem[];
  certificate: CertificateItem[];
  summary: Summary;
  meta?: ContentMeta;
}

export const SECTION_KEYS: string[] = [
  'basic', 'education', 'work', 'project', 'skill', 'certificate', 'summary',
];

// ── 模板 schema ──────────────────────────────────────────────────
export interface TemplateTheme {
  primary: string;
  text: string;
  muted: string;
  bg: string;
  accent: string;
}

export interface TemplateStyle {
  fontFamily: string;
  baseFontSize: number;
  lineHeight: number;
  sectionGap: number;
  radius: number;
  headerLayout: 'left' | 'center' | 'banner';
  density: 'compact' | 'normal';
  showAvatar: boolean;
}

export interface TemplateSection {
  key: string;
  title: string;
  enabled: boolean;
  order: number;
  layout: 'inline' | 'list' | 'cards' | 'text';
}

export interface TemplateSchema {
  code: string;
  name: string;
  description?: string;
  tags?: string[];
  preview_url?: string;
  theme: TemplateTheme;
  style: TemplateStyle;
  sections: TemplateSection[];
}

export interface Template {
  id: string;
  code: string;
  name: string;
  preview_url: string;
  schema_json: TemplateSchema;
  is_builtin: number;
  sort_order: number;
  status: string;
}

// ── 资料 / 简历 ──────────────────────────────────────────────────
export interface Material {
  id: string;
  user_id: string;
  resume_id: string | null;
  type: string;
  file_name: string;
  file_url: string;
  raw_text: string;
  parsed_text: string;
  parse_status: ParseStatus;
  parse_message?: string;
  size: number;
  created_at: string;
}

export interface Resume {
  id: string;
  user_id: string;
  template_id: string;
  title: string;
  status: ResumeStatus;
  generation_mode: GenerationMode;
  config_source: ConfigSource;
  created_at: string;
  updated_at: string;
}

/** 简历详情：携带规范化 content 与模板 schema。 */
export interface ResumeDetail extends Resume {
  content: ContentJson;
  template: TemplateSchema;
}

export interface ResumeListItem {
  id: string;
  title: string;
  templateCode: string;
  status: ResumeStatus;
  shareStatus: string;
  generationMode: GenerationMode;
  configSource: ConfigSource;
  updatedAt: string;
  createdAt: string;
}

// ── 分享 ─────────────────────────────────────────────────────────
export interface ShareView {
  enabled: boolean;
  url: string;
  token: string;
  viewCount: number;
  createdAt: string;
  revokedAt: string;
}

/** 公开快照（只含 4 个白名单字段）。 */
export interface PublicSnapshot {
  title: string;
  content: ContentJson;
  template: TemplateSchema;
  publishedAt: string;
}

export interface QrView {
  dataUrl: string;
  url: string;
}

// ── CR-001 模型配置 ──────────────────────────────────────────────
export interface ModelConfig {
  config_name: string;
  base_url: string;
  model: string;
  api_key_mask: string;
  is_enabled: boolean;
  last_tested_at: string;
}

/** GET/PUT /api/settings/llm 的响应 data（v1.1 §5.1）。 */
export interface LlmSettings {
  configured: boolean;
  config: ModelConfig | null;
  effectiveSource: ConfigSource;
}

/** DELETE /api/settings/llm 的响应 data。 */
export interface LlmDeleteResult {
  configured: false;
  effectiveSource: ConfigSource;
}

/** POST /api/settings/llm/test 请求体（api_key 省略时复用已存密文）。 */
export interface LlmTestPayload {
  config_name?: string;
  base_url: string;
  api_key?: string;
  model: string;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface ModelConfigPayload {
  config_name: string;
  base_url: string;
  api_key: string;
  model: string;
  is_enabled: boolean;
  last_tested_at?: string;
}

// ── 生成结果 ─────────────────────────────────────────────────────
export interface GenerateResult {
  resume: ResumeDetail;
  generationMode: GenerationMode;
  configSource: ConfigSource;
  degradedReason?: string;
}

/** 带结构化错误信息的客户端异常。 */
export interface ApiErrorData {
  errKey?: string;
  lockedUntil?: string;
  field?: string;
  [key: string]: unknown;
}
