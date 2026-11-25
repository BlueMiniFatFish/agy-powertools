# Codex 增强分支开发文档（`feat/codex-style`）

本分支基于 [`WhiteBr1ck/agy-powertools`](https://github.com/WhiteBr1ck/agy-powertools)（MIT 协议）Fork 维护，定位为**仿 Codex 交互、排版与高保真媒体体验的 Antigravity 增强分支**。所有自研能力均集中收敛于设置页独立分栏 **「Codex 增强扩展」（`Codex Extensions`）**，不混入原作者既有分栏，确保后续跟进上游版本升级时边界清晰、冲突极小。

---

## 1. 仓库与分支约定及同步流程

- `upstream`：`https://github.com/WhiteBr1ck/agy-powertools.git`（上游原仓库）
- `origin`：`https://github.com/xiejunjie168-bot/agy-powertools.git`（自有定制版对外发布仓库，当前发行版 `v1.0.0`，集成上游 `v2.15.5`）
- `main` / `feat/codex-style`：默认主分支与开发分支均同步包含 Codex 定制版改动，`project.json` 已切换至 `origin` 发布源

```bash
# 1. 拉取上游最新代码并直接合入当前工作分支（默认当前分支，支持 --rebase）
bash scripts/sync-upstream.sh

# 2. 校验语法、运行全量单元测试与发布包构建
npm test
node scripts/build-release.mjs

# 3. 安装到本地 Antigravity 插件目录（macOS 起自 2.15.5 使用原版 App 自动重启，无需冗余启动器；Cmd + Q 重启生效）
npm run install:local
```

> 说明：二开版采用独立版本号（如 `v1.0.0`）并更新 `project.json` 后，「关于」页应用内检查更新会对接自有 `origin` 仓库 Releases；同步上游仍统一通过 `sync-upstream.sh` 完成。

---

## 2. 开发进度总览

| 功能模块 | 当前状态 | 设置开关 / 字段 | 所在设置分栏 | 主要涉及文件 |
| :--- | :--- | :--- | :--- | :--- |
| 独立双开关分栏隔离 | ✅ 已完成 | `codexStyle`、`hdImages`（`CodexExtensionsSection`） | Codex 增强扩展 | `lib/native-panels.js`、`lib/settings.mjs`、`tests/native-ui.test.mjs` |
| Codex 对话排版与本机静默适配 | ✅ 已完成 | `codexStyle` | Codex 增强扩展 | `lib/codex-style.mjs`、`lib/codex-style-helpers.mjs`、`lib/native-host.mjs`、`lib/native-ui.js` |
| Codex 工作进度流统一（日常工作/软件开发） | ✅ 已完成 | `codexStyle`（内部 `setCodexProgress`） | Codex 增强扩展 | `lib/native-client.js`、`lib/native-ui.js`、`lib/native-i18n.js`、`lib/zh-tw.mjs`、`tests/native-client.test.mjs` |
| 大尺寸贴图预览与快捷剔除热区 | ✅ 已完成 | `codexStyle`（内部 `setCodexComposerMedia`） | Codex 增强扩展 | `lib/native-ui.js`、`lib/native-client.js`、`tests/native-ui.test.mjs`、`tests/native-client.test.mjs` |
| 高清原图上传（`≤ 3 MiB`） | ✅ 已完成 | `hdImages` | Codex 增强扩展 | `lib/native-bindings.js`、`lib/native-client.js`、`lib/native-panels.js`、`lib/settings.mjs`、`tests/native-client.test.mjs` |
| 遗漏汉化与全场景横向右键胶囊 | ✅ 已完成 | `codexStyle`、`fileContextMenu` | Codex 增强扩展 / 会话增强 | `lib/native-client.js`、`lib/native-ui.js`、`lib/native-i18n.js`、`lib/zh-tw.mjs`、`tests/native-client.test.mjs`、`tests/i18n.test.mjs` |

---

## 3. 已完成功能架构与实现契约

### 3.1 独立设置分栏（`Codex 增强扩展` / `Codex Extensions`）

- 在 `lib/native-panels.js` 中定义独立组件 `CodexExtensionsSection({ toggle })`，置于「设置」页启用后的第一个分区。
- 分区内**仅保留两个极简总开关**：
  1. 「Codex 风格体验」（`codexStyle`，默认开启）：一键联动排版与配色、流式工作进度、大尺寸输入框贴图与横向右键胶囊，不再陈列繁琐子开关或路径配置卡片。
  2. 「高清原图上传（≤ 3 MiB）」（`hdImages`，默认开启）：全部自研开关均收归于此，不混入原作者「界面与显示」或「会话增强」分栏。
- 原「紧凑排版」与「用户消息气泡着色」保留非破坏式接管说明。

### 3.2 Codex 对话排版与静默适配（`codexStyle`）

- **默认启用（`codexStyle: true`）**：在 `lib/native-ui.js` 单 `<style>` 节点（`densityStyle`）中注入 `html[data-agy-codex-style]` 层叠规则，紧随 `html[data-agy-compact]` 之后生效；对齐 Codex 桌面端源码的 `48rem` 对话列宽、左右边线、1.625 正文行高、标题/列表/引用尺度、无框横线表格、半透明行内代码方牌、虚线下划线链接及无边框用户气泡，同时保留 `--conversation-nav-reserve` 与 `--overview-panel-reserve`。
- **内置预设与静默适配**：以实测 Codex 当前参数为内置默认预设（`#181818` / `#FFFFFF` 画布、ChatGPT 蓝 `#3A83F7` 强调色、无边框 `#173E76` / `#E8F3FE` 用户气泡、`#63A8F8` / `#1F4E94` 文件链接、`14px` 正文字号与 `12px` 代码字号），零配置即开即用；若检测到本机存在 `~/.codex` / `$CODEX_HOME` 桌面外观配置则静默对齐，未检测到时无感知回退内置默认。
- **主题色与无边框气泡协同**：`codexStyle` 开启时默认同步启用 Codex 画布、文字、强调色与无边框气泡（`data-agy-codex-theme`）；搭配 `:not([data-agy-user-bubble])` 避让条件，用户主动开启「用户消息气泡着色」（`userBubbleTint: true`）时即覆盖气泡色并保留 Codex 画布，关闭 `codexStyle` 后全部立即回退。
- **DOM 属性与 CSS 变量契约**：
  - `<html>` 属性：`data-agy-codex-style`、`data-agy-codex-progress`、`data-agy-codex-composer-media`、`data-agy-codex-theme`、`data-agy-codex-local`、`data-agy-codex-font-size`、`data-agy-codex-code-font-size`、`data-agy-codex-font-sans`、`data-agy-codex-font-mono`
  - CSS 变量：`--agy-codex-max-width`、`--agy-codex-font-smoothing`、`--agy-codex-line-height`、`--agy-codex-block-gap`、可选 `--agy-codex-font-size` / `--agy-codex-code-font-size`，以及 `light` / `dark` 双模式色板、气泡和字体变量。

### 3.3 Codex 工作进度流统一（随 `codexStyle` 生效）

- **统一开关控制**：随 `codexStyle` 一并开启或关闭，通过 `lib/native-client.js` 中的 `syncSegmentHook()` 包装原生 `segment`（`SSc`）渲染器，在「日常工作」与「软件开发」两种界面布局中统一传入 `{ ephemeralToolCalls: false, ephemeralProgressTextMode: 'none' }`，消除单行刷屏覆盖与灰字限高滚动盒。
- **执行态与完成态分离**：Agent 运行期间按时间线亮前景色显示阶段汇报，并将单条非等待审批终端步骤压缩为单行灰字 `toolGroupCollapsible`；通过可选绑定 `splitSegments`（`T5b`）在工作流开启时统一多 `executionId` 分段，并在出现 `WAITING`（`status === 9`）人工审批步骤、最新轮次存在 `in_progress` 计划项/运行中步骤或活跃直接子代理时保持内联（不读取未订阅的外部 Redux `notFullyIdle`，避免 `useMemo` 缓存锁死）；最终回复生成完毕后，仅当存在经 `isStepActuallyRendered`（`isRendered`）核验为可见的工作过程步骤时，将前置汇报、中间回复、`Message from ...` 唤醒消息及子代理分组统一收拢折叠为单行 `用时 X分X秒 >`，隐藏的系统通知（如 `[Notice]`）绝不产生空折叠箭头。
- **样式与文案清理**：`lib/native-ui.js` 通过 `html[data-agy-codex-progress]` 移除 `[data-testid="progress-updates-timeline"]` 的 `max-height` 限制与水平内缩、`formatWorkedLabel` 去掉完成行末尾冗余的进度计数后缀，在原生 `[data-testid="idle-status-text"]`（「工作中」）存在期间隐藏同组底部操作栏与提前挂载的用时组件，保留对齐 Antigravity 2.35.1 新增的 `step-plan-chip`（`N/M 步`）胶囊使之不与时长栏重叠，并将顶层 `systemMessage` / 后台任务折叠行同步对齐到左边界与 Codex 静音灰行样式；`lib/native-i18n.js` 与 `lib/zh-tw.mjs` 全面覆盖 Antigravity 2.35.1 固定进度、工具与子代理/后台任务文案（含 `Started N subagents`、`Message from ...`、`Compacting`、工具组合摘要、`Reading/Editing/Listing/Searching/Running <目标>`、`Waiting for approval to ...`、浏览器与定时器操作、`just now`、`Worked for ...d` 及系统事件标题）的简/繁中文翻译。
- **Agent 精简输出与工具摘要汉化提示接管（去人设）**：当 `codexStyle` 开启时，`lib/native-ui.js` 透传 `language` 至 `adapter.setUiLanguage(lang)` 并启用 `codexProgress`，`lib/native-client.js` 中的 `configureRequest` 自动以 `buildCodexAgentRule(uiLanguage)` 替换请求字段 `appendPromptSections` 里的 `powertools_stage_updates`（包含结论先行、默认精简篇幅、克制行内反引号、句尾文件链接、阶段汇报推进与按界面语言本地化 `toolSummary`/`focus`/步骤标题，严格排除任何个人人设且不改动用户 `~/.gemini/AGENTS.md`）；关闭 `codexStyle` 后自动恢复原版 `stageUpdateRule`，`lib/native-panels.js` 的「阶段汇报」描述同步展示只读升级接管说明。

### 3.4 高清原图上传与 Codex 贴图预览（`hdImages` / `codexStyle`）

- **双通道放行与缩略图提清**：
  1. `lib/native-bindings.js` 通过 `findOptional('imageCompress', ...)` 定位客户端原生压缩函数并暴露在 `bindings.names.imageCompress`。
  2. `lib/native-client.js` 在 `hdImages` 或 `codexStyle` 开启时按需放行：`hdImages` 放行 `(1048576, 1024)` 主图通道至 `≤ 3 MiB` 无损/高质量直传（超 3 MiB 按原始宽高二分降质收敛）；`hdImages` 或 `codexStyle`（内部 `codexComposerMedia`）任一开启时将 `(10240, 320)` 缩略图通道提升至 `160 KiB / 640px`，避免 Retina 屏预览糊图。
- **Codex 规格输入框大贴图（随 `codexStyle` 生效）**：
  - 在 `lib/native-ui.js` 通过 `html[data-agy-codex-composer-media]` 仅命中包含 `<img>` 的 `[data-testid="input-attachment"]`，主输入框渲染 `122×122`（侧边对话为 `88×88`）同心圆角预览卡（自然向上撑高 `.surface-composer-card`），搭配悬浮显现的 `18×18` 反色圆形移除按钮与 `30×30` 点击热区；普通文档胶囊不受影响。

### 3.5 Codex 横向胶囊操作栏（划词 + 选中右键 + 文件/图片右键）

- **统一目标解析与选区提取**：`lib/native-client.js` 提供 `resolveContextTarget` / `resolveInlineMediaPayload`（覆盖用户上传图、Markdown 图片、图集、`generateImage`、`@文件`/`@目录` 胶囊、Artifact 卡片、工具步骤行与文件树），同时提供 `extractQuotableSelection` / `attachSelectionToComposer` 提取干净划词文本并识别 `<pre>` 代码块（标签 `code_block` vs `Quote`）。
- **三路交互统一（`codexStyle: true` 默认生效）**：
  1. **左键划词**：样式与作用域文案直接覆盖原生 `.selection-popup > .agy-selection-pill`，隐藏 `⌘L`/`⌘E` 快捷键，改为 Codex 原版横向双按钮纯文字胶囊「添加到对话 | 在侧边聊天中提问」（`28px` 按钮高、`10px` 外圆角、`1px` 全高分割线、`#2D2D2D` 深色实底）。
  2. **选中文字右键与文件/图片右键**：在 `contextmenu` 捕获阶段先校验聊天划词选区、再解析文件/图片目标，统一弹出一致的 `CodexActionPill` 胶囊覆盖作者原有纵向 `FileContextMenu`，点击「在侧边聊天中提问」时通过原生 Redux `sidePanelV2/setContent`、`sidePanel/setSidePanelOpen` 与 `sideQuestion/enqueueDraftSideQuestionQuote`（或文件/媒体直注）自动展开侧边草稿输入框；当 `codexStyle` 关闭时自动回退原生划词文案与 `FileContextMenu`。`Pinned Conversations`、`Save Image` 等词条已补入 `lib/native-i18n.js`。

---

## 4. 二开工程规范（规范写法）

1. **独立分栏隔离**：所有自研控制项（「Codex 风格体验」与「高清原图上传」）一律收敛于 `CodexExtensionsSection`（「Codex 增强扩展」/`Codex Extensions`），严禁写入「界面与显示」「会话增强」等上游原分栏。
2. **上游防冲突边界**：优先把新业务逻辑抽到独立 `.mjs`（如 `codex-style-helpers.mjs`）并在宿主文件保持极小挂载点；**禁止修改上游 `README.md` 与 `README_EN.md`**（既防合并冲突，也确保不破坏 `tests/lifecycle.test.mjs` 对上游徽章的断言），二开文档统一维护于本文件 [CODEX_DEV.md](./CODEX_DEV.md)。
3. **浏览器内联与单样式表约束**：凡会被 `native-host.mjs` 拼接内联进渲染进程的文件（如 `codex-style-helpers.mjs`、`zh-tw.mjs`）只能使用 `export function`，**禁止使用 `export const`**；所有注入 CSS 必须写在 `native-ui.js` 的唯一 `densityStyle.textContent` 内，禁止新增第二个 `<style>` 节点。
4. **Hook 安全与完全可逆**：
   - `setEnabled(false)`、单独功能开关关闭与 `dispose()` 必须完整恢复原全局函数引用（`resolve`、`segment`、`imageCompress`、`sidebarItems`）、`<html>` 自定义 `data-agy-codex-*` 属性及 `--agy-codex-*` 变量。
   - 状态同步函数调用 `installRequestOverrides()` 时必须外层 `try/catch` 容错未挂载对话视图（`/powertools` 设置页或无对话窗场景）。
5. **国际化与文案规范**：
   - 所有新增 UI 文案统一使用 `text('简体', 'English')`；繁化转换依赖 `lib/zh-tw.mjs`，新增简体汉字需确保已收录转换映射，提交前必须通过 `tests/i18n.test.mjs` 的 `simplifiedOnly` 全文扫描。
   - **严禁使用中点（`·`）作为状态、耗时或UI文本分隔符**（遵循项目 `AGENTS.md` 规则）。
6. **验证与安装交付清单**：每次改动交付前必须按序执行 `node --check` 语法校验、`npm test`（0 失败）、`node scripts/build-release.mjs` 构建校验；需要同步到本机试用时运行 `npm run install:local` 并提醒完整退出重启（`Cmd + Q`）Antigravity。
