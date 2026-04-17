# Research Space v2.1.0-alpha.22

`v2.1.0-alpha.22` 是一个面向测试的 **alpha 预览版**。这一版继续推进蓝图实例加载 / 绑定收口，并对画布中的通道、连线与右键交互做了一轮细节打磨。  
它已经可以安装和体验，但**稳定性仍弱于 `v1.2.2` 稳定线**。

## 使用提醒

- 这是 alpha 开发版，请谨慎使用
- 建议先备份工作区，再在副本中试用
- 不建议直接替代 `v1.2.2` 稳定版作为唯一生产环境

## 本次更新重点

### 1. 蓝图实例化链路继续收口

- 蓝图实例开始按完整 `*.blueprint.json` 定义恢复结构
- 已可恢复：
  - 功能节点
  - 内部数据节点
  - 输入 / 输出占位节点
  - 内部连接边
- 蓝图输入绑定、实例容器展示与当前 Phase C 的加载态继续收口

### 2. 通道交互从箭头回到圆点方案

- 删除左右箭头造型，恢复为更克制的圆点句柄
- 保留更大的接近命中区，降低“看得见但不好点中”的问题
- 鼠标靠近 / 悬停时，圆点会高亮并触发呼吸式闪烁
- 通道悬停时会显示：
  - `输入通道`
  - `输出通道`

### 3. 连接线与右键交互继续打磨

- 普通连接线与 Pipeline 连线保留选中高亮能力
- 连线支持右键删除
- 右键菜单会跟随画布元素移动
- 修复菜单内部点击被过早关闭的问题，确保菜单项可正常执行

### 4. 版本与文档同步

- README、CHANGELOG、发布文案与版本号已同步到 `v2.1.0-alpha.22`

## English summary

`v2.1.0-alpha.22` is an alpha preview focused on blueprint instantiation refinement and canvas interaction polish.  
This version continues the Phase C work of restoring blueprint instances from full definitions, while also revising port interaction back to dot handles with clearer hover feedback, pulse highlighting, and input/output tooltips.  
Please use it cautiously, back up your workspace first, and avoid relying on it as your only production environment.
