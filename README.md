# 蓝色大肥鱼 · QQ 群 AI 群友

一个会接梗、有长期记忆、能自己判断要不要说话的 QQ 群机器人。用 **NapCat（OneBot 11）+ DeepSeek（OpenAI 兼容接口）** 实现，人设是 DeepSeek 的鲸鱼娘「蓝色大肥鱼」。

> 非腾讯 / DeepSeek 官方项目。NapCat 属于第三方方案，违反 QQ 用户协议、有封号风险，请只用小号，详见文末「安全与免责声明」。

---

## 功能

- **群聊只回 @**；也可以在控制台把某个群切成「直接回复」（不用 @ 也回）
- **私聊按人开关**：每个人单独决定回不回复
- **人设**：DeepSeek 鲸鱼娘，贱萌、傲娇、爱摸鱼偷吃；可自己改 `prompts/persona.md`
- **长期记忆**：记住主人/男朋友、讨厌的人；私聊主人更黏更甜
- **会话独立设置**：每个群/私聊单独设置回复模式、每分钟/每小时限额、是否承认主人关系
- **梗词典**：遇到看不懂的梗自动记到控制台，你写一句解释，AI 下次就懂
- **固定接梗**：`token来→token回`、`白饭来→白饭回`、`寿来→寿回`
- **省 token**：图片/表情包/语音不读取，长消息截断，上下文有字数上限
- **桌面控制台**：启动/停止/重启、看日志、改会话设置、扫码登录 NapCat
- **本地全链路自测**：`npm run selftest` 用模拟 QQ/模拟大模型跑通，不花钱不连 QQ

## 两种获取方式

### 方式 A：下载「全量包」（推荐，不用另装 NapCat）

到 [Releases](https://github.com/tkxnj/dafeiyu-bot/releases/latest) 下载：

- `dafeiyu-bot-full.zip`：包含项目代码 + 项目依赖 + **NapCat 运行时**

解压后照着下面「快速开始」做即可，不需要再下载/安装 NapCat。

> 全量包约 350MB；NapCat 的登录配置和缓存已移除，第一次运行需要手机 QQ 扫码登录一次。登录数据属于账号凭据，不能公开分发。

### 方式 B：源码仓库

```bash
git clone https://github.com/tkxnj/dafeiyu-bot.git
cd dafeiyu-bot
npm ci
```

源码仓库**不包含** NapCat，需要你自己准备 NapCat（放到 `napcat/` 或使用已有的 OneBot 11 WebSocket 服务）。

## 快速开始

### 1. 准备

- Windows 10/11
- **QQ 桌面版**（官方客户端；NapCat 需要调用已安装的 QQ）
- **Node.js 20+**（<https://nodejs.org/zh-cn>，安装 LTS 即可）
- **一个 QQ 小号**（不要用大号；有封号风险）
- **DeepSeek API Key**：<https://platform.deepseek.com/api_keys>

### 2. 首次配置（推荐，双击向导）

双击根目录的 **`首次配置.bat`**，按提示输入：

- DeepSeek API Key（`sk-` 开头，必填）
- 机器人 QQ 号
- 主人/男朋友的昵称或 QQ（可留空）
- OneBot Token（直接回车会自动生成）

脚本会自动生成/更新 `.env`，不需要手工改文件。

> API Key 是你自己的付费凭据，**不会**放在公开仓库里，需要自己填一次。

也可以手动把 `.env.example` 复制为 `.env` 后填写：

```env
LLM_API_KEY=sk-你的DeepSeekKey
BOT_QQ=你的机器人QQ号
OWNER_NAMES=你的昵称,你的QQ号
ONEBOT_ACCESS_TOKEN=换成一个随机字符串
```

> `ONEBOT_ACCESS_TOKEN` 要和 NapCat 里 WebSocket 服务器的 Token 一致；全量包会由 `scripts/setup-napcat.mjs` 自动按 `.env` 生成 NapCat 配置，一般不用手动对。

### 3. 启动

**方式 A（全量包）**：双击根目录的 `启动.bat`（首次配置向导最后也会问你要不要直接启动）。

**方式 B（源码）**：先启动 NapCat（或已有的 OneBot 11 WS），再：

```bash
npm start
```

如果还没有 `.env`，`启动.bat` 会自动从 `.env.example` 创建并打开记事本，填完保存后再运行一次。

### 4. 首次登录 NapCat（只需一次）

- 无界面启动时，二维码在 `napcat\napcat\cache\qrcode.png`，日志在 `data\napcat.log`
- 手机 QQ 登录**机器人小号**，扫码授权
- 登录成功后，打开 NapCat WebUI（地址/Token 在 `data\napcat.log` 里），确认「网络配置 → WebSocket 服务器」为 `127.0.0.1:3001`，Token 与 `.env` 一致
- 如果二维码过期：双击 `napcat\start-napcat-qr.bat` 重新生成

### 5. 验证

```bash
npm run selftest     # 本地全链路自测：模拟 QQ + 模拟大模型，不花钱
npm run check        # 检查 NapCat/OneBot 连接和登录账号
npm run doctor       # 环境体检
```

看到 `PASS ✅`、并且控制台状态正常，就可以在群里 @ 它或私聊测试了。

## 桌面控制台（可选）

双击 `control\启动控制台.bat`，或运行：

```powershell
powershell -ExecutionPolicy Bypass -File control\安装控制台.ps1
```

会生成桌面快捷方式「大肥鱼控制台」。控制台页面：

- **运行状态**：NapCat/bot 状态、启动/停止/重启、清除日志
- **会话设置**：每个群「仅 @ 回复 / 直接回复」，每个私聊「回复 / 不回复」，每个会话独立限额、是否装不认识主人
- **梗词典**：待解释 / 已学会
- **运行日志**

## 配置速查（`.env`）

| 变量 | 说明 |
| --- | --- |
| `ONEBOT_WS_URL` | NapCat OneBot WebSocket 地址，默认 `ws://127.0.0.1:3001` |
| `ONEBOT_ACCESS_TOKEN` | 与 NapCat WS 配置一致的 Token，可留空 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容接口；默认 DeepSeek |
| `BOT_QQ` | 机器人 QQ 号 |
| `BOT_NICKNAME` | 机器人昵称，用于日志和 prompt |
| `ALLOWED_GROUPS` | 只允许工作的群号，英文逗号分隔；留空 = 所有群 |
| `IGNORE_QQS` | 不搭理的 QQ（别的机器人、小号等） |
| `OWNER_NAMES` | 主人兼男朋友的昵称/QQ，英文逗号分隔 |
| `NEMESIS_NAMES` | 讨厌的人（语气会变差，但不会辱骂） |
| `TRIGGER_KEYWORDS` | 关键词触发；留空 = 只回 @ |
| `REPLY_RATE` | 没 @ 时随机接话概率，0~1 |
| `COOLDOWN_SECONDS` | 主动接话冷却（秒） |
| `MAX_REPLIES_PER_HOUR` / `MAX_REPLIES_PER_MINUTE` / `MAX_PRIVATE_REPLIES_PER_MINUTE` | 全局限额默认值 |
| `QUIET_HOURS` | 安静时段，如 `1-8` |
| `MAX_INPUT_CHARS` / `MAX_CONTEXT_CHARS` | 单条输入/上下文总字数上限，省 token |
| `STRANGER_GROUPS` | 可选：默认要装不认识主人的群号（控制台也能单独切换） |

## 项目结构

```
blue-fatfish-bot/
├─ src/            # bot 源码（入口、OneBot、记忆、触发、LLM、会话设置、梗词典）
├─ prompts/        # 人设 prompt
├─ control/        # 桌面控制台（本地网页后端 + 前端 + 隐藏启动脚本）
├─ scripts/        # 自测、体检、演示、停止脚本
├─ docs/           # 常见问题、调教指南、原理、形象设定
├─ data/           # 运行期数据（日志、记忆、会话设置）——不提交、不外传
├─ napcat/         # NapCat 运行时（全量包包含；源码仓库不含）
├─ .env.example    # 配置模板
├─ 启动.bat / 停止.bat
└─ package.json
```

## 自测与排错

- `npm run selftest`：不需要 `.env` 里的真 Key，也不需要 QQ
- `npm run doctor`：检查 Node、NapCat 端口、模型配置
- `npm run check`：检查 OneBot 连接与登录账号
- 日志：`data\bot.log`（bot）、`data\napcat.log`（NapCat）、`data\control.log`（控制台）
- 常见问题见 [docs/常见问题.md](docs/常见问题.md)

## 自定义人设

编辑 `prompts/persona.md` 即可。更详细的设定、调教示例和实现原理：

- [docs/形象设定.md](docs/形象设定.md)
- [docs/调教指南.md](docs/调教指南.md)
- [docs/原理.md](docs/原理.md)

## 安全与免责声明

- 本项目**不是**腾讯或 DeepSeek 官方项目，与它们没有关系。
- NapCat 是第三方 QQ 协议方案，**违反 QQ 用户协议，存在临时冻结/长期封号风险**；请只用小号、低频使用、不要用于违法用途。
- 不要把自己的 `.env`、`data/`、NapCat 登录缓存发给别人；本仓库的 `.gitignore` 已默认排除这些文件。
- AI 生成内容可能出错；涉及事实、代码、法律/医疗等内容请自行核实。
- 禁止用本项目生成违法、色情、暴力、骚扰或侵犯他人隐私的内容。
- 公开仓库不包含任何真实账号登录数据、API Key 或聊天记录。

## License

代码以 MIT License 发布，见 [LICENSE](LICENSE)。

NapCat 为独立第三方项目，遵循其自身许可证；本仓库/全量包只做打包分发，不修改其核心代码。DeepSeek 鲸鱼娘形象为社区二创，相关角色/梗版权归原作者，本仓库仅作非官方同人使用。
