# Research Space v2.1.0-alpha.34

`v2.1.0-alpha.34` 是当前 **蓝图运行闭环 + 多模态 AI 工具收口阶段** 的 alpha 预览版，已经可以安装和体验，但**稳定性仍弱于 `v1.2.2` 稳定版**。

请在 GitHub Release 页面明确说明：

- 这是 alpha 开发版，请勿直接替代稳定版作为唯一工作环境
- 建议先备份工作区，再在副本中试用
- 当前重点是验证蓝图实例运行链路、多模态工具链路与节点交互收口，不承诺完全稳定

本次版本重点：

- 图像生成 / 图像编辑接入 `doubao-seedream-5.0-lite`
- 新增「多图融合」与「组图输出」AI 工具
- 图像编辑移除节点内“编辑指令”，改为统一使用连接的文本节点作为提示词输入
- Doubao 图像尺寸参数统一改为合法格式，并兼容旧画布残留值自动归一化
- 图像 / 音频 / 视频 / 转录等多模态输出节点补齐模型与服务商标签
- 各类 AI 工具补齐更一致的节点内 warning banner，尽量把问题前置到运行前
- FunctionNode 高度同步改为内容尺寸驱动，修复功能节点边界框溢出回归
- 暂存架删除逻辑优化：外部拖入文件不再被误删，新建草稿改为落画布时再落盘
- README、CHANGELOG、发布文案与版本号同步到 `v2.1.0-alpha.34`

推荐的 GitHub 发布文案：

> `v2.1.0-alpha.34` is an alpha preview focused on closing the loop for blueprint execution and multimodal AI tools. It adds Doubao Seedream 5.0 Lite image support, new image-fusion and grouped-image tools, more consistent pre-run warnings, multimodal model badges, staging deletion safety fixes, and layout fixes for function nodes. Please use it cautiously, back up your workspace first, and avoid relying on it as your only production environment.
