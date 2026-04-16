# Research Space v2.0.0-alpha.14

`v2.0.0-alpha.14` 是 **2.0 新链路的开发预览版**，已经可以安装体验，但仍然 **不是稳定版**。

请在 GitHub Release 页面明确说明：

- 这是 alpha 开发版，稳定性弱，慎重使用
- 建议先备份工作区，再在副本中试用
- 不建议直接替代 `v1.2.2` 稳定版用于唯一生产环境

本次版本重点：

- 文本类节点卡片正文改为按尺寸按需补载，首次拉伸到足够尺寸时会自动请求全文
- 节点卡片展示态持久化到画布，重新打开后会恢复上次的摘要态 / 全文态
- 修复全文缓存残留导致的展示错位，节点缩回摘要态后不再继续错误显示全文
- README、CHANGELOG、发布文案与版本号统一收口到 `v2.0.0-alpha.14`

推荐的 GitHub 发布文案：

> `v2.0.0-alpha.14` is an alpha development preview of the upcoming 2.0 workflow engine. It is available for testing, but stability is still weaker than the `v1.2.2` stable line. Please use it cautiously, back up your workspace first, and avoid relying on it as your only production environment.
