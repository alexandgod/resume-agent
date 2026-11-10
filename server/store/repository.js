/**
 * Repository —— 唯一数据访问出入口（依赖倒置：业务层只依赖本层接口）。
 * 强制要点：
 *  - 唯一键在内存建 Map，写入时同步维护，冲突抛 AppError(409)；
 *  - 所有私有查询通过 findByUser / getOwned 强制 user_id 过滤；
 *  - 跨用户访问返回 403（不是 404），资源不存在返回 404；
 *  - 所有写操作经 JsonStore.commit() 串行写队列。
 */
import { randomUUID } from 'node:crypto';
import { JsonStore } from './jsonStore.js';
import { COLLECTION_NAMES, UNIQUE_KEYS, COMPOSITE_INDEXES } from './collections.js';
import { AppError, CODE } from '../domain/contracts.js';

function cloneDoc(doc) {
  return structuredClone(doc);
}

/** 把复合索引字段组合值编码为稳定的 Map key。 */
function compositeKey(fields, doc) {
  return fields.map((field) => String(doc?.[field] ?? '')).join('\u0001');
}

function assertCollection(coll) {
  if (!COLLECTION_NAMES.includes(coll)) {
    throw new AppError(CODE.INTERNAL, '数据集合不存在');
  }
}

export class Repository {
  /** @param {JsonStore} store */
  constructor(store) {
    this.store = store;
    this.rebuildIndexes();
  }

  /** 启动时为唯一键与复合查询索引构建内存 Map（v1.1 §3.2 / M-04）。 */
  rebuildIndexes() {
    /** @type {Map<string, Map<string, Map<string, string>>>} */
    this.uniqueMaps = new Map();
    for (const coll of COLLECTION_NAMES) {
      const fieldMaps = new Map();
      for (const field of UNIQUE_KEYS[coll] || []) {
        const valueMap = new Map();
        for (const doc of this.store.read(coll)) {
          const value = doc[field];
          if (value !== undefined && value !== null && value !== '') {
            valueMap.set(String(value), doc.id);
          }
        }
        fieldMaps.set(field, valueMap);
      }
      this.uniqueMaps.set(coll, fieldMaps);
    }

    /** @type {Map<string, {fields: string[], map: Map<string, Set<string>>}>} */
    this.compositeMaps = new Map();
    for (const [coll, definition] of Object.entries(COMPOSITE_INDEXES)) {
      const indexMap = new Map();
      for (const doc of this.store.read(coll)) {
        const key = compositeKey(definition.fields, doc);
        if (!indexMap.has(key)) indexMap.set(key, new Set());
        indexMap.get(key).add(doc.id);
      }
      this.compositeMaps.set(coll, { fields: definition.fields, map: indexMap });
    }
  }

  /** 复合索引：新增/更新条目时同步维护。 */
  syncCompositeAdd(coll, doc) {
    const entry = this.compositeMaps.get(coll);
    if (!entry) return;
    const key = compositeKey(entry.fields, doc);
    if (!entry.map.has(key)) entry.map.set(key, new Set());
    entry.map.get(key).add(doc.id);
  }

  /** 复合索引：删除/更新条目时同步维护。 */
  syncCompositeRemove(coll, doc) {
    const entry = this.compositeMaps.get(coll);
    if (!entry) return;
    const key = compositeKey(entry.fields, doc);
    const ids = entry.map.get(key);
    if (!ids) return;
    ids.delete(doc.id);
    if (ids.size === 0) entry.map.delete(key);
  }

  /** 唯一键冲突校验（自身 id 允许保持原值）。 */
  assertUnique(coll, doc) {
    const fieldMaps = this.uniqueMaps.get(coll);
    if (!fieldMaps) return;
    for (const [field, valueMap] of fieldMaps) {
      const value = doc[field];
      if (value === undefined || value === null || value === '') continue;
      const ownerId = valueMap.get(String(value));
      if (ownerId && ownerId !== doc.id) {
        throw new AppError(CODE.CONFLICT, '该信息已被占用，请更换后重试', {
          errKey: 'UNIQUE_CONFLICT',
          field,
        });
      }
    }
  }

  syncIndexAdd(coll, doc) {
    this.syncCompositeAdd(coll, doc);
    const fieldMaps = this.uniqueMaps.get(coll);
    if (!fieldMaps) return;
    for (const [field, valueMap] of fieldMaps) {
      const value = doc[field];
      if (value !== undefined && value !== null && value !== '') {
        valueMap.set(String(value), doc.id);
      }
    }
  }

  syncIndexRemove(coll, doc) {
    this.syncCompositeRemove(coll, doc);
    const fieldMaps = this.uniqueMaps.get(coll);
    if (!fieldMaps) return;
    for (const [field, valueMap] of fieldMaps) {
      const value = doc[field];
      if (value === undefined || value === null || value === '') continue;
      if (valueMap.get(String(value)) === doc.id) valueMap.delete(String(value));
    }
  }

  /** 包装 store.commit：写失败时重建索引，保证内存索引与快照一致。 */
  async commit(mutator) {
    try {
      return await this.store.commit(mutator);
    } catch (error) {
      this.rebuildIndexes();
      throw error;
    }
  }

  /**
   * 条件查询（返回深拷贝，调用方无法直接污染内存快照）。
   * @param {string} coll
   * @param {(doc: object) => boolean} predicate
   */
  async find(coll, predicate = () => true) {
    assertCollection(coll);
    const rows = this.store.read(coll).filter((doc) => {
      try {
        return Boolean(predicate(doc));
      } catch {
        return false;
      }
    });
    return rows.map(cloneDoc);
  }

  async findOne(coll, predicate = () => true) {
    const rows = await this.find(coll, predicate);
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * 按声明的复合查询索引精确取值（如 model_configs 的 [user_id, is_enabled]）。
   * JSON Store 无原生索引，此处用内存 Map 把 O(n) 扫描降为 O(k)。
   * @param {string} coll 集合名
   * @param {unknown[]} values 与 COMPOSITE_INDEXES[coll].fields 一一对应的值
   */
  async findByComposite(coll, values) {
    assertCollection(coll);
    const entry = this.compositeMaps.get(coll);
    if (!entry) return [];
    const parts = Array.isArray(values) ? values : [values];
    const key = parts.map((value) => String(value ?? '')).join('\u0001');
    const ids = entry.map.get(key) || new Set();
    return this.find(coll, (doc) => ids.has(doc.id));
  }

  /** 复合索引单条查询。 */
  async findOneByComposite(coll, values) {
    const rows = await this.findByComposite(coll, values);
    return rows.length > 0 ? rows[0] : null;
  }

  /** 强制按 user_id 过滤的查询。 */
  async findByUser(coll, userId, predicate = () => true) {
    if (!userId) throw new AppError(CODE.FORBIDDEN, '无权限访问该资源');
    return this.find(coll, (doc) => doc.user_id === userId && predicate(doc));
  }

  /**
   * 归属校验读取：不存在 404，属于他人 403。
   * @returns {Promise<object>}
   */
  async getOwned(coll, userId, id) {
    const doc = await this.findOne(coll, (item) => item.id === id);
    if (!doc) throw new AppError(CODE.NOT_FOUND, '资源不存在');
    if (doc.user_id !== userId) {
      throw new AppError(CODE.FORBIDDEN, '无权限访问该资源');
    }
    return doc;
  }

  async count(coll, predicate = () => true) {
    assertCollection(coll);
    return this.store.read(coll).filter((doc) => {
      try {
        return Boolean(predicate(doc));
      } catch {
        return false;
      }
    }).length;
  }

  /** 插入文档（自动生成 id），唯一键冲突抛 409。 */
  async insert(coll, doc) {
    assertCollection(coll);
    return this.commit((draft) => {
      if (!Array.isArray(draft[coll])) draft[coll] = [];
      const record = { ...cloneDoc(doc), id: doc.id || randomUUID() };
      this.assertUnique(coll, record);
      draft[coll].push(record);
      this.syncIndexAdd(coll, record);
      return cloneDoc(record);
    });
  }

  /** 按 id 更新（id 不可改），不存在抛 404。 */
  async update(coll, id, patch) {
    assertCollection(coll);
    return this.commit((draft) => {
      if (!Array.isArray(draft[coll])) draft[coll] = [];
      const list = draft[coll];
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) throw new AppError(CODE.NOT_FOUND, '资源不存在');
      const oldDoc = list[index];
      const candidate = { ...oldDoc, ...cloneDoc(patch), id };
      this.assertUnique(coll, candidate);
      list[index] = candidate;
      this.syncIndexRemove(coll, oldDoc);
      this.syncIndexAdd(coll, candidate);
      return cloneDoc(candidate);
    });
  }

  /** 按 id 删除，返回是否删除成功。 */
  async remove(coll, id) {
    assertCollection(coll);
    return this.commit((draft) => {
      if (!Array.isArray(draft[coll])) draft[coll] = [];
      const list = draft[coll];
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) return false;
      const [removed] = list.splice(index, 1);
      this.syncIndexRemove(coll, removed);
      return true;
    });
  }
}

// ── 进程内单例（服务层统一 import { repo }） ──────────────────────
/** @type {Repository | null} */
let currentRepository = null;

/**
 * 初始化数据层：创建 Store → 加载 db.json → 构建 Repository 与唯一索引。
 * @param {string} dataDir 数据目录
 * @returns {Repository}
 */
export function initRepository(dataDir) {
  const store = new JsonStore(dataDir);
  store.load();
  currentRepository = new Repository(store);
  return currentRepository;
}

/** 获取当前 Repository（未初始化时抛 500，避免业务层拿到空对象）。 */
export function getRepo() {
  if (!currentRepository) {
    throw new AppError(CODE.INTERNAL, '数据层尚未初始化');
  }
  return currentRepository;
}

/** 获取当前底层 Store（仅测试与启动日志使用）。 */
export function getStore() {
  return getRepo().store;
}

/**
 * 稳定的代理对象：业务代码只依赖此对象，未来替换 Store 实现零改动。
 * 所有方法均为异步（写操作走 Promise 串行队列）。
 */
export const repo = {
  find: (...args) => getRepo().find(...args),
  findOne: (...args) => getRepo().findOne(...args),
  findByComposite: (...args) => getRepo().findByComposite(...args),
  findOneByComposite: (...args) => getRepo().findOneByComposite(...args),
  findByUser: (...args) => getRepo().findByUser(...args),
  getOwned: (...args) => getRepo().getOwned(...args),
  count: (...args) => getRepo().count(...args),
  insert: (...args) => getRepo().insert(...args),
  update: (...args) => getRepo().update(...args),
  remove: (...args) => getRepo().remove(...args),
};
