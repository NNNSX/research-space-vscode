# Research Space v2.1.0-alpha.22

`v2.1.0-alpha.22` 是 **蓝图创建 / 加载起步版开发预览**，已经可以安装体验，但仍然 **不是稳定版**。

请在 GitHub Release 页面明确说明：

- 这是 alpha 开发版，稳定性弱，慎重使用
- 建议先备份工作区，再在副本中试用
- 不建议直接替代 `v1.2.2` 稳定版用于唯一生产环境

本次版本重点：

- 蓝图实例链路已切到按完整 `*.blueprint.json` 定义恢复结构，开始恢复功能节点、内部数据节点、输入/输出占位与内部边
- 蓝图输入绑定、实例容器展示与当前 Phase C 的加载态继续收口
- 节点通道交互这一轮改回圆点方案：删除箭头造型，恢复圆点句柄
- 圆点通道新增接近态高亮、呼吸式闪烁，以及“输入通道 / 输出通道”悬停提示
- 普通连接线与 Pipeline 连线保留选中高亮和右键删除能力
- 右键菜单跟随画布元素移动，并修复菜单内点击不应被过早关闭的问题
- README、CHANGELOG、发布文案与版本号同步到 `v2.1.0-alpha.22`

推荐的 GitHub 发布文案：

> `v2.1.0-alpha.22` is an alpha preview focused on blueprint loading / instantiation refinement and canvas interaction polish. It is available for testing, but stability is still weaker than the `v1.2.2` stable line. Please use it cautiously, back up your workspace first, and avoid relying on it as your only production environment.
