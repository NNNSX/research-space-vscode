# Changelog

All notable changes to **Research Space** are documented here.

## [2.0.0-alpha.13] — 2026-04-16

- **发布定位明确为开发预览版** — 这次 GitHub 同步面向 `2.0` 新链路试用，不作为稳定版替代；README 与发布说明都会明确提醒“稳定性弱，慎重使用，建议先备份工作区”
- **AI 流式输出改为分帧缓冲** — Webview 侧对 `aiChunk` 更新增加按帧合并，避免多节点 Pipeline 连续运行时因流式文本过密触发 React 嵌套更新风暴，缓解“第一个节点完成、第二个节点启动即崩溃”的问题
- **文件节点刷新与画布保存解耦** — 新增 `canvasStateSync` 轻量消息，画布当前内存态会实时同步到 Extension Host，而不必等待手动保存或 3 分钟自动保存；新创建节点在文件保存后即可命中文件监听并刷新卡片信息
- **文件监听优先使用活动画布内存态** — 文件变更、删除、重命名时，监听器优先读取当前打开画布的 `document.data`，不再只依赖磁盘上的旧 `.rsws` 快照，避免“节点已在画布中，但扩展侧还不知道它存在”的状态错位
- **节点元数据回写链路收口** — 文件监听刷新 `content_preview`、`ai_readable_chars`、缺失状态等元数据后，会同步更新活动文档内存态并写回 `.rsws`，减少“刷新了 UI 但下次保存又被旧数据覆盖”的问题

## [2.0.0-alpha.12] — 2026-04-15

- **节点组引擎回归原生节点** — 废弃 `overlay + 外挂 port 节点` 的试错方案，节点组改回原生 `NodeGroupNode` 渲染，组框、标题栏、折叠态和左右双通道统一挂在同一个 React Flow 节点实体上
- **节点组语义改为 hub 收口** — 节点组不再在连线时临时展开为多条外部边，而是持久化一个真实 `group_hub` 节点，并用隐藏的 `hub_member` 边把成员节点汇聚到 hub；对外连线始终只有一条显式边，执行时再展开为成员输入
- **节点组主体改为指针穿透** — 节点组主体区域不再拦截组内文件节点的鼠标交互，只让标题栏、菜单与左右端口接管交互，避免再次出现“组能显示但把成员都挡住”的回归
- **节点组双通道补齐** — 节点组恢复与普通节点一致的左入右出双通道，右侧用于整组批量输出，左侧用于整组批量接入，为后续“爆炸/蓝图”能力保留一致心智模型
- **节点组拖拽命中区修正** — 标题栏整体都作为整组拖拽句柄，底层复用原生节点拖拽链路，再由 store 把 hub 位移翻译成成员位移，避免出现“点中标题栏却拖不动”或“只移动框不移动成员”的交互错觉
- **节点组通道交互显式化** — 左右通道都由原生句柄本体负责命中与连线，并继续跟随组框颜色，避免再出现“看起来像通道、实际只是装饰”的问题

## [2.0.0-alpha.11] — 2026-04-15

- **节点组通道可见性回修** — `GroupPortNode` 改回“真实句柄自身就是可见圆点”的实现，避免组通道只剩偏移 `Handle` 导致在组框边缘看起来像消失
- **节点组通道定位微调** — 展开态与折叠态的组通道锚点重新对齐到组框右侧，保持“看得见即可拖拽连线”的直觉

## [2.0.0-alpha.10] — 2026-04-15

- **保存脏状态去伪存真** — 自动保存只会由真正改变 `.rsws` 内容的操作触发；选中节点、ReactFlow 内部尺寸/选择回报等瞬时 UI 变化不再反复把顶栏状态打回“未保存”
- **保存提示收口** — 顶栏保存状态改为纯文字提醒，不再带底色和边框；保存按钮改成与其他按钮一致的普通样式与单色图标
- **文本节点可读元数据统一** — `ai_output`、`note` 等文本节点的 `ai_readable_chars` 现在由统一链路维护：AI 生成输出时写入全文长度，文件变更监听也会同步刷新预览和全文长度
- **AI 输出提示不再假装全文 300 字** — 当只有预览、没有全文长度元数据时，底部提示会明确显示“已载入预览”，避免把 300 字预览误报成全文长度

## [2.0.0-alpha.9] — 2026-04-15

- **保存状态可见化** — 顶栏新增画布保存状态提示，明确显示 `已保存` / `未保存` / `几秒后自动保存` / `保存中` / `保存失败`
- **手动保存入口** — 顶栏新增 `💾 保存` 按钮，并支持 `Ctrl/Cmd+S`，与自动保存共用同一条宿主写盘链路
- **保存回执补齐** — Extension Host 在自动保存和手动保存完成后主动回传 `canvasSaveStatus`，前端不再依赖“猜测是否已经写盘成功”

## [2.0.0-alpha.8] — 2026-04-15

- **Pipeline 入口条件收紧** — `▶▶ Pipeline` 只在多选/选区工具栏中出现，不再因单独选中一个节点而显示，保持“外部入口”语义并与蓝图入口一致
- **文件节点底部信息固定** — 数据节点改为“头部固定 + 正文滚动 + 底部元信息固定”，`AiReadabilityBadge` 与文件路径/模型标签不再在缩高时被压扁
- **节点组通道去装饰化** — 移除组框上的假圆点，仅保留真实的 `GroupPortNode` 句柄；连接校验同步支持节点组 → 功能节点，恢复可拖拽连线
- **执行前画布强制同步** — `runFunction` / `runBatchFunction` / `runPipeline` 现在携带当前画布快照并在宿主侧立即写回，修复“删除旧功能节点后仍触发旧节点”与 `找不到功能节点或 ai_tool 配置` 的时序问题

## [2.0.0-alpha.7] — 2026-04-15

### Fixed
- **Pipeline 入口回归** — 移除 FunctionNode 内部的 `▶▶ Pipeline` 按钮，恢复为外部入口，避免多节点场景下入口语义混乱，并保持与后续蓝图设计兼容
- **数据节点缩放布局** — 调整 DataNode 结构，标题栏与预览按钮改为固定头部区域，仅正文滚动，节点调节高度时不再把头部一起压缩
- **节点组通道恢复** — 恢复节点组右侧通道的可见提示与可连线行为，组框与折叠卡片重新显示独立圆点，通道节点层级上移避免被外框覆盖
- **画布高 CPU 回归** — 优化 `Canvas` 的 `displayNodes` 构造逻辑，非搜索/非折叠场景下复用原始节点对象，减少打开画布后因内容更新导致的整画布重建与高频重渲染

---

## [2.0.0-alpha.6] — 2026-04-15

### Fixed
- **Pipeline 启动异常** — 修复 `pipelineStarted` 消息在 `totalCount` 定义前读取变量的问题，避免 Pipeline 启动阶段直接失败
- **Pipeline warning 丢失** — 校验 warning 现在在 `pipelineStarted` 之后发送，Webview 能正确接收并在 `PipelineToolbar` 中展示
- **Pipeline 跳过状态不一致** — 新增 `pipelineNodeSkipped` 消息，跳过节点现在会正确更新进度统计和节点视觉状态，不再停留在 waiting
- **Pipeline 等待态误显示为运行中** — 启动 Pipeline 时改为清理旧的 `fn_status`，等待节点由 Pipeline 专属状态驱动，避免所有节点一开始都显示“运行中”
- **菜单入口范围偏窄** — Explorer “Add to Canvas” 与树菜单 “Open File” 现在覆盖数据、音视频、BibTeX、CSV/TSV 等已支持类型

---

## [2.0.0-alpha.4] — 2026-04-15

### Added
- **Pipeline 执行前校验** — `pipeline-validator.ts` 在 Pipeline 启动前检查所有节点：缺失输入连接、空 prompt 等问题自动检测，分为 error（阻止执行）和 warning（允许继续）两级
- **Pipeline 进度工具栏** — `PipelineToolbar` 浮动工具栏：进度条、暂停/恢复/取消按钮、当前执行节点名称、完成节点统计
- **Pipeline 状态机** — Zustand `PipelineState`：`nodeStatuses` / `completedNodes` / `isPaused` / `currentNodeId` / `validationWarnings` 完整状态管理
- **Pipeline 节点视觉状态** — FunctionNode 在 Pipeline 运行中显示不同状态：waiting 虚线边框、running 蓝色脉冲动画、done 绿色 ✅、failed 红色 ❌、skipped 灰色 ⊘
- **Pipeline 边动态着色** — `PipelineEdge` 根据执行状态动态变色：flowing 蓝色动画 → done 绿色 → failed 红色
- **BibTeX 文件支持** — code 节点新增 `.bib` / `.bst` 文件类型识别

### Changed
- `pipelineStarted` 消息携带完整元数据（节点列表、执行顺序、层级信息），UI 端一次初始化所有状态

---

## [2.0.0-alpha.3] — 2026-04-15

### Added
- **Pipeline 执行引擎** — `pipeline-engine.ts` 实现 BFS 下游节点发现 + Kahn 算法拓扑分层；`pipeline-runner.ts` 逐层执行、同层并行、中间结果通过 `injectedContents` 传递到下一层
- **Pipeline 运行按钮** — FunctionNode 新增 ▶▶ Pipeline 按钮，点击后从当前节点开始执行整条管道
- **Pipeline 消息链路** — `pipelineNodeStart` / `pipelineNodeComplete` / `pipelineNodeError` / `pipelineComplete` 消息类型，实时推送各节点执行进度

### Changed
- `function-runner.ts` 新增 `injectedContents` 参数，Pipeline 模式下跳过文件读取，直接使用上游节点的输出内容

---

## [2.0.0-alpha.2] — 2026-04-15

### Added
- **Pipeline 功能节点互连** — 功能节点之间现在可以用 `pipeline_flow` 边连接，构建多步骤 AI 处理管道
- **环路检测** — `graph-utils.ts` 新增 `wouldCreateCycle` 检测和 `topologicalSort` 拓扑排序，连线时实时阻止环路
- **Pipeline 边样式** — `PipelineEdge.tsx` 虚线紫色管道边，与普通 `data_flow` 边视觉区分
- **连接校验** — Canvas `isValidConnection` 实时校验连接合法性（类型检查 + 环路检测）

### Changed
- `EdgeType` 新增 `pipeline_flow` 类型
- `_createEdge` 重构为 `edgeType` 参数化，支持创建不同类型的边

---

## [2.0.0-alpha.1] — 2026-04-15

### Added
- **AI 内容理解度指示器** — `AiReadabilityBadge` 组件，在数据节点上显示 AI 对该内容的可读性评估：
  - PDF：显示可提取字符数 + 页数，检测到图表/公式时警告"含不可读内容"
  - Note / Code / AI Output：显示字符数，标注"完全可读"
  - Image：标注"需要多模态模型"
  - Audio / Video：标注转录需求
  - CSV：显示行列数
- **PDF 图表检测** — `content-extractor` 新增正则检测 PDF 中的 Figure / Table / Chart / Equation 引用，提示用户 AI 可能无法理解这些内容

### Changed
- `NodeMeta` 新增字段：`ai_readable_chars` / `pages` / `has_unreadable_content` / `unreadable_hint` / `csv_rows` / `csv_cols`

---

## [1.2.2] — 2026-04-14

### Fixed
- **画板拖动粘鼠板效应** — 拖动画板时不再"粘住"经过的节点。改为在拖动开始时快照内部节点，整个拖动过程中只移动快照中的节点，避免路过的节点被意外带走
- **AI 输出编辑后不更新** — 双击编辑 AI 输出节点后，节点卡片和预览窗口现在正确刷新。修复原因：`ai_output` 节点定义 `extensions: []`（无扩展名），导致文件变更监听器无法通过扩展名匹配到节点类型，现改为直接查询节点类型定义的 `watchContent` 标志
- **画布多节点时卡顿** — 移除 `onlyRenderVisibleElements`（ReactFlow 内置虚拟化）避免频繁挂载/卸载节点造成性能抖动；DataNode 和 FunctionNode 组件用 `React.memo()` 包裹，避免无关状态变更导致的不必要重渲染

---

## [1.2.1] — 2026-04-14

### Added
- **画布内置弹出式预览器** — 点击节点「预览」按钮，在画布内弹出全屏模态窗口预览内容，取代之前跳转 VSCode 编辑器的方式：
  - Markdown/笔记/AI 输出 → ReactMarkdown 全文渲染，14px 字体，完整 GFM 支持（表格、代码块、引用等）
  - 代码文件 → 等宽字体 + 行号 + 语言标签，全高度滚动
  - PDF → 多页渲染，所有页面上下滚动翻阅，页数统计
  - 图片 → 全尺寸居中显示（object-fit: contain）
  - 音频 → 波形可视化 + 播放/暂停控制 + 进度条（点击跳转）+ 时间显示
  - 视频 → 原生 `<video controls>` 全尺寸播放器
  - CSV/TSV → 全表格渲染，斑马条纹，列×行统计
  - 实验记录/任务清单 → 完整展示
  - ESC 键 / 点击背景关闭

### Changed
- **画板标题栏按钮放大** — ✎ 编辑按钮和 × 删除按钮字体大小与标题同步（24px / 28px），提升可点击性
- **画板标题自适应文字颜色** — 根据画板边框颜色亮度自动选择深色/浅色文字 + 对应阴影，确保任何颜色画板标题都清晰可读

---

## [1.2.0] — 2026-04-14

### Added
- **画板/工作区（Board）** — 全新的画布分区隔离系统，完全替代旧的「归纳组」功能：
  - 画板是半透明彩色矩形区域，节点放在上面，移动画板时内部节点跟随移动
  - 8 个控制点（四角+四边中点）自由调整画板大小
  - 工具栏「📋 画板」下拉：列出所有画板（点击跳转）、新建画板（名称+颜色选择）
  - 新建画板进入暂存架，拖到画布放置
  - 右键画板：编辑名称/颜色、删除画板
  - 动态归属：节点是否在画板内由 bounding box 重叠实时计算，无需手动管理
  - 旧画布的归纳组自动迁移为画板

### Removed
- **归纳组系统** — 被画板/工作区完全替代，选区浮动工具栏中的「归纳」按钮已移除

---

## [1.1.4] — 2026-04-14

### Fixed
- **归纳组输出归属** — 功能节点位于归纳组内时，AI 生成的输出节点自动加入同一归纳组，组边界自动扩展
- **归纳组标签可见性** — 标题栏高度 26→32px，字体 11→14px，加粗 600→700，增强多层文字阴影确保任何颜色下都清晰可读
- **生成历史功能移除** — 右键 AI 输出节点的"查看生成历史"菜单项已移除，避免画布崩溃
- **功能节点运行动效** — 运行中的功能节点显示流动渐变边框（蓝→紫→粉循环）+ 脉冲光晕效果，与暂存架风格一致

---

## [1.1.3] — 2026-04-14

### Fixed
- **fullContentCache 内存泄漏** — 节点删除后缓存条目未清理，在 `onNodesChange` 中新增自动清理逻辑
- **AudioContext 资源泄漏** — 波形生成出错时 `ctx.close()` 未调用，改用 `try/catch/finally`
- **PdfPreview 文档泄漏** — `pdfDoc.destroy()` 在错误和组件卸载路径未调用，现已补全
- **finishAiRun 重复节点** — AI 输出消息可能重复到达导致节点重复，新增 ID 去重检查

---

## [1.1.2] — 2026-04-14

### Added
- **PDF 节点第一页图形化展示** — Paper/PDF 节点从文字摘要改为渲染 PDF 第一页原图，使用 `pdfjs-dist`（v4.10.38）在 Webview 侧渲染第一页到 `<canvas>`
- **PdfPreview 组件** — blob worker 模式（兼容 IIFE 打包 + CSP），加载中/渲染失败状态处理，`renderedUri` ref 防重复渲染

### Changed
- Paper 节点不再走文字预览路径（`content_preview` 300 字符摘要保留用于搜索等场景）
- CSP 新增 `worker-src blob:` 允许 pdfjs blob worker

---

## [1.1.1] — 2026-04-14

### Added
- **画布按需渲染** — 启用 ReactFlow `onlyRenderVisibleElements`，视口外节点不挂载 DOM，大幅降低节点数量多时的内存和 CPU 占用
- **内容懒加载** — 节点进入视口时才请求完整内容（`requestFileContent`），离开视口后 DOM 卸载释放资源
- **fullContentCache 缓存** — 已加载的内容存入 store 级 Map，节点重新进入视口时直接命中缓存不重复请求，切换画布时自动清空

### Changed
- `content_preview`（300 字符摘要）仅作初始快速渲染用，全量内容不持久化到 `.rsws` 文件

---

## [1.1.0] — 2026-04-14

### Added
- **节点内容按需全量加载** — DataNode 挂载时通过 `requestFileContent` 向 Extension Host 请求完整文件内容，收到 `fileContent` 响应后自动替换为全量内容

### Changed
- `content_preview` 恢复为 300 字符摘要（仅用于初始快速渲染）
- 表格节点移除行列硬限制（原先 4 行 × 5 列），容器改为 `overflow:auto` 支持滚动
- `.rsws` 文件体积不受影响（全量内容不持久化，仅运行时加载）

---

## [1.0.9] — 2026-04-14

### Fixed
- **节点宽度爆炸** — `addNode`/`finishAiRun`/`commitStagingNode`/`createDataNode`/`createFunctionNode` 创建 FlowNode 时未设置 `width`/`height`，导致 ReactFlow 自动测量撑满容器；现已在所有创建点补全
- **内容不跟随填充** — 内容容器 `overflow:'hidden'` 改为 `overflow:'auto'` + `minHeight:0`；CodePreview 移除 5 行硬限制
- **updateNodeSize 一致性** — 同步更新 FlowNode 顶层 `width`/`height`

---

## [1.0.8] — 2026-04-14

### Fixed
- **节点初始大小异常** — `canvasToFlow` 新增尺寸合理性校验（width 120–800, height 50–1200），超出范围回退默认值
- **内容区域自适应** — 文本/代码/Markdown 预览移除固定 `maxHeight`，改用 `flex:1 + overflow:auto`；图片/视频预览改为百分比自适应

---

## [1.0.7] — 2026-04-14

### Changed
- **拖拽放入提示修正** — 恢复暂存架原始标题栏样式；新增拖拽文件进入画布时的全屏半透明蒙层（📥 图标 + 提示文字），拖拽离开或松手后自动消失

---

## [1.0.6] — 2026-04-14

### Added
- **代码节点渲染升级** — 深色背景、等宽字体、行号、语言标签（自动从文件扩展名推断）
- **节点可调整大小** — 所有数据节点新增 NodeResizer，选中后拖拽边角可自由缩放，尺寸自动持久化

### Changed
- 暂存架标题栏下方新增醒目横幅「↗ 拖至画布放置」

---

## [1.0.5] — 2026-04-14

### Added
- **Shift 拖拽提示** — 画布底部新增提示胶囊
- **暂存架流光动效** — 蓝→紫→粉渐变边框 + 呼吸光晕

### Fixed
- **宠物渲染尺寸跳变** — 不同动画 GIF 尺寸不一致导致宽度跳变，改用固定 bounding box + `object-fit:contain`

---

## [1.0.4] — 2026-04-14

### Fixed
- **宠物对话面板关闭后位置偏移** — 打开时保存原始位置，关闭时恢复

---

## [1.0.3] — 2026-04-14

### Fixed
- **多模态工具 activeRuns 泄漏** — TTS/STT/视频生成/图像编辑执行后 `activeRuns` 未清理（unreachable code）
- **新建画布同名文件夹冲突** — 若同名文件夹已存在但无 `.rsws` 文件，会尝试打开不存在的文件
- **syncDataNodeFile 空内容拦截** — `!content` 判断误拦截空字符串
- **_handleMessage 无顶层错误处理** — 任意 case 抛异常变为静默 unhandled rejection

---

## [1.0.2] — 2026-04-14

### Changed
- **节点紧凑布局** — 数据节点从固定 `height` 改为内容自适应（auto-size），消除底部空白

---

## [1.0.1] — 2026-04-14

### Fixed
- **实验/任务节点内容溢出** — DataNode 固定 `height` + 双重渲染导致溢出；改用 `minHeight` 自适应，排除专属 Body 组件的 text preview

---

## [1.0.0] — 2026-04-14

### Added
- **Per-Canvas 文件隔离** — 每个画布拥有独立工作空间文件夹（`{画布名}/{画布名}.rsws`），笔记、AI 输出、自定义工具、宠物状态均存储在画布子文件夹中，多画布完全隔离
- 新建画布自动创建同名文件夹；删除画布时清理整个文件夹

### Removed
- `aiOutputDir` 配置项（固定为 `outputs/`）

---

## [0.10.19] — 2026-04-14

### Fixed
- **实验/任务无法添加到画布** — 笔记/实验/任务标题输入从 Webview `window.prompt()`（被 VSCode iframe 阻止）改为 Extension Host 侧 `vscode.window.showInputBox()`

---

## [0.10.18] — 2026-04-13

### Changed
- **笔记/实验/任务统一存入 notes/ 文件夹** — 新建笔记改为保存到 `notes/` 子文件夹；实验记录和任务清单新增磁盘文件持久化（`.md` 格式）

---

## [0.10.17] — 2026-04-13

### Changed
- **Mermaid 图表提示词升级** — 系统提示词内置完整 Mermaid v11 语法参考（6 种图表 + 常见错误规避），输出改为标准 `.md` 文件

---

## [0.10.16] — 2026-04-13

### Fixed
- **宠物状态栏恢复** — PetChat 底部恢复显示心情/精力/经验完整信息
- **Mermaid 渲染错误处理** — 渲染失败时显示具体语法错误 + 原始代码 fallback，成功后新增「图表/代码」切换

### Added
- 空画布引导卡新增 ✕ 关闭按钮

---

## [0.10.15] — 2026-04-13

### Changed
- **Markdown 预览改为半窗口** — `markdown.showPreviewToSide`，不再全屏覆盖画布
- **宠物窗口越界修复** — 模式切换时自动 clamp 位置
- **PetChat 拖拽区域扩大** — 新增顶部标题栏作为拖拽区域

---

## [0.10.14] — 2026-04-13

### Changed
- **宠物自由放置** — 从四角吸附改为自由放置（拖到哪停在哪），位置用绝对 `left/top` 持久化
- **帮助弹窗内容更新** — 新增 CSV 表格节点、Shift+拖拽、归纳选色、宠物伴侣等说明

---

## [0.10.13] — 2026-04-13

### Changed
- **工具栏自适应布局** — 画布顶栏 `flexWrap` 自适应，窄窗口自动换行
- **自定义服务商图像支持** — 有图像时自动切换 OpenAI vision content array 格式

---

## [0.10.12] — 2026-04-13

### Fixed
- **CSV 导入修复** — StagingPanel 过滤器和 `isDataNode()` 缺少 `data` 类型

---

## [0.10.11] — 2026-04-13

### Added
- **CSV 表格节点** — `data` 节点类型（📊 图标），CSV/TSV 文件以表格样式展示（表头高亮、列数行数统计）

---

## [0.10.10] — 2026-04-13

### Fixed
- **宠物解锁修复** — 类型选择器改为按等级判断解锁
- **新增文件格式支持** — CSV/TSV/XML/HTML/CSS/SQL 等 15+ 种
- **Markdown 预览优化** — 仅打开渲染预览窗口

---

## [0.10.9] — 2026-04-13

### Changed
- **预览改用 VSCode 原生** — 移除 Webview 内置 PreviewModal，改为调用 `vscode.open`

---

## [0.10.8] — 2026-04-13

### Fixed
- **宠物对话无法发送** — vscodeApi 引用错误改用 `bridge.postMessage`

### Added
- 工作统计栏（本次时长/累计/连续天数）+ 📋 每日总结按钮

---

## [0.10.7] — 2026-04-13

### Added
- **宠物 AI 独立配置** — 支持独立服务商和模型（设置面板「宠物 AI」区域）
- **画布事件感知** — 添加/删除节点、AI 完成/出错时宠物即时反应

---

## [0.10.6] — 2026-04-13

### Changed
- **宠物浮动窗口打磨** — 气泡响应式宽度、点击展开对话、主题前景层独立裁切、入场淡入动画

---

## [0.10.5] — 2026-04-13

### Changed
- **宠物引擎改造** — 底部面板重构为浮动可拖拽窗口（最小化/漫游态/对话态），pointer-events 穿透不阻挡画布

---

## [0.10.4] — 2026-04-13

### Added
- **5 个场景主题背景** — 森林/城堡/秋天/海滩/冬天（来自 vscode-pets），背景/前景 PNG 分层渲染
- 设置面板新增场景主题选择器

---

## [0.10.3] — 2026-04-13

### Changed
- **宠物像素 GIF 素材** — 使用 vscode-pets（MIT）高质量像素 GIF 替换 Emoji 渲染，7 种宠物 × 6 个动画

---

## [0.10.2] — 2026-04-13

### Added
- **宠物 AI 感知 + 对话** — 感知画布内容，空闲 >5 分钟自动 AI 建议，双击打开对话弹窗，会话历史持久化

---

## [0.10.1] — 2026-04-13

### Added
- **宠物伴侣引擎 Phase 1** — 画布底部宠物面板，6 种像素宠物，Emoji 动画引擎，情绪系统，成长系统，休息提醒

---

## [0.10.0] — 2026-04-13

### Added
- **归纳颜色 + 编辑** — 创建时选择边框颜色（8 色预设）、创建后可编辑名称和颜色

### Fixed
- 自定义服务商输出节点标签显示 UUID 的问题

---

## [0.9.9] — 2026-04-13

### Changed
- **设置面板整理** — 按「LLM 文本服务商 / 多模态工具 / 其他」分组
- **工具栏统一** — `+ 图标 文字` 格式
- **拖拽导入** — 支持从 VSCode 资源管理器或系统文件管理器拖拽文件到画布

---

## [0.9.8] — 2026-04-13

### Added
- **AI 编排提示词** — AI 工具面板底部新增按钮，一键复制完整工具定义 JSON 规范提示词

### Changed
- 所有 LLM 工具系统 Prompt 编辑器显示默认提示词占位符
- 未连接输入时显示蓝色输入提示（按 apiType/slots 自动生成）

---

## [0.9.7] — 2026-04-13

### Fixed
- **工具导入防冲突** — ID/名称冲突自动追加后缀；磁盘文件名冲突检测

---

## [0.9.6] — 2026-04-13

### Added
- **撤销/重做** — Ctrl+Z / Cmd+Z 撤销、Ctrl+Shift+Z / Cmd+Shift+Z 重做；工具栏 ↩/↪ 按钮；覆盖节点/边/拖拽/连线/归纳等操作；最多 50 步

---

## [0.9.5] — 2026-04-13

### Changed
- **PDF 预览修复** — Paper 节点改为嵌入式 PDF 阅读器（`<embed>`）；CSP 添加 `frame-src`/`object-src`

---

## [0.9.4] — 2026-04-13

### Changed
- **预览按钮化** — 数据节点单击不再弹出预览，改为标题栏「预览」按钮触发

---

## [0.9.3] — 2026-04-13

### Fixed
- **归纳边界精确** — 使用 ReactFlow `getNodesBounds` 获取 DOM 实际测量尺寸；拖动节点同步更新归纳框；标题栏可拖拽整体移动

---

## [0.9.2] — 2026-04-13

### Changed
- **归纳简化** — 移除放缩功能，仅保留命名矩形框 + 删除；使用 ViewportPortal 渲染；画布缩放范围扩大至 5%–400%

---

## [0.9.1] — 2026-04-13

### Added
- **选区工具栏入口** — 工具栏「⬚ 选区」按钮切换框选模式

---

## [0.9.0] — 2026-04-13

### Added
- **选区工具 + 归纳** — 多选节点后浮动工具栏（移动/归纳）；归纳将选中节点包裹在命名矩形框中

---

## [0.8.8] — 2026-04-13

### Removed
- **移除分组和自动布局** — 删除 GroupNode 和 Dagre 自动布局功能（用户反馈会打乱布局）；清理 `@dagrejs/dagre` 依赖

---

## [0.8.7] — 2026-04-13

### Added
- **Auto-layout (Dagre)** — toolbar button "🔀 整理" automatically arranges all canvas nodes using Dagre hierarchical graph layout algorithm. Nodes are positioned left-to-right based on their connection relationships. Unconnected nodes are placed below. Group children are laid out internally.
- New dependency: `@dagrejs/dagre` for directed acyclic graph layout computation.

---

## [0.8.6] — 2026-04-13

### Added
- **Group nodes (folding groups)** — select multiple nodes on the canvas and click "📦 分组" in the toolbar to create a group. Group nodes act as visual containers with:
  - Dashed-border rectangle with colored accent
  - Title bar with rename (double-click), collapse/expand toggle
  - 8 color choices via right-click context menu
  - Collapse to single-line summary showing child count
  - Dissolve group (right-click → "🗑 解散分组") — children return to canvas
  - Resizable when selected (drag corners/edges)
  - Child nodes constrained within group bounds
- **`renameNode` store action** — inline rename for non-file nodes (groups, etc.)
- **`dissolveGroup` store action** — unparents all children and removes the group node

### Changed
- `NodeMeta` extended with `group_color` field.
- `FlowNode` / `FlowEdge` interfaces extended with `selected`, `hidden` fields.
- `canvasToFlow` now sets `style` dimensions for group nodes.
- Canvas nodeTypes registry includes `groupNode`.
- Toolbar has new "📦 分组" button.

---

## [0.8.5] — 2026-04-13

### Added
- **AI Tools panel grouped by category** — tools are now organized into 5 collapsible groups: Text Processing (summarize, polish, translate, review), Research (literature-review, outline-gen, rag), Multimodal (image-gen, image-edit, tts, stt, video-gen, image-to-video), Project Management (meeting-transcribe, action-items), General (chat, draw). Custom tools remain in their own section.
- **Tool search** — search input at the top of the AI Tools panel. Filters by name, description, and ID. Shows flat results while searching, grouped view when empty.
- **`category` field in JsonToolDef** — new optional field for tool categorization. All 17 built-in tool definitions updated.

### Fixed
- **Audio node stuck on "加载中"** — audio nodes never requested a webview URI (`requestImageUri` only handled `image` and `video`, not `audio`). Added `audio` to all 4 URI request locations. Also improved `useWaveform` hook with `<audio>` element fallback for duration and deterministic pseudo-random fallback waveform.

---

## [0.8.4] — 2026-04-13

### Added
- **Audio node waveform preview** — audio nodes now show a waveform visualization instead of a static icon. Waveform is generated from actual audio data using Web Audio API `decodeAudioData`.
- **Audio player modal** — single-click on audio node opens a modal with an interactive waveform player. Click on waveform to seek. Play/pause button with elapsed/total time display. Waveform bars highlight in blue as playback progresses.

### Removed
- **Run Guard selector** — removed "运行条件" dropdown (always/on-change/manual-confirm) from function nodes. Simplified to always run on button click.
- **Batch Run button** — removed "⚡ 批量" button from function node UI. The `runBatchFunction` message handler remains in the backend for future use.
- **Manual confirm dialog** — removed the confirm prompt that appeared when run_guard was set to manual-confirm.

### Changed
- Function node now has a single full-width "▶ 运行" button.
- Audio nodes are now included in `PREVIEWABLE` set for single-click preview.

---

## [0.8.3] — 2026-04-13

### Fixed
- **Critical: connections to no-slot tools silently dropped** — `onConnect` called `confirmConnection()` without first setting `pendingConnection`, so `confirmConnection` found a null connection and returned immediately. This caused **all** connections to tools without slots (TTS, image-gen, video-gen, image-edit, image-to-video, draw, chat, rag) to silently disappear after dragging. Refactored into `onConnect` → `_createEdge` for direct connections, `confirmConnection` only used after role picker dialog for slot-based tools.

---

## [0.8.2] — 2026-04-13

### Added
- **Experiment Log node (SR3)** — toolbar button `🧪 实验` creates an inline experiment log node. Fields: status (running/done/failed), date, params, result. All data stored in `meta`, serialized to `content_preview` for AI consumption. New `resources/nodes/experiment_log.json` definition.
- **Task node (PM1)** — toolbar button `✅ 任务` creates an inline task checklist node. Features: progress bar, checkbox toggle, add/remove items. Serialized as `任务进度: N/M (X%)\n[x] item\n[ ] item` for AI tools. New `resources/nodes/task.json` definition.

### Fixed
- **Staging note deletion** — removing a note node from the staging panel now also deletes the corresponding `.md` file on disk. Previously the file was orphaned.
- **TTS tool crash** — `runTts()` was missing `new AbortController()`, causing a runtime `controller is not defined` error. Fixed.
- **TTS/multimodal upstream check** — multimodal tools (TTS, image-gen, video-gen) no longer require upstream data nodes in the generic check. They have their own input validation.
- **TTS `text_input` param removed** — the redundant "文本（可选）" text input was removed from TTS. TTS now reads text exclusively from connected nodes (note, ai_output, etc.). FunctionNode shows warning when no upstream connected.
- **Multimodal model selector** — removed redundant "工具默认" / "全局默认" empty option from multimodal model dropdowns in both Settings panel and FunctionNode per-node selector. First model is now default.

### Changed
- `DataNodeType` extended with `experiment_log` and `task`.
- `NodeMeta` extended with experiment and task fields.
- `DEFAULT_SIZES` extended for new node types.
- `StagingPanel` and `FunctionNode` icon maps updated for `experiment_log` and `task`.
- `WebviewMessage` extended with `deleteNote` type.

---

## [0.8.0] — 2026-04-13

### Added
- **Batch Run (B1)** — each function node now shows a **⚡ 批量** button next to the Run button. Clicking it runs the tool once per upstream data node, producing a separate output node for each. Progress is shown as `批量运行 N/M…`. Runs sequentially to avoid API rate limits. New message type `runBatchFunction`; new `runBatchFunctionNode()` in `function-runner.ts`.
- **Output History (C3)** — right-click any `ai_output` node → **🕓 查看生成历史**: a modal lists all `.md` files in `.ai_outputs/`, newest first, with a 200-char preview per file. Click **恢复** on any entry to bring it back as a new staging node. Click **打开** to open it in the VSCode editor. Current node's file is marked with a "当前" badge.
- **Literature Review tool (SR1)** — new `literature-review.json`: batch-synthesizes multiple papers into paragraph synthesis, comparison table, or argument map. Slots: `论文` (multiple, required) + `综述方向说明` (optional reference note).
- **Outline Generation tool (SR2)** — new `outline-gen.json`: turns notes/drafts into a structured 2–4 level paper outline. Supports research paper / thesis / report styles. Slots: `笔记/草稿` (multiple, required) + `参考结构` (optional).
- **Meeting Transcription tool (PM2a)** — new `meeting-transcribe.json`: transcribes meeting audio via AIHubMix Whisper. Slot: `会议录音` (required audio node).
- **Action Items tool (PM2b)** — new `action-items.json`: extracts action items (who, what, when) from meeting transcripts or notes. Output as checklist or table. Slots: `会议记录` (required) + `上次行动项` (optional reference).

### Changed
- `OutputHistoryEntry` interface added to `canvas-model.ts`; `outputHistory` state + `setOutputHistory` action added to Zustand store.
- `requestOutputHistory` / `restoreOutputVersion` message types added to `WebviewMessage`.
- `outputHistory` added to `ExtensionMessage`.

---

## [0.7.4] — 2026-04-13

### Changed
- **Error experience (E2)** — error toasts now classify by type and show contextual action buttons:
  - **API Key 错误** (401 / unauthorized / "未配置…Key"): shows a **打开设置** button that opens the Settings panel directly.
  - **网络错误** (fetch failed / ECONNREFUSED / timeout): shows a hint to check network or Ollama service.
  - **文件缺失** (ENOENT / "找不到文件"): shows a hint to remove the node and re-import the file.
  - **其他错误**: auto-dismisses after 12 seconds.
  - All toasts still dismiss on click.

---

## [0.7.3] — 2026-04-13

### Added
- **Right-click menu unification (D2)** — consistent context menu across node types:
  - Data nodes: **打开文件** (open in VSCode editor), **重命名** (note nodes), **复制节点**, **从画布删除**
  - Function nodes: **重命名** (renames the node title in-place), **复制节点** (duplicates with all param values), **从画布删除**
  - New `duplicateNode` store action: clones a node 30px offset, resets fn_status to idle, saves canvas.
- **Empty canvas guide card (E1)** — when `nodes.length === 0`, a centered overlay card with three-step onboarding instructions and an "导入第一个文件" quick-action button is shown. Disappears automatically once the first node is added.

---

## [0.7.0] — 2026-04-13

### Changed
- **Removed blueprint engine**: deleted `blueprint-runner.ts`, `BlueprintNode.tsx`, `OrchestrationEditor.tsx` and all related state, message types, and UI (Blueprint tab in AI Tools panel, FunctionNode mini mode). `NodeType` no longer includes `blueprint`. The canvas now focuses on the simple, transparent data-node + function-node interaction model.

---

## [0.7.1] — 2026-04-13

### Added
- **Edge Role Labels (A0)** — when connecting a data node to a function node that defines `slots`, a role-picker dialog appears so the user can assign a semantic role to the connection. The role label (e.g. `原文`, `术语表`) is displayed as a pill badge at the edge midpoint.
  - `CanvasEdge` gained an optional `role` field (fully backwards-compatible — existing `.rsws` files are unaffected).
  - `JsonToolDef` gained an optional `slots: SlotDef[]` field.
  - `Shift`-drag or tools without `slots` skip the dialog and create a generic edge immediately.
  - `function-runner.ts`: upstream content blocks are now grouped by role with `## <role label>` headers before being sent to the AI, so the model can clearly distinguish "原文" from "参考建议", "待翻译文本" from "术语表", etc.
  - Built-in tools updated: **polish**, **translate**, and **review** now ship with `slots` definitions.

---

## [0.7.2] — 2026-04-13

### Added
- **Output placement (A1)** — `calcOutputPosition()` uses axis-aligned bounding-box collision detection to place new AI output nodes in the first non-overlapping slot to the right of the function node (up to 20 candidates, then appends below the lowest existing node). Eliminates piled-up output nodes after repeated runs.
- **Streaming progress feedback (F1)** — while a function node is running, a throttled (500 ms) progress update pushes character count + an 80-character inline peek preview to the webview. Displayed as a tinted preview box below the function node status line.
- **Run guard (F2)** — each function node can be configured with a run condition:
  - `always` (default) — runs unconditionally on every click.
  - `on-change` — computes a djb2 fingerprint of all upstream content; skips the AI call and shows "已是最新（输入未变化）" if nothing changed since last run.
  - `manual-confirm` — shows an inline confirm dialog before executing; useful for expensive or destructive operations.
  - Run guard is stored in `node.meta.run_guard` (not `param_values`) to keep AI parameters separate from node behavior.
- **Prompt parameterization (F3)** — `summarize` tool gains a free-text **关注点** (`focus`) parameter and a `slots` definition. The system prompt template uses `{{focus}}` substitution (already supported by `ToolRegistry.buildSystem()`) so the focus phrase is injected directly into the prompt without extra user effort.

---

## [0.6.15] — 2026-04-12

### Added
- **Node right-click context menu** — all node types (data, function, blueprint) support right-click delete
- **Note rename** — right-click a note node to rename it inline; renames the underlying file via `WorkspaceEdit.renameFile` (VSCode-tracked), detects name conflicts and suggests alternatives, updates canvas immediately without relying on `onDidRenameFiles`

### Fixed
- `window.prompt()` is blocked in VSCode webview — replaced with inline React input UI inside the context menu portal
- After rename, node showed as "missing" with old title — fixed by directly updating canvas data and pushing `nodeFileMoved` message instead of relying on file-system events

## [0.6.14] — 2026-04-12

### Fixed
- **Ollama multimodal false warning** — removed the `VISION_KEYWORDS` heuristic that incorrectly flagged models like `qwen3.5` as "may not support images". Image handling is now unconditional; the model itself handles unsupported inputs

## [0.5.2] — 2026-04-12

### Fixed
- **ResizeObserver fatal error** — `window.error` handler was treating the benign `ResizeObserver loop completed with undelivered notifications` browser notification as a crash, replacing the entire UI with a fatal error screen. Now filtered out; ReactFlow/MiniMap resize is no longer fatal

### Changed
- **BlueprintNode visual redesign** — complete style overhaul:
  - Canvas card (240 px wide): header with title + `SERIAL`/`PARALLEL` pill; step preview rows with color-coded left border, number badge, tool name, status dot; footer with status indicator + step count + **详细** + **▶ Run**; drop-shadow + selection ring
  - Detail modal: blurred backdrop; large header with `StatusPill` + `ModePill` + error-strategy badge; toolbar with add-step dropdown, mode/error toggles, save-def, run; step cards with param-chip previews; inline `StepParamForm` slides in above list on ⚙; clean connector arrows between serial steps



### Fixed
- **BlueprintNode layout** — blueprint child function nodes were incorrectly rendered as independent ReactFlow nodes on the canvas, floating on top of the blueprint card and obscuring its step preview. Fix: `canvasToFlow` now excludes all nodes whose `parent_group_id` points to a blueprint node from the ReactFlow node list; their info is read directly by `getBlueprintChildNodes` and displayed inside the compact card and detail modal
- **Blueprint card redesign** — replaced the old fixed-size scrollable box with a compact self-sizing card (max 3 steps preview + "…N more") and a full detail modal (portal to `document.body`, ESC/backdrop-click to close) containing the full step list, inline param forms, toolbar for add/reorder/delete/exec-mode/on-error/save-def/run

## [0.5.0] — 2026-04-12

### Added
- **Multimodal tools** (AIHubMix API Key required):
  - **Image Generation** — FLUX.1-Kontext-pro / DALL-E / Ideogram text-to-image
  - **Image Editing** — FLUX Kontext / GPT-4o edit with reference image
  - **Text-to-Speech** — tts-1 / tts-1-hd / Gemini TTS; outputs audio node
  - **Speech-to-Text** — Whisper transcription/translation; outputs ai_output node
  - **Video Generation** — Wan / Kling / HailuoAI text-to-video; outputs video node
  - **Image-to-Video** — Wan / Kling image-to-video with motion prompt
- **`audio` / `video` node types** — new data node types with 🎵 / 🎬 card UI
- **AIHubMix API Key** setting in Settings panel and `researchSpace.ai.aiHubMixApiKey` config
- **Blueprints tab** in AI Tools panel — browse, preview steps, drag-to-instantiate, import/export/delete
- **BlueprintNode edit mode** — double-click for blue-border edit mode with toolbar: add step, move up/down, remove, configure params, toggle serial/parallel, toggle on_error, save definition

### Fixed
- `finishAiRun` now calls `debouncedSave` so multimodal output nodes persist across canvas close/reopen

## [0.4.0] — 2026-04-12

### Added
- **Blueprint engine rewrite**: `JsonBlueprintDef` JSON-driven blueprint definitions
- **BlueprintRegistry** — 3 built-in blueprints (`summarize-polish`, `rag-report`, `review-translate`) + user `.rsblueprints/` hot-reload
- **Kahn topological sort** — guarantees correct step execution order via internal `data_flow` edges
- **Serial chain data passing** — previous step output injected into next step without disk I/O
- `on_error` strategy (`stop` / `continue`) per blueprint node
- `instantiateBlueprint` — creates container node + child nodes + internal edges from a `JsonBlueprintDef`
- 11 blueprint orchestration message types (`addBlueprintStep`, `removeBlueprintStep`, `moveBlueprintStep`, `addBlueprintChannel`, `updateBlueprintChannel`, `removeBlueprintChannel`, `setBlueprintExecMode`, `setBlueprintOnError`, `updateBlueprintStepParams`, `saveBlueprintDef`)
- Blueprint import / export / delete
- `.rsblueprints/` file watcher for hot-reload
- `canvas-store`: `blueprintDefs`, `editingBlueprintId`, `getBlueprintChildNodes`
- `function-runner`: `FunctionRunResult` return type (`success`, `outputContent`, `outputNode`)
- `content-extractor`: `injectedContents` parameter for blueprint serial injection

## [0.3.1] — 2026-04-12

### Changed
- Removed "Restore Viewport" button; MiniMap is now pannable + zoomable for quick navigation

### Added
- **Input ordering** — drag ⠿ handles inside function nodes to reorder connected files; order persists to `input_order` and affects AI processing sequence
- **Chat tool** — custom prompt textarea with file pill tags; click a tag to insert `@filename` reference; `function-runner` resolves `@ref` to file content at run time

## [0.3.0] — 2026-04-12

### Added
- Double-click node opens file in `ViewColumn.Beside` so canvas stays visible
- Viewport persistence — pan/zoom written to `.rsws`; toolbar "Restore / Fit" toggle
- `DataNodeRegistry` — node metadata (icon, color, extensions, preview type) driven by `resources/nodes/*.json`; eliminates 13 hardcoded mappings

## [0.2.9] — 2026-04-12

### Added
- AI Tools panel groups builtins vs. custom tools
- Tool import / export / delete
- `.rstools/` hot-reload watcher — custom tools reload without reopening canvas
- `validateToolDef` error toast on malformed JSON

## [0.2.8] — 2026-04-12

### Added
- Staging panel persistence — `stagingNodes` written to `.rsws`; restored on reopen
- JSON-driven tool engine — `ToolRegistry` loads `resources/tools/*.json`; `AiToolsPanel` renders dynamically
- User `.rstools/` directory for custom tool definitions

## [0.2.0–0.2.7] — 2026-04-11 / 12

### Added
- Embedded Settings panel (⚙) with per-provider config (API Key, Model, Base URL)
- Custom OpenAI-compatible providers (e.g. AIHubMix)
- Copilot global default model; model list auto-fetched from API
- Node drag fix: skip `debouncedSave` while dragging
- Stability fixes: dirty-dot, listener leaks, `suppressNextRevert`, `Promise.allSettled`
- Canvas crash fix: `writeCanvas` uses direct overwrite instead of tmp+rename
- Double-click nodes open in VSCode built-in viewer
- Markdown rendering preview in `note` / `ai_output` node cards

## [0.1.0–0.1.9] — 2026-04-11

- Initial release: Custom Editor, ReactFlow canvas, data nodes, function nodes, three-tier AI provider fallback (Copilot → Anthropic → Ollama)
- Per-node Provider / Model selector; System Prompt editor
- RAG query input; Draw (Mermaid) tool
- Sidebar tree view with right-click context menus
- Staging Panel — new nodes land in floating tray before placement
- File sync: rename tracking, content_preview refresh, delete watcher
