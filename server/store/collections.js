/**
 * 集合定义、默认值、唯一键声明与启动 seed 入口。
 * data/db.json 单文件结构固定为 7 个集合，所有时间统一 ISO 8601 UTC 字符串。
 */
import { seedTemplates } from '../domain/templates.js';

/** 7 个集合，顺序即写入 db.json 的键顺序。 */
export const COLLECTION_NAMES = [
  'users',
  'resumes',
  'materials',
  'templates',
  'share_links',
  'model_configs',
  'revoked_tokens',
];

/**
 * 唯一键（Repository 写入时校验，冲突抛 409）。
 * users.email / users.username / templates.code / share_links.token /
 * model_configs.user_id / revoked_tokens.jti
 */
export const UNIQUE_KEYS = {
  users: ['email', 'username'],
  resumes: [],
  materials: [],
  templates: ['code'],
  share_links: ['token'],
  // v1.1 M-04：MVP 每用户 1 套配置；P1 R-036 放开多套时仅需去掉此唯一约束、
  // 改查询取 is_enabled=1 的一条，集合字段（表结构）零改动。
  model_configs: ['user_id'],
  revoked_tokens: ['jti'],
};

/**
 * 复合查询索引声明（v1.1 §3.2）。
 * JSON Store 无原生索引：Repository 启动时在内存为每个声明构建
 * 「字段组合值 → id 集合」的 Map，写入时同步维护；类图按 User 1:N ModelConfig 表达。
 * 未来迁移到 SQLite 时，本声明即对应 CREATE INDEX，业务层零改动。
 */
export const COMPOSITE_INDEXES = {
  resumes: { name: 'idx_resumes_user_updated', fields: ['user_id', 'updated_at'] },
  materials: { name: 'idx_materials_user_created', fields: ['user_id', 'created_at'] },
  share_links: { name: 'idx_sharelinks_resume_enabled', fields: ['resume_id', 'is_enabled'] },
  model_configs: { name: 'idx_modelconfigs_user_enabled', fields: ['user_id', 'is_enabled'] },
};

/** 生成一份全新的空数据库（深拷贝，避免共享引用）。 */
export function createEmptyDb() {
  const db = {};
  for (const name of COLLECTION_NAMES) {
    db[name] = [];
  }
  return db;
}

/**
 * 启动 seed 入口：保证 3 套内置模板幂等写入。
 * @param {object} repo Repository 实例
 * @returns {Promise<number>} 模板数量
 */
export async function runSeed(repo) {
  return seedTemplates(repo);
}
