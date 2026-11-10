# 简历 Agent（resume_agent）

[![CI](https://github.com/alexandgod/resume-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/alexandgod/resume-agent/actions/workflows/ci.yml)

把零散的履历资料（文本、TXT/MD、PDF/DOCX，图片仅存档）一键整理成结构化简历，可切换模板、手动编辑、保存多版本，并生成带高熵 token 的二维码，让他人免登录扫码只读查看。

- **全简体中文**：界面文案、注释、文档均为简体中文。
- **零外部服务即可运行**：本地单机 JSON 原子持久化 + 本地文件存储，不需要数据库、不需要云账号、不需要大模型密钥。
- **纯 JS 依赖**：不含任何需要 node-gyp 编译的原生模块，Windows 下 `npm install` 一次成功。
- **隐私基线**：简历默认私有，私有接口强制 `user_id` 隔离；分享采用发布快照，自动隐藏邮箱与手机号；关闭分享后旧链接立即失效。

---

## 一、一键启动

环境要求：**Node.js 18+**（推荐 20/22）、npm。

```bash
cd resume-agent      # 进入克隆或解压后的项目目录
npm install          # 一次安装，无原生编译
npm run dev          # 一条命令同时启动前后端
```

浏览器打开 **http://localhost:5173** 即可使用。

| 端口 | 服务 | 说明 |
| --- | --- | --- |
| `5173` | Vite 前端 / 开发态网关 | 页面入口，`/api` 反向代理到后端 |
| `3001` | Express 后端 | 私有 `/api`、公开 `/api/public` |

其他命令：

```bash
npm test             # Node 内置 node:test，零配置运行核心自测
npm run build        # 产出 dist/（生产态可由 Express 单端口托管）
```

首次启动会自动创建 `data/db.json` 并幂等写入 3 套内置模板（简约 / 专业 / 创意）。数据目录 `data/` 已加入 `.gitignore`。

---

## 二、后续如何自主添加大模型密钥（CR-001）

**本期不内置任何真实密钥**。真实值只由开发者或用户在运行期填入；`.env.example` 中只有占位符。系统统一走 **OpenAI 兼容协议**（`base_url + api_key + model`），不绑定任何厂商，更换兼容服务无需改代码。

### 路径 A：开发者 / 部署者 —— 环境变量

```bash
cp .env.example .env     # Windows: copy .env.example .env
```

编辑 `.env` 中以下几项（**留空 `LLM_API_KEY` 即视为未配置**）：

| 变量 | 示例 / 默认值 | 说明 |
| --- | --- | --- |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容接口地址 |
| `LLM_API_KEY` | 空 / `<your-api-key>` | 部署级密钥，**空即未配置** |
| `LLM_MODEL` | `gpt-4o-mini` | 模型名，可自由填写 |
| `LLM_TIMEOUT` | `30000` | 生成超时毫秒 |
| `MODEL_CONFIG_SECRET` | `<set-a-random-secret>` | 用户级密钥 AES-256-GCM 加密密钥，不入库；留空则由 `JWT_SECRET` 派生 |
| `TEST_CONNECT_TIMEOUT` | `10000` | 测试连接超时 |

改完**重启服务**即可生效。删除 `LLM_API_KEY` 后重启，生成自动回落到规则化。

### 路径 B：终端用户 —— 「设置 → 模型配置」页

登录后点击右上角账号下拉 → **设置 · 模型配置**（前端路由 `/settings/llm`），填写配置名称、`base_url`、`api_key`（`type="password"`，支持显隐切换）、模型名，打开「启用此配置」，可先点「测试连接」验证，再「保存配置」。

- 密钥在服务端用 **AES-256-GCM 加密存储**，页面只回显末 4 位掩码（形如 `sk-****************3f9a`），明文不落库、不落日志、不出现在任何接口响应与错误体。
- 「测试连接」10 秒内返回 `{ok, latencyMs, message}`，**不落库、不生成简历、不回显密钥**。
- 「删除配置」有二次确认，删除后密文不可恢复，自动回落。
- `base_url` 校验：允许 `https://`；本机兼容服务允许 `http://localhost` 与 `http://127.0.0.1`，其余公网 `http://` 拒绝。
- 接口地址允许任意 OpenAI 兼容服务，例如本机 `http://localhost:11434/v1`。

**（架构 v1.1 口径）配置接口统一为 `/api/settings/llm*`，全部要求登录并按 `user_id` 隔离：**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/settings/llm` | 返回 `{configured, config(掩码安全视图)|null, effectiveSource}`；未配置返回 `configured:false`，不以 404 为主路径 |
| `PUT` | `/api/settings/llm` | 保存/更新配置，响应同上（掩码回显，绝不回完整密钥或密文） |
| `DELETE` | `/api/settings/llm` | 清除密文，返回 `{configured:false, effectiveSource}`；未配置时 404 |
| `POST` | `/api/settings/llm/test` | 测试连接，请求体 `{config_name?, base_url, api_key?, model}`，响应 `{ok, latencyMs, message}` |

旧版配置接口与独立状态接口已全部作废，**不保留兼容层**；生效来源由 GET 的 `effectiveSource` 提供。加解密原语独立在 `server/utils/crypto.js`（Node 内置 `crypto`，AES-256-GCM），`server/utils/security.js` 只负责 bcryptjs / JWT / 分享 token。

### 优先级（重要）

```
用户级已启用配置（设置页，来源是「我的配置」）  ← 最高优先
        ↓ 无
部署级环境变量 LLM_API_KEY（来源是「部署配置」）
        ↓ 无
本地规则化生成（rule / none）
```

- 用户配置存在且启用时**覆盖**环境变量；删除用户配置后自动回落到环境变量。
- **选定来源调用失败 / 超时 30s / 返回非法 JSON 时，本次直接降级为规则化生成并明确提示，绝不自动切换到另一密钥来源**（避免账单归属混淆）；界面保留被选来源标识并展示黄色降级条。
- 生成响应与简历记录同时留痕 `generationMode`（`ai`/`rule`）与 `configSource`（`user`/`env`/`none`），杜绝「显示 AI 实为规则化」的错标。

---

## 三、没有密钥也能完整跑通

任何环境（无 `.env`、无用户配置、模型不可达/超时）都不会中断闭环：系统自动使用**纯本地零网络**的规则化生成器（正则抽取邮箱/手机/日期、教育/公司/职位/技能关键词词库、按行分段填充 7 个分区），产出可读简历，界面明确标注「当前为规则化生成」。

完整闭环：**注册 → 上传/粘贴资料 → 选模板 → 一键生成 → 预览编辑保存 → 开启分享 → 二维码 → 扫码只读查看**，全程无需密钥。生成结果 100% 可人工编辑。

> 本期导出 PDF 使用浏览器「打印 / 另存为 PDF」兜底（编辑页有按钮），服务端无头导出列 V1.1。
> PDF/DOCX 抽取依赖 `pdfjs-dist` / `mammoth` 为 **optionalDependencies + 动态 import**：加载或解析失败时资料标记「解析失败，可手动补录」，不阻塞上传与生成闭环。

---

## 四、手机扫码查看：`PUBLIC_BASE_URL` 要改成本机局域网 IP

二维码链接由服务端拼装为 `${PUBLIC_BASE_URL}/s/${token}`，默认 `http://localhost:5173`。**这个地址在手机上是手机自己**，因此同局域网真机扫码测试时必须改成本机局域网 IP：

```bash
# .env
PUBLIC_BASE_URL=http://192.168.1.23:5173
```

要求：手机与电脑在同一 Wi-Fi、改完重启服务、防火墙放行 5173 端口；然后重新开启分享生成新二维码（或点「重新发布快照」）。生产域名 / 内网穿透列 V1.1。

公开页为发布时的**只读快照**：不含邮箱、手机号、账号信息、原文件路径、任何密钥或配置字段，也没有任何编辑或后台入口。关闭分享后旧链接统一返回「链接已失效」。

---

## 五、移动端与后续路线

| 阶段 | 端侧交付 |
| --- | --- |
| **本期（MVP）** | **PC 网页完整闭环 + 移动 H5 响应式完整闭环**（375px~1920px 无横向滚动、移动端按钮 ≥44×44px、编辑页 Tab 切换编辑/预览）+ 扫码公开 H5 只读页。登录、资料追加、模板切换、生成、编辑、分享开关、扫码查看在手机浏览器均可用。 |
| **V1.1（P1）** | Taro 工程编译**微信小程序**（复用 `src/types` 与请求层适配，公开查看页用 `web-view` 承载 H5）；PWA / 跨端 APP 壳；服务端无头 PDF 导出；图片 OCR；分享有效期与访问趋势；模板扩充与样式自定义。 |
| **后续阶段（P2）** | APP 原生安装包打包（Android/iOS）、应用商店上架、微信小程序审核发布、微信一键登录、按 JD 优化/多语言简历/评分、团队版、云端 DB 与对象存储迁移、生产 HTTPS 与合规加固。 |

本期**不编码** APP 安装包、商店上架与小程序审核发布，也不创建 `miniapp/`、`public/sw.js` 等预留目录文件。

---

## 六、目录速览

```
src/          前端：types / api / store / components / 8 个页面
server/       后端：store / domain / utils(security.js 认证原语 + crypto.js 加解密) / services / routes / tests
docs/         PRD、CR-001 增量、架构设计 v1.1、实现说明
data/         运行期生成：db.json、uploads/（已 gitignore）
```

本期实现 **43 个代码文件**（架构 v1.1 第 2 节清单，含新增 `server/utils/crypto.js`）+ 根目录 `README.md` + `docs/03-IMPLEMENTATION.md`；6 个预留文件一律未创建。

- 权威设计：`docs/02-ARCHITECTURE.md`（**v1.1**）
- 实现与自测报告：`docs/03-IMPLEMENTATION.md`
- 环境变量占位示例：`.env.example`

> 安全提醒：`JWT_SECRET` 默认 `dev-only-change-me` 仅用于本地 demo，生产部署必须在 `.env` 中改为随机长字符串；生产环境应启用 HTTPS。系统仅保证**单进程**内的写一致性，多实例部署需按架构文档第 7 节迁移到 SQLite / 云端 DB。
