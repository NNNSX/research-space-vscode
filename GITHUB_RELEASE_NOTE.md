# Research Space v2.0.0-alpha.13

`v2.0.0-alpha.13` 是 **2.0 新链路的开发预览版**，已经可以安装体验，但仍然 **不是稳定版**。

请在 GitHub Release 页面明确说明：

- 这是 alpha 开发版，稳定性弱，慎重使用
- 建议先备份工作区，再在副本中试用
- 不建议直接替代 `v1.2.2` 稳定版用于唯一生产环境

本次版本重点：

- 节点组 / Hub / Pipeline 新链路继续收口
- AI 流式输出改为分帧缓冲，降低多节点 Pipeline 连续运行时的崩溃风险
- 文件节点刷新与画布保存解耦，新创建节点不必先保存画布才能正确刷新卡片信息
- 文件监听优先读取活动画布内存态，减少节点元数据被旧 `.rsws` 覆盖的情况

推荐的 GitHub 发布文案：

> `v2.0.0-alpha.13` is an alpha development preview of the upcoming 2.0 workflow engine. It is available for testing, but stability is still weaker than the `v1.2.2` stable line. Please use it cautiously, back up your workspace first, and avoid relying on it as your only production environment.
