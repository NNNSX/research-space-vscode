# Changelog

All notable changes to **Research Space** are documented here.

## [2.1.0-alpha.41] — 2026-04-18

- **修复打开设置即白屏的 React hook 顺序错误** — `SettingsPanel` 新增保存状态逻辑后，`useMemo` 放在了 `settings` 判空分支之后，导致“第一次设置快照还没到时”和“快照到达后”两次渲染的 hook 数量不一致，触发 React error #310；现已把相关状态准备前移，设置面板可正常打开

## [2.1.0-alpha.40] — 2026-04-18

- **设置页补回手动“保存设置”按钮** — 虽然设置本身仍会自动保存，但主设置面板和各个二级弹窗里现在都会额外显示一个明确的 `💾 保存设置` 按钮，方便用户手动确认
- **设置保存状态开始显式可见** — 设置区会显示 `已保存 / 待保存 / 保存中` 状态，并在收到宿主回传的最新设置快照后更新，减少“到底有没有真的记住”这种不确定感
- **设置按钮支持强制确认同步** — 点击“保存设置”会先冲刷仍在 debounce 队列里的输入，再主动向宿主请求最新设置快照，确保自动保存和手动确认两条路径都收口到同一份状态

## [2.1.0-alpha.39] — 2026-04-18

- **保存按钮现在会主动提醒用户还没真正写盘** — 顶栏「保存」按钮在 `未保存` 状态下会改为高亮并轻微脉冲，提醒当前画布仍有脏改动，避免用户只顾着继续编辑而忘记手动保存
- **保存中的反馈从纯文字扩展到按钮动效** — 当画布正在写盘时，保存按钮会切到更明显的进行中样式与呼吸动效，不再只有旁边那行小字在变化
- **保存失败时会直接把按钮切成错误态** — 若最近一次保存失败，保存按钮会进入醒目的错误高亮，用户可以更直观看到需要立即重试，而不是误以为已经落盘

## [2.1.0-alpha.38] — 2026-04-18

- **功能节点重复输入提示已去重** — 之前部分工具在“无输入”时会同时出现蓝色连接引导和黄色 warning，两条都在说“需连接输入”，造成重复提示；现在当 warning 已覆盖缺失输入时，不再额外显示同类蓝色提示
- **功能节点下拉已直接恢复为常规原生样式** — 不再继续折腾节点内/页面级浮层；功能节点中的服务商、模型和参数下拉现统一改回原生 `select`，避免再出现缩放变形、位置错位或边界联动问题
- **功能节点下拉改成“节点内浮层”模式** — 功能节点里的下拉不再使用页面级固定浮层，而是挂到节点本体里的独立覆盖层：既不会把节点高度撑长，也会随节点一起缩放/移动；菜单最大高度会被限制在节点底部以内，超出部分内部滚动
- **下拉浮层现在会跟随画布里的节点一起移动** — 之前为了解耦节点高度，把候选列表改成独立浮层后，只监听了窗口滚动/缩放，没覆盖 React Flow 画布的平移/缩放，导致菜单像“钉在页面上”；现在菜单打开时会持续跟踪锚点位置，随节点一起移动
- **常用模型过滤不再悄悄回退成全量列表** — 之前当常用模型配置为空，或常用模型 ID 没能在当前列表中命中时，功能节点还会兜底把全量模型重新展示出来；现在空配置会继续走默认常用模型逻辑，未命中时也不再直接回退全量列表
- **功能节点下拉菜单不再把节点边界一起撑长** — `SearchableSelect` 的候选列表已从节点内部普通布局改为独立浮层；列表继续保留固定最大高度，超出部分用滚动查看，但不再被功能节点自动高度同步纳入计算
- **功能节点默认常用模型提示改为首帧稳定显示** — 自动常用模型在模型列表尚未返回时，也会先按 provider 预置一组“乐观默认值”，减少重开画布后先无提示、随后再补出“仅显示常用模型”的二次变化
- **功能节点端口圆点裁切修复** — 之前为压住内容溢出，把整个节点外层设成了 `overflow: hidden`，连带把左右通道圆点裁掉半边；现在改为外层允许端口外露、内层表面单独裁切内容，圆点与命中区会完整显示
- **重开画布时开始真正恢复持久化视角** — 之前虽然 `.rsws` 已写入 `viewport`，但 React Flow 初次挂载时常先吃到默认视角，后续加载到真实画布数据时没有再次显式应用持久化视角，导致重开后看起来仍像回到初始页；现在在画布数据就绪后会主动把持久化视角重新打回画布实例
- **关闭/切走画布前会额外冲刷待保存视角状态** — 当画布还有待保存改动时，切标签、隐藏 Webview 或关闭前会尝试立即保存，降低“刚刚平移缩放过，但还没赶上 autosave 就关闭了”导致视角回退的概率
- **功能节点模型提示不再在重开画布后突然后跳** — 之前画布重开时，功能节点会先按“设置 / 模型列表尚未到位”的初态渲染，随后在常用模型与模型列表到达后再补出“仅显示常用模型”提示，导致节点高度二次变化；现改为预留稳定提示高度，减少重开画布后的视觉抖动
- **模型列表请求开始做前端去重并在打开画布后预取** — 画布拿到设置快照后，会对已配置可用的 provider 先做一次后台模型预取；功能节点和设置面板也改为复用统一的请求入口，避免同一 provider 因多个节点同时挂载而被重复请求
- **AIHubMix 的 LLM 默认常用模型再收口为 3 个** — 对 AIHubMix 自定义 provider，未手动配置常用模型时，文本功能节点现在优先只预置 `gemini-3.1-pro-preview`、`gpt-5.4`、`claude-sonnet-4-6`
- **默认热门常用模型继续收口到 6 个文本模型** — 未手动配置常用模型时，内置热门候选现在收口为 GPT / Gemini / Claude 各 2 个；Qwen、DeepSeek 等不再默认塞进文本功能节点下拉
- **热门常用模型匹配逻辑改为按模型家族自动识别** — 不再只靠写死精确 ID；现会优先识别 GPT-5.4 / GPT-5.4 Mini、Gemini 3.1 Pro / Gemini 3 Flash、Claude Sonnet 4.6 / Claude Opus 4.6，并在新 ID、preview 后缀或旧版 fallback 场景下尽量自动命中
- **Anthropic 默认模型更新到 Claude Sonnet 4.6** — 内置 Anthropic provider 的默认模型与静态回退列表已同步到 Claude 4.6 代际；同时补入 4.6 家族的能力提示，避免默认模型仍停留在 4.5
- **AIHubMix 原始流输出保留修复** — 修复 Claude 等经 AIHubMix 走自定义 OpenAI 兼容 provider 时出现“接口成功但输出文件为空”的问题；除标准 `delta.content` 外，现开始兼容 `reasoning_content`、`reasoning_details` 与 `tool_calls`
- **未知流式格式改为优先保留原始 SSE** — 当插件无法识别标准正文输出时，不再静默写出空文件，而是把 reasoning / tool calls / raw SSE chunks 全量保留进输出文件，避免额度浪费，也方便用户反馈真实返回格式
- **AIHubMix 官方 max_output 现在会自动顶满** — 对走 AIHubMix 的自定义 OpenAI 兼容 provider，插件会先查询官方 `Models API` 中该模型的 `max_output`，并把 `max_tokens` 自动设为模型允许的最高值；这也覆盖了 Claude 普通版 / `-think` 变体这类需要显式放开输出上限的场景
- **AIHubMix 上下文窗口改为按官方 `context_length` 自适应** — 聊天类功能节点现在会基于官方模型元数据动态放宽 PDF / Office / 文本提取上限，并按估算 token 预算裁剪输入，不再固定卡死在 `100_000` / `200_000` 字级别
- **新增全局“最大输出 / 最大上下文”设置** — 设置面板与 VSCode 配置现在新增 `researchSpace.ai.maxOutputTokens` / `researchSpace.ai.maxContextTokens`；默认 `0` 表示自动取最大，若用户填写了更小的上限，则按 `min(模型最大值, 设置值)` 生效
- **Provider 预算逻辑扩展到全通道** — 统一预算逻辑已从 AIHubMix 扩展到所有聊天类 provider：Anthropic 会按模型家族启发式给出已知上限，Ollama 会读取本地 `/api/show` 的 `num_ctx` / `model_info`，Copilot 与未知 custom provider 则至少会使用用户配置的上限做输入裁剪，并尝试把输出上限透传给 provider
- **新增“常用模型”管理** — 设置面板现在可为每个 provider 勾选常用模型；设置里的模型管理仍显示完整模型列表，但功能节点默认只显示常用模型，降低超长模型列表的操作负担
- **设置面板拆成主入口 + 二级弹窗** — 原本越滚越长的设置页已改为简洁主面板，详细 provider / 多模态 / 画布 / 宠物配置进入二级弹窗编辑；常用模型也有独立弹窗管理
- **常用模型现支持排序** — 常用模型弹窗中现在可以拖拽排序，也可用上下按钮微调顺序；功能节点中的模型下拉会按该顺序展示
- **文本服务商二级设置再细分为标签页** — LLM 设置弹窗进一步拆成“概览 / 内置服务商 / 自定义服务商”，减少继续堆长列表带来的查找成本
- **画布重新打开时开始恢复上次视角** — 现在会在平移/缩放结束后持久化 `viewport`，再次打开同一画布时优先恢复到上次关闭前的位置；只有没有有效历史视角时才回退到初始 `fitView`
- **函数节点高度同步继续收口** — 针对功能节点在改其它内容后容易出现“运行按钮上方溢出”或“按钮下方留白很多”的问题，调整了最小高度、改进测量方式为更稳定的双帧/真实渲染高度测量，并补充更多触发高度重算的依赖，减少边界漂移
- **默认常用模型开始预置一组热门候选** — 当某个 provider 还没有手动配置常用模型时，插件会按内置 provider / AIHubMix / Ollama 的当前可用模型给出一组默认常用候选，功能节点不再轻易退回显示所有模型
- **旧功能节点自动跟随最新工具定义** — 打开旧画布或收到最新 `toolDefs` 时，历史功能节点现在会自动刷新 `input_schema` 并补齐新增参数默认值；`FunctionNode` 参数渲染也改为优先使用当前工具定义，减少“老节点没更新、新节点正常”的长期不一致问题
- **画布加载迁移改为即时落盘** — 旧画布在打开时若触发节点组 hub 补齐、蓝图尺寸归一化、`summaryGroups → boards`、功能节点 schema 补齐等加载期迁移，现在会立即自动保存，避免“本次会话看起来正常、但磁盘文件其实还没真正升级”的半迁移状态
- **旧蓝图实例开始补齐当前定义** — 蓝图索引刷新后，Webview 现会向宿主补拉对应蓝图定义，并尝试为旧实例补齐缺失的输入/输出占位、内部功能节点、内部数据节点与定义边；同时为实例内部节点补写 `blueprint_source_*` 溯源元数据，给后续更稳定的实例迁移打基础

## [2.1.0-alpha.37] — 2026-04-18

- **蓝图取消语义开始收口** — PipelineToolbar 在取消后不再立刻消失，而是显示“取消中 / 已取消”；蓝图容器会持久化最近一次取消状态
- **最近问题节点可定位** — 蓝图容器开始记录最近问题节点，并支持直接从容器中定位到失败/中断节点
- **新增 v2.0 主线总控待办** — 仓库根目录新增 `待办清单.md`，统一维护 v2.0 主线、蓝图子线与阶段计划完成情况

## [2.1.0-alpha.36] — 2026-04-18

- **ESLint 9 flat config 补齐** — 新增根目录 `eslint.config.cjs`，恢复 `npm run lint` 可执行
- **清理无效 lint 注释** — 移除历史遗留的无效 `eslint-disable` 注释，减少 lint 噪音，便于继续推进蓝图主线改造

## [2.1.0-alpha.34] — 2026-04-17

- **AI 工具警告文案统一** — 节点内黄色 warning banner 统一改为更短、更一致的“需…”语气，减少不同工具之间提示风格跳变
- **README / 规划清单同步到当前实现** — 文档已补充 Doubao 图像生成/编辑、多图融合、组图输出、节点内警告提示、多模态输出模型标签，以及新增的 AIHubMix 默认模型配置项

## [2.1.0-alpha.33] — 2026-04-17

- **AI 工具警告提示统一覆盖** — FunctionNode 现按统一规则为各类 AI 工具给出前置警告：文本工具缺少必需输入、Chat 缺少 Prompt、RAG 缺少问题、图像生成缺少描述、图像编辑缺少图像或提示词、多图融合缺少图像或指令、视频生成缺少描述、TTS/STT 缺少正确输入类型等，尽量把问题前置到节点内提示，而不是等运行时报错

## [2.1.0-alpha.32] — 2026-04-17

- **多模态输出节点补齐模型标签** — 图像 / 音频 / 视频 / 转录等经 AIHubMix 生成的输出节点现在都会写入 `ai_provider / ai_model` 元数据，并在节点头部显示与文本类输出一致的服务商 / 模型 badge
- **组图输出补齐前置输入警告** — 组图输出节点在既没有连接文本节点、也没有填写组图描述参数时，会直接在节点内给出缺失警告，减少“点运行才报错”的无效尝试

## [2.1.0-alpha.31] — 2026-04-17

- **图像类参数面板按模型能力动态收口** — 图像生成 / 图像编辑节点现在会根据当前实际生效的模型自动隐藏不适用参数：Gemini 不再显示 Doubao 专属的 `size / watermark / web_search`，Doubao 也不再显示 Gemini 专属的 `aspect_ratio`
- **图像生成提示改为强制文本节点输入语义** — 对普通图像生成节点，界面提示改为明确要求连接文本节点提供描述，只把下方参数保留给模型、风格和输出控制，减少把参数区误当主提示词输入区的歧义

## [2.1.0-alpha.30] — 2026-04-17

- **图像编辑改回“图像 + 文本节点”输入模式** — 移除图像编辑节点内部的“编辑指令”参数，运行时改为读取连接进来的文本节点内容作为编辑提示词；节点也会在只连了图像、没连文本时给出明确警告
- **Doubao 图像尺寸参数改为合法格式** — Doubao 图像生成 / 图像编辑 / 多图融合 / 组图输出统一改用接口实际接受的 `2k / 3k / 宽x高` 格式；对旧画布中残留的 `1K / 2K` 也会在运行时自动归一化，避免再触发 `size is not valid` 的 400

## [2.1.0-alpha.29] — 2026-04-17

- **图像生成 / 图像编辑补入 Doubao Seedream 5.0 Lite** — AIHubMix 多模态设置与节点模型下拉中新增 `doubao-seedream-5.0-lite`；现有图像生成 / 图像编辑节点会按 Doubao `predictions` 接口直接走文生图 / 图生图
- **新增多图融合与组图输出工具** — 画布里新增「多图融合」与「组图输出」两个 AI 工具，并补充各自独立默认模型设置；多图融合要求至少连接 2 张图像，组图输出支持一次回填多张连贯图
- **FunctionNode 高度同步改为内容尺寸驱动** — 节点高度不再只依赖少量状态切换触发重算，而是由 `ResizeObserver` 直接驱动内容区测量与外框同步，修复聊天 / 多模态参数区再次出现的边界框溢出回归

## [2.1.0-alpha.28] — 2026-04-17

- **暂存架删除不再误删工作区文件** — 从文件夹拖入暂存架的外部文件节点，现在点击 `✕` 只会从暂存架移除，不会再删除工作区里的真实文件
- **新建笔记 / 实验 / 任务改为“落画布时落盘”** — 这三类节点在暂存架阶段只保留草稿标题和初始内容，不会提前创建实体 `.md` 文件；只有真正拖到画布后才会在 `notes/` 下生成文件
- **暂存架草稿物化链路补齐** — Webview 在放置草稿节点时会请求宿主创建文件，创建成功后再把节点正式提交到画布；物化过程中暂存架条目会显示“创建中…”，避免重复点击或半状态删除

## [2.1.0-alpha.27] — 2026-04-17

- **蓝图实例运行入口接通首轮闭环** — 正式蓝图容器上的 `▶ 运行` 按钮已可用；运行前会先校验必填输入，缺失时直接阻止执行并给出明确报错
- **蓝图执行计划改为实例内闭包** — 蓝图运行不再沿整张画布盲目扩散，而是只对当前实例内部功能节点构建拓扑计划；多头蓝图也会在同一轮内按层执行
- **中间产物开始就地更新** — 实例内部功能节点如果本来指向蓝图内部中间数据节点，运行结果会优先替换该内部节点并重绑后续边，而不是继续在容器外额外堆一个输出卡片
- **实例外 Pipeline 上游显式拦截** — 当前首轮闭环仍不支持“实例外功能节点 → 实例内功能节点”的 Pipeline 依赖；运行前会显式阻止，避免半执行状态混入主线
- **执行控制继续复用现有 Pipeline 工具栏** — 蓝图实例运行仍走统一的 Pipeline 进度、暂停、继续、取消链路，避免为蓝图另起一套执行状态机

## [2.1.0-alpha.22] — 2026-04-17

- **通道从箭头改回圆点** — 取消节点边缘箭头通道，恢复为更克制的圆点句柄，避免通道本身过度抢视觉
- **圆点接近反馈增强** — 通道保留更大的不可见命中区，鼠标靠近时圆点会高亮并做呼吸式闪烁，更容易发现可连线入口
- **悬停提示输入 / 输出语义** — 通道悬停时会弹出“输入通道 / 输出通道”提示，帮助用户在不依赖箭头形状的情况下理解当前句柄职责

## [2.1.0-alpha.21] — 2026-04-17

- **通道箭头改为更醒目的头部比例** — 在统一向右的小箭头基础上，进一步放大箭头头部占比，并增强边缘对比与 hover 光感，让通道在节点边缘更容易被一眼识别

## [2.1.0-alpha.20] — 2026-04-17

- **通道箭头继续瘦身** — 进一步缩短并收窄箭头尾部，同时把箭头头部做得更尖，让通道更接近流程图里的“小箭头”观感

## [2.1.0-alpha.19] — 2026-04-17

- **通道箭头方向统一为向右** — 按当前画布工作流“从左向右推进”的视觉语义，左右两侧通道现都统一使用向右箭头，避免输入侧再出现反向箭头打断阅读方向
- **箭头尾部进一步收窄缩短** — 继续回修上一版箭头仍显得偏厚、偏长的问题，让通道更接近简洁的流程箭头而不是粗块状标记

## [2.1.0-alpha.18] — 2026-04-17

- **箭头通道视觉改为更明确的实体箭头** — 修正上一版通道看起来更像矩形块的问题，左右通道现直接使用更明显的左箭头 / 右箭头轮廓，方向感更强
- **右键菜单关闭判定改为“菜单内点击不抢先关闭”** — 修复菜单关闭监听过于激进，导致在右键菜单里点击条目时先被全局关闭逻辑打断的问题；现在会先执行菜单项，再按既有动作自然关闭
- **保留外部点击 / 继续右键 / 画布滚动自动收口** — 菜单内部点击不会误杀，但点击外部、对其他元素再次右键、或滚动画布时仍会自动关闭，维持单菜单收口行为

## [2.1.0-alpha.17] — 2026-04-17

- **节点通道改为箭头语义** — 数据节点、功能节点、节点组与蓝图实例的左右通道统一改成箭头形态，直接提示“左侧输入 / 右侧输出”的方向约束，降低误把输出接回输入侧导致流程失败的低级操作成本
- **连接线选中反馈显著增强** — 普通数据流连线与 Pipeline 连线在左键或右键选中后都会显示更强的高亮描边与光晕，方便用户明确当前真正选中了哪一条边
- **连接线补齐右键删除** — 现在右键普通连线或 Pipeline 连线会先选中并高亮该线，再弹出删除菜单，不需要只靠键盘 Delete 才能移除边
- **上下文菜单改为跟随画布元素移动** — 节点、蓝图、节点组与画板的右键菜单不再固定在屏幕视口，而是锚定到画布元素本身；平移画布时菜单会跟随元素一起移动
- **同一时刻只保留一个右键菜单** — 新的上下文菜单关闭机制会在继续点击、右键其他元素、滚动画布或开始拖拽时自动收口旧菜单，避免多个菜单同时残留
- **右键即选中并高亮目标元素** — 节点、节点组、蓝图、画板和连接线在右键打开菜单前都会先进入高亮选中状态，减少“菜单开了但不知道当前操作对象是谁”的交互歧义

## [2.1.0-alpha.16] — 2026-04-17

- **蓝图实例化开始按完整定义恢复真实结构** — 从蓝图库点击或拖拽蓝图到画布时，宿主现在会先读取完整 `*.blueprint.json`，再在画布中恢复功能节点、内部数据节点、输入占位节点、输出占位节点与内部边，而不再只靠索引摘要生成单个蓝图卡片
- **蓝图实例外层改为边界框包裹真实节点** — 首轮结构化实例会自动创建一个带蓝图标题的外部边界框，把恢复出来的节点整体包住，朝“蓝图就是可复用 Pipeline 模板”而不是摘要容器继续推进
- **输入 / 输出占位节点获得最小可见样式** — 占位节点现会带蓝图颜色、虚线边框和“输入占位 / 输出占位”标识，方便区分真实节点与占位节点

## [2.1.0-alpha.15] — 2026-04-17

- **蓝图定义开始保留原始 pipeline 结构信息** — 蓝图 JSON 现在新增内部数据节点定义与更明确的占位语义，不再只保存输入/输出数量与功能节点摘要，为后续“实例化时恢复原始结构”铺路
- **输入 / 输出占位语义进入蓝图草稿层** — 输入槽位和最终输出槽位现在会记录占位样式、绑定提示与替换策略，创建阶段就开始服务后续“拖入即替换 / 连线即绑定”的实例交互目标
- **创建对话框开始展示保留节点与占位意图** — 蓝图创建弹窗现在会额外显示保留的内部数据节点，并明确提示哪些对象未来会作为占位框出现，避免继续把蓝图理解成摘要容器

## [2.1.0-alpha.14] — 2026-04-17

- **蓝图实例首帧尺寸也会按新规范归一化** — `initCanvas()` 现会先按蓝图节点自身保存的输入/输出统计字段修正旧实例尺寸，不再依赖 `blueprintIndex` 回来后才把旧卡片拉大
- **蓝图重载修复继续前置到初始化阶段** — 即使蓝图库索引因为时序或刷新延迟稍晚到达，旧蓝图实例在画布首轮加载时也不会先以过小边界渲染一版再跳变
- **阶段定位仍然保持在 Phase C** — 这一轮仍然是蓝图实例加载一致性修复，未开始 Phase D 的执行编排实现

## [2.1.0-alpha.13] — 2026-04-17

- **旧蓝图实例在重载时会自动迁移到新容器结构** — 画布重新打开并收到 `blueprintIndex` 后，现有蓝图节点会按最新蓝图定义回填输入/输出槽位、统计信息和容器尺寸，不再只让新创建实例使用新布局
- **蓝图实例尺寸与槽位元数据统一收口** — 新建实例和重载迁移改为复用同一套蓝图元数据构造逻辑，避免出现“摘要计数已更新但输出槽位列表仍是旧的”这种半同步状态
- **阶段定位仍然保持在 Phase C** — 这一轮仍然是在修复蓝图实例加载与显示一致性，还没有进入 Phase D 的执行编排升级

## [2.1.0-alpha.12] — 2026-04-17

- **蓝图实例补齐输出槽位展示** — 实例容器右侧现会显示蓝图定义中的输出槽位，并同步渲染对应的右侧输出通道，为后续 Phase D 的执行回填预留统一容器语义
- **实例级输入校验态进入容器本身** — 蓝图实例中间栏新增输入校验状态，会直接显示“可运行”或“缺少 N 个必填输入”，把实例是否满足运行前提明确挂回容器
- **蓝图实例布局升级为三栏结构** — 容器改为“输入槽位 | 实例状态/摘要 | 输出槽位”三栏布局，尺寸计算也会同时考虑输入侧和输出侧内容，不再只按输入槽位估算
- **阶段定位继续保持在 Phase C** — 这一轮仍然只是在补蓝图实例的加载与可见状态，不涉及执行计划和蓝图运行闭环

## [2.1.0-alpha.11] — 2026-04-17

- **蓝图实例边界改为按内容自适应** — 蓝图实例化时不再沿用过小的固定尺寸，容器宽高现在会按输入槽位数量和摘要区布局计算，避免首轮实例卡片一加载就出现内容溢出
- **实例摘要改为双列栅格** — 蓝图卡片右侧的输入 / 中间 / 输出 / 功能节点统计改成 2×2 布局，减少纵向堆叠导致的高度压力
- **蓝图文件路径区域回收到底部** — 路径显示仍保留，但会在更宽的容器里自然换行，减少实例加载后第一屏就被路径文本挤爆的情况

## [2.1.0-alpha.10] — 2026-04-17

- **蓝图实例输入槽位接入真实连线** — 蓝图容器节点不再只是静态摘要卡片，现会把蓝图定义中的输入槽位渲染为真实 `Handle`；数据节点可直接像连接功能节点一样连接到蓝图实例输入槽位
- **槽位绑定状态回收到实例容器** — 蓝图实例会在卡片上显示每个输入槽位当前已绑定数量、必填状态与单/多输入约束，实例级状态不再需要另存一套绑定表
- **蓝图输入绑定继续复用现有边模型** — 绑定关系仍然落在现有 `data_flow` 边上，通过 `targetHandle/role` 指向蓝图输入槽位，避免为了蓝图实例再分叉一套专用连接语义
- **蓝图槽位标签进入边展示链路** — 连到蓝图实例的边会沿用现有边标签显示逻辑，并优先显示蓝图输入槽位标题，而不是只露出内部 slot id

## [2.1.0-alpha.9] — 2026-04-17

- **蓝图库最小入口接入左侧工具面板** — `AiToolsPanel` 现会显示当前工作区蓝图库索引，支持查看、拖拽和点击 `+` 直接实例化蓝图
- **蓝图实例容器节点首轮落地** — 新增 `blueprint` 节点类型与 `BlueprintContainerNode`，蓝图现在可以作为独立实例对象回到画布，而不是停留在文件层
- **实例化继续复用现有节点引擎语义** — 蓝图实例目前以单节点容器卡片呈现，保持与现有画布节点相同的拖拽、选中、持久化链路，不另起一套 overlay 交互层
- **蓝图库索引补齐结构摘要** — 注册表条目现在包含输入槽位、中间槽位、输出槽位和功能节点数量，实例容器可直接展示蓝图定义的基本规模

## [2.1.0-alpha.8] — 2026-04-17

- **蓝图创建对话框进入可编辑阶段** — `CreateBlueprintDialog` 不再只是只读预览，现可修改蓝图名称、颜色、描述以及输入/中间/输出槽位的名称、必填状态和多输入开关
- **蓝图落盘链路接通** — 新增 `blueprint-registry.ts`，蓝图现可保存到工作区 `blueprints/` 目录下的 `*.blueprint.json` 文件，并在重名时明确阻止覆盖
- **最小蓝图库索引回传** — Extension Host 在画布打开、`ready` 和蓝图文件变化时都会回传 `blueprintIndex`，为后续蓝图库面板和实例化入口提供基础数据
- **保存后自动收口当前草稿** — 蓝图保存成功后，当前创建对话框会自动关闭并刷新索引；蓝图创建流程从“预览草稿”推进到“草稿 → 保存文件”闭环

## [2.1.0-alpha.7] — 2026-04-17

- **蓝图草稿定义首轮落地** — 新增 `src/blueprint/blueprint-types.ts` 与 `blueprint-builder.ts`，冻结首版蓝图草稿结构：输入槽位 / 中间槽位 / 输出槽位 / 功能节点 / 边 / 元数据不再靠 UI 临时猜测
- **多选工具栏接入“创建蓝图”入口** — 选中包含功能节点的一段工作流后，可直接从 SelectionToolbar 触发 `createBlueprintDraft`
- **蓝图草稿宿主链路接通** — Extension Host 新增 `createBlueprintDraft` 消息处理，按当前选区与当前画布快照生成结构化蓝图草稿并回传 Webview
- **蓝图草稿预览对话框** — Webview 首轮接入蓝图草稿预览弹窗，可直接查看识别出的输入槽位、中间/输出槽位、功能节点与边结构
- **首版保持严格选区模式** — 当前若选中的功能节点仍依赖未选中的上游，或选区里直接包含 `group_hub`，会明确报错而不是静默猜测，避免把隐藏依赖带进蓝图定义

## [2.1.0-alpha.6] — 2026-04-17

- **文档提取跨平台 fallback 收口** — OOXML / OpenDocument / EPUB 的文本提取改为优先走内置 zip 解析，不再依赖系统 `unzip`；`rtf` 增加纯文本 fallback；`doc/dot` 在非 macOS 或 `textutil` 不可用时回退到 legacy 文本抽取；`xls/ppt/xlt/pps/pot` 的 best-effort 文本提取改为内置实现，不再依赖系统 `strings`

## [2.1.0-alpha.5] — 2026-04-17

- **Office 模板 / 放映变体继续补齐** — 新增 `dot` / `dotx` / `dotm`、`xlt` / `xltx` / `xltm`、`pps` / `ppsx` / `ppsm`、`pot` / `potx` / `potm` 导入支持；对应 Note / Data 节点映射、Explorer 右键入口、文件监听和 fallback 识别已同步扩展
- **Flat OpenDocument 首轮接入** — 新增 `fodt` / `fods` / `fodp` 支持：直接读取 XML 文本，不再只覆盖 zip 版 `odt/ods/odp`
- **提取链路继续复用同类实现** — `dotx/dotm` 复用 Word OOXML 提取，`ppsx/ppsm/potx/potm` 复用 PowerPoint OOXML 提取，`xltx/xltm` 复用 Excel OOXML 提取；`dot` 走 `textutil`，`xlt/pps/pot` 继续走 legacy best-effort 文本抽取

## [2.1.0-alpha.4] — 2026-04-17

- **老 Office 格式首轮接入** — 新增 `doc` / `xls` / `ppt` 导入支持，不再只覆盖新 Office；其中 `doc` 归入 Note，`xls` 归入 Data，`ppt` 归入 Note
- **第二批文档格式补齐** — 继续补入 `docm` / `xlsm` / `pptm`、`rtf`、`odt` / `ods` / `odp`、`epub`；对应导入入口、文件监听和 fallback 映射已同步扩展
- **提取策略分层** — `doc/rtf` 优先走 macOS `textutil`，`docx/xlsx/pptx/docm/xlsm/pptm` 走 OOXML 解包，`odt/ods/odp/epub` 走 zip/XML/HTML 首轮提取，`xls/ppt` 走 best-effort 文本提取；当前目标是“可导入、可预览、可喂给 AI”，不是版式保真

## [2.1.0-alpha.3] — 2026-04-17

- **Office 文件首轮接入** — 新增 `docx` / `pptx` / `xlsx` 导入支持：Word 与 PowerPoint 会进入 Note 节点，Excel 会进入 Data 节点，不再只能卡在资源管理器里导不进画布
- **OOXML 文本提取链路补齐** — Extension Host 对 `docx` / `pptx` / `xlsx` 增加首轮解包提取：`docx` 读取正文/页眉页脚文本，`pptx` 提取各页 slide 文本，`xlsx` 提取工作表单元格内容并转成制表文本，支持卡片预览、全文请求与 AI 输入
- **说明与限制显式化** — 这一轮先支持现代 OOXML（`docx/xlsx/pptx`），暂不覆盖旧二进制 `doc/xls/ppt`；Office 提取目前属于“基础可读文本”级别，不等同于完整版式保真解析

## [2.1.0-alpha.2] — 2026-04-17

- **主流文件导入范围扩充** — 新增一批更常见的文本/代码/媒体格式映射：`markdown` / `mdown` / `mkd` / `rst` / `adoc`，`mjs` / `cjs` / `mts` / `cts` / `h` / `hpp` / `php` / `lua` / `ps1` / `vue` / `svelte` / `astro` / `ipynb` / `jsonl` / `ndjson` 等现在都可直接加入画布
- **图片/音视频格式补齐** — Image 节点补充 `svg` / `bmp` / `avif` / `ico`，Audio 节点补充 `ogg` / `oga`，Video 节点补充 `m4v`，减少“常见文件拖不进来”的割裂感
- **导入入口与文件监听同步放宽** — Explorer「Add to Canvas」菜单匹配范围、宿主文件监听 glob、硬编码后备映射与语言识别表已同步更新，避免“能识别但右键没有入口”或“导入后文件变化不刷新”的半支持状态

## [2.1.0-alpha.1] — 2026-04-17

- **收口版执行计划统一** — 单节点运行、批量运行与 Pipeline 运行进一步共享同一套 `execution-plan` 语义，Hub 展开、输入顺序、数据流 / 管道流依赖和下游注入不再各走各路
- **执行错误可见性补齐** — 功能节点与 Pipeline 工具栏现在统一展示 `missing_input` / `missing_config` / `run_failed` / `skipped` 等结构化问题，减少“节点没跑但看不出来为什么”的假状态
- **节点容器视觉统一** — 数据节点、功能节点、节点组统一了边框粗细、hover/selected 反馈、标题字号与端口外观，节点组更明确呈现为收口容器而不是另一张文件卡片
- **首屏加载观察面建立** — 大画布加载期间新增节点数、媒体请求数、全文请求数、组边界重算次数、首轮渲染时间等观察信息，后续性能问题不再只能靠主观卡顿感猜
- **高频更新源第一轮收口** — 搜索输入增加 debounce，媒体 URI / 节点预览改为按帧批量回填，相同内容不再重复写入 store，降低大画布和流式更新时的无效重渲染
- **加载提示关闭条件更真实** — 首屏 loading notice 现在会等待首轮渲染就绪、媒体恢复和关键全文补载完成，而不再只因为初始 JSON 到达就过早消失

## [2.0.0-alpha.14] — 2026-04-16

- **版本与发布资料统一到 alpha.14** — `package.json`、README、CHANGELOG 与 GitHub Release Note 全部同步到 `v2.0.0-alpha.14`，避免安装包、仓库说明与发布页文案出现版本错位
- **节点卡片全文态改为尺寸驱动按需补载** — 文本类节点不再只能通过“预览”弹窗拿到全文；当节点首次被拉伸到足够尺寸时，会自动请求全文内容，减少“信息像丢了”的交互错觉
- **节点展示态写回画布数据** — 新增卡片内容展示模式元数据，重新打开画布时可恢复节点上次关闭前的摘要态 / 全文态，而不是统一退回固定摘要
- **全文缓存与摘要态切换回归一致** — 修复节点已经加载过全文后，缩回摘要态仍继续显示全文缓存的问题；卡片正文现在严格跟随节点自己的展示模式
- **继续保持 alpha 预览警告** — 发布说明继续明确标注该版本稳定性弱于 `v1.2.2`，仅建议在备份后的副本工作区中试用

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
