# 简历生成 Agent · 本期实现说明与自测报告（架构 v1.1）

> 工程师：寇豆码（Alex）｜**权威依据：`docs/02-ARCHITECTURE.md` v1.1（1346 行，覆盖性修订）**，辅以 `docs/01-PRD.md`、`docs/01-PRD-ADDENDUM.md`（CR-001）
> 项目根目录：`D:/workbuddy_project/resume-agent/`
> 交付范围：v1.1 第 2 节「本期实现 ✅」的 **43 个代码文件**；另按要求追加根目录 `README.md` 与本文件，共 **45 个交付文件**。6 个「预留文件 ❌」逐项核验未创建。
> 版本说明：本报告为按 v1.1 修订后的最终版，取代此前的 v1.0 报告；配置接口、前端设置页路由、加解密文件拆分、复合索引与 S1~S10 均已落地，**旧接口无兼容层**。

---

## 1. 文件清单（按 T01 → T05 分组，v1.1 编号）

### T01 · 项目基础设施与工程约定（9 个）

| # | 文件 | 说明 |
| --- | --- | --- |
| 1 | `package.json` | scripts 按 9.4 节原文；`type:module`；纯 JS 依赖；`pdfjs-dist`/`mammoth` 在 `optionalDependencies`；无 node-gyp 原生模块 |
| 2 | `vite.config.ts` | `@`→`src`、port 5173、`/api` 代理到 `http://localhost:3001`、内联 PostCSS、显式 `esbuild.jsx='automatic'` |
| 3 | `tailwind.config.js` | ESM 默认导出，`corePlugins.preflight=false`，中性蓝灰扩展色 |
| 4 | `index.html` | `lang="zh-CN"`、中文 meta、viewport、挂载点 |
| 5 | `.env.example` | 6.7 节全部变量，**只有 `<your-api-key>` / `<set-a-random-secret>` 等占位符**（S10） |
| 6 | `.gitignore` | 忽略 `node_modules/ dist/ data/ .env` |
| 7 | `src/main.tsx` | `createRoot` + `BrowserRouter` + MUI `ThemeProvider/CssBaseline`（zhCN）+ `ToastProvider`/`AuthProvider` |
| 8 | `src/App.tsx` | 6.2 节完整路由表；**P8 路由 `/settings/llm`**；`PrivateRoute`（未登录带 redirect 回跳）；公开 `/s/:token` 不套 Layout |
| 9 | `src/index.css` | Tailwind 指令、CSS 变量、A4 预览/缩略图/打印样式、响应式无横向滚动 |

### T02 · 服务端数据层与领域约定（6 个）

| # | 文件 | 说明 |
| --- | --- | --- |
| 10 | `server/store/jsonStore.js` | 7 集合、内存快照、Promise 串行写队列、tmp→fsync→rename 原子写、启动清理 `db.json.tmp-*` |
| 11 | `server/store/collections.js` | 集合定义、唯一键、**`COMPOSITE_INDEXES` 复合索引声明**（含 `model_configs(user_id,is_enabled)`）、`runSeed()` |
| 12 | `server/store/repository.js` | **唯一数据出入口**：唯一键 Map（冲突 409）+ 复合索引内存 Map + `findByComposite/findOneByComposite`；`getOwned` 跨用户 403 |
| 13 | `server/domain/contentSchema.js` | `EMPTY_CONTENT` / `SECTION_KEYS` / `SAMPLE_CONTENT` / `normalizeContent()`；前后端同构（无 node: 依赖） |
| 14 | `server/domain/templates.js` | 3.4 节 `BUILTIN_TEMPLATES` 逐值照抄 + `seedTemplates()` 幂等 |
| 15 | `server/domain/contracts.js` | 6.1 节 `CODE` / `AppError`、状态与模式枚举、环境变量惰性读取、路径与限额常量 |

### T03 · 服务端业务与 HTTP 接口层（14 个，含 #43）

| # | 文件 | 说明 |
| --- | --- | --- |
| 16 | `server/index.js` | env → Store/Repository/seed → 中间件 → `/api/public` → `/api` → 静态 `dist`/SPA fallback → listen；启动日志含 `LLM_BASE_URL`/`LLM_MODEL` 默认值提示（S2），**不含密钥或掩码** |
| 17 | `server/middleware.js` | `res.ok/res.fail`、`asyncHandler`、`apiNotFound`、错误归一化、内存限流、`requireAuth`（JWT + jti 黑名单） |
| 18 | `server/utils/security.js` | **仅认证原语**：bcryptjs、JWT(jti)、128bit 高熵 token、公开 URL 拼装；AES 加解密已拆至 #43 |
| 19 | `server/services/authService.js` | 注册/登录/登出/me/注销级联清理、密码强度、5 次锁定 5 分钟（429 + `lockedUntil`） |
| 20 | `server/services/modelConfigService.js` | **CR-001**：`resolveModelConfig()` 单一入口、`/api/settings/llm` 的 `getSettings/upsert/delete` 与 `effectiveSource`、10s 测试连接、复合索引查询、归属隔离（S1/S2/S5/S6） |
| 21 | `server/services/materialService.js` | multer 随机 UUID 落盘、白名单/10MB/50 份、文本粘贴、CRUD、重新解析、上传目录清理 |
| 22 | `server/services/parseService.js` | TXT/MD 内置抽取，PDF/DOCX 动态 import + try/catch 降级，图片 skipped |
| 23 | `server/services/aiService.js` | `generateStructured()` 编排、OpenAI 兼容 `fetch`、`AbortSignal.timeout`、强制 JSON、**失败/超时/鉴权失败/非法 JSON 一律降级不换源**（S3/S4） |
| 24 | `server/services/ruleGenerator.js` | 纯本地零网络规则化生成（正则 + 关键词词库 + 7 分区填充），AC-01 底线 |
| 25 | `server/services/resumeService.js` | 简历 CRUD、另存版本、模板切换不动 content、生成落库留痕 `generation_mode/config_source` |
| 26 | `server/services/shareService.js` | 幂等开启、**脱敏快照**、republish/撤销、view_count、二维码 dataURL（S8 零配置字段） |
| 27 | `server/routes/private.js` | 5.1 节全部 **29 个**私有接口；**`/api/settings/llm*` 四个接口全部挂 `requireAuth` 并按 `user_id` 过滤** |
| 28 | `server/routes/public.js` | **独立文件**、`/api/public`、无鉴权、不 import 任何私有 service、`readPublicSnapshot()` 只返回 4 字段 |
| **43** | `server/utils/crypto.js` | **v1.1 新增**：Node 内置 `crypto` 的 AES-256-GCM 加密/解密（12 字节随机 IV + tag，`base64(iv).base64(tag).base64(cipher)`）、`mask()` 掩码、`MODEL_CONFIG_SECRET`/`scryptSync(JWT_SECRET,'ra-model-cfg',32)` 派生加密密钥、`scrubSecret()` 错误脱敏；明文不出口 |

### T04 · 前端基础与复用层（5 个）

| # | 文件 | 说明 |
| --- | --- | --- |
| 29 | `src/types/index.ts` | 3.1 节全部类型与枚举；**`LlmSettings`（configured/config/effectiveSource）、`LlmDeleteResult`、`LlmTestPayload`**（替代旧 `ModelConfigStatus`） |
| 30 | `src/api/client.ts` | `apiFetch`（Bearer + 解包 + 401 清 `ra_token` 回跳）与 `publicFetch`（**绝不读取/附加 token**）；通用包装器，无硬编码业务路径 |
| 31 | `src/store/authStore.tsx` | Context + `localStorage('ra_token')`，`login/logout/refreshMe/deleteAccount`，刷新不掉线 |
| 32 | `src/components/shell.tsx` | 四类状态组件、`ConfirmDialog`、`Toast`、表单字段（含 `PasswordField` 显隐）、导航、用户下拉（**设置入口 → `/settings/llm`**）、`GenerationSourceBar` |
| 33 | `src/components/ResumeRenderer.tsx` | 纯展示，props 仅 `content` + `schema`，只遍历 `schema.sections` 并应用 `theme/style` |

### T05 · 前端页面、集成与测试（9 个）

| # | 文件 | 说明 |
| --- | --- | --- |
| 34 | `src/pages/AuthPage.tsx` | P1 登录/注册 Tab、密码显隐、校验、锁定倒计时、成功回跳 |
| 35 | `src/pages/MaterialsPage.tsx` | P2 拖拽/多选上传、粘贴框、卡片 CRUD、解析状态、重新解析、超限提示、删除二次确认 |
| 36 | `src/pages/TemplatesPage.tsx` | P3 网格、`SAMPLE_CONTENT` 缩略渲染、预览弹窗、使用模板、当前模板角标 |
| 37 | `src/pages/ResumeEditPage.tsx` | P4 左编辑右预览/移动 Tab、7 分区增删改排序、300ms 防抖、生成三阶段进度+30s 超时、来源标识条、保存/另存/去分享/打印 |
| 38 | `src/pages/ResumesPage.tsx` | P5 列表、搜索/状态筛选、新建/重命名/删除/复制/设为当前、分享状态标识 |
| 39 | `src/pages/SharePage.tsx` | P6 分享开关、复制链接、`<img alt="简历分享二维码">` + 下载 PNG、风险提示、关闭/重新发布 |
| 40 | `src/pages/PublicResumePage.tsx` | P7 免登录只读、**无 Layout / 无 authStore / 无 apiFetch / 无编辑入口**、失效统一提示、骨架屏 |
| 41 | `src/pages/ModelConfigPage.tsx` | P8 路由 `/settings/llm`：来源状态条（`effectiveSource`）、`type="password"` + 显隐 + 掩码回显、启用开关、测试连接、保存/删除二次确认、风险提示、表单校验禁用保存；**只调 `/api/settings/llm*`** |
| 42 | `server/tests/core.test.js` | 5 组 describe / **27 个真实断言用例**（含 v1.1 新契约与 S8 检查） |

**附加交付**：`README.md`（项目简介、一键启动、默认端口、两条密钥配置路径与优先级、v1.1 接口表、无密钥降级、局域网 IP 提示、移动端后续路线）、`docs/03-IMPLEMENTATION.md`（本文件）。

**未创建（预留）**：`server/store/sqliteRepository.js`、`server/services/ocrService.js`、`server/services/exportService.js`、`server/routes/generateStream.js`、`miniapp/`、`public/manifest.webmanifest` + `public/sw.js`。已逐项核验不存在。

---

## 2. 关键实现说明

1. **零编译持久化**：`JsonStore.commit()` 用 Promise 写锁串行化所有写事务；每次写 `structuredClone(cache)` → `db.json.tmp-<uuid>` → `fsync` → `rename` 覆盖；启动时清理残留 tmp、损坏文件备份重建。仅保证**单进程**一致性。
2. **唯一数据出入口 + 索引**：业务层只依赖 `repo` 代理；唯一键（users.email/username、templates.code、share_links.token、**model_configs.user_id（MVP 每用户 1 套）**、revoked_tokens.jti）在内存建 Map，冲突 409。`COMPOSITE_INDEXES` 声明 `idx(user_id,is_enabled)` 等 4 个复合查询索引，Repository 启动时构建「组合值 → id 集合」Map 并在 insert/update/remove 时同步维护；`findOneByComposite('model_configs',[userId,1])` 精确命中已启用配置。**类图关系按 `User 1:N ModelConfig : configures` 表达，P1 放开多套时表结构零改动**（M-04）。
3. **统一响应与错误**：`{code,message,data}`，`code=0` 成功；HTTP 状态与 code 一致；401 前端清 `ra_token` 并跳 `/login?redirect=...`；403 用于跨用户；异常日志只打印错误名，错误体不回显堆栈或密钥。
4. **content_json 单一规范化**：`normalizeContent()` 对 null/残缺/错类型输入一律补齐 7 分区 + meta 且绝不抛错；`create/update/copy/generate/快照复制` 全部先过该函数。
5. **Schema 驱动渲染**：`ResumeRenderer` 只遍历 `schema.sections` 并应用 `theme/style`；新增模板只需新增配置。缩略图用 `SAMPLE_CONTENT` 渲染，无图片资源。
6. **CR-001 / v1.1 密钥能力**：
   - **S1** `resolveModelConfig(userId)`：`user`（已启用，走复合索引 + AES-GCM 解密）> `env`（`LLM_API_KEY` 非空）> `null`；`aiService` 只消费解析结果，前端不传递/拼接密钥。
   - **S2** `envLlmConfigured() = Boolean((process.env.LLM_API_KEY || '').trim())`；`LLM_BASE_URL`/`LLM_MODEL` 缺失只用默认值并打印启动日志；`LLM_API_KEY` 为空即「无配置」，`generateStructured()` 在发起任何 `fetch` 之前直接返回 `rule/none`。
   - **S3** 选定来源调用失败 / 超时 30s / 鉴权失败 / 非法 JSON → 本次 `generationMode='rule'` + `degradedReason`，**保留原 `configSource`（user/env），绝不自动切换另一来源**；只有完全未配置才为 `none`。
   - **S4** 生成响应同时带 `generationMode`、`configSource`；`resume.generation_mode/config_source` 与 `content_json.meta` 同步留痕；P4 按 5.4 四态展示来源条与降级黄条，禁止错标。
   - **S5/#43** 加解密全部在 `server/utils/crypto.js`（Node 内置 `crypto`）：`MODEL_CONFIG_SECRET` 优先（sha256），未配置 `scryptSync(JWT_SECRET,'ra-model-cfg',32)` 派生；密文随机 12B IV + tag；掩码仅末 4 位。库内只有 `api_key_encrypted` 与 `api_key_mask`。
   - **S5/接口形状** `GET /api/settings/llm` → `{configured, config(6 个安全字段)|null, effectiveSource:'user'|'env'|'none'}`；未配置返回 200 + `configured:false`，**不再有独立 `/status` 接口**。`PUT` 返回 `{configured:true, config:{...掩码}, effectiveSource}`；`DELETE` 返回 `{configured:false, effectiveSource}`，未配置时 404；`POST /api/settings/llm/test` 返回 `{ok, latencyMs, message}`，10s 超时、不落库、不生成简历、失败原因脱敏且复用本人已存密文（未传 `api_key` 时）。
   - **S6** 四个 `/api/settings/llm*` 全部挂 `requireAuth`，按 `req.user.id` 过滤；可选 `?id=` / `body.config_id` 触发 `assertConfigOwner()`，跨用户读取/使用一律 **403**。
   - **S7** P8 `api_key` 用 `PasswordField`（`type="password"` + 显隐切换），已保存只回填掩码；`base_url`/`model`/`config_name` 校验不通过时禁用保存。
   - **S8** `/api/public/*` 只返回 `title/content/template/publishedAt`；二维码接口只返回 `{dataUrl, url}` 且仅在登录态；任何响应（含错误体）不含 `api_key*` / `base_url` / `model` / `config_name` / `effectiveSource` / 掩码；`public.js` 不 import 私有 service。
   - **S9** 明文密钥只在本次请求内存存在：不写启动日志、请求日志、异常 message、错误响应、简历记录、快照；`decrypt` 失败抛 `AppError(500,'密钥解析失败')`；异常日志只打印错误名。
   - **S10** `.env.example`、代码、文档、示例数据只有 `<your-api-key>` 等占位符，无厂商专有字段或适配分支；`encrypt/decrypt/mask/scrubSecret` 全部集中在 #43。
7. **分享隔离**：`buildSnapshot()` 复制并 `normalizeContent()`，剔除 `basic.email/phone`、清除 `content.meta`、过滤 `mailto:`/`tel:` 链接；快照自包含 template。`public.js` 按 5.3 节做 token 格式校验、失效判定（撤销/过期/简历已删统一 404「链接已失效」）、`view_count+1`。关闭后重新开启生成新 token；`republish` 沿用原 token。
8. **上传安全**：multer 白名单 9 种扩展名、10MB、单次 ≤20 文件、单用户 ≤50 份；落盘名一律 `randomUUID()` + 白名单扩展名（**绝不拼接用户 file_name**），`data/uploads/<userId>/` 不挂 `express.static`。PDF/DOCX 用 optionalDependencies 动态 import 包裹 try/catch，失败标记 `parse_status=failed` +「解析失败，可手动补录」；图片 `skipped`。
9. **账号安全**：bcryptjs 加盐哈希、密码 ≥8 位含字母+数字、JWT 7 天含 jti、登出写 `revoked_tokens`（旧 token 401）、连续 5 次错误锁 5 分钟（429 + `data.lockedUntil`）、`DELETE /api/auth/me` 级联清理。
10. **前端分层**：`pages → components/store/api → types` 单向，`api` 不 import `store`，`components` 不 import `api`；`PublicResumePage` 只用 `publicFetch`。响应式 375~1920px 无横向滚动、按钮 ≥44×44px、P4 移动 Tab、300ms 防抖、二次确认统一 `ConfirmDialog`。

### 按架构第 8 节「建议默认值」自行决策（无需确认）

Q1 不绑定厂商；Q2 `MODEL_CONFIG_SECRET` 留空由 `JWT_SECRET` 派生并打印启动告警；Q3 校验允许 `https://` 与本机 `http://localhost|127.0.0.1`；Q4 测试连接走 `/chat/completions`、`max_tokens:1`、10s；Q5 失败降级保留被选来源；Q6 `PUBLIC_BASE_URL` 默认 `http://localhost:5173` 并在 README 提示改局域网 IP；Q7 缩略图用 `SAMPLE_CONTENT`；Q8 快照剔除 email/phone；Q9 `NODE_ENV=production` 托管 `dist` + SPA fallback；Q10 仅单进程一致；Q11 本期实现账号注销级联清理；Q12 不提供原文件下载接口。

---

## 3. 全局一致性审查结论（v1.1 覆盖性复核）

逐项核对任务书 15 条契约、**v1.1 五条差异**、6.7.1 的 S1~S10、import 路径互存、前后端字段名、路由齐全性、遗漏文件：

| 检查项 | 结果 |
| --- | --- |
| package.json scripts / 依赖 / optionalDependencies / 无原生模块 | ✅ `npm install` 一次成功，346 包，无 node-gyp |
| vite 配置（alias/proxy/内联 PostCSS/preflight=false/无 postcss.config.*） | ✅ |
| 统一响应、CODE/AppError、错误码与前端动作、401 回跳 | ✅ HTTP 实测 |
| `/api` 私有 / `/api/public` 公开、`publicFetch` 无 token、强制 user_id、跨用户 403 | ✅ HTTP 实测 403（含配置接口） |
| content_json 常量与所有写入路径先过 normalizeContent() | ✅ 单测覆盖 |
| 3 套模板逐值照抄、渲染器只遍历 sections、缩略图无图片资源 | ✅ HTTP 实测 3 套 / 7 sections |
| JsonStore 原子写+串行队列+tmp 清理、Repository 唯一出入口、唯一键 409 | ✅ 20 并发单测 |
| **M-02 接口路径**：仅 `/api/settings/llm`(GET/PUT/DELETE) 与 `/api/settings/llm/test`(POST)，旧路径全部下线无兼容层 | ✅ HTTP 实测旧路径 404 |
| **M-02 响应形状**：`{configured, config, effectiveSource}`，config 仅 6 安全字段；无密文/完整密钥/环境变量密钥 | ✅ HTTP 实测 + 单测 |
| **M-03 前端路由**：`/settings/llm`（App.tsx 与 shell.tsx 两处入口） | ✅ 全仓代码检索无旧设置路由 |
| **M-04 类图关系与索引**：`unique(user_id)` + `idx(user_id,is_enabled)` 复合索引、User 1:N | ✅ 单测 `findOneByComposite` 命中 |
| **M-05/#43 crypto.js**：AES-GCM/掩码/密钥派生全部拆出，security.js 仅认证原语 | ✅ 静态检索 security.js 无密码学原语 |
| **S1~S10 逐条**（优先级/缺失即降级/失败不换源/双字段留痕/掩码/鉴权隔离/password/公开零泄露/明文不落盘/占位符） | ✅ 单测 + HTTP 实测 + 全仓检索 |
| 分享快照脱敏、readPublicSnapshot 5.3 逻辑、public.js 独立、新 token、republish | ✅ 单测 + HTTP 实测 |
| **S8 二维码与公开响应零配置字段（含错误体）** | ✅ 单测 + HTTP 实测 `leak=false` |
| 上传白名单/限额/随机名/动态 import 降级/图片 skipped/不静态暴露 | ✅ 代码审查 |
| 账号 bcryptjs/JWT/锁定/黑名单/注销级联 | ✅ 单测 |
| 8 页路由 + P8/P4/P7 硬性要求 | ✅ 构建通过 |
| shell 四类状态/ConfirmDialog/Toast/导航/来源条、Renderer 纯展示、单向依赖 | ✅ |
| 响应式/44px/移动 Tab/300ms/二次确认/二维码参数与 alt + 下载 | ✅ 构建通过 |
| core.test.js 5 组 describe 真实可跑 | ✅ **27/27 通过** |
| 43 个代码文件齐全、6 个预留文件未创建 | ✅ 逐项清点 |

审查轮次：v1.0 首轮发现并修复 2 处（`shell.tsx` 移除 api 层 import、测试密钥字面量动态拼接）；v1.1 覆盖性修订后重跑全量检查与自测，**未发现遗留问题**。

**IS_PASS: YES**

---

## 4. 自测命令与实际输出（v1.1 修订后重新真实执行）

环境：Node `v22.22.2` / npm `10.9.7` / Windows（Git Bash）。

### 4.1 `npm install`

```
added 346 packages in 1m     # 首次安装
up to date in 17s            # v1.1 收口复核复跑
Exit Code: 0
```

**实际结果：成功**。无 node-gyp 编译、无原生模块失败；optionalDependencies 未阻塞安装。

### 4.2 `npm test`

```
# tests 27
# suites 5
# pass 27
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1972.0624
Exit Code: 0
```

**实际结果：全绿**。5 组 describe：① Store 原子写与 20 次并发无丢失、② Auth 注册/登录/5 次锁定/登出黑名单、③ 规则化降级产出合法 ContentJson、④ CR-001 优先级 user>env>none / 删除回落 / 失败不换源 / 加密掩码 / **v1.1 GET 语义与复合索引 / 跨用户 403 与未配置 404**、⑤ 分享快照脱敏与撤销失效 / **S8 公开与二维码零配置字段**。

### 4.3 `npm run build`

```
vite v5.4.21 building for production...
✓ 11531 modules transformed.
dist/index.html                   0.56 kB │ gzip:   0.45 kB
dist/assets/index-Bis-y0mK.css    5.63 kB │ gzip:   1.57 kB
dist/assets/index-Do8yF_yw.js   565.03 kB │ gzip: 179.40 kB
✓ built in 11.55s
Exit Code: 0
```

**实际结果：成功**，产出 `dist/`。

### 4.4 真实 HTTP 端到端冒烟（v1.1 新路径，非臆测）

以 `DATA_DIR=./data-smoke2 PORT=3001 node server/index.js` 启动后用 curl 实测：

| # | 步骤 | 实际输出 |
| --- | --- | --- |
| 1 | `GET /api/settings/llm` 未配置 | `HTTP 200 {"code":0,"data":{"configured":false,"config":null,"effectiveSource":"none"}}` |
| 2 | 旧版配置接口与独立状态接口已下线 | 两条旧路径均返回 `HTTP 404 接口不存在`（无兼容层） |
| 3 | 未登录访问设置接口 | `HTTP 401 {"code":401,"message":"请先登录"}` |
| 4 | `PUT /api/settings/llm` | `code=0 keys=config,configured,effectiveSource configured=true effectiveSource=user configKeys=api_key_mask,base_url,config_name,is_enabled,last_tested_at,model` |
| 5 | `GET /api/settings/llm` 已配置 | `hasPlain=false hasEncrypted=false mask=pl****************3f9a` |
| 6 | `POST /api/settings/llm/test`（不可达） | `{"ok":false,"latencyMs":18,"message":"接口地址不可达或网络异常，请检查配置"}` |
| 7 | 跨用户 `GET /api/settings/llm?id=<他人配置id>` | `HTTP 403 {"code":403,"message":"无权限访问该配置"}` |
| 8 | `DELETE /api/settings/llm` | `{"configured":false,"effectiveSource":"none"}`，随后 GET 回落 `configured:false` |
| 9 | 未配置再次 `DELETE` | `HTTP 404 {"code":404,"message":"尚未配置模型"}` |
| 10 | `data-smoke2/db.json` 明文检索 | `OK 无明文` |
| 11 | S8 公开快照 / 二维码 | 公开 `keys=content,publishedAt,template,title leak=false`；二维码 `keys=dataUrl,url leak=false` |
| 12 | 启动日志 | 端口 / 模板数 / 配置来源状态 / `LLM_BASE_URL`、`LLM_MODEL` 默认值提示 / 告警；**无密钥或掩码** |

冒烟数据目录 `data-smoke2/` 已在测试后删除；后台服务已停止。

### 4.5 静态检查

- 形似真实密钥的字面量检索 `sk-[A-Za-z0-9]{8,}`：**无命中**（全仓含文档）。
- 禁用原生模块检索：**无命中**（仅注释中「绝不引入 canvas」）。
- `public.js` 依赖：仅 `express`、`contracts.js`、`repository.js`。
- `publicFetch`：不读取 `localStorage`、删除 `Authorization`、`credentials:'omit'`。
- `security.js`：无 `aes-256-gcm` / `createCipheriv` / `createDecipheriv` / `scryptSync` / `mask` / `encrypt` / `decrypt`（已全部拆至 `crypto.js`）。
- 全仓旧路径检索：仅架构 v1.1 §0.4 修订记录出现旧值（文档描述），**代码与 README 无旧路径调用**。
- 6 个预留文件：**均未创建**。
- 代码文件数：**43**（v1.1 第 2 节清单），另 `README.md` 与本文件共 45 个交付文件。
- `private.js` 路由数：**29**（v1.1 5.1 节：auth 5 + settings/llm 4 + materials 7 + templates 1 + resumes 7 + share 5）。

### 4.6 收口前复核（主理人最终口径指令，四条命令重新真实执行）

| 命令 | 实际结果 |
| --- | --- |
| `npm install` | `up to date in 17s`，Exit 0 |
| `npm test` | `# tests 27 / # suites 5 / # pass 27 / # fail 0 / # duration_ms 1972.0624`，Exit 0 |
| `npm run build` | `✓ 11531 modules transformed`，`dist/assets/index-Do8yF_yw.js 565.03 kB (gzip 179.40 kB)`，`✓ built in 11.55s`，Exit 0 |
| 最小 HTTP 冒烟（4 个 `/api/settings/llm*` 接口） | GET 未配置 `200 {configured:false,config:null,effectiveSource:"none"}`；PUT `200 {configured:true,config:{...api_key_mask:"pl****************3f9a"...},effectiveSource:"user"}`；GET 已配置 `200 ...effectiveSource:"user"`；POST test `200 {"ok":false,"latencyMs":16,...}`；DELETE `200 {configured:false,effectiveSource:"none"}`；未配置再 DELETE `404`；`db.json` 明文检索 `OK 无明文` |

收口复核只做了一处文档最小清理（把冒烟表中的旧路径字面量改为「旧版配置接口与独立状态接口」），**未改动任何业务逻辑**。旧路径关键字 Grep：代码 + `README.md` + `docs/03-IMPLEMENTATION.md` **命中 0**；全仓仅 `docs/02-ARCHITECTURE.md` §0.4 修订记录 2 处（上游权威设计文档自身的旧值列，不修改）。

---

## 5. 与设计的必要偏差（均已验证不影响契约）

1. **异步数据层**：因 `JsonStore.commit()` 是 Promise 串行写队列，`Repository` 方法、`resolveModelConfig()`、`readPublicSnapshot()` 均为 `async`（设计 5.3/6.7 示例代码为同步写法）。判定逻辑、返回字段、错误码与失效语义完全照抄，仅改为 `await`。
2. **新建空简历的留痕值**：`generation_mode='manual'` 表示「尚未生成」，与 `meta.generatedMode` 枚举一致；生成后严格为 `ai`/`rule`。
3. **快照额外脱敏**：`buildSnapshot()` 除剔除 `basic.email/phone` 外，还删除 `content.meta`、过滤 `mailto:`/`tel:` 链接，确保公开响应白名单「绝不返回任何生成来源信息」（S8）。
4. **测试连接的返回形态**：连接失败/超时归一化为 `HTTP 200 + {ok:false, latencyMs, message}`（而非抛 500），便于 P8 直接展示可读原因；参数校验仍为 422。测试本身不写库；`last_tested_at` 仅在用户「保存配置」时随表单提交落库。
5. **配置归属显式校验**：四个 `/api/settings/llm*` 支持可选 `?id=` / `body.config_id`，用于触发 `assertConfigOwner()` 的跨用户 403 校验（S6）；不传时按当前用户配置操作，行为与设计一致。
6. **PUT 允许省略 `api_key`**：编辑已保存配置时沿用已存密文，配合 P8 掩码回显（S7）避免用户必须重录密钥；首次保存强制必填，校验仍为 422。
7. **无 `tsconfig*.json`**：v1.1 第 2 节清单未列出，Vite/esbuild 原生处理 TS/TSX；`vite.config.ts` 显式设置 `esbuild.jsx='automatic'`，构建实测通过。
8. **P3 复用同构模块**：`TemplatesPage.tsx` 直接 import `server/domain/contentSchema.js` 的 `SAMPLE_CONTENT`（该模块刻意不引入任何 node: 内置模块），避免重复定义示例数据，构建实测通过。
9. **P2 编辑面板**用 Dialog 实现「抽屉式侧滑面板」的等价交互（功能一致）。
10. **JSON 复合索引为内存实现**：v1.1 §3.2 的 `idx(...)` 在 JSON Store 中落地为 Repository 启动时构建的「组合值 → id 集合」Map（配合 `COMPOSITE_INDEXES` 声明），语义与未来 SQLite 的 `CREATE INDEX` 对齐；类图 `User 1:N ModelConfig` 与 `unique(user_id)` 均已落实。

---

## 6. 已知限制

- **单进程一致性**：JSON 单文件方案仅保证单进程写一致；多实例/多进程需按架构第 7 节迁移到 SQLite/云端 DB（`Repository` 接口不变）。
- **PDF/DOCX 抽取为可选能力**：`pdfjs-dist`/`mammoth` 安装失败或运行异常时统一降级为「解析失败，可手动补录」；`.doc`（旧二进制格式）暂不支持自动抽取。图片 OCR 未实现（P1）。
- **导出 PDF**：本期用浏览器打印/另存为 PDF 兜底，未做服务端无头渲染（P1）。
- **分享增强**：有效期选择、访问趋势、二维码美化未实现（P1）；本期默认永久有效直到手动关闭。
- **模板**：内置 3 套，未提供主色/字号自定义与可视化编辑器（P1）。
- **安全默认值**：`JWT_SECRET` 默认 `dev-only-change-me`，`MODEL_CONFIG_SECRET` 留空时由 JWT_SECRET 派生，仅适合本地 demo；生产必须显式配置随机密钥并启用 HTTPS。
- **局域网扫码**：`PUBLIC_BASE_URL` 默认 `http://localhost:5173`，真机扫码需改为本机局域网 IP（见 README 第四节）。
- **前端包体积**：MUI + React 单 chunk 约 565KB（gzip 179KB），本期未做代码分割（不影响功能，P1 可优化）。
- **端侧**：本期为 PC 网页 + 移动 H5 响应式完整闭环；Taro 小程序编译、PWA/APP 壳、原生安装包与商店/小程序审核发布均在后续阶段（见 README 第五节）。
