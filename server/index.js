/**
 * 服务端入口：读 env → 初始化 Store/Repository/seed → 装配中间件与路由 → listen。
 * NODE_ENV=production 时额外托管 dist/ 并提供 SPA fallback（单端口部署）。
 * 启动日志只打印端口、模板数量与配置来源状态计数，绝不打印任何密钥或掩码。
 */
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDataDir,
  getPort,
  getJwtSecret,
  getEnv,
} from './domain/contracts.js';
import { initRepository, getRepo } from './store/repository.js';
import { runSeed } from './store/collections.js';
import {
  attachResponseHelpers,
  errorHandler,
  apiNotFound,
  createRateLimiter,
} from './middleware.js';
import { createPrivateRouter } from './routes/private.js';
import { createPublicRouter } from './routes/public.js';
import { envLlmConfigured } from './services/modelConfigService.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. 数据层初始化 ──────────────────────────────────────────────
const repository = initRepository(getDataDir());
const templateCount = await runSeed(repository);

// ── 2. Express 装配 ──────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(attachResponseHelpers);

// 内存限流（只按 IP 计数，不记录请求体）。
app.use('/api', createRateLimiter());

// 公开前缀必须先于私有前缀注册，且独立文件、不挂鉴权。
app.use('/api/public', createPublicRouter());
app.use('/api', createPrivateRouter());
app.use('/api', apiNotFound);

// ── 3. 生产态静态托管与 SPA fallback ─────────────────────────────
if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
  const distDir = path.join(projectRoot, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
}

// 错误归一化必须最后挂载。
app.use(errorHandler);

// ── 4. 启动 ──────────────────────────────────────────────────────
const port = getPort();
app.listen(port, () => {
  const currentRepo = getRepo();
  const userConfigCount = currentRepo.store.read('model_configs')
    .filter((item) => item.is_enabled).length;
  const envConfigured = envLlmConfigured();
  const usingDefaultJwt = getJwtSecret() === 'dev-only-change-me';

  console.log(`[简历 Agent] 服务已启动：http://localhost:${port}`);
  console.log(`[简历 Agent] 内置模板：${templateCount} 套`);
  console.log(
    `[简历 Agent] 配置来源状态：用户级启用 ${userConfigCount} 套 / 部署级 ${envConfigured ? '已配置' : '未配置'} / 无密钥时规则化生成`,
  );
  console.log(`[简历 Agent] 数据目录：${getDataDir()}`);
  if (usingDefaultJwt) {
    console.log('[简历 Agent] 提示：JWT_SECRET 使用开发默认值，生产环境请在 .env 中修改（不阻断 demo）');
  }
  // S2：LLM_BASE_URL / LLM_MODEL 缺失只用默认值并打印提示；LLM_API_KEY 为空即「无配置」，不发网络请求。
  if (!getEnv('LLM_BASE_URL', '')) {
    console.log('[简历 Agent] 提示：LLM_BASE_URL 未配置，使用默认值 https://api.openai.com/v1');
  }
  if (!getEnv('LLM_MODEL', '')) {
    console.log('[简历 Agent] 提示：LLM_MODEL 未配置，使用默认值 gpt-4o-mini');
  }
  if (!getEnv('LLM_API_KEY', '')) {
    console.log('[简历 Agent] 提示：未配置部署级密钥，生成将走本地规则化；可在设置页由用户自行配置');
  }
});
