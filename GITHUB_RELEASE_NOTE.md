# Research Space v2.1.0-alpha.41

`v2.1.0-alpha.41` 是从上一个 GitHub 发布版 `v2.1.0-alpha.34` 继续演进后的新一轮 **蓝图运行闭环 / 旧画布迁移 / 模型与设置体验收口版**。  
它已经可以安装测试，但**仍然是 alpha 开发版，稳定性弱于 `v1.2.2` 稳定版**。

请在 GitHub Release 页面明确说明：

- 这是 alpha 开发版，请勿直接替代稳定版作为唯一工作环境
- 建议先备份工作区，再在副本中试用
- 当前重点是验证：蓝图运行态收口、旧实例/旧节点迁移、AIHubMix 与模型预算适配、设置与保存体验

---

## 从 `v2.1.0-alpha.34` 到 `v2.1.0-alpha.41` 的主要有效变化

### 1. 蓝图运行闭环继续收口

- 蓝图容器开始持久化最近一次运行摘要、最近成功/失败时间
- 取消运行后不再立刻消失，而会明确显示“取消中 / 已取消”
- 蓝图容器开始记录最近问题节点，并支持从容器直接定位
- 打开旧蓝图实例时，会尝试按当前蓝图 definition 补齐缺失的输入/输出占位、内部功能节点、内部数据节点和定义边

### 2. 旧画布 / 旧节点迁移更可靠

- 历史功能节点在打开旧画布或收到最新工具定义后，会自动刷新到当前参数 schema，并补齐新增默认值
- 旧画布在加载时若触发迁移（如节点组 hub、蓝图尺寸归一化、`summaryGroups → boards`、功能节点 schema 补齐），现在会**即时落盘**，不再只停留在内存态

### 3. AIHubMix / 模型预算 / 输出保留能力显著增强

- 修复 Claude 等经 AIHubMix 走自定义 OpenAI 兼容 provider 时“接口成功但输出文件为空”的问题
- 当拿不到标准 `delta.content` 时，不再静默写空文件，而会优先保留 reasoning / tool calls / 原始 SSE chunk
- 聊天类运行会读取 AIHubMix 官方 `Models API` 的 `max_output / context_length`
- `max_tokens` 会自动放宽到模型允许的上限，并按上下文窗口自适应裁剪文本输入
- 新增全局“最大输出 tokens / 最大上下文 tokens”设置，对所有文本 provider 统一按 `min(模型最大值, 设置值)` 生效

### 4. 模型选择体验继续收口

- 设置页新增按 provider 管理的“常用模型”
- 功能节点默认只显示常用模型，降低超长列表噪音
- 常用模型支持排序，功能节点会按该顺序展示
- AIHubMix 的 LLM 默认常用模型收口为：
  - `gemini-3.1-pro-preview`
  - `gpt-5.4`
  - `claude-sonnet-4-6`
- 文本默认热门模型收口为 GPT / Gemini / Claude 各 2 个
- Anthropic 默认模型同步切到 Claude Sonnet 4.6
- 模型列表请求开始前端去重，并在打开画布后后台预取已配置 provider 的模型，减少重复请求

### 5. 设置页体验重做了一轮

- 设置面板已拆成主入口 + 二级弹窗，主面板更简洁
- 文本服务商设置进一步拆成“概览 / 内置服务商 / 自定义服务商”标签
- 设置区现在会直接显示 `已保存 / 待保存 / 保存中`
- 补回明确的 `💾 保存设置` 按钮，既保留自动保存，也给用户手动确认入口
- 修复 `alpha.40` 中点击设置直接触发 React error #310 的回归问题

### 6. 画布保存与恢复体验加强

- 顶栏保存按钮在 `未保存 / 保存中 / 保存失败` 三种状态下会高亮或动效提醒
- 画布会在重开时恢复上次关闭前的视角，而不再总是回到初始页
- 切标签 / 关闭前若还有待保存视角状态，会尝试额外冲刷一次

### 7. 功能节点 UI 稳定性修复

- 功能节点模型/服务商/参数下拉最终改回更稳定的原生 `select`
- 修复下拉跟随、缩放变形、节点边界被撑高等一系列问题
- 修复左右端口圆点只显示一半的问题
- 修复缺失输入时蓝色引导和黄色 warning 重复提示的问题
- 继续收口功能节点高度漂移、运行按钮溢出、底部留白等问题

### 8. 维护与工程化

- 补齐 ESLint 9 flat config，恢复 `npm run lint`
- README / CHANGELOG / 发布说明 / 版本号已同步到 `v2.1.0-alpha.41`

---

## 推荐的 GitHub 发布文案

> `v2.1.0-alpha.41` is an alpha preview that bundles all meaningful changes since the previous GitHub release `v2.1.0-alpha.34`, rather than only the last tiny patch. It further closes the loop for blueprint execution and cancellation UX, improves migration of old blueprint instances and old function nodes, preserves raw AIHubMix SSE output when standard text parsing fails, adapts max output/context budgets to official model limits, introduces favorite-model management and a cleaner settings UI, restores canvas viewport on reopen, improves save visibility, and fixes multiple FunctionNode layout issues. It also adds explicit settings save feedback and fixes the `alpha.40` settings-panel crash. Please back up your workspace first and avoid relying on this alpha build as your only production environment.
