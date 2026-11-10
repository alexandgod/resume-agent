/**
 * 纯 JS JSON 原子持久化层（零原生模块依赖）。
 * 三个工程保障：
 *  1. 写 tmp 文件 → fsync → rename 原子替换，避免半写损坏；
 *  2. Promise 串行写队列，所有写操作串行执行，读走内存快照；
 *  3. 启动时清理 db.json.tmp-* 残留文件。
 * 明确限制：仅保证单进程内一致性，多实例/多进程需迁移到 SQLite / 云端 DB。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { COLLECTION_NAMES, createEmptyDb } from './collections.js';

export class JsonStore {
  /**
   * @param {string} dataDir 数据目录（绝对路径或相对 cwd）
   */
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.dbPath = path.join(this.dataDir, 'db.json');
    /** @type {object} 内存快照 */
    this.cache = createEmptyDb();
    /** @type {Promise<void>} 串行写队列 */
    this.writeLock = Promise.resolve();
  }

  /** 加载或初始化 data/db.json；损坏时备份并重建，保证 demo 永远可启动。 */
  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.cleanupTmpFiles();

    if (!fs.existsSync(this.dbPath)) {
      this.cache = createEmptyDb();
      this.atomicWrite(this.cache);
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      this.cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : createEmptyDb();
    } catch {
      const backup = `${this.dbPath}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.dbPath, backup);
      } catch {
        // 备份失败不阻塞启动，直接覆盖重建。
      }
      this.cache = createEmptyDb();
      this.atomicWrite(this.cache);
    }

    // 兼容旧版本或手工编辑导致的缺失集合。
    let changed = false;
    for (const name of COLLECTION_NAMES) {
      if (!Array.isArray(this.cache[name])) {
        this.cache[name] = [];
        changed = true;
      }
    }
    if (changed) this.atomicWrite(this.cache);
  }

  /** 启动时清理上次进程崩溃留下的临时文件。 */
  cleanupTmpFiles() {
    let names = [];
    try {
      names = fs.readdirSync(this.dataDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith('db.json.tmp-')) {
        try {
          fs.rmSync(path.join(this.dataDir, name), { force: true });
        } catch {
          // 单个残留清理失败不影响启动。
        }
      }
    }
  }

  /**
   * 读取集合（返回内部数组，Repository 负责克隆后对外暴露）。
   * @param {string} collection 集合名
   * @returns {object[]}
   */
  read(collection) {
    if (!Array.isArray(this.cache[collection])) this.cache[collection] = [];
    return this.cache[collection];
  }

  /**
   * 串行提交一次写事务。
   * mutator 收到的是内存快照的深拷贝；只有 mutator 成功才落盘并替换快照。
   * @param {(draft: object) => unknown | Promise<unknown>} mutator
   * @returns {Promise<unknown>} mutator 的返回值
   */
  commit(mutator) {
    const run = async () => {
      const draft = structuredClone(this.cache);
      const result = await mutator(draft);
      this.atomicWrite(draft);
      this.cache = draft;
      return result;
    };
    // 前一个任务即使失败，队列也继续向后执行，避免写锁永久卡死。
    const task = this.writeLock.then(run, run);
    this.writeLock = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  /**
   * 原子写：tmp → fsync → rename 覆盖 db.json。
   * @param {object} data 全量数据
   */
  atomicWrite(data) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmpPath = path.join(this.dataDir, `db.json.tmp-${randomUUID()}`);
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, this.dbPath);
  }

  /** 供测试/排错读取当前内存快照。 */
  snapshot() {
    return structuredClone(this.cache);
  }
}
