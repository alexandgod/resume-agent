# 04 · QA 独立验收报告（resume_agent）

> 执行人：Edward（QA 工程师 / 第二层质量关卡）｜执行日期：2026-11-07
> 权威口径：`docs/02-ARCHITECTURE.md` **v1.1**（1346 行）第 2 节 43 文件清单、5.1/5.2 API、5.4 四态、6.1 错误码、6.7.1 S1~S10、第 12 节验收对照；`docs/01-PRD.md` + `docs/01-PRD-ADDENDUM.md`（CR-001，AC-01~AC-08）。
> 参考但不采信：`docs/03-IMPLEMENTATION.md`、`README.md`、工程师自带的 `server/tests/core.test.js` 自测结论。
> 声明：**本次验收未修改任何源码**；仅新增测试代码 `server/tests/qa.regression.test.js` 与本报告。项目目录非 git 仓库（`git status` 返回 `fatal: not a git repository`），故以文件清单清点 + 源码逐行读取核验代替 diff 核对。

---

## 1. 验证范围与方法

| 项 | 说明 |
| --- | --- |
| 独立性原则 | **不重跑、不 import 工程师的 `core.test.js` 断言**；新建 `server/tests/qa.regression.test.js`（Node 内置 `node:test` + `node:assert/strict`），30 个用例全部自行设计 |
| 真实性原则 | 用 `child_process.spawn` 启动**两个真实 Express 服务子进程**（零密钥服务 / env 密钥服务），通过真实 `fetch` 打 HTTP；用**本地 `node:http` mock server** 模拟 OpenAI 兼容 `/chat/completions`（合法 JSON / 非法 JSON / 401 / 挂起超时四种行为） |
| 隔离性 | 每个服务使用独立 `mkdtemp` 数据目录；每个用例尽量注册独立用户；`RATE_LIMIT_MAX=100000` 排除限流干扰；`LLM_*` / `JWT_SECRET` / `MODEL_CONFIG_SECRET` 显式注入，防止外部环境与 `.env` 污染（项目内无 `.env` 文件） |
| 判据来源 | 字段口径、优先级、降级语义、公开白名单、错误码一律以架构 v1.1 与 PRD AC 为准；信息不足处按设计 **v1.1 第 8 节建议默认值**处理：Q3（允许本机 `http://localhost|127.0.0.1`）、Q4（测试连接走 `{base_url}/chat/completions`）、Q5（失败降级保留原 `configSource`）、Q8（快照剔除 `basic.email/phone`）、Q9（本期只验 dev 态）、Q10（仅单进程写一致） |
| 轮次约束 | 严格 **最多 2 轮**：Round 1 全量执行 → 路由判定 → 修复 → Round 2 回归 → 结束，不进入第 3 轮 |

**覆盖的验证项**：A 静态一致性（6 组）、B 真实运行（4 条命令 + 1 次真实启动日志捕获）、C 功能与边界（AC-01~AC-08、分享闭环、鉴权越权、资料模板、错误码契约，共 24 个功能用例）。

---

## 2. B 组：真实运行命令与**实际输出**（如实记录）

| # | 命令 | 退出码 | 实际输出摘要 |
| --- | --- | --- | --- |
| B1 | `npm install` | **0** | `up to date in 17s` / `66 packages are looking for funding` / `run \`npm fund\` for details`。node_modules 顶层 265 个包，`node -v` = `v22.22.2` |
| B2 | `npm test` | **0** | `> node --test server/tests/core.test.js`；TAP：`# tests 27` `# suites 5` `# pass 27` `# fail 0` `# duration_ms 1959.9768`。5 组 describe（Store 并发 / Auth 锁定 / 规则化降级 / CR-001 优先级与加密 / 分享快照）全绿。**仅作基线，不作为本次验收依据**（纯服务层、无 HTTP、AI 成功路径未覆盖） |
| B3 | `npm run build` | **0** | `vite v5.4.21 building for production...` / `✓ 11531 modules transformed.` / `dist/index.html 0.56 kB │ gzip: 0.45 kB` / `dist/assets/index-Bis-y0mK.css 5.63 kB │ gzip: 1.57 kB` / `dist/assets/index-Do8yF_yw.js 565.03 kB │ gzip: 179.40 kB` / `✓ built in 11.72s` |
| B4 | `node --test server/tests/qa.regression.test.js`（**Round 1**） | **1** | `# tests 30` `# suites 10` `# pass 29` `# fail 1` `# duration_ms 5898.1769`。唯一失败 `A4`，详见第 5 节 |
| B5 | `node --test server/tests/qa.regression.test.js`（**Round 2 回归**） | **0** | `# tests 30` `# suites 10` `# pass 30` `# fail 0` `# cancelled 0` `# skipped 0` `# todo 0` `# duration_ms 5749.0648`；`ok 1 - QA 独立回归验收（resume_agent / 架构 v1.1 + CR-001）` |
| B6（补充） | 带假密钥 `LLM_API_KEY=sk-NEVER-LOG-THIS-9876543210` 真实启动服务 3s 并捕获启动日志 | 124（`timeout` 正常终止） | 日志共 4 行：`[简历 Agent] 服务已启动：http://localhost:39999` / `[简历 Agent] 内置模板：3 套` / `[简历 Agent] 配置来源状态：用户级启用 0 套 / 部署级 已配置 / 无密钥时规则化生成` / `[简历 Agent] 数据目录：<临时目录>`。**全文无该密钥、无掩码、无任何 `sk-` 命中**（S9/S10 实证） |

> 静态源码复核亦确认：全仓 `console.log/error` 仅 8 处（`server/index.js` 6 处固定文案 + 端口/模板数/来源计数/数据目录，`server/middleware.js` 1 处只打印 `err.name`），无任何密钥变量进入日志。

---

## 3. A 组：静态一致性结果表

| 编号 | 验证项 | 结果 | 证据 / 说明 |
| --- | --- | --- | --- |
| A1 | 43 个本期文件全部存在 | ✅ 通过 | 逐一 `fs.existsSync` 清点：`declared=43 present=43 missing=0` |
| A1 | 6 个预留文件确实未创建 | ✅ 通过 | `sqliteRepository.js` / `ocrService.js` / `exportService.js` / `generateStream.js` / `miniapp/` / `public/manifest.webmanifest` / `public/sw.js` 全部 `ABSENT` |
| A2 | 旧口径残留命中数 0（`model-config`、`/settings/model`、`generationMode:'fallback'`、`'fallback'`、`ai-256`） | ✅ 通过（含文档例外） | 全仓文本逐行扫描，**源码命中 0**；`ai-256` 全仓 0 命中。**唯一例外 3 行**，均在 `docs/02-ARCHITECTURE.md` §0.4「v1.1 修订记录」表格内，性质是「登记被作废的旧值」而非使用旧值：第 67 行 M-01（`generationMode: "ai" \| "fallback"` 说明「该说法作废」）、第 68 行 M-02（旧路径 `/api/model-config` 说明「统一为 `/api/settings/llm`」）、第 69 行 M-03（旧路由 `/settings/model` 说明「改为 `/settings/llm`」）。按架构 v1.1 修订记录属文档例外，已在测试中显式跳过并断言恰好 3 条 |
| A2' | `bcrypt`/`argon2`/`better-sqlite3` 等字样 | ✅ 通过 | 命中仅出现在 `docs/01-PRD.md`、`docs/02-ARCHITECTURE.md` 的「明确不引入 / 排除」说明中，非依赖声明 |
| A3 | `server/utils/crypto.js` 存在且导出 AES-256-GCM 加解密与 `mask` | ✅ 通过 | 实测导出 `encrypt/decrypt/mask/getEncryptionKey/scrubSecret`；源码含 `aes-256-gcm`、`createCipheriv`、`createDecipheriv`、`randomBytes(12)`；**真实加解密往返**、随机 IV 两次密文不同、密文三段式、密文不含明文、掩码仅末 4 位均通过 |
| A3 | `server/utils/security.js` 已无加解密原语 | ✅ 通过 | 仅保留 `hashPassword/verifyPassword/signToken/verifyToken/generateId/generateShareToken/buildPublicUrl`；无 `createCipheriv`/`createDecipheriv`/`aes-256-gcm`/`scryptSync`/`encrypt|decrypt|mask` 导出 |
| A4 | `server/routes/public.js` 不 import 私有 service、不挂 `requireAuth` | ✅ 通过 | 只 import `express`、`domain/contracts.js`、`store/repository.js`；`createPublicRouter()` 直挂，无鉴权中间件 |
| A4 | `publicFetch` 不携带 Authorization | ✅ 通过 | `src/api/client.ts` 中 `publicFetch` 显式 `headers.delete('Authorization')` + `credentials: 'omit'`，不读 `ra_token`、不做登录回跳 |
| A4 | `PublicResumePage` 不引入 Layout/authStore/apiFetch | ✅ 通过 | **剥离注释后**的真实代码仅 import `publicFetch`、`ApiClientError`、`ResumeRenderer`、类型；组件内无 `useAuth`/`AppLayout`/`apiFetch` 调用 |
| A4 | 前端私有页路由守卫 | ✅ 通过 | `src/App.tsx` 中 `/materials`、`/templates`、`/resumes`、`/resumes/:id/edit`、`/resumes/:id/share`、`/settings/llm` 六条均由 `PrivateRoute` 包裹；`/s/:token` 为公开路由不套 Layout；`PasswordField` 默认 `type="password"`（S7） |
| A5 | `package.json` 无 node-gyp 原生依赖 | ✅ 通过 | `dependencies / devDependencies / optionalDependencies` 均无 `better-sqlite3`、`sqlite3`、`bcrypt`、`argon2`、`canvas`；密码用 `bcryptjs`，PDF/DOCX 用纯 JS 可选依赖 |
| A5 | `.env.example` 与全仓无真实密钥字面量（AC-07） | ✅ 通过 | `.env.example`：`LLM_API_KEY=` 留空，`JWT_SECRET=<set-a-random-secret>`、`MODEL_CONFIG_SECRET=<set-a-random-secret>`、`LLM_MODEL=<your-model-name>` 均为占位符；全仓高熵密钥格式正则（`sk-[A-Za-z0-9]{20,}` / `sk-proj-` / `AKIA...` / `ghp_...`）**0 命中**。QA 测试文件中的 `sk-user-test-1234` 等为本地 mock 假凭证，非真实密钥，且不满足上述高熵格式 |
| A6 | 3 套模板 `schema.sections` 可渲染 | ✅ 通过（结构/接口级） | 3 套模板各 7 个分区、key 完整覆盖 `SECTION_KEYS`、均 `enabled` 且含 `order/title/layout`、theme/style 完整；`GET /api/templates` 返回 3 条含完整 `schema_json`。**未做浏览器 DOM 渲染**，见第 7 节 |
| A-补 | AC-08 厂商无关 | ✅ 通过 | `server/services/` 中除注释与架构规定的默认 `DEFAULT_BASE_URL='https://api.openai.com/v1'` 外，无 `openai`/`anthropic`/`qwen` 等 SDK import 或厂商专有分支；用户配置改指 `http://127.0.0.1:<mock>` + 任意 model 后 AI 生成成功（C3-1 实证），无需改代码 |

---

## 4. C 组：功能与边界结果表

> 全部通过**真实 HTTP 子进程**验证（非服务层直调）。用例编号对应 `qa.regression.test.js`。

| 编号 | 验证项 | 结果 | 关键断言（实际通过） |
| --- | --- | --- | --- |
| C1-1 | **AC-01 零密钥闭环**：清空 `LLM_API_KEY` + 无用户配置，注册→新建简历→上传文本资料→生成 | ✅ 通过 | `generationMode='rule'`、`configSource='none'`、无 `degradedReason`；`content_json` 7 分区齐全、`meta.schemaVersion=1`、经 `normalizeContent` 补齐、`summary.content` 可读、至少 1 个实质分区有内容；`resume.generation_mode/config_source` 同步留痕 `rule/none` |
| C1-2 | 零密钥下 GET 配置 | ✅ 通过 | `configured:false`、`effectiveSource:'none'`、`config:null` |
| C2-1 | **AC-02 AI 成功路径（工程师自测未覆盖，重点）**：mock `/chat/completions` 返回合法 JSON，`LLM_BASE_URL` 指向 mock、`LLM_API_KEY` 假值 | ✅ 通过 | `generationMode='ai'`、`configSource='env'`；模型返回内容被 `normalizeContent` 正确结构化（`basic.name='FROM_ENV'`、`work[0].company`、`summary.content` 均按 mock 内容落库），`meta.generatedMode='ai'`、`resume.generation_mode='ai'`、`resume.config_source='env'`；mock 确实收到 `Bearer sk-env-test-5678` 且路径为 `/chat/completions`；响应体零密钥 |
| C2-2 | 非法 JSON / 401 / 超时 三种失败 → 本次降级且不换源、带 `degradedReason` | ✅ 通过 | 三种场景均 `HTTP 200` + `generationMode='rule'` + `configSource='env'`（保留原来源）+ 可读中文 `degradedReason`；降级后仍产出可读规则化简历；**所有 mock 调用仅使用 env 密钥，未出现任何其他来源的密钥**（不换源实证）；响应零密钥 |
| C3-1 | **AC-03 优先级** user > env > none；删除用户配置回落 env | ✅ 通过 | ① 仅 env → `env`；② 保存用户配置（不同密钥）→ `configSource='user'` 且 `basic.name='FROM_USER'`，mock 全为 user 密钥、无 env 密钥；③ DELETE 配置 → 回落 `env` 且 `basic.name='FROM_ENV'`；④ 两者皆空（零密钥服务）→ `rule/none` |
| C3-2 | 用户来源调用失败降级 `rule/user`，**绝不切换到 env** | ✅ 通过 | `rule/user` + `degradedReason`；mock 调用全为 user 密钥，`Bearer sk-env-test-5678` **一次都未被调用** |
| C3-3 | 用户配置停用后回落 env | ✅ 通过 | `is_enabled=false` 时 `configSource='env'`、`basic.name='FROM_ENV'` |
| C4-1 | **AC-05** PUT 后 db.json 无明文；GET 只返回 6 安全字段 + `configured` + `effectiveSource`；mask 仅末 4 位 | ✅ 通过 | 读取实际 `db.json`：`api_key_encrypted`/`api_key_mask` 存在，**明文 user key 与 env key 均不出现**；GET 顶层键恰为 `[config, configured, effectiveSource]`，`config` 键恰为 6 个（`api_key_mask/base_url/config_name/is_enabled/last_tested_at/model`），不含 `api_key_encrypted`/`user_id`/完整密钥；掩码以末 4 位 `1234` 结尾、含星号、不含完整密钥 |
| C4-2 | **AC-04** 测试连接 10s 内返回 `{ok,latencyMs,message}`、失败原因可读不回显密钥、不落库不产生简历 | ✅ 通过 | 成功与 HTTP 401 失败两种均返回三字段对象、`latencyMs<10000`、失败 message 可读且不含明文密钥；测试前后 `configured` 恒为 `false`、`/api/resumes` 条数不变 |
| C4-3 | **AC-06** 跨用户读取/使用配置 403；未登录私有接口 401 | ✅ 通过 | B 用户带 A 的配置 id 调 `GET /api/settings/llm?id=` 与 `POST /api/settings/llm/test`（`config_id`）均 `403/403`；B 不带 id 时 `configured:false`（看不到 A 的配置）；未登录 `GET /api/settings/llm`、`GET /api/resumes` 均 `401/401` |
| C4-4 | `base_url` 校验 | ✅ 通过 | 公网 `http://evil.example.com/v1` → `422/422` + `errKey:INVALID_BASE_URL`；空 `config_name` → `422/422`；本机 `http://127.0.0.1` 接受（Q3） |
| C5-1 | **分享闭环**：≥128bit token、快照脱敏、公开只读四字段、关闭失效、重开新 token、republish 沿用 | ✅ 通过 | token 匹配 `^[A-Za-z0-9_-]{22,}$` 且 `Buffer.from(base64url).length>=16`；公开 `data` 键恰为 `[title, content, template, publishedAt]`；快照 `basic.email`/`basic.phone`/`meta` 被剔除、`mailto:`/`tel:` 链接被过滤，全响应不含 `private@example.com`、`13900001111`、`user_id`、`file_url`、`raw_text`、`parsed_text`、任何 `api_key*`/`base_url`/`config_name`/`effectiveSource`/`generation_mode`；关闭后旧链接 `404/404` + 「链接已失效」且不泄露内容；重开 `token2!==token1` 且旧 token 仍 404；`republish` 沿用 `token2` 且快照标题已更新；非法 token `422`、未知 token `404` |
| C5-2 | **AC-06/S8**：已配置密钥时，`/api/public/*` 全部响应（含错误体）与二维码接口零配置字段 | ✅ 通过 | 对公开成功、公开 404、公开 422、二维码 4 个响应体做零泄露断言，`api_key`/`base_url`/`config_name`/`effectiveSource`/`api_key_mask`/`last_tested_at`/`is_enabled`/`"model":`/`sk-` 全部 0 命中 |
| C5-1 | 二维码只返回 `dataUrl`+`url` | ✅ 通过 | 键恰为 `[dataUrl, url]`，`dataUrl` 为 `data:image/png` 前缀，零配置字段 |
| C6-1 | 越权：A 用户 token 访问 B 用户资料/简历/分享一律 403 | ✅ 通过 | 4 个 GET（资料详情、简历详情、分享状态、二维码）+ PUT 简历 + DELETE 资料 + POST 生成，共 7 个接口全部 `403/403`（非 404） |
| C6-2 | 登出后旧 token 401（jti 黑名单） | ✅ 通过 | logout 返回 `revoked:true`；随后 `GET /api/auth/me`、`GET /api/resumes` 均 `401/401` |
| C6-3 | 连续 5 次密码错误锁 5 分钟 `429` + `lockedUntil` | ✅ 通过 | 前 4 次 `401/401`；第 5 次 `429/429` + `errKey:ACCOUNT_LOCKED` + 未来时间 `lockedUntil`（≤5min+5s）；锁定期内用**正确密码**仍 `429/429` |
| C6-4 | 注册冲突/弱密码/不存在资源错误码 | ✅ 通过 | 重复邮箱 `409/409`、弱密码 `422/422`（`WEAK_PASSWORD`）、不存在简历 `404/404` |
| C7-1 | 删除资料不破坏已生成简历；模板切换只改 `template_id` 不触碰 `content_json` | ✅ 通过 | 删除资料后 `content` JSON 深度不变；切换模板后 `template_id` 变更、`content` JSON 不变、`template.code` 为新模板 |
| C7-2 | 3 套模板经 HTTP 返回完整 `schema_json` | ✅ 通过 | 3 条、各 7 sections 且全 enabled、`status=active`、`preview_url=''` |
| C7-3 | 上传白名单 / 10MB / 50 份上限 | ✅ 通过 | `.exe` → `422`；`10MB+1KB` 真实上传 → `422`；**真实循环添加 50 份成功后第 51 份** → `429/429` + `errKey:MATERIAL_LIMIT`（未降低配置阈值，按架构默认 50 实测） |
| C7-4 | 路径穿越防护 | ✅ 通过 | 以 `../../../../evil_qa.txt` 上传：接口 200、`parse_status=success`；落盘 basename 为 `UUID.txt` 且不含原始文件名片段；项目根与数据根均无 `evil_qa.txt`；`uploads/<userId>/` 下所有文件名匹配 UUID；该资料文本成功参与生成 |
| C7-5 | PDF 解析失败 `parse_status=failed` 不阻塞闭环 | ✅ 通过 | 上传非合法 PDF 内容：接口仍 `200/code=0`，`parse_status='failed'` 且 `failed[]` 给出原因；随后新建简历生成仍 `200` + 可读规则化结果 |
| C7-6 | `normalizeContent(null)` / `({})` / 残缺/异常输入不抛错 | ✅ 通过 | 7 类输入（含 `[]`、`'garbage'`、`42`、字段类型错乱）均不抛错且补齐 7 分区、`meta` 值域合法；`createEmptyContent()` 返回独立副本 |
| C8-1 | **错误码契约**：统一 `{code,message,data}` 且 HTTP 状态与 code 一致 | ✅ 通过 | 抽查 6 个接口（`200/0`、`401/401`、`422/422`、`404/404`×3）：响应三字段齐全、数字 `code`、状态与 `code` 完全一致（成功为 `200/0`）；错误体无密钥；`Content-Type: application/json; charset=utf-8` |

**AC 覆盖矩阵**：AC-01 ✅｜AC-02 ✅（重点，独立实证）｜AC-03 ✅｜AC-04 ✅｜AC-05 ✅｜AC-06 ✅｜AC-07 ✅｜AC-08 ✅。

---

## 5. 失败项明细与智能路由判定（严格 2 轮）

### Round 1 — 判定：**QA（测试代码自身 Bug，自行修复）**

- 结果：`30 tests / 29 pass / 1 fail`，退出码 1。
- 唯一失败：`A4 公开路由/请求层/公开页/路由守卫的隔离硬约定`
  - 位置：`server/tests/qa.regression.test.js:400`（原断言 `assert.doesNotMatch(imports, /AppLayout|useAuth|authStore|apiFetch/)`）
  - 实际：`src/pages/PublicResumePage.tsx` **文件头注释**写着「P7 扫码公开只读页：不套 Layout、不读 authStore、不调 apiFetch，只用 publicFetch」，被切片的 `imports` 区间连同注释一起纳入匹配，产生假阳性。
  - 性质判定：**断言本身写错（把注释文本当成代码依赖），源码完全正确**。`PublicResumePage.tsx` 的真实 import 仅 `publicFetch / ApiClientError / ResumeRenderer / PublicSnapshot`，无任何 `Layout`/`authStore`/`apiFetch`。
  - 路由：**Send To QA（self）**。按约定自行修复测试，**不向 Engineer 报 Bug**。
  - 修复：改为剥离 `/* ... */` 与 `// ...` 注释后对**全文件真实代码**做 `\b(AppLayout|useAuth|authStore|apiFetch)\b` 断言，并保留 `publicFetch` 正向断言（修复后断言强度反而高于原版）。

### Round 2 — 判定：**NoOne（全部通过）**

- 命令：`node --test server/tests/qa.regression.test.js`
- 结果：`30 tests / 10 suites / 30 pass / 0 fail / 0 skipped / 0 todo`，退出码 **0**，`duration_ms 5749.0648`。
- 30 个用例逐条 `ok`，含重点项 `C2-1 AC-02 AI 成功路径`、`C2-2 三种降级不换源`、`C3-1 优先级`、`C4-1 密钥安全`、`C5-1 分享闭环`、`C6-1 越权`、`C7-3 上传边界`、`C8-1 错误码契约`。
- 结论：**未发现任何源码 Bug，无需转交 Engineer 修复**；2 轮硬上限到此结束，不进入第 3 轮。

> 全程未修改任何源码；唯一代码改动是测试文件自身的一处断言修复。

---

## 6. 测试通过率

| 套件 | 用例数 | 通过 | 失败 | 通过率 |
| --- | --- | --- | --- | --- |
| **QA 独立回归 `qa.regression.test.js`（Round 2 最终）** | **30** | **30** | **0** | **100%** |
| QA 独立回归（Round 1，含 1 个测试自身 Bug） | 30 | 29 | 1 | 96.7% |
| 工程师基线 `core.test.js`（仅参考，不作验收依据） | 27 | 27 | 0 | 100% |
| 合计（最终态） | 57 | 57 | 0 | 100% |

- 估算覆盖：43 个本期文件中，服务端 20 个 JS 模块全部被直接或经 HTTP 间接执行；私有 API 29 条中覆盖 auth(5)/settings-llm(4)/materials(6)/templates(1)/resumes(7)/share(5)/generate(1)，公开 API 1 条覆盖成功+失效+非法 token；前端 11 个文件以静态契约核查覆盖。核心业务路径覆盖率估计 **≥85%**（未做浏览器 E2E，见第 7 节）。

---

## 7. 未覆盖项、已知问题与风险（如实标注）

**未发现阻断性源码缺陷。** 以下为本次验收未覆盖或按设计边界不做的能力，不构成 Bug：

| # | 项 | 性质 | 说明 / 建议 |
| --- | --- | --- | --- |
| R1 | 3 套模板「可渲染」 | 部分覆盖 | 已验证 `schema_json.sections` 结构完整 + HTTP 返回 + `ResumeRenderer` 被公开页/编辑页引用；**未启动浏览器做 DOM/视觉渲染**。建议交付前人工打开 P3 模板页与 P7 公开页目测一次 |
| R2 | 前端 UI 交互 E2E | 未覆盖 | 拖拽上传、300ms 防抖编辑预览、分享页二维码 PNG 下载、`window.print()` 导出、移动端 H5 响应式、扫码打开 ≥95%，本环境无浏览器自动化未验 |
| R3 | PDF/DOCX 可选依赖「完全缺失」 | 等价覆盖 | 当前 `node_modules` 已装 `pdfjs-dist`/`mammoth`，用「损坏 PDF 文件触发同一 `catch` 降级分支」验证 `parse_status=failed` 且不阻塞闭环；未卸载依赖后再验。二者在 `parseService.js` 汇入同一降级路径，风险低 |
| R4 | 30s 墙钟超时 | 等价覆盖 | 为控制测试时长，`LLM_TIMEOUT=1200ms` 注入后验证 `AbortSignal.timeout` 降级链路；架构默认 30000ms 未实测墙钟。逻辑等价 |
| R5 | `NODE_ENV=production` 单端口托管 `dist` | 未覆盖 | 架构 Q9 明确「本期只验 `npm run dev`」，生产态为代码预留；`npm run build` 产物已生成且 `dist/` 存在，未做端到端静态托管验证 |
| R6 | 多实例/多进程写一致 | 设计边界 | 架构 Q10 明确「本期仅保证单进程写一致」，不属本期验收范围 |
| R7 | 账号锁定后的自动解锁 | 未覆盖 | 已验证锁定 5 分钟返回 429 + `lockedUntil`；未等待 5 分钟验证到期自动解锁（时间成本高，`authService.login` 中逻辑清晰） |
| R8 | 真机扫码 / 局域网 `PUBLIC_BASE_URL` | 未覆盖 | 二维码 `dataUrl` 与 `url` 生成正确，但未做手机真机扫码；按架构 Q6 部署时需把 `PUBLIC_BASE_URL` 改为本机局域网 IP |
| R9 | 文档例外 | 说明项 | `docs/02-ARCHITECTURE.md` §0.4 修订记录保留 3 处「被作废旧值」的字面描述，属**有意保留的修订痕迹**，非实现残留；若后续要求全仓字面 0 命中，需由架构侧改为转义写法 |

**工程约束复核**：Windows + Node v22.22.2 下 `npm install` 一次成功（零编译）、`npm test` 与 `npm run build` 均可用，满足架构第 12 节「主理人工程约束」。

---

## 8. 结论

- **智能路由最终判定：`NoOne`（全部通过）**。Round 1 唯一失败经判定为 **QA 测试代码自身 Bug**，已自行修复；Round 2 回归 **30/30 全绿**。**未发现任何源码 Bug，无需 Engineer 返工**。
- **测试通过率：独立回归套件 100%（30/30）**；含工程师基线合计 57/57。
- 架构 v1.1 第 2 节 43 文件、6 预留、§0.4 口径修订、5.4 生成四态、6.1 错误码、6.7.1 S1~S10 与 CR-001 **AC-01~AC-08 全部验证通过**；重点补齐了工程师自测未覆盖的 **AI 成功路径** 与 **失败降级不换源** 的真实 HTTP 证据。
- **建议：通过验收，允许放行。** 交付前建议按 R1/R2 做一次人工浏览器冒烟（模板页 + 公开扫码页），并按 R8 在真机演示时配置 `PUBLIC_BASE_URL`。

---

## 附录 A：产出文件

| 路径 | 说明 |
| --- | --- |
| `server/tests/qa.regression.test.js` | QA 独立回归测试，30 个用例 / 10 个 describe；运行命令 `node --test server/tests/qa.regression.test.js` |
| `docs/04-QA-REPORT.md` | 本报告 |

> 注：测试与报告中出现的 `sk-user-test-1234`、`sk-env-test-5678`、`sk-NEVER-LOG-THIS-9876543210` 均为本地 mock 假凭证，仅存在于测试进程内存与 QA 产物中，不属于仓库内置真实密钥；二者已被加入 QA 静态扫描的自指排除集。

## 附录 B：30 个独立用例清单

| 组 | 用例 |
| --- | --- |
| A（6） | A1 43 文件/6 预留 · A2 旧口径残留 · A3 crypto/security 职责拆分 · A4 公开侧与前端隔离 · A5 原生依赖与密钥字面量 · A6 3 套模板结构 |
| C1（2） | AC-01 零密钥闭环 · 零密钥 GET 配置 |
| C2（2） | **AC-02 AI 成功路径 ai/env** · 非法 JSON/401/超时三降级不换源 |
| C3（3） | 四级优先级与删除回落 · 用户源失败不换源 · 停用回落 |
| C4（4） | db.json 无明文 + GET 安全视图 + 掩码 · 测试连接契约与不落库 · 跨用户 403/401 · base_url 校验 |
| C5（2） | 分享全闭环（token/脱敏/四字段/失效/重开/republish） · 公开侧与二维码零配置字段 |
| C6（4） | 跨用户 403 ×7 接口 · 登出黑名单 · 5 次锁定 429 · 409/422/404 错误码 |
| C7（6） | 删资料/切模板不破坏内容 · 模板 HTTP · 白名单/10MB/50 份 · 路径穿越 · PDF 解析降级 · normalizeContent 健壮性 |
| C8（1） | 6 接口统一响应契约 |
