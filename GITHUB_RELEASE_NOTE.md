# Research Space 2.1.1-alpha.1

`2.1.1-alpha.1` 是从上一个 GitHub 发布版 `v2.1.0-alpha.41` 继续演进后的新一轮 **蓝图运行闭环 / 旧画布迁移 / 占位节点收口 / 设置体验修复汇总版**。
它已经可以安装测试，但 **仍然是 alpha 开发版，稳定性弱于 `v1.2.2` 稳定版**。

请在 GitHub Release 页面明确说明：

- 这是 alpha 开发版，请勿直接替代稳定版作为唯一工作环境
- 建议先备份工作区，再在副本中试用
- 当前重点是验证：蓝图最终输出持久化恢复、旧实例迁移、蓝图 overlay 结构、输入/输出占位统一、设置体验与模型默认值

---

## 从 `v2.1.0-alpha.41` 到 `2.1.1-alpha.1` 的主要有效变化

### 1. 旧蓝图实例与旧画布迁移开始系统性收口

- 旧蓝图实例不再只做“补缺”，而是开始进入**严格迁移**：会反向清理历史残留的蓝图内部节点、过期定义边、失效 `blueprint_bound_*` 元数据与容器外遗留占位节点
- 节点组历史 `group_hub` / `hub_member` 结构、空组、悬空边、旧 `board` 伪节点、旧 `summaryGroups`、旧壳数据（如 viewport / boards / stagingNodes）都开始在加载期按当前口径归一并即时落盘
- 蓝图 definitions / index / session 隔离链路继续补强：损坏的个别蓝图文件不再拖垮整批恢复，旧画布在索引或 definitions 迟到时也更容易恢复到当前语义

### 2. 蓝图运行容器从“摘要卡”进一步收口为正式实例外壳

- 蓝图主视图切到了更稳定的 **overlay 外壳**：外框与标题栏独立渲染，内部原始 pipeline 节点继续作为主要信息层，容器自身退出主视图命中链路
- 整实例拖拽改成 overlay 快照式平移，旧的边界迟到恢复、误拖和延迟问题持续收口
- 蓝图容器补上更完整的运行态信息：总进度、取消中 / 已取消、最近问题节点定位、运行历史、失败后继续、输出历史入口等

### 3. 蓝图最终输出的持久化 / 恢复链路被重做了一轮

- 宿主写盘开始显式保留 blueprint output 绑定元数据与 `bound output → placeholder` 绑定边，不再只落普通 `ai_generated` 输出
- 加载期新增多轮输出支撑边自修复与旧裁边机制拆解，合法的 output placeholder 外连线、bound output 支撑边不再被历史白名单误裁掉
- 对“终点 function 没有显式输出节点”的 blueprint，会自动合成 **隐式 output slot**，让最终结果具备正式的蓝图输出身份
- 输出拓扑统一为 **`function → output placeholder → real output`**；真实输出固定落到蓝图外侧，placeholder 继续保留在蓝图内部做稳定语义锚点
- 旧节点上的跨蓝图外连线会在输出切换时自动重绑到新的当前输出，重开画布后蓝图最终输出不再反复掉线

### 4. 重开画布后的“先在蓝图内、后跳到外面”问题被连续收口

- 初始化与运行态的 blueprint bounds 计算口径被统一，外部 `blueprint_bound_*` 节点不再被误算进蓝图容器
- 加载旧 `.rsws` 时，系统会更早补齐 output slot defs、输出支撑边和真实输出节点外侧位置，减少首帧跳变
- `research.rsws` 这类测试画布暴露出的“刚打开有线、随后掉线 / 先在蓝图内、后跳出去”的链路已被前移到加载期处理

### 5. 输入 / 输出占位开始真正共用同一套 Placeholder Shell

- 输入占位持续按输出占位母版收口：箭头方向、标题 badge、主体状态区、footer 结构、动作入口逐步统一
- 占位节点开始按内容自动扩高，蓝图外框也会联动跟随，减少内容超边界、被裁掉或消失
- 多行 footer 提示被遮盖的问题已修复；测高回归导致的“边界无限下长”也已回收
- 输入占位 footer 中与主体重复的摘要说明、状态 chips、定位按钮已删除，避免同一信息在节点内重复堆叠

### 6. Blueprint 编辑与普通节点共享骨架回归得到修复

- 修复蓝图创建弹窗中拖拽选择文字会误触 backdrop 关闭的问题
- 修复普通文件节点 footer 被内容区挤出边界的共享布局回归
- direct pipeline 在 blueprint runtime 中生成的中间结果会按隐藏内部节点处理，不再像普通输出一样弹到蓝图外

### 7. 设置与模型默认值继续收口

- Copilot 提供商移除了“自动”模型项，默认模型明确收口为 **`gpt-4.1`**，减少用户一上来就撞到付费模型
- 功能节点与设置页对默认模型的展示更清晰，不再继续给出含混的“自动”语义

---

## 推荐的 GitHub Release 文案

> `2.1.1-alpha.1` is an alpha rollup release that bundles all meaningful changes since the previous GitHub release `v2.1.0-alpha.41`, rather than only the last tiny patch. It significantly tightens old blueprint-instance and old-canvas migration, moves blueprint containers to a more stable overlay shell, rebuilds the persistence/recovery chain for final blueprint outputs, auto-synthesizes missing output slots for terminal functions, keeps real outputs outside blueprints without disconnecting after reopen, and continues converging input/output placeholders into one shared placeholder shell with auto-height behavior. It also fixes the blueprint-create dialog text-selection close bug, restores normal file-node footer layout, and changes Copilot’s default model to `gpt-4.1` without the previous ambiguous “auto” option. Please back up your workspace first and avoid using this alpha as your only production environment.
