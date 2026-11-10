/**
 * QA 独立回归验收（第二层质量关卡 / 新眼睛验证）
 * ---------------------------------------------------------------------------
 * 与工程师自带 core.test.js 完全独立：
 *   - 不 import、不重跑 core.test.js 的任何断言；
 *   - 以「真实 HTTP 子进程 + 本地 mock OpenAI 兼容服务」验证端到端行为；
 *   - 重点覆盖工程师自测未覆盖的 AI 成功路径、失败降级不换源、公开侧零泄露。
 *
 * 运行：node --test server/tests/qa.regression.test.js
 *
 * 约定：本文件只使用 node:test / node:assert/strict / Node 内置模块；
 *       不修改任何源码；测试用的假密钥（sk-user-test-1234 等）仅为本地 mock 凭证。
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const existsRel = (rel) => fs.existsSync(path.join(ROOT, rel));

// ── 架构 v1.1 §2 的 43 个本期文件 ────────────────────────────────
const FILES_43 = [
  'package.json', 'vite.config.ts', 'tailwind.config.js', 'index.html',
  '.env.example', '.gitignore', 'src/main.tsx', 'src/App.tsx', 'src/index.css',
  'server/store/jsonStore.js', 'server/store/collections.js', 'server/store/repository.js',
  'server/domain/contentSchema.js', 'server/domain/templates.js', 'server/domain/contracts.js',
  'server/index.js', 'server/middleware.js', 'server/utils/security.js',
  'server/services/authService.js', 'server/services/modelConfigService.js',
  'server/services/materialService.js', 'server/services/parseService.js',
  'server/services/aiService.js', 'server/services/ruleGenerator.js',
  'server/services/resumeService.js', 'server/services/shareService.js',
  'server/routes/private.js', 'server/routes/public.js',
  'src/types/index.ts', 'src/api/client.ts', 'src/store/authStore.tsx',
  'src/components/shell.tsx', 'src/components/ResumeRenderer.tsx',
  'src/pages/AuthPage.tsx', 'src/pages/MaterialsPage.tsx', 'src/pages/TemplatesPage.tsx',
  'src/pages/ResumeEditPage.tsx', 'src/pages/ResumesPage.tsx', 'src/pages/SharePage.tsx',
  'src/pages/PublicResumePage.tsx', 'src/pages/ModelConfigPage.tsx',
  'server/tests/core.test.js', 'server/utils/crypto.js',
];

// ── 6 个预留（本期不得创建） ─────────────────────────────────────
const RESERVED_6 = [
  'server/store/sqliteRepository.js', 'server/services/ocrService.js',
  'server/services/exportService.js', 'server/routes/generateStream.js',
  'miniapp/', 'public/manifest.webmanifest', 'public/sw.js',
];

/**
 * 递归收集仓库文本文件。
 * 排除：依赖/构建/数据目录；QA 自身产物（本测试文件内含有被检索的旧口径字面量，
 *       docs/04-QA-REPORT.md 会引述旧值，二者属自指，不计入「源码残留」）。
 */
const QA_ARTIFACTS = new Set([
  'server/tests/qa.regression.test.js',
  'docs/04-QA-REPORT.md',
]);
function collectFiles(dir = ROOT, base = ROOT, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'data', '.env'].includes(name)) continue;
    const abs = path.join(dir, name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      collectFiles(abs, base, out);
    } else if (!QA_ARTIFACTS.has(rel)
      && (/\.(js|jsx|ts|tsx|json|md|html|css|example|txt|mermaid|yml|yaml)$/.test(name)
        || name === '.env.example' || name === '.gitignore')) {
      out.push(rel);
    }
  }
  return out;
}

// ── HTTP 客户端（真实 fetch） ────────────────────────────────────
async function api(base, method, urlPath, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${urlPath}`, {
    method, headers, body: payload, signal: AbortSignal.timeout(20000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 响应时保留 null */ }
  return { status: res.status, json, headers: res.headers };
}

/** 断言统一响应体 {code,message,data} 且 HTTP 状态与 code 一致（成功为 200/0）。 */
function assertEnvelope(res, expectedStatus, expectedCode) {
  assert.ok(res.json, `响应必须是 JSON：status=${res.status}`);
  assert.equal(typeof res.json.code, 'number', '响应必须含数字 code');
  assert.equal(typeof res.json.message, 'string', '响应必须含 message');
  assert.ok(res.json.data !== undefined, '响应必须含 data 字段');
  assert.equal(res.status, expectedStatus);
  assert.equal(res.json.code, expectedCode);
}

let userSeq = 0;
/** 注册一个全新用户并返回 {token, email, username}。 */
async function register(base, tag = 'u') {
  userSeq += 1;
  const stamp = `${Date.now().toString(36)}${userSeq}${Math.random().toString(36).slice(2, 6)}`;
  const email = `qa_${tag}_${stamp}@example.com`;
  const username = `qa${tag}${stamp}`.replace(/[^A-Za-z0-9_.-]/g, '');
  const res = await api(base, 'POST', '/api/auth/register', {
    body: {
      email, username, password: 'QaPass12345', confirmPassword: 'QaPass12345',
    },
  });
  assert.equal(res.status, 200, `注册失败：${JSON.stringify(res.json)}`);
  assert.equal(res.json.code, 0);
  assert.ok(res.json.data.token, '注册应返回 token');
  return { token: res.json.data.token, email, username };
}

/** 建简历 + 追加一份文本资料（可指定资料文本）。 */
async function makeResumeWithMaterial(base, token, rawText) {
  const tpl = await api(base, 'GET', '/api/templates', { token });
  assert.equal(tpl.status, 200);
  assert.ok(tpl.json.data.items.length >= 3, '至少 3 套内置模板');
  const templateId = tpl.json.data.items[0].id;

  const created = await api(base, 'POST', '/api/resumes', {
    token, body: { title: 'QA 验收简历', templateId },
  });
  assert.equal(created.status, 200);
  const resumeId = created.json.data.resume.id;

  const mat = await api(base, 'POST', '/api/materials/text', {
    token, body: { title: 'QA 资料', rawText },
  });
  assert.equal(mat.status, 200);
  return { resumeId, templateId, templates: tpl.json.data.items, materialId: mat.json.data.material.id };
}

const SAMPLE_TEXT = [
  '姓名：张启明',
  '手机：13800138000',
  '邮箱：zhangqiming@example.com',
  '求职意向：前端工程师',
  '教育经历：',
  '2016-09 至 2020-06 清华大学 计算机科学与技术 本科',
  '工作经历：',
  '2020-07 至 2024-03 字节跳动科技有限公司 前端工程师',
  '负责后台管理系统重构，首屏加载时间下降 40%',
  '项目经历：',
  '数据可视化平台，独立完成图表引擎封装',
  '技能专长：',
  'React、TypeScript、Vite、Node.js、Docker',
  '证书荣誉：',
  '2021-06 获得优秀员工奖',
  '自我评价：',
  '4 年前端开发经验，注重交付质量与协作效率。',
].join('\n');

// ── 端口 / 子进程工具 ────────────────────────────────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function startServer(port, dataDir, extraEnv) {
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    JWT_SECRET: 'qa-fixed-jwt-secret-for-regression',
    MODEL_CONFIG_SECRET: 'qa-fixed-model-config-secret',
    NODE_ENV: 'test',
    RATE_LIMIT_MAX: '100000',
    RATE_LIMIT_WINDOW_MS: '60000',
    MAX_FILE_SIZE_MB: '10',
    MAX_MATERIALS_PER_USER: '50',
    // 显式清空，防止外部环境污染
    LLM_API_KEY: '', LLM_BASE_URL: '', LLM_MODEL: '',
    ...extraEnv,
  };
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  return { child, getLog: () => log };
}

async function waitReady(base, handle, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (handle.child.exitCode !== null) {
      throw new Error(`服务进程提前退出：${handle.getLog()}`);
    }
    try {
      const res = await fetch(`${base}/api/public/share/probe`, {
        signal: AbortSignal.timeout(1200),
      });
      const json = await res.json().catch(() => null);
      if (json && typeof json.code === 'number') return;
    } catch { /* 尚未就绪 */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`服务启动超时：${handle.getLog()}`);
}

function stopServer(handle) {
  return new Promise((resolve) => {
    const child = handle.child;
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
  });
}

/** mock 返回的 AI 结构化简历（用 basic.name 标记实际使用的密钥来源）。 */
function makeAiContent(tag) {
  return {
    basic: {
      name: tag, gender: '', birthDate: '', phone: '', email: '',
      location: '', jobTarget: 'AI 工程师', avatarUrl: '', links: [],
    },
    education: [{
      school: 'AI 大学', degree: '本科', major: '计算机科学与技术',
      startDate: '2018-09', endDate: '2022-06', description: '',
    }],
    work: [{
      company: `${tag} 科技有限公司`, position: 'AI 工程师', location: '上海',
      startDate: '2022-07', endDate: '2024-06', highlights: ['构建智能简历解析链路'],
    }],
    project: [], skill: [{ category: 'AI', items: ['LLM', 'Prompt'], level: '熟练' }],
    certificate: [],
    summary: { content: `由 ${tag} 生成的职业总结`, highlights: [] },
    meta: { schemaVersion: 1, generatedMode: 'ai', configSource: 'env', updatedAt: '' },
  };
}

// ══════════════════════════════════════════════════════════════════
describe('QA 独立回归验收（resume_agent / 架构 v1.1 + CR-001）', { concurrency: 1 }, () => {
  let zeroDir, aiDir, zeroPort, aiPort, mockPort;
  let zeroBase, aiBase, zeroHandle, aiHandle, mockServer;
  const mockState = { mode: 'success', calls: [] };

  before(async () => {
    zeroDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-qa-zero-'));
    aiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-qa-ai-'));
    zeroPort = await freePort();
    aiPort = await freePort();
    mockPort = await freePort();
    zeroBase = `http://127.0.0.1:${zeroPort}`;
    aiBase = `http://127.0.0.1:${aiPort}`;

    // 本地 OpenAI 兼容 mock（与测试同进程，行为由 mockState 直接控制）
    mockServer = http.createServer((req, res) => {
      const auth = String(req.headers.authorization || '');
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        mockState.calls.push({ auth, mode: mockState.mode, path: req.url });
        if (mockState.mode === 'hang') return; // 不响应，触发客户端超时
        res.setHeader('Content-Type', 'application/json');
        if (mockState.mode === 'http401') {
          res.writeHead(401);
          res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
          return;
        }
        if (mockState.mode === 'invalid-json') {
          res.writeHead(200);
          res.end(JSON.stringify({ choices: [{ message: { content: '这不是 JSON {{{' } }] }));
          return;
        }
        const tag = /sk-user/.test(auth) ? 'FROM_USER'
          : /sk-env/.test(auth) ? 'FROM_ENV' : 'FROM_UNKNOWN';
        res.writeHead(200);
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify(makeAiContent(tag)) } }],
        }));
      });
    });
    await new Promise((resolve) => mockServer.listen(mockPort, '127.0.0.1', resolve));
    const mockUrl = `http://127.0.0.1:${mockPort}`;

    // 服务 A：零密钥（AC-01 与大部分与密钥无关的功能）
    zeroHandle = startServer(zeroPort, zeroDir, {});
    await waitReady(zeroBase, zeroHandle);

    // 服务 B：部署级 env 密钥指向 mock（AC-02/03/04/05/06）
    aiHandle = startServer(aiPort, aiDir, {
      LLM_API_KEY: 'sk-env-test-5678',
      LLM_BASE_URL: mockUrl,
      LLM_MODEL: 'qa-mock-model',
      LLM_TIMEOUT: '1200',
      TEST_CONNECT_TIMEOUT: '800',
    });
    await waitReady(aiBase, aiHandle);
  });

  after(async () => {
    if (zeroHandle) await stopServer(zeroHandle);
    if (aiHandle) await stopServer(aiHandle);
    if (mockServer) {
      try { mockServer.closeAllConnections(); } catch { /* 忽略 */ }
      await new Promise((resolve) => mockServer.close(resolve));
    }
    for (const dir of [zeroDir, aiDir]) {
      if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ } }
    }
  });

  // ═════════════════════ A. 静态一致性 ═══════════════════════════
  describe('A 静态一致性', { concurrency: 1 }, () => {
    test('A1 43 个本期文件全部存在，6 个预留文件确实未创建', () => {
      const missing = FILES_43.filter((rel) => !existsRel(rel));
      assert.deepEqual(missing, [], `缺失文件：${missing.join(', ')}`);
      assert.equal(FILES_43.length, 43);
      const created = RESERVED_6.filter((rel) => existsRel(rel.replace(/\/$/, '')));
      assert.deepEqual(created, [], `不应创建的预留文件：${created.join(', ')}`);
    });

    test('A2 全仓无旧口径残留（v1.1 §0.4 修订记录旧值为文档例外）', () => {
      const patterns = [
        /model-config/, /settings\/model/,
        /generationMode\s*[:=]\s*['"]fallback/,
        /['"]fallback['"]/, /ai-256/i,
      ];
      const hits = [];
      const exceptions = [];
      for (const rel of collectFiles()) {
        const lines = readRel(rel).split(/\r?\n/);
        lines.forEach((line, index) => {
          if (!patterns.some((re) => re.test(line))) return;
          // 架构 v1.1 §0.4「修订记录」表格（61~79 行）记录的是被作废的旧值，属文档例外
          if (rel === 'docs/02-ARCHITECTURE.md' && index + 1 >= 61 && index + 1 <= 79) {
            exceptions.push(`${rel}:${index + 1}`);
            return;
          }
          hits.push(`${rel}:${index + 1}: ${line.trim().slice(0, 90)}`);
        });
      }
      assert.deepEqual(hits, [], `源码/文档仍残留旧口径：\n${hits.join('\n')}`);
      assert.equal(exceptions.length, 3, '应恰好 3 条 §0.4 修订记录例外（M-01/M-02/M-03）');
    });

    test('A3 crypto.js 导出 AES-256-GCM 加解密与 mask；security.js 无加解密原语', async () => {
      const crypto = await import('../utils/crypto.js');
      for (const fn of ['encrypt', 'decrypt', 'mask', 'getEncryptionKey', 'scrubSecret']) {
        assert.equal(typeof crypto[fn], 'function', `crypto.js 应导出 ${fn}`);
      }
      const src = readRel('server/utils/crypto.js');
      assert.match(src, /aes-256-gcm/);
      assert.match(src, /createCipheriv/);
      assert.match(src, /createDecipheriv/);
      assert.match(src, /randomBytes\(12\)/);

      const plain = 'sk-unit-roundtrip-9f3a';
      const cipher = crypto.encrypt(plain);
      assert.ok(!cipher.includes(plain), '密文不得含明文');
      assert.equal(cipher.split('.').length, 3, '密文应为 iv.tag.cipher 三段');
      assert.equal(crypto.decrypt(cipher), plain, '解密往返应还原明文');
      assert.notEqual(crypto.encrypt(plain), cipher, '随机 IV：两次加密结果应不同');
      const masked = crypto.mask(plain);
      assert.ok(masked.endsWith('9f3a'), '掩码应仅保留末 4 位');
      assert.ok(!masked.includes(plain), '掩码不得含完整明文');

      const sec = readRel('server/utils/security.js');
      assert.doesNotMatch(sec, /createCipheriv|createDecipheriv|aes-256-gcm|aes-256-cbc|scryptSync/);
      assert.doesNotMatch(sec, /\bexport function (encrypt|decrypt|mask)\b/);
    });

    test('A4 公开路由/请求层/公开页/路由守卫的隔离硬约定', () => {
      const pub = readRel('server/routes/public.js');
      assert.doesNotMatch(pub, /requireAuth|services\/(authService|modelConfigService|aiService|shareService|resumeService|materialService)/);
      assert.match(pub, /createPublicRouter/);

      const client = readRel('src/api/client.ts');
      const publicFetchBody = client.slice(client.indexOf('export async function publicFetch'));
      assert.doesNotMatch(publicFetchBody, /getToken\(|setToken\('Authorization'|Bearer/);
      assert.match(publicFetchBody, /headers\.delete\('Authorization'\)/);
      assert.match(publicFetchBody, /credentials:\s*'omit'/);

      const page = readRel('src/pages/PublicResumePage.tsx');
      // 必须剥离注释后再断言：文件头注释本身会描述「不套 Layout / 不读 authStore」，
      // 若连注释一起匹配会造成假阳性（此处校验的是真实代码依赖，不是注释文本）。
      const pageCode = page
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      assert.doesNotMatch(pageCode, /\b(AppLayout|useAuth|authStore|apiFetch)\b/);
      assert.match(pageCode, /publicFetch/);

      const app = readRel('src/App.tsx');
      for (const privatePath of ['/materials', '/templates', '/resumes', '/resumes/:id/edit', '/resumes/:id/share', '/settings/llm']) {
        assert.ok(app.includes(`path="${privatePath}"`), `缺少私有路由 ${privatePath}`);
      }
      assert.match(app, /PrivateRoute/);
      assert.match(app, /path="\/s\/:token"/);
      assert.match(readRel('src/components/shell.tsx'), /type=\{visible \? 'text' : 'password'\}/);
      assert.match(readRel('src/pages/ModelConfigPage.tsx'), /PasswordField/);
    });

    test('A5 无 node-gyp 原生依赖；.env.example 与全仓无真实密钥字面量（AC-07）', () => {
      const pkg = JSON.parse(readRel('package.json'));
      const allDeps = {
        ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies,
      };
      for (const native of ['better-sqlite3', 'sqlite3', 'bcrypt', 'argon2', 'canvas']) {
        assert.equal(allDeps[native], undefined, `不应引入原生依赖 ${native}`);
      }
      assert.equal(pkg.scripts.test, 'node --test server/tests/core.test.js');

      const envExample = readRel('.env.example');
      assert.match(envExample, /LLM_API_KEY=/);
      assert.match(envExample, /<your-api-key>|<set-a-random-secret>/);
      assert.doesNotMatch(envExample, /^LLM_API_KEY=\S+/m, '.env.example 的 LLM_API_KEY 必须留空');

      // 真实密钥格式（高熵），测试 fixture 中的短假值不会命中
      const realKey = /sk-[A-Za-z0-9]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}/;
      const leaks = [];
      for (const rel of collectFiles()) {
        if (rel === '.env.example') continue; // 已单独校验占位符
        readRel(rel).split(/\r?\n/).forEach((line, i) => {
          if (realKey.test(line)) leaks.push(`${rel}:${i + 1}`);
        });
      }
      assert.deepEqual(leaks, [], `疑似真实密钥字面量：${leaks.join(', ')}`);
    });

    test('A6 3 套内置模板 schema.sections 均可渲染（7 分区完整）', async () => {
      const { BUILTIN_TEMPLATES } = await import('../domain/templates.js');
      const { SECTION_KEYS } = await import('../domain/contentSchema.js');
      assert.equal(BUILTIN_TEMPLATES.length, 3);
      for (const tpl of BUILTIN_TEMPLATES) {
        const sections = tpl.schema_json.sections;
        assert.equal(sections.length, 7, `${tpl.code} 应有 7 个分区`);
        assert.deepEqual(
          sections.map((s) => s.key).sort(), [...SECTION_KEYS].sort(),
          `${tpl.code} 分区键应完整覆盖 7 分区`,
        );
        assert.ok(sections.every((s) => s.enabled && Number.isInteger(s.order) && s.title && s.layout));
        assert.ok(tpl.schema_json.theme.primary && tpl.schema_json.style.fontFamily);
      }
    });
  });

  // ═══════════════ C1. AC-01 零密钥闭环（真实 HTTP） ═══════════════
  describe('C1 AC-01 零密钥闭环', { concurrency: 1 }, () => {
    test('C1-1 注册→建简历→上传文本→生成 返回 rule/none 且 7 分区合法可读', async () => {
      const { token } = await register(zeroBase, 'ac01');
      const { resumeId } = await makeResumeWithMaterial(zeroBase, token, SAMPLE_TEXT);

      const gen = await api(zeroBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      assertEnvelope(gen, 200, 0);
      assert.equal(gen.json.data.generationMode, 'rule');
      assert.equal(gen.json.data.configSource, 'none');
      assert.equal(gen.json.data.degradedReason, undefined);

      const content = gen.json.data.resume.content;
      for (const key of ['basic', 'education', 'work', 'project', 'skill', 'certificate', 'summary']) {
        assert.ok(content[key] !== undefined, `content 缺少分区 ${key}`);
      }
      assert.equal(content.meta.schemaVersion, 1);
      assert.equal(content.meta.generatedMode, 'rule');
      assert.equal(content.meta.configSource, 'none');
      // 规则化产出必须「可读」：至少抽出姓名/联系方式，且 summary 有文字
      assert.equal(typeof content.basic.name, 'string');
      assert.ok(content.summary.content.length > 10, '规则化结果应有可读的自我评价文本');
      assert.ok(content.education.length + content.work.length + content.skill.length > 0,
        '规则化结果应至少填充一个实质分区');
      // 简历记录同步留痕
      assert.equal(gen.json.data.resume.generation_mode, 'rule');
      assert.equal(gen.json.data.resume.config_source, 'none');
    });

    test('C1-2 零密钥场景 GET /api/settings/llm 返回 configured:false / effectiveSource:none', async () => {
      const { token } = await register(zeroBase, 'ac01b');
      const res = await api(zeroBase, 'GET', '/api/settings/llm', { token });
      assertEnvelope(res, 200, 0);
      assert.equal(res.json.data.configured, false);
      assert.equal(res.json.data.effectiveSource, 'none');
      assert.equal(res.json.data.config, null);
    });
  });

  // ═══════════════ C2. AC-02 AI 成功路径（工程师自测未覆盖） ═══════════════
  describe('C2 AC-02 AI 成功路径与 AI 失败降级', { concurrency: 1 }, () => {
    test('C2-1 env 配置 + mock 合法 JSON → ai/env，内容被正确结构化', async () => {
      const { token } = await register(aiBase, 'aiok');
      const { resumeId } = await makeResumeWithMaterial(aiBase, token, SAMPLE_TEXT);
      mockState.mode = 'success';
      mockState.calls.length = 0;

      const gen = await api(aiBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      assertEnvelope(gen, 200, 0);
      assert.equal(gen.json.data.generationMode, 'ai', 'AI 成功必须标 ai');
      assert.equal(gen.json.data.configSource, 'env', 'env 来源必须标 env');
      assert.equal(gen.json.data.degradedReason, undefined);

      const content = gen.json.data.resume.content;
      assert.equal(content.basic.name, 'FROM_ENV', '模型返回内容应被结构化写入（标记来自 env 密钥）');
      assert.equal(content.basic.jobTarget, 'AI 工程师');
      assert.equal(content.work.length, 1);
      assert.equal(content.work[0].company, 'FROM_ENV 科技有限公司');
      assert.equal(content.summary.content, '由 FROM_ENV 生成的职业总结');
      assert.equal(content.meta.schemaVersion, 1);
      assert.equal(content.meta.generatedMode, 'ai');
      assert.equal(content.meta.configSource, 'env');
      assert.equal(gen.json.data.resume.generation_mode, 'ai');
      assert.equal(gen.json.data.resume.config_source, 'env');

      // 服务端确实携带密钥调用了 mock，且只调用 env 来源
      assert.ok(mockState.calls.length >= 1, '应真实发起一次模型调用');
      assert.ok(mockState.calls.every((c) => c.auth === 'Bearer sk-env-test-5678'));
      assert.ok(mockState.calls.every((c) => /\/chat\/completions$/.test(c.path)));
      // 响应体绝不回显密钥
      assert.ok(!JSON.stringify(gen.json).includes('sk-env-test-5678'));
    });

    test('C2-2 非法 JSON / 401 / 超时 三种失败均本次降级 rule，configSource 保留 env 且不换源', async () => {
      const { token } = await register(aiBase, 'aideg');
      const { resumeId } = await makeResumeWithMaterial(aiBase, token, SAMPLE_TEXT);

      const scenarios = [
        { mode: 'invalid-json', reason: /JSON|模型返回/ },
        { mode: 'http401', reason: /密钥无效|无权限|失败/ },
        { mode: 'hang', reason: /超时/ },
      ];
      for (const sc of scenarios) {
        mockState.mode = sc.mode;
        mockState.calls.length = 0;
        const gen = await api(aiBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
        assertEnvelope(gen, 200, 0, );
        assert.equal(gen.json.data.generationMode, 'rule', `${sc.mode} 应降级为 rule`);
        assert.equal(gen.json.data.configSource, 'env', `${sc.mode} 降级后仍保留原来源 env`);
        assert.match(String(gen.json.data.degradedReason || ''), sc.reason, `${sc.mode} 应带可读 degradedReason`);
        assert.equal(gen.json.data.resume.generation_mode, 'rule');
        assert.equal(gen.json.data.resume.config_source, 'env');
        assert.ok(gen.json.data.resume.content.summary.content.length > 10, '降级后仍产出可读简历');
        // 不切换到另一来源：所有调用都只有 env 这一个密钥
        assert.ok(mockState.calls.length >= 1);
        assert.ok(mockState.calls.every((c) => c.auth === 'Bearer sk-env-test-5678'),
          `${sc.mode} 降级时不得改用其他来源的密钥`);
        assert.ok(!JSON.stringify(gen.json).includes('sk-env-test-5678'), '降级响应不得回显密钥');
      }
      mockState.mode = 'success';
    });
  });

  // ═══════════════ C3. AC-03 优先级与回落 ═══════════════════════════
  describe('C3 AC-03 配置优先级 user > env > none', { concurrency: 1 }, () => {
    const USER_KEY = 'sk-user-test-1234';

    test('C3-1 user+env 并存取 user；删除用户配置后回落 env；两者皆空回落 none', async () => {
      const { token } = await register(aiBase, 'prio');
      const { resumeId } = await makeResumeWithMaterial(aiBase, token, SAMPLE_TEXT);
      const mockUrl = `http://127.0.0.1:${mockPort}`;

      // ① 无用户配置 → env
      mockState.mode = 'success'; mockState.calls.length = 0;
      let gen = await api(aiBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      assert.equal(gen.json.data.configSource, 'env');
      assert.equal(gen.json.data.resume.content.basic.name, 'FROM_ENV');

      // ② 保存用户配置（指向同一 mock，但密钥不同）→ user 优先
      const put = await api(aiBase, 'PUT', '/api/settings/llm', {
        token,
        body: {
          config_name: '我的 QA 配置', base_url: mockUrl, api_key: USER_KEY,
          model: 'qa-user-model', is_enabled: true,
        },
      });
      assertEnvelope(put, 200, 0);
      assert.equal(put.json.data.effectiveSource, 'user');

      mockState.calls.length = 0;
      gen = await api(aiBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      assert.equal(gen.json.data.generationMode, 'ai');
      assert.equal(gen.json.data.configSource, 'user');
      assert.equal(gen.json.data.resume.content.basic.name, 'FROM_USER', '应实际使用用户级密钥调用');
      assert.ok(mockState.calls.every((c) => c.auth === `Bearer ${USER_KEY}`),
        'user 生效时不得混用 env 密钥');
      assert.ok(!mockState.calls.some((c) => c.auth === 'Bearer sk-env-test-5678'));

      // ③ 删除用户配置 → 回落 env
      const del = await api(aiBase, 'DELETE', '/api/settings/llm', { token });
      assertEnvelope(del, 200, 0);
      assert.equal(del.json.data.configured, false);
      assert.equal(del.json.data.effectiveSource, 'env');
      mockState.calls.length = 0;
      gen = await api(aiBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      assert.equal(gen.json.data.configSource, 'env');
      assert.equal(gen.json.data.resume.content.basic.name, 'FROM_ENV');
      assert.ok(mockState.calls.every((c) => c.auth === 'Bearer sk-env-test-5678'));

      // ④ 两者皆空 → none（在零密钥服务上验证）
      const z = await register(zeroBase, 'prioz');
      const zr = await makeResumeWithMaterial(zeroBase, z.token, SAMPLE_TEXT);
      const zgen = await api(zeroBase, 'POST', `/api/resumes/${zr.resumeId}/generate`, { token: z.token, body: {} });
      assert.equal(zgen.json.data.generationMode, 'rule');
      assert.equal(zgen.json.data.configSource, 'none');
    });

    test('C3-2 用户来源调用失败 → 本次降级 rule/user，绝不切换到 env 来源', async () => {
      const { token } = await register(aiBase, 'noswitch');
      const { resumeId } = await makeResumeWithMaterial(aiBase, token, SAMPLE_TEXT);
      const mockUrl = `http://127.0.0.1:${mockPort}`;
      await api(aiBase, 'PUT', '/api/settings/llm', {
        token,
        body: {
          config_name: 'QA 用户源', base_url: mockUrl, api_key: USER_KEY,
          model: 'qa-user-model', is_enabled: true,
        },
      });

      mockState.mode = 'http401';
      mockState.calls.length = 0;
      const gen = await api(aiBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      assert.equal(gen.json.data.generationMode, 'rule');
      assert.equal(gen.json.data.configSource, 'user', '失败降级必须保留被选定的 user 来源');
      assert.ok(gen.json.data.degradedReason);
      assert.ok(mockState.calls.length >= 1);
      assert.ok(mockState.calls.every((c) => c.auth === `Bearer ${USER_KEY}`),
        '降级时不得改用 env 密钥');
      assert.ok(!mockState.calls.some((c) => c.auth === 'Bearer sk-env-test-5678'),
        'env 密钥一次都不应被调用（不换源）');

      // 清理，避免污染其它用例
      await api(aiBase, 'DELETE', '/api/settings/llm', { token });
      mockState.mode = 'success';
    });

    test('C3-3 用户配置停用（is_enabled=false）后回落 env', async () => {
      const { token } = await register(aiBase, 'disablecfg');
      const { resumeId } = await makeResumeWithMaterial(aiBase, token, SAMPLE_TEXT);
      const mockUrl = `http://127.0.0.1:${mockPort}`;
      await api(aiBase, 'PUT', '/api/settings/llm', {
        token,
        body: {
          config_name: '停用测试', base_url: mockUrl, api_key: USER_KEY,
          model: 'qa-user-model', is_enabled: false,
        },
      });
      mockState.mode = 'success'; mockState.calls.length = 0;
      const gen = await api(aiBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      assert.equal(gen.json.data.configSource, 'env');
      assert.equal(gen.json.data.resume.content.basic.name, 'FROM_ENV');
      await api(aiBase, 'DELETE', '/api/settings/llm', { token });
    });
  });

  // ═══════════════ C4. AC-04/05/06 密钥安全 ═══════════════════════════
  describe('C4 AC-04/05/06 密钥安全、测试连接与归属隔离', { concurrency: 1 }, () => {
    const USER_KEY = 'sk-user-test-1234';

    test('C4-1 PUT 后 db.json 无明文；GET 只返回 6 个安全字段 + configured + effectiveSource', async () => {
      const { token } = await register(aiBase, 'sec');
      const mockUrl = `http://127.0.0.1:${mockPort}`;
      const put = await api(aiBase, 'PUT', '/api/settings/llm', {
        token,
        body: {
          config_name: 'QA 安全配置', base_url: mockUrl, api_key: USER_KEY,
          model: 'qa-secure-model', is_enabled: true,
        },
      });
      assertEnvelope(put, 200, 0);
      assert.equal(put.json.data.configured, true);
      assert.equal(put.json.data.effectiveSource, 'user');

      // ① 落库零明文
      const dbText = fs.readFileSync(path.join(aiDir, 'db.json'), 'utf8');
      assert.ok(!dbText.includes(USER_KEY), 'db.json 不得出现密钥明文');
      assert.ok(!dbText.includes('sk-env-test-5678'), 'db.json 不得出现 env 密钥明文');
      assert.ok(dbText.includes('api_key_encrypted'), '应存密文字段');
      assert.ok(dbText.includes('api_key_mask'), '应存掩码字段');

      // ② GET 字段白名单
      const get = await api(aiBase, 'GET', '/api/settings/llm', { token });
      assertEnvelope(get, 200, 0);
      assert.deepEqual(Object.keys(get.json.data).sort(), ['config', 'configured', 'effectiveSource']);
      assert.deepEqual(Object.keys(get.json.data.config).sort(), [
        'api_key_mask', 'base_url', 'config_name', 'is_enabled', 'last_tested_at', 'model',
      ]);
      const serialized = JSON.stringify(get.json);
      for (const forbidden of ['api_key_encrypted', USER_KEY, 'user_id', 'api_key"']) {
        assert.ok(!serialized.includes(forbidden), `GET 响应不得含 ${forbidden}`);
      }
      // ③ 掩码仅末 4 位
      const mask = get.json.data.config.api_key_mask;
      assert.ok(mask.endsWith('1234'), '掩码应以末 4 位结尾');
      assert.ok(!mask.includes(USER_KEY), '掩码不得含完整密钥');
      assert.ok(/\*{8,}/.test(mask), '掩码应含星号遮蔽');
      assert.equal(get.json.data.config.config_name, 'QA 安全配置');

      await api(aiBase, 'DELETE', '/api/settings/llm', { token });
    });

    test('C4-2 测试连接 10s 内返回 {ok,latencyMs,message}，失败原因可读且不回显密钥、不落库不产生简历', async () => {
      const { token } = await register(aiBase, 'testconn');
      const mockUrl = `http://127.0.0.1:${mockPort}`;

      const before = await api(aiBase, 'GET', '/api/settings/llm', { token });
      assert.equal(before.json.data.configured, false);
      const resumesBefore = await api(aiBase, 'GET', '/api/resumes', { token });
      const countBefore = resumesBefore.json.data.items.length;

      // 成功路径
      mockState.mode = 'success';
      const ok = await api(aiBase, 'POST', '/api/settings/llm/test', {
        token, body: { base_url: mockUrl, api_key: USER_KEY, model: 'qa-mock-model' },
      });
      assertEnvelope(ok, 200, 0);
      assert.deepEqual(Object.keys(ok.json.data).sort(), ['latencyMs', 'message', 'ok']);
      assert.equal(ok.json.data.ok, true);
      assert.equal(typeof ok.json.data.latencyMs, 'number');
      assert.ok(ok.json.data.latencyMs < 10000, '测试连接应在 10s 内返回');
      assert.equal(typeof ok.json.data.message, 'string');

      // 失败路径：HTTP 401 → 可读原因、不回显密钥
      mockState.mode = 'http401';
      const bad = await api(aiBase, 'POST', '/api/settings/llm/test', {
        token, body: { base_url: mockUrl, api_key: USER_KEY, model: 'qa-mock-model' },
      });
      assertEnvelope(bad, 200, 0);
      assert.equal(bad.json.data.ok, false);
      assert.ok(bad.json.data.latencyMs < 10000);
      assert.ok(/401|失败|不可达|无效/.test(bad.json.data.message), '失败原因应可读');
      assert.ok(!JSON.stringify(bad.json).includes(USER_KEY), '失败响应不得回显密钥明文');

      // 不落库、不产生简历记录
      const after = await api(aiBase, 'GET', '/api/settings/llm', { token });
      assert.equal(after.json.data.configured, false, '测试连接不得写入配置');
      const resumesAfter = await api(aiBase, 'GET', '/api/resumes', { token });
      assert.equal(resumesAfter.json.data.items.length, countBefore, '测试连接不得产生简历记录');
      mockState.mode = 'success';
    });

    test('C4-3 跨用户读取/使用配置返回 403；未登录私有接口 401', async () => {
      const a = await register(aiBase, 'ownerA');
      const b = await register(aiBase, 'ownerB');
      const mockUrl = `http://127.0.0.1:${mockPort}`;

      const put = await api(aiBase, 'PUT', '/api/settings/llm', {
        token: a.token,
        body: {
          config_name: 'A 的私有配置', base_url: mockUrl, api_key: USER_KEY,
          model: 'qa-user-model', is_enabled: true,
        },
      });
      assert.equal(put.status, 200);
      // 从 A 自己的 GET 中拿到配置 id 不可得（安全视图不含 id），改为从 db.json 读取
      const db = JSON.parse(fs.readFileSync(path.join(aiDir, 'db.json'), 'utf8'));
      const cfg = db.model_configs.find((c) => c.config_name === 'A 的私有配置');
      assert.ok(cfg, 'A 的配置应已落库');

      // B 带 A 的配置 id 读取 → 403
      const crossGet = await api(aiBase, 'GET', `/api/settings/llm?id=${cfg.id}`, { token: b.token });
      assertEnvelope(crossGet, 403, 403);
      // B 带 A 的配置 id 使用（测试连接）→ 403
      const crossTest = await api(aiBase, 'POST', '/api/settings/llm/test', {
        token: b.token, body: { config_id: cfg.id, base_url: mockUrl, model: 'x' },
      });
      assertEnvelope(crossTest, 403, 403);
      // B 不带 id 时只能看到自己的（空），绝不能读到 A 的配置
      const bGet = await api(aiBase, 'GET', '/api/settings/llm', { token: b.token });
      assert.equal(bGet.json.data.configured, false, 'B 不应看到 A 的配置');
      // 未登录
      const anon = await api(aiBase, 'GET', '/api/settings/llm');
      assertEnvelope(anon, 401, 401);
      const anon2 = await api(aiBase, 'GET', '/api/resumes');
      assertEnvelope(anon2, 401, 401);
      await api(aiBase, 'DELETE', '/api/settings/llm', { token: a.token });
    });

    test('C4-4 base_url 校验：公网 http 拒绝 422、localhost/https 接受', async () => {
      const { token } = await register(aiBase, 'baseurl');
      const bad = await api(aiBase, 'PUT', '/api/settings/llm', {
        token,
        body: {
          config_name: 'x', base_url: 'http://evil.example.com/v1',
          api_key: USER_KEY, model: 'm', is_enabled: true,
        },
      });
      assertEnvelope(bad, 422, 422);
      assert.equal(bad.json.data.errKey, 'INVALID_BASE_URL');
      const empty = await api(aiBase, 'PUT', '/api/settings/llm', {
        token, body: { config_name: '', base_url: `http://127.0.0.1:${mockPort}`, api_key: USER_KEY, model: 'm' },
      });
      assertEnvelope(empty, 422, 422);
    });
  });

  // ═══════════════ C5. 分享闭环 + 公开侧零泄露 ═══════════════════════════
  describe('C5 分享闭环与公开接口零配置字段', { concurrency: 1 }, () => {
    test('C5-1 开启分享 → 脱敏快照 → 公开只读四字段 → 关闭失效 → 重开新 token → republish 沿用', async () => {
      const { token } = await register(zeroBase, 'share');
      const { resumeId, templates } = await makeResumeWithMaterial(zeroBase, token, SAMPLE_TEXT);

      // 生成并显式写入含隐私字段的内容，便于验证快照脱敏
      const gen = await api(zeroBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      const content = gen.json.data.resume.content;
      content.basic.email = 'private@example.com';
      content.basic.phone = '13900001111';
      content.basic.links = [
        { label: '邮箱', url: 'mailto:private@example.com' },
        { label: '主页', url: 'https://example.com' },
      ];
      const saved = await api(zeroBase, 'PUT', `/api/resumes/${resumeId}`, {
        token, body: { content },
      });
      assert.equal(saved.status, 200);

      // ① 开启分享：≥128bit token（base64url 22 字符 = 16 字节 = 128bit）
      const on = await api(zeroBase, 'POST', `/api/resumes/${resumeId}/share`, { token });
      assertEnvelope(on, 200, 0);
      const token1 = on.json.data.share.token;
      assert.match(token1, /^[A-Za-z0-9_-]{22,}$/, 'token 应为 ≥128bit 高熵串');
      assert.ok(Buffer.from(token1, 'base64url').length >= 16);
      assert.equal(on.json.data.share.enabled, true);
      assert.ok(on.json.data.share.url.includes(token1));

      // ② 公开读取：只返回 4 字段且快照已脱敏
      const pub = await api(zeroBase, 'GET', `/api/public/share/${token1}`);
      assertEnvelope(pub, 200, 0);
      assert.deepEqual(Object.keys(pub.json.data).sort(), ['content', 'publishedAt', 'template', 'title']);
      const pubContent = pub.json.data.content;
      assert.equal(pubContent.basic.email, undefined, '快照应剔除 basic.email');
      assert.equal(pubContent.basic.phone, undefined, '快照应剔除 basic.phone');
      assert.ok(!('meta' in pubContent), '快照应剔除 meta 生成来源');
      assert.ok(!pubContent.basic.links.some((l) => /^(mailto:|tel:)/i.test(l.url)), '应剔除 mailto/tel 链接');
      const pubText = JSON.stringify(pub.json);
      for (const forbidden of ['private@example.com', '13900001111', 'user_id', 'file_url',
        'raw_text', 'parsed_text', 'api_key', 'api_key_mask', 'api_key_encrypted',
        'base_url', 'config_name', 'effectiveSource', 'generation_mode', 'config_source']) {
        assert.ok(!pubText.includes(forbidden), `公开响应不得含 ${forbidden}`);
      }
      assert.ok(pub.json.data.template.sections, '快照应自包含可渲染的 template');

      // 二维码只返回 dataUrl + url，且零配置字段
      const qr = await api(zeroBase, 'GET', `/api/resumes/${resumeId}/share/qrcode?size=320`, { token });
      assertEnvelope(qr, 200, 0);
      assert.deepEqual(Object.keys(qr.json.data).sort(), ['dataUrl', 'url']);
      assert.ok(qr.json.data.dataUrl.startsWith('data:image/png'));
      assert.ok(!/api_key|base_url|config_name|effectiveSource|api_key_mask/.test(JSON.stringify(qr.json)));

      // ③ 关闭分享：旧链接 404「链接已失效」且不泄露内容
      const off = await api(zeroBase, 'DELETE', `/api/resumes/${resumeId}/share`, { token });
      assertEnvelope(off, 200, 0);
      assert.equal(off.json.data.share.enabled, false);
      const dead = await api(zeroBase, 'GET', `/api/public/share/${token1}`);
      assertEnvelope(dead, 404, 404);
      assert.match(dead.json.message, /链接已失效/);
      assert.ok(!JSON.stringify(dead.json).includes('private@example.com'), '失效响应不得泄露内容');
      assert.ok(!/api_key|base_url|effectiveSource|config_name/.test(JSON.stringify(dead.json)));

      // ④ 重新开启生成新 token，旧 token 不复活
      const on2 = await api(zeroBase, 'POST', `/api/resumes/${resumeId}/share`, { token });
      const token2 = on2.json.data.share.token;
      assert.notEqual(token2, token1, '重新开启必须换新 token');
      const deadAgain = await api(zeroBase, 'GET', `/api/public/share/${token1}`);
      assertEnvelope(deadAgain, 404, 404);
      const alive = await api(zeroBase, 'GET', `/api/public/share/${token2}`);
      assert.equal(alive.status, 200);

      // ⑤ republish 沿用原 token 且更新快照
      const renamed = await api(zeroBase, 'PUT', `/api/resumes/${resumeId}`, {
        token, body: { title: 'QA 重新发布标题' },
      });
      assert.equal(renamed.status, 200);
      const rep = await api(zeroBase, 'POST', `/api/resumes/${resumeId}/share/republish`, { token });
      assertEnvelope(rep, 200, 0);
      assert.equal(rep.json.data.share.token, token2, 'republish 应沿用原 token');
      const repPub = await api(zeroBase, 'GET', `/api/public/share/${token2}`);
      assert.equal(repPub.json.data.title, 'QA 重新发布标题', 'republish 应更新快照内容');

      // 非法 token 格式 422；未知 token 404
      const badToken = await api(zeroBase, 'GET', '/api/public/share/short');
      assertEnvelope(badToken, 422, 422);
      const unknown = await api(zeroBase, 'GET', `/api/public/share/${'A'.repeat(22)}`);
      assertEnvelope(unknown, 404, 404);
      assert.ok(!/api_key|base_url|effectiveSource/.test(JSON.stringify(badToken.json)));
    });

    test('C5-2 已配置密钥时，公开成功/错误响应与二维码仍零配置字段（aiServer）', async () => {
      const { token } = await register(aiBase, 'pubsec');
      const { resumeId } = await makeResumeWithMaterial(aiBase, token, SAMPLE_TEXT);
      const mockUrl = `http://127.0.0.1:${mockPort}`;
      await api(aiBase, 'PUT', '/api/settings/llm', {
        token,
        body: {
          config_name: 'QA 公开隔离配置', base_url: mockUrl,
          api_key: 'sk-user-test-1234', model: 'qa-user-model', is_enabled: true,
        },
      });
      const on = await api(aiBase, 'POST', `/api/resumes/${resumeId}/share`, { token });
      const shareToken = on.json.data.share.token;
      // 字段名均含下划线/引号/连字符，标准 base64（二维码 dataUrl）不含这些字符，
      // 因此可直接对完整响应体做零泄露断言而不产生偶然命中。
      const forbidden = /api_key|base_url|config_name|effectiveSource|api_key_mask|last_tested_at|is_enabled|"model"\s*:|sk-/;
      for (const res of [
        await api(aiBase, 'GET', `/api/public/share/${shareToken}`),
        await api(aiBase, 'GET', '/api/public/share/nonexistent_token_xxx'),
        await api(aiBase, 'GET', '/api/public/share/short'),
        await api(aiBase, 'GET', `/api/resumes/${resumeId}/share/qrcode`, { token }),
      ]) {
        assert.ok(!forbidden.test(JSON.stringify(res.json)),
          `响应不得含任何配置字段：${JSON.stringify(res.json).slice(0, 160)}`);
      }
      await api(aiBase, 'DELETE', '/api/settings/llm', { token });
    });
  });

  // ═══════════════ C6. 鉴权与越权 ═══════════════════════════
  describe('C6 鉴权、越权、登出黑名单与账号锁定', { concurrency: 1 }, () => {
    test('C6-1 A 用户 token 访问 B 用户的资料/简历/分享一律 403（不是 404）', async () => {
      const a = await register(zeroBase, 'crossA');
      const b = await register(zeroBase, 'crossB');
      const { resumeId, materialId } = await makeResumeWithMaterial(zeroBase, b.token, SAMPLE_TEXT);
      await api(zeroBase, 'POST', `/api/resumes/${resumeId}/share`, { token: b.token });

      const paths = [
        `/api/materials/${materialId}`,
        `/api/resumes/${resumeId}`,
        `/api/resumes/${resumeId}/share`,
        `/api/resumes/${resumeId}/share/qrcode`,
      ];
      for (const p of paths) {
        const res = await api(zeroBase, 'GET', p, { token: a.token });
        assertEnvelope(res, 403, 403, );
      }
      // 写操作同样 403
      const write = await api(zeroBase, 'PUT', `/api/resumes/${resumeId}`, {
        token: a.token, body: { title: '越权篡改' },
      });
      assertEnvelope(write, 403, 403);
      const del = await api(zeroBase, 'DELETE', `/api/materials/${materialId}`, { token: a.token });
      assertEnvelope(del, 403, 403);
      // 生成接口也 403
      const gen = await api(zeroBase, 'POST', `/api/resumes/${resumeId}/generate`, { token: a.token, body: {} });
      assertEnvelope(gen, 403, 403);
    });

    test('C6-2 登出后旧 token 立即 401（jti 黑名单）', async () => {
      const { token } = await register(zeroBase, 'logout');
      const before = await api(zeroBase, 'GET', '/api/auth/me', { token });
      assert.equal(before.status, 200);
      const out = await api(zeroBase, 'POST', '/api/auth/logout', { token, body: {} });
      assertEnvelope(out, 200, 0);
      assert.equal(out.json.data.revoked, true);
      const after = await api(zeroBase, 'GET', '/api/auth/me', { token });
      assertEnvelope(after, 401, 401);
      const resumes = await api(zeroBase, 'GET', '/api/resumes', { token });
      assertEnvelope(resumes, 401, 401);
    });

    test('C6-3 连续 5 次密码错误锁 5 分钟，返回 429 + data.lockedUntil', async () => {
      const user = await register(zeroBase, 'lock');
      const account = user.email;
      for (let i = 1; i <= 4; i += 1) {
        const res = await api(zeroBase, 'POST', '/api/auth/login', {
          body: { account, password: 'WrongPass999' },
        });
        assertEnvelope(res, 401, 401);
      }
      const fifth = await api(zeroBase, 'POST', '/api/auth/login', {
        body: { account, password: 'WrongPass999' },
      });
      assertEnvelope(fifth, 429, 429);
      assert.equal(fifth.json.data.errKey, 'ACCOUNT_LOCKED');
      assert.ok(fifth.json.data.lockedUntil, '应返回 lockedUntil');
      const until = Date.parse(fifth.json.data.lockedUntil);
      assert.ok(Number.isFinite(until) && until > Date.now(), 'lockedUntil 应为未来时间');
      assert.ok(until - Date.now() <= 5 * 60 * 1000 + 5000, '锁定时长约 5 分钟');

      // 锁定期内即使密码正确也 429
      const correct = await api(zeroBase, 'POST', '/api/auth/login', {
        body: { account, password: 'QaPass12345' },
      });
      assertEnvelope(correct, 429, 429);
    });

    test('C6-4 注册/校验类错误码：409 冲突、422 弱密码、404 不存在', async () => {
      const u = await register(zeroBase, 'code');
      const dup = await api(zeroBase, 'POST', '/api/auth/register', {
        body: { email: u.email, username: 'anotheruser', password: 'QaPass12345', confirmPassword: 'QaPass12345' },
      });
      assertEnvelope(dup, 409, 409);
      const weak = await api(zeroBase, 'POST', '/api/auth/register', {
        body: { email: 'weak@example.com', username: 'weakuser', password: '123', confirmPassword: '123' },
      });
      assertEnvelope(weak, 422, 422);
      assert.equal(weak.json.data.errKey, 'WEAK_PASSWORD');
      const notFound = await api(zeroBase, 'GET', '/api/resumes/00000000-0000-0000-0000-000000000000', { token: u.token });
      assertEnvelope(notFound, 404, 404);
    });
  });

  // ═══════════════ C7. 资料、模板、边界 ═══════════════════════════
  describe('C7 资料与模板、上传边界、normalizeContent', { concurrency: 1 }, () => {
    test('C7-1 删除资料不破坏已生成简历；模板切换只改 template_id 不触碰 content_json', async () => {
      const { token } = await register(zeroBase, 'tmpl');
      const { resumeId, templates, materialId } = await makeResumeWithMaterial(zeroBase, token, SAMPLE_TEXT);
      const gen = await api(zeroBase, 'POST', `/api/resumes/${resumeId}/generate`, { token, body: {} });
      const contentBefore = JSON.stringify(gen.json.data.resume.content);

      // 删除资料
      const del = await api(zeroBase, 'DELETE', `/api/materials/${materialId}`, { token });
      assert.equal(del.json.data.deleted, true);
      const afterDel = await api(zeroBase, 'GET', `/api/resumes/${resumeId}`, { token });
      assert.equal(JSON.stringify(afterDel.json.data.resume.content), contentBefore,
        '删除资料不得改变已生成简历内容');

      // 切换模板
      const otherTemplate = templates.find((t) => t.id !== templates[0].id);
      assert.ok(otherTemplate);
      const beforeTpl = afterDel.json.data.resume.template_id;
      const switched = await api(zeroBase, 'PUT', `/api/resumes/${resumeId}`, {
        token, body: { templateId: otherTemplate.id },
      });
      assert.equal(switched.status, 200);
      assert.equal(switched.json.data.resume.template_id, otherTemplate.id);
      assert.notEqual(switched.json.data.resume.template_id, beforeTpl);
      assert.equal(JSON.stringify(switched.json.data.resume.content), contentBefore,
        '模板切换不得触碰 content_json');
      const detail = await api(zeroBase, 'GET', `/api/resumes/${resumeId}`, { token });
      assert.equal(detail.json.data.resume.template.code, otherTemplate.code);
    });

    test('C7-2 3 套模板经 HTTP 返回完整 schema_json 且 sections 可渲染', async () => {
      const { token } = await register(zeroBase, 'tpl3');
      const res = await api(zeroBase, 'GET', '/api/templates', { token });
      assertEnvelope(res, 200, 0);
      assert.equal(res.json.data.items.length, 3);
      for (const item of res.json.data.items) {
        assert.equal(item.schema_json.sections.length, 7);
        assert.ok(item.schema_json.sections.every((s) => s.enabled));
        assert.equal(item.status, 'active');
        assert.equal(item.preview_url, '');
      }
    });

    test('C7-3 上传白名单拒绝 .exe；10MB 超限 422；50 份上限 429', async () => {
      const { token } = await register(zeroBase, 'uplimit');

      // 类型白名单
      const badType = new FormData();
      badType.append('files', new Blob(['MZ fake exe']), 'malware.exe');
      const rej = await api(zeroBase, 'POST', '/api/materials/upload', { token, form: badType });
      assert.equal(rej.status, 422, `拒绝非法类型应 422，实际 ${rej.status}`);
      assert.equal(rej.json.code, 422);

      // 10MB 上限（默认 MAX_FILE_SIZE_MB=10，传 10MB+1KB）
      const tooBig = new FormData();
      tooBig.append('files', new Blob([Buffer.alloc(10 * 1024 * 1024 + 1024, 0x61)]), 'big.txt');
      const big = await api(zeroBase, 'POST', '/api/materials/upload', { token, form: tooBig });
      assert.equal(big.status, 422, `超 10MB 应 422，实际 ${big.status}`);
      assert.equal(big.json.code, 422);

      // 50 份上限（默认 getMaxMaterialsPerUser()=50）
      const limitUser = await register(zeroBase, 'limit50');
      for (let i = 0; i < 50; i += 1) {
        const r = await api(zeroBase, 'POST', '/api/materials/text', {
          token: limitUser.token, body: { rawText: `第 ${i + 1} 份资料内容` },
        });
        assert.equal(r.status, 200, `第 ${i + 1} 份应成功`);
      }
      const overflow = await api(zeroBase, 'POST', '/api/materials/text', {
        token: limitUser.token, body: { rawText: '第 51 份资料' },
      });
      assertEnvelope(overflow, 429, 429);
      assert.equal(overflow.json.data.errKey, 'MATERIAL_LIMIT');
    });

    test('C7-4 路径穿越文件名不逃逸；落盘为随机名；TXT 正常解析参与生成', async () => {
      const { token } = await register(zeroBase, 'traversal');
      const form = new FormData();
      form.append('files', new Blob(['姓名：路径测试\n技能：React、TypeScript']), '../../../../evil_qa.txt');
      const up = await api(zeroBase, 'POST', '/api/materials/upload', { token, form });
      assert.equal(up.status, 200, `上传应成功：${JSON.stringify(up.json)}`);
      const item = up.json.data.items[0];
      assert.equal(item.parse_status, 'success');
      // DATA_DIR 位于系统临时目录时，file_url 允许含相对 .. 段；关键是落盘 basename
      // 必须是 UUID，绝不能是用户可控的原始文件名（路径穿越防护的实质）。
      const diskName = path.basename(item.file_url);
      assert.match(diskName, /^[0-9a-f-]{36}\.txt$/,
        `落盘文件名应为 UUID，不得使用用户原始文件名：${diskName}`);
      assert.ok(!diskName.includes('evil_qa'), '落盘名不得含原始文件名片段');
      assert.ok(item.file_url.includes('uploads'), '应落在 uploads 目录');

      // 磁盘上不得出现逃逸文件
      assert.ok(!fs.existsSync(path.join(ROOT, 'evil_qa.txt')), '项目根不得出现逃逸文件');
      assert.ok(!fs.existsSync(path.join(zeroDir, 'evil_qa.txt')), '数据根不得出现原始文件名');
      const db = JSON.parse(fs.readFileSync(path.join(zeroDir, 'db.json'), 'utf8'));
      const users = db.users;
      assert.ok(Array.isArray(users));
      for (const u of users) {
        const dir = path.join(zeroDir, 'uploads', u.id);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          assert.match(name, /^[0-9a-f-]{36}\.[a-z0-9]+$/, `落盘文件名应为 UUID：${name}`);
        }
      }
      // 上传资料可参与生成闭环
      const tpl = await api(zeroBase, 'GET', '/api/templates', { token });
      const created = await api(zeroBase, 'POST', '/api/resumes', {
        token, body: { templateId: tpl.json.data.items[0].id },
      });
      const gen = await api(zeroBase, 'POST', `/api/resumes/${created.json.data.resume.id}/generate`, { token, body: {} });
      assert.equal(gen.json.data.generationMode, 'rule');
      assert.ok(gen.json.data.resume.content.skill.length > 0, '上传文本应被解析并进入生成结果');
    });

    test('C7-5 PDF 解析失败标记 parse_status=failed 而不阻塞上传与生成闭环', async () => {
      const { token } = await register(zeroBase, 'pdf');
      const form = new FormData();
      // 故意上传非合法 PDF 内容，验证解析降级（可选依赖缺失/损坏均走同一降级分支）
      form.append('files', new Blob(['this is not a real pdf file']), 'fake_resume.pdf');
      const up = await api(zeroBase, 'POST', '/api/materials/upload', { token, form });
      assert.equal(up.status, 200, 'PDF 解析失败不得阻塞上传接口');
      assert.equal(up.json.code, 0);
      const item = up.json.data.items[0];
      assert.equal(item.parse_status, 'failed', '解析失败应标记 failed');
      assert.ok(up.json.data.failed.length >= 1, '应在 failed 列表给出原因');

      // 生成闭环仍可用（汇总其它成功解析资料；本例为空文本也返回 200 规则化结果）
      const tpl = await api(zeroBase, 'GET', '/api/templates', { token });
      const created = await api(zeroBase, 'POST', '/api/resumes', {
        token, body: { templateId: tpl.json.data.items[0].id },
      });
      const gen = await api(zeroBase, 'POST', `/api/resumes/${created.json.data.resume.id}/generate`, { token, body: {} });
      assertEnvelope(gen, 200, 0);
      assert.equal(gen.json.data.generationMode, 'rule');
      assert.ok(gen.json.data.resume.content.summary.content.length > 0, '仍应产出可读简历');
    });

    test('C7-6 normalizeContent(null) / ({}) / 残缺输入均不抛错且补齐 7 分区', async () => {
      const { normalizeContent, SECTION_KEYS, createEmptyContent } = await import('../domain/contentSchema.js');
      for (const input of [null, undefined, {}, [], 'garbage', 42,
        { basic: null, education: 'not-array', work: [null, 3], meta: { generatedMode: 'HACK' } }]) {
        let result;
        assert.doesNotThrow(() => { result = normalizeContent(input); }, `输入 ${String(input)} 不应抛错`);
        for (const key of SECTION_KEYS) assert.ok(key in result, `${key} 必须补齐`);
        assert.equal(result.meta.schemaVersion, 1);
        assert.ok(['ai', 'rule', 'manual'].includes(result.meta.generatedMode));
        assert.ok(['user', 'env', 'none'].includes(result.meta.configSource));
        assert.ok(Array.isArray(result.education) && Array.isArray(result.work));
        assert.equal(typeof result.basic.name, 'string');
      }
      const empty = createEmptyContent();
      assert.equal(empty.meta.generatedMode, 'manual');
      assert.notEqual(createEmptyContent(), empty, '应返回独立副本');
    });
  });

  // ═══════════════ C8. 错误码契约 ═══════════════════════════
  describe('C8 统一响应契约 {code,message,data}', { concurrency: 1 }, () => {
    test('C8-1 抽查 6 个接口：成功 200/0，错误 HTTP 状态与 code 完全一致', async () => {
      const { token } = await register(zeroBase, 'contract');
      const cases = [
        { method: 'GET', path: '/api/templates', token, status: 200, code: 0 },
        { method: 'GET', path: '/api/resumes', status: 401, code: 401 },
        { method: 'POST', path: '/api/materials/text', token, body: {}, status: 422, code: 422 },
        { method: 'GET', path: '/api/resumes/not-exist-id', token, status: 404, code: 404 },
        { method: 'GET', path: '/api/resumes/not-exist-id/share/qrcode', token, status: 404, code: 404 },
        { method: 'GET', path: '/api/no-such-endpoint', token, status: 404, code: 404 },
      ];
      for (const c of cases) {
        const res = await api(zeroBase, c.method, c.path, { token: c.token, body: c.body });
        assertEnvelope(res, c.status, c.code);
        if (c.status >= 400) {
          assert.ok(res.json.message.length > 0, '错误响应应有可读 message');
          assert.ok(!/api_key|sk-/.test(JSON.stringify(res.json)), '错误体不得含密钥');
        }
      }
      // Content-Type 契约
      const res = await api(zeroBase, 'GET', '/api/auth/me', { token });
      assert.match(res.headers.get('content-type') || '', /application\/json/);
    });
  });
});
