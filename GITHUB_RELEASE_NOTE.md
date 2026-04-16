# Research Space v2.1.0-alpha.5

`v2.1.0-alpha.5` 是 **2.0 新链路的收口版开发预览**，已经可以安装体验，但仍然 **不是稳定版**。

请在 GitHub Release 页面明确说明：

- 这是 alpha 开发版，稳定性弱，慎重使用
- 建议先备份工作区，再在副本中试用
- 不建议直接替代 `v1.2.2` 稳定版用于唯一生产环境

本次版本重点：

- 主流文件导入继续扩容，已补齐 `doc/xls/ppt`、`docm/xlsm/pptm`、`rtf`、`odt/ods/odp`、`epub`
- 继续补齐 Office 模板 / 放映 / Flat ODF 变体：`dot/dotx/dotm`、`xlt/xltx/xltm`、`pps/ppsx/ppsm`、`pot/potx/potm`、`fodt/fods/fodp`
- 导入入口、文件监听、fallback 识别、预览 / 全文提取、AI 输入链路已同步打通
- `doc/rtf` 优先走 macOS `textutil`，OOXML 走解包提取，`odt/ods/odp/epub/fod*` 走 XML/HTML 提取，`xls/ppt/xlt/pps/pot` 仍属 best-effort 文本抽取
- README、CHANGELOG、发布文案与版本号同步到 `v2.1.0-alpha.5`

推荐的 GitHub 发布文案：

> `v2.1.0-alpha.5` is a closure-focused alpha preview of the upcoming 2.0 workflow engine. It is available for testing, but stability is still weaker than the `v1.2.2` stable line. Please use it cautiously, back up your workspace first, and avoid relying on it as your only production environment.
