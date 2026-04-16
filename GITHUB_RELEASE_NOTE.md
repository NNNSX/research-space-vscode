# Research Space v2.1.0-alpha.6

`v2.1.0-alpha.6` 是 **2.0 新链路的收口版开发预览**，已经可以安装体验，但仍然 **不是稳定版**。

请在 GitHub Release 页面明确说明：

- 这是 alpha 开发版，稳定性弱，慎重使用
- 建议先备份工作区，再在副本中试用
- 不建议直接替代 `v1.2.2` 稳定版用于唯一生产环境

本次版本重点：

- 文档文本提取继续做跨平台收口：OOXML / OpenDocument / EPUB 改为优先走内置 zip 解析，不再依赖系统 `unzip`
- `rtf` 增加纯文本 fallback；`doc/dot` 在非 macOS 或 `textutil` 不可用时回退到 legacy 文本抽取
- `xls/ppt/xlt/pps/pot` 的 best-effort 文本提取改为内置实现，不再依赖系统 `strings`
- 这意味着 `docx/xlsx/pptx`、`odt/ods/odp`、`epub`、`fodt/fods/fodp` 在 Windows / Linux / macOS 上的文本预览与 AI 输入链路更一致
- README、CHANGELOG、发布文案与版本号同步到 `v2.1.0-alpha.6`

推荐的 GitHub 发布文案：

> `v2.1.0-alpha.6` is a closure-focused alpha preview of the upcoming 2.0 workflow engine. It is available for testing, but stability is still weaker than the `v1.2.2` stable line. Please use it cautiously, back up your workspace first, and avoid relying on it as your only production environment.
