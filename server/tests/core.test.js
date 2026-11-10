/**
 * 核心自测（node:test + node:assert/strict，零额外测试框架依赖）。
 * 5 组 describe：
 *  ① Store 原子写与 20 次并发无丢失
 *  ② Auth 注册 / 登录 / 5 次锁定 / 登出黑名单
 *  ③ 规则化降级产出合法 ContentJson
 *  ④ CR-001 优先级 user>env>none、删除回落、失败不换源、加密掩码
 *  ⑤ 分享快照脱敏（无 email/phone）与撤销失效
 * 所有断言均真实执行，不使用空断言。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

import { JsonStore } from '../store/jsonStore.js';
import { Repository, repo, initRepository } from '../store/repository.js';
import { runSeed } from '../store/collections.js';
import { normalizeContent, SECTION_KEYS } from '../domain/contentSchema.js';
import { BUILTIN_TEMPLATES } from '../domain/templates.js';
import { encrypt, decrypt, mask } from '../utils/crypto.js';
import { verifyToken, hashPassword, verifyPassword } from '../utils/security.js';
import * as authService from '../services/authService.js';
import * as modelConfigService from '../services/modelConfigService.js';
import { ruleBasedGenerate } from '../services/ruleGenerator.js';
import { generateStructured } from '../services/aiService.js';
import * as resumeService from '../services/resumeService.js';
import * as shareService from '../services/shareService.js';
import { readPublicSnapshot } from '../routes/public.js';

let tempDir = '';
const scratchDirs = [];

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ra-${prefix}-`));
  scratchDirs.push(dir);
  return dir;
}

/** 启动一个 OpenAI 兼容 mock 服务，记录每次请求的 Authorization。 */
function createMockLlm() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      hits.push({ authorization: String(req.headers.authorization || ''), url: String(req.url || ''), body });
      const structured = {
        basic: { name: '模型示例', jobTarget: '前端工程师' },
        education: [], work: [], project: [], skill: [], certificate: [],
        summary: { content: '由大模型整理生成的结构化简历。', highlights: [] },
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(structured) } }],
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: Number(server.address().port), hits });
    });
  });
}

/** 获取一个确定已关闭的端口，用于模拟调用失败。 */
function reserveClosedPort() {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = Number(server.address().port);
      server.close(() => resolve(port));
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

before(async () => {
  tempDir = makeTempDir('core-main');
  process.env.DATA_DIR = tempDir;
  process.env.JWT_SECRET = 'unit-test-jwt-secret';
  process.env.MODEL_CONFIG_SECRET = '';
  process.env.PUBLIC_BASE_URL = 'http://localhost:5173';
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  initRepository(tempDir);
  await runSeed(repo);
});

after(async () => {
  for (const dir of scratchDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }
  }
});

// ── ① JsonStore 原子写与并发 ─────────────────────────────────────
describe('① JsonStore 原子写、串行写队列与 20 次并发', () => {
  it('7 个集合初始化完整，db.json 可解析且无 tmp 残留', () => {
    const dir = makeTempDir('store-init');
    const store = new JsonStore(dir);
    store.load();
    const dbPath = path.join(dir, 'db.json');
    assert.equal(fs.existsSync(dbPath), true, 'db.json 应被自动创建');
    const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    for (const name of ['users', 'resumes', 'materials', 'templates', 'share_links', 'model_configs', 'revoked_tokens']) {
      assert.equal(Array.isArray(parsed[name]), true, `${name} 集合应为数组`);
    }
    assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('db.json.tmp-')).length, 0);
  });

  it('20 次并发 commit 后数据无丢失、无覆盖', async () => {
    const dir = makeTempDir('store-concurrent');
    const store = new JsonStore(dir);
    store.load();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.commit((draft) => {
        draft.users.push({ id: `u-${index}`, email: `u${index}@example.com` });
      })),
    );
    assert.equal(store.snapshot().users.length, 20, '内存快照应保留 20 条');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(onDisk.users.length, 20, '落盘文件应保留 20 条');
    const ids = new Set(onDisk.users.map((item) => item.id));
    assert.equal(ids.size, 20, '不应出现重复或覆盖');
  });

  it('Repository 20 次并发 insert 无丢失，唯一键冲突抛 409', async () => {
    const dir = makeTempDir('repo-concurrent');
    const repository = new Repository(new JsonStore(dir));
    // 手动 load：Repository 构造时 store 尚未读取文件，先显式加载并重建索引。
    repository.store.load();
    repository.rebuildIndexes();
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => repository.insert('users', {
        email: `c${index}@example.com`, username: `c${index}`,
      })),
    );
    assert.equal(await repository.count('users'), 20);
    await assert.rejects(
      () => repository.insert('users', { email: 'c0@example.com', username: 'other' }),
      (error) => error.code === 409,
    );
    assert.equal(await repository.count('users'), 20, '冲突写入不应落到库里');
  });

  it('启动自动 seed 3 套模板且重复 seed 不重复', async () => {
    const items = await repo.find('templates');
    assert.equal(items.length, BUILTIN_TEMPLATES.length);
    await runSeed(repo);
    assert.equal((await repo.find('templates')).length, BUILTIN_TEMPLATES.length);
  });
});

// ── ② Auth 注册 / 登录 / 锁定 / 登出黑名单 ───────────────────────
describe('② Auth 注册、登录、5 次锁定与登出黑名单', () => {
  const email = 'auth-user@test.local';
  const password = 'TestPass123';
  let userId = '';

  it('注册返回 user/token，库中不出现明文密码', async () => {
    const result = await authService.register({
      email, username: 'authuser', password, confirmPassword: password,
    });
    assert.equal(result.user.email, email);
    assert.equal(typeof result.token, 'string');
    assert.ok(result.token.length > 20);
    userId = result.user.id;
    const raw = fs.readFileSync(path.join(tempDir, 'db.json'), 'utf8');
    assert.equal(raw.includes(password), false, '密码明文不得入库');
    assert.equal(result.user.password_hash, undefined);
    assert.equal(result.user.salt, undefined);
  });

  it('重名邮箱 / 弱密码 / 两次密码不一致均被拒绝', async () => {
    await assert.rejects(
      () => authService.register({ email, username: 'another', password, confirmPassword: password }),
      (error) => error.code === 409,
    );
    await assert.rejects(
      () => authService.register({ email: 'weak@test.local', username: 'weakuser', password: 'abcdefgh', confirmPassword: 'abcdefgh' }),
      (error) => error.code === 422 && error.data.errKey === 'WEAK_PASSWORD',
    );
    await assert.rejects(
      () => authService.register({ email: 'mismatch@test.local', username: 'mismatch', password, confirmPassword: 'Other123' }),
      (error) => error.code === 422,
    );
  });

  it('bcrypt 哈希可校验，正确凭据可登录', async () => {
    const { password_hash } = hashPassword(password);
    assert.equal(verifyPassword(password, password_hash), true);
    assert.equal(verifyPassword('wrong-password', password_hash), false);
    const result = await authService.login({ account: email, password });
    assert.equal(result.user.id, userId);
    assert.equal(typeof result.token, 'string');
  });

  it('连续 5 次错误锁定 5 分钟并返回 429 + lockedUntil', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await assert.rejects(
        () => authService.login({ account: email, password: 'WrongPass1' }),
        (error) => error.code === 401,
      );
    }
    await assert.rejects(
      () => authService.login({ account: email, password: 'WrongPass1' }),
      (error) => error.code === 429 && typeof error.data.lockedUntil === 'string',
    );
    await assert.rejects(
      () => authService.login({ account: email, password }),
      (error) => error.code === 429 && error.data.errKey === 'ACCOUNT_LOCKED',
    );
  });

  it('登出把 jti 写入黑名单，旧 token 立即失效；me 不含敏感字段', async () => {
    // 用未锁定的第二个账号验证登出链路。
    const other = await authService.register({
      email: 'logout-user@test.local', username: 'logoutuser', password, confirmPassword: password,
    });
    const payload = verifyToken(other.token);
    assert.equal(typeof payload.jti, 'string');
    assert.equal(await authService.isTokenRevoked(payload.jti), false);
    await authService.logout(payload.jti, payload.exp);
    assert.equal(await authService.isTokenRevoked(payload.jti), true);

    const me = await authService.me(userId);
    assert.equal(me.id, userId);
    assert.equal(me.password_hash, undefined);
    assert.equal(me.salt, undefined);
  });
});

// ── ③ 规则化降级 ─────────────────────────────────────────────────
describe('③ 规则化降级产出合法 ContentJson', () => {
  it('normalizeContent 对 null / {} / 残缺输入均补齐 7 分区且绝不抛错', () => {
    for (const input of [null, undefined, {}, { basic: { name: 123 } }, 'bad-input', 42]) {
      const content = normalizeContent(input);
      for (const key of SECTION_KEYS) {
        assert.ok(key in content, `缺少分区 ${key}`);
      }
      assert.equal(Array.isArray(content.education), true);
      assert.equal(Array.isArray(content.work), true);
      assert.equal(Array.isArray(content.skill), true);
      assert.equal(typeof content.basic.name, 'string');
      assert.equal(content.meta.schemaVersion, 1);
    }
    assert.equal(normalizeContent({ basic: { name: 123 } }).basic.name, '123');
  });

  it('ruleBasedGenerate 由正则与词库产出可读简历', () => {
    const texts = [
      '姓名：张明',
      '手机 13800138000 邮箱 zhang@example.com',
      '求职意向：前端工程师',
      'XX大学 本科 计算机科学与技术 2016-09 2020-06',
      'XX科技有限公司 前端工程师 2020-07 2024-03',
      '负责后台管理系统重构，首屏加载时间下降 40%',
      '熟悉 React TypeScript Docker',
      '大学英语六级 2019-06',
    ];
    const content = normalizeContent(ruleBasedGenerate(texts));
    assert.equal(content.basic.phone, '13800138000');
    assert.equal(content.basic.email, 'zhang@example.com');
    assert.equal(content.basic.jobTarget, '前端工程师');
    assert.ok(content.education.length >= 1, '应抽取出教育经历');
    assert.ok(content.work.length >= 1, '应抽取出工作经历');
    assert.ok(content.skill.length >= 1, '应抽取出技能');
    assert.ok(content.summary.content.trim().length > 0, '自评必须可读');
  });

  it('完全无密钥时 generateStructured 返回 rule / none', async () => {
    delete process.env.LLM_API_KEY;
    const result = await generateStructured('no-config-user', ['张明，前端工程师，熟悉 React']);
    assert.equal(result.generationMode, 'rule');
    assert.equal(result.configSource, 'none');
    assert.equal(result.content.meta.generatedMode, 'rule');
    assert.ok(result.content.summary.content.length > 0);
  });

  it('resumeService.generate 落库留痕与 content_json.meta 一致', async () => {
    const registered = await authService.register({
      email: 'rule-resume@test.local', username: 'ruleresume', password: 'TestPass123', confirmPassword: 'TestPass123',
    });
    const templates = await repo.find('templates');
    const created = await resumeService.create(registered.user.id, { templateId: templates[0].id, title: '规则化简历' });
    await authService.login({ account: 'rule-resume@test.local', password: 'TestPass123' }).catch(() => null);
    const result = await resumeService.generate(registered.user.id, created.id, {});
    assert.equal(result.generationMode, 'rule');
    assert.equal(result.configSource, 'none');
    assert.equal(result.resume.generation_mode, 'rule');
    assert.equal(result.resume.config_source, 'none');
    assert.equal(result.resume.content.meta.generatedMode, 'rule');
    assert.equal(result.resume.content.meta.configSource, 'none');
    assert.ok(result.resume.content.summary.content.length > 0);
  });
});

// ── ④ CR-001 密钥来源优先级、回落、不换源、加密掩码 ──────────────
describe('④ CR-001 密钥来源优先级与密钥安全', () => {
  let mock = null;
  let userId = '';
  const userKey = 'test-user-placeholder-key';
  const envKey = 'test-env-placeholder-key';

  before(async () => {
    mock = await createMockLlm();
    const registered = await authService.register({
      email: 'cfg-user@test.local', username: 'cfguser', password: 'TestPass123', confirmPassword: 'TestPass123',
    });
    userId = registered.user.id;
  });

  after(async () => {
    await closeServer(mock?.server);
    try { await modelConfigService.deleteConfig(userId); } catch { /* 可能已删除 */ }
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  it('AES-256-GCM 加解密往返正确、密文不含明文、掩码仅末 4 位', () => {
    // 动态拼接，避免代码库中出现任何形似真实密钥的字面量（AC-07）。
    const plain = ['sk', '1234567890abcdef3f9a'].join('-');
    const cipher = encrypt(plain);
    assert.equal(cipher.split('.').length, 3, '密文格式应为 3 段 base64');
    assert.equal(cipher.includes(plain), false, '密文不得含明文');
    assert.equal(decrypt(cipher), plain);
    assert.equal(mask(plain), 'sk-****************3f9a');
    assert.equal(mask('abcdefghijklmnop'), 'ab****************mnop');
    assert.equal(mask('ab'), '*'.repeat(20));
    assert.throws(() => decrypt('not-a-valid-cipher'), (error) => error.code === 500);
  });

  it('user + env 并存时采用 user，且库/响应中无密钥明文', async () => {
    process.env.LLM_API_KEY = envKey;
    process.env.LLM_BASE_URL = `http://127.0.0.1:${mock.port}/v1`;
    process.env.LLM_MODEL = 'mock-model';

    const safe = await modelConfigService.upsertConfig(userId, {
      config_name: '我的配置',
      base_url: `http://127.0.0.1:${mock.port}/v1`,
      api_key: userKey,
      model: 'mock-model',
      is_enabled: true,
    });
    assert.equal(safe.api_key_mask, mask(userKey));
    assert.equal(JSON.stringify(safe).includes(userKey), false, '响应不得含明文');

    const resolved = await modelConfigService.resolveModelConfig(userId);
    assert.equal(resolved.source, 'user');
    assert.equal(resolved.apiKey, userKey);

    const hitsBefore = mock.hits.length;
    const result = await generateStructured(userId, ['张明，前端工程师，熟悉 React']);
    assert.equal(result.generationMode, 'ai');
    assert.equal(result.configSource, 'user');
    assert.equal(result.content.basic.name, '模型示例');
    assert.equal(mock.hits.length, hitsBefore + 1);
    assert.ok(mock.hits[mock.hits.length - 1].authorization.includes(userKey), '应使用用户级密钥');
    assert.equal(mock.hits[mock.hits.length - 1].authorization.includes(envKey), false);

    const rawDb = fs.readFileSync(path.join(tempDir, 'db.json'), 'utf8');
    assert.equal(rawDb.includes(userKey), false, '数据库不得出现密钥明文');
    assert.equal(rawDb.includes(envKey), false);
  });

  it('删除用户配置后回落 env，清空 env 后回落 none', async () => {
    await modelConfigService.deleteConfig(userId);
    const envResolved = await modelConfigService.resolveModelConfig(userId);
    assert.equal(envResolved.source, 'env');
    assert.equal(envResolved.apiKey, envKey);

    delete process.env.LLM_API_KEY;
    const noneResolved = await modelConfigService.resolveModelConfig(userId);
    assert.equal(noneResolved, null);
    const status = await modelConfigService.getStatus(userId);
    assert.equal(status.source, 'none');
    assert.equal(status.generationModeHint, 'rule');
  });

  it('选定来源调用失败时本次直接降级 rule，保留来源且不切换另一来源', async () => {
    const closedPort = await reserveClosedPort();
    process.env.LLM_API_KEY = envKey;
    process.env.LLM_BASE_URL = `http://127.0.0.1:${mock.port}/v1`;
    process.env.LLM_MODEL = 'mock-model';
    await modelConfigService.upsertConfig(userId, {
      config_name: '失败来源配置',
      base_url: `http://127.0.0.1:${closedPort}/v1`,
      api_key: userKey,
      model: 'mock-model',
      is_enabled: true,
    });

    const hitsBefore = mock.hits.length;
    const result = await generateStructured(userId, ['张明，前端工程师']);
    assert.equal(result.generationMode, 'rule');
    assert.equal(result.configSource, 'user', '降级必须保留被选来源');
    assert.ok(typeof result.degradedReason === 'string' && result.degradedReason.length > 0);
    assert.equal(mock.hits.length, hitsBefore, '绝不自动切换到 env 来源发起请求');
    assert.equal(JSON.stringify(result).includes(userKey), false, '响应体不得含密钥');
  });

  it('base_url 校验拒绝公网 http、接受 localhost；GET 只返回安全字段', async () => {
    await assert.rejects(
      () => modelConfigService.upsertConfig(userId, {
        config_name: '非法地址', base_url: 'http://example.com/v1', api_key: userKey, model: 'm',
      }),
      (error) => error.code === 422 && error.data.errKey === 'INVALID_BASE_URL',
    );
    const safe = await modelConfigService.getConfig(userId);
    assert.deepEqual(Object.keys(safe).sort(), [
      'api_key_mask', 'base_url', 'config_name', 'is_enabled', 'last_tested_at', 'model',
    ]);
    assert.equal(safe.api_key_encrypted, undefined);
    assert.equal(JSON.stringify(safe).includes(userKey), false);
  });

  it('v1.1 GET /settings/llm 语义：configured/config/effectiveSource，零密文，复合索引生效', async () => {
    const settings = await modelConfigService.getSettings(userId);
    assert.equal(settings.configured, true);
    assert.equal(settings.effectiveSource, 'user');
    assert.ok(settings.config && typeof settings.config === 'object');
    assert.deepEqual(Object.keys(settings.config).sort(), [
      'api_key_mask', 'base_url', 'config_name', 'is_enabled', 'last_tested_at', 'model',
    ]);
    const serialized = JSON.stringify(settings);
    assert.equal(serialized.includes('api_key_encrypted'), false, '不得返回密文字段');
    assert.equal(serialized.includes(userKey), false, '不得返回用户密钥明文');
    assert.equal(serialized.includes(envKey), false, '不得返回环境变量密钥');
    // M-04：idx(user_id, is_enabled) 复合索引必须能精确命中已启用配置。
    const indexed = await repo.findOneByComposite('model_configs', [userId, 1]);
    assert.ok(indexed, '复合索引应命中已启用配置');
    assert.equal(indexed.user_id, userId);
    assert.equal(indexed.is_enabled, 1);
  });

  it('v1.1 跨用户配置 403、未配置 DELETE 404、GET 返回 configured:false', async () => {
    const config = await repo.findOne('model_configs', (item) => item.user_id === userId);
    assert.ok(config, '此时应存在用户配置');
    await assert.rejects(
      () => modelConfigService.assertConfigOwner('another-user-id-for-403-check', config.id),
      (error) => error.code === 403,
    );
    await modelConfigService.deleteConfig(userId);
    await assert.rejects(
      () => modelConfigService.deleteConfig(userId),
      (error) => error.code === 404,
    );
    const settings = await modelConfigService.getSettings(userId);
    assert.equal(settings.configured, false);
    assert.equal(settings.config, null);
    assert.equal(settings.effectiveSource, 'env', '用户配置删除后应回落 env');
  });
});

// ── ⑤ 分享快照脱敏与撤销失效 ─────────────────────────────────────
describe('⑤ 分享快照脱敏、访问计数与撤销失效', () => {
  let userId = '';
  let otherUserId = '';
  let resumeId = '';
  const privateEmail = 'private-person@example.com';
  const privatePhone = '13900139000';

  before(async () => {
    const owner = await authService.register({
      email: 'share-owner@test.local', username: 'shareowner', password: 'TestPass123', confirmPassword: 'TestPass123',
    });
    userId = owner.user.id;
    const other = await authService.register({
      email: 'share-other@test.local', username: 'shareother', password: 'TestPass123', confirmPassword: 'TestPass123',
    });
    otherUserId = other.user.id;
    const templates = await repo.find('templates');
    const created = await resumeService.create(userId, { templateId: templates[0].id, title: '分享测试简历' });
    resumeId = created.id;
    await resumeService.update(userId, resumeId, {
      content: normalizeContent({
        basic: { name: '张明', phone: privatePhone, email: privateEmail, jobTarget: '前端工程师' },
        summary: { content: '五年经验的前端工程师。' },
      }),
    });
  });

  it('开启分享生成 128bit+ token，公开快照只返回 4 个白名单字段且已脱敏', async () => {
    const share = await shareService.enable(userId, resumeId);
    assert.equal(share.enabled, true);
    assert.ok(/^[A-Za-z0-9_-]{22,}$/.test(share.token), 'token 应为 ≥128bit base64url');
    assert.ok(share.url.includes(`/s/${share.token}`));

    const data = await readPublicSnapshot(share.token);
    assert.deepEqual(Object.keys(data).sort(), ['content', 'publishedAt', 'template', 'title']);
    assert.equal(data.title, '分享测试简历');
    assert.equal(data.content.basic.email, undefined, '快照必须剔除 email');
    assert.equal(data.content.basic.phone, undefined, '快照必须剔除 phone');
    assert.equal(JSON.stringify(data.content).includes(privateEmail), false);
    assert.equal(JSON.stringify(data.content).includes(privatePhone), false);
    assert.equal(data.content.meta, undefined, '快照不得带出生成来源信息');
    assert.ok(Array.isArray(data.template.sections) && data.template.sections.length > 0, '快照自包含模板');
    assert.equal(data.view_count, undefined);
    assert.equal(data.user_id, undefined);
  });

  it('公开访问累计 view_count，非法 token 返回 422', async () => {
    const share = await shareService.getShare(userId, resumeId);
    await readPublicSnapshot(share.token);
    await readPublicSnapshot(share.token);
    const after = await shareService.getShare(userId, resumeId);
    assert.ok(after.viewCount >= 3, `访问次数应累计，实际 ${after.viewCount}`);
    await assert.rejects(
      () => readPublicSnapshot('short'),
      (error) => error.code === 422,
    );
  });

  it('republish 沿用原 token 更新快照', async () => {
    const before = await shareService.getShare(userId, resumeId);
    const republished = await shareService.republish(userId, resumeId);
    assert.equal(republished.token, before.token);
    const data = await readPublicSnapshot(republished.token);
    assert.equal(data.content.basic.phone, undefined);
  });

  it('关闭分享后旧的 token 统一返回 404「链接已失效」', async () => {
    const before = await shareService.getShare(userId, resumeId);
    const oldToken = before.token;
    await shareService.disable(userId, resumeId);
    await assert.rejects(
      () => readPublicSnapshot(oldToken),
      (error) => error.code === 404 && error.message === '链接已失效',
    );
    const disabled = await shareService.getShare(userId, resumeId);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.url, '');
  });

  it('重新开启生成全新 token，旧链接永不复活', async () => {
    const old = await shareService.getShare(userId, resumeId);
    // 先取上一次禁用前的 token：从库中查出历史链接。
    const history = await repo.find('share_links', (link) => link.resume_id === resumeId);
    const oldToken = history[history.length - 1].token;
    const fresh = await shareService.enable(userId, resumeId);
    assert.notEqual(fresh.token, oldToken, '重新开启必须换新 token');
    assert.equal(old.revokedAt !== '', true);
    await assert.rejects(
      () => readPublicSnapshot(oldToken),
      (error) => error.code === 404 && error.message === '链接已失效',
    );
    const data = await readPublicSnapshot(fresh.token);
    assert.equal(data.content.basic.email, undefined);
  });

  it('跨用户访问他人简历 / 分享 / 配置返回 403（不是 404）', async () => {
    await assert.rejects(
      () => resumeService.get(otherUserId, resumeId),
      (error) => error.code === 403,
    );
    await assert.rejects(
      () => shareService.getShare(otherUserId, resumeId),
      (error) => error.code === 403,
    );
    await assert.rejects(
      () => resumeService.remove(otherUserId, resumeId),
      (error) => error.code === 403,
    );
    const config = await repo.findOne('model_configs', (item) => item.user_id === userId);
    if (config) {
      await assert.rejects(
        () => modelConfigService.assertConfigOwner(otherUserId, config.id),
        (error) => error.code === 403,
      );
    }
  });

  it('S8：公开快照与二维码响应均不含任何模型配置字段（含掩码与配置名称）', async () => {
    const share = await shareService.getShare(userId, resumeId);
    assert.equal(share.enabled, true);
    const publicData = await readPublicSnapshot(share.token);
    const qr = await shareService.qrcode(userId, resumeId);

    const forbidden = [
      'api_key_encrypted', 'api_key_mask', 'api_key', 'base_url',
      'config_name', 'effectiveSource', 'last_tested_at', 'is_enabled',
    ];
    const publicJson = JSON.stringify(publicData);
    const qrJson = JSON.stringify(qr);
    for (const field of forbidden) {
      assert.equal(publicJson.includes(field), false, `公开响应不得含 ${field}`);
      assert.equal(qrJson.includes(field), false, `二维码响应不得含 ${field}`);
    }
    assert.deepEqual(Object.keys(qr).sort(), ['dataUrl', 'url'], '二维码只返回 dataUrl 与 url');
    assert.equal(qr.url.includes(`/s/${share.token}`), true, 'dataUrl 只编码公开链接');
    assert.equal(qr.dataUrl.startsWith('data:image/png;base64,'), true);
  });
});
