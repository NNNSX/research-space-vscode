# Research Space

在 VSCode 里用可视化画布管理研究工作流，AI 一键分析文献、笔记和代码。

---

## 核心理念

**工作区即研究空间，文件即素材，画布是工作流编排工具。**

打开任意文件夹，该文件夹就是你的研究工作区。把 PDF、图片、代码、笔记拖入画布成为数据节点，从工具箱拉出 AI 功能节点连线，点击运行，AI 自动处理并在画布上生成输出节点。

插件不改变你的文件结构，不引入额外概念，最大程度复用 VSCode 原生能力。

---

## 快速上手

1. 打开任意文件夹（`File > Open Folder`）
2. 点击左侧活动栏的 **Research Space** 图标，点击 **+ New Canvas** 新建画布
3. 在 Explorer 中右键任意 PDF / Markdown / 代码文件，选择 **Add to Canvas**
4. 从左侧工具箱**拖出**一个 AI 功能节点到画布（拖至画布任意位置落下，经暂存架中转）
5. 将数据节点连线到功能节点（从数据节点右侧箭头通道拖向功能节点左侧箭头通道）
6. 点击功能节点的 **▶ Run** 按钮，等待 AI 生成输出
7. 顶栏会显示当前保存状态；支持自动保存、`Ctrl/Cmd+S` 和「💾 保存」按钮手动立即保存，未保存 / 保存中 / 保存失败时保存按钮也会高亮提醒

---

## 节点类型

### 数据节点

| 图标 | 类型 | 来源文件 | 双击行为 |
|------|------|---------|---------|
| 📄 | Paper | `.pdf` | 系统 PDF 阅读器 |
| 📝 | Note | `.md` `.markdown` `.txt` `.rst` `.adoc` `.doc/.dot/.docx/.docm/.dotx/.dotm` `.ppt/.pps/.pot/.pptx/.pptm/.ppsx/.ppsm/.potx/.potm` `.rtf` `.odt/.fodt` `.odp/.fodp` `.epub` 等 | VSCode 编辑器 |
| `</>` | Code | `.py` `.js` `.ts` `.vue` `.svelte` `.php` `.ipynb` 等 | VSCode 编辑器（语法高亮） |
| 🖼 | Image | `.png` `.jpg` `.gif` `.webp` `.svg` `.bmp` `.avif` 等 | VSCode 图片预览 |
| 🤖 | AI Output | `.md`（在 `outputs/`） | VSCode 编辑器 |
| 🎵 | Audio | `.mp3` `.wav` `.ogg` `.m4a` `.flac` 等 | 系统播放器 |
| 🎬 | Video | `.mp4` `.mov` `.m4v` | 系统播放器 |
| 📊 | Data | `.csv` `.tsv` `.xls/.xlt/.xlsx/.xlsm/.xltx/.xltm` `.ods/.fods` | VSCode 编辑器（表格预览） |
| 🧪 | Experiment Log | `.md`（在 `notes/`） | 内联编辑（自动同步文件） |
| ✅ | Task | `.md`（在 `notes/`） | 内联编辑（自动同步文件） |

### 功能节点（AI 工具）

| 工具 | 说明 | 主要参数 |
|------|------|---------|
| **Summarize** 摘要 | 生成结构化摘要，支持图片多模态 | 语言、风格、关注点、最大字数 |
| **Polish** 润色 | 对文本进行学术润色 | 力度（轻/中/重）、语言 |
| **Review** 审稿 | 模拟审稿人视角输出评分和意见 | 严格度、语言 |
| **Translate** 翻译 | 学术翻译，附专业术语对照 | 源语言、目标语言、领域 |
| **Literature Review** 文献综述 | 批量综合多篇论文，对比分析 | 综述方向 |
| **Outline Gen** 大纲生成 | 从笔记/草稿生成论文大纲 | 大纲风格（研究论文/学位论文/报告） |
| **Draw** 绘图 | 根据描述生成 Mermaid 图表 | 图表类型 |
| **RAG Chat** 检索问答 | 基于工作区文件回答问题，引用来源 | 问题、检索数量 |
| **Chat** 自由对话 | 自定义提示词，`@ref` 引用文件 | 自定义提示词 |
| **Meeting Transcribe** 会议转录 ✨ | Whisper 会议录音转文字（需 AIHubMix Key） | 语言 |
| **Action Items** 行动项 | 从会议记录提取行动项（谁/做什么/何时） | 输出格式 |
| **图像生成** ✨ | Gemini / Doubao 文生图（需 AIHubMix Key） | 模型、风格提示、比例/尺寸、水印 |
| **文字转语音** ✨ | 将文本转换为音频（需 AIHubMix Key） | 模型、声音、格式 |
| **语音转文字** ✨ | Whisper 音频转录（需 AIHubMix Key） | 模型、语言、任务 |
| **视频生成** ✨ | Doubao Seedance 文字生成视频（需 AIHubMix Key） | 模型、时长、分辨率 |
| **图像编辑** ✨ | Gemini / Doubao 图像编辑（需连接图片节点 + 文本提示词节点）| 模型、比例/尺寸、水印 |
| **多图融合** ✨ | Doubao 多图融合（需至少 2 张图 + 融合指令） | 模型、融合指令、尺寸、水印 |
| **组图输出** ✨ | Doubao 一次生成多张连贯组图 | 模型、组图描述、输出张数、尺寸、水印 |
| **图生视频** ✨ | Doubao Seedance 图像转视频（需连接图片节点）| 模型、时长、分辨率 |

---

## AI Provider 配置

插件支持四种内置 AI Provider，按优先级自动降级：

**GitHub Copilot**（零配置，推荐）
- 需要 VSCode 中已安装并登录 GitHub Copilot
- 在功能节点上可选择具体模型（GPT-4o、Claude Sonnet 等）

**Anthropic**（需 API Key）
- 在 VSCode 设置中填入 `researchSpace.ai.anthropicApiKey`
- 支持 claude-opus-4-6 / claude-sonnet-4-6 / claude-haiku-4-5
- 模型列表自动从 API 拉取

**Ollama**（本地模型，完全离线）
- 需本地运行 [Ollama](https://ollama.com)，默认地址 `http://localhost:11434`
- 可用模型列表自动从本地实例同步
- 图片输入需要多模态模型（如 qwen2-vl、llava、gemma3、llama3.2-vision）；非视觉模型会弹出警告提示

**oMLX**（本地 OpenAI 兼容）
- 需本地运行 [oMLX](https://github.com/jundot/omlx)，默认地址 `http://localhost:11433/v1`
- 可用模型列表自动从本地实例的 `/v1/models` 同步
- 聊天推理通过 `/v1/chat/completions` 执行
- 如本地未启用鉴权，API Key 可留空

**自定义 OpenAI 兼容 Provider**（如 AIHubMix）
- 可在设置面板里追加 Base URL + API Key + 默认模型
- AIHubMix 会额外读取官方 Models API 的 `max_output / context_length`，自动收口输出与上下文预算
- 当 AIHubMix 返回 `insufficient_user_quota` 时，节点内现在会直接提示“额度不足”，不再把整段原始 JSON 错误直接抛给用户

### Per-node 覆盖

每个功能节点可独立设置：
- **Provider**：覆盖全局设置，指定节点使用的 AI 提供商
- **Model**：在所选 Provider 下选择具体模型
- **System Prompt**：查看并修改该工具的系统提示词，支持 Reset 恢复默认

---

## 工具栏说明

| 按钮 | 功能 |
|------|------|
| **+ Files** | 从工作区选择文件，添加到**暂存架** |
| **+ Note** | 新建 Markdown 笔记草稿到**暂存架**；只有真正放到画布时才会创建 `notes/` 下的实体文件 |
| **🧪 实验** | 新建实验记录草稿到暂存架；只有放到画布时才会落盘为 `.md` 文件 |
| **✅ 任务** | 新建任务清单草稿到暂存架；只有放到画布时才会落盘为 `.md` 文件 |
| **⚡ AI Tools** | 展开/收起左侧工具箱；工具支持拖拽添加，也可点击「**+ 新建节点**」通过可视化表单创建功能节点 |
| **⚙ Settings** | 打开内嵌设置面板，配置 AI Provider |

**暂存架**：悬浮在画布右下角，新增节点先汇聚于此，从暂存架拖动节点到画布中精确摆放。暂存架可自由拖动位置。来自工作区的外部文件从暂存架移除时**不会删除源文件**；而画布内新建的笔记 / 实验 / 任务现在会先以草稿形态停留在暂存架中，只有真正落到画布时才创建实体文件。

**MiniMap**：右下角小地图支持拖动和缩放，可快速定位画布任意区域。

**设置面板**：右侧滑出，按 Provider 分组展示配置项（API Key、Default Model、Base URL），输入后实时保存到 VSCode 用户设置，无需重启。Copilot 模型区分标准/Pro，功能节点模型下拉标注 `(Pro)` 提示。

**宠物空间小游戏**：宠物漫游窗和对话窗右上角现在都带有 `🎮` 入口，先进入小游戏面板，再选择贪吃蛇、2048、数独或像素鸟开始；方向键、`W/A/S/D`、空格等按键会按游戏类型生效，得分会给宠物增加少量经验。小游戏面板会把**游戏入口和该游戏自己的最近分数 / 今日最佳 / 历史最佳 / 最近一次**合并到同一卡片里，中途退出时也会保留当前分数；列表区域支持滚动查看，关闭游戏后宠物窗口会恢复到进入前的位置。最近几轮已删掉冗长游戏简介、为贪吃蛇补上轻松 / 标准 / 挑战三档难度与差异化得分权重，并把难度选择收回到游戏界面内，而不再占用游戏列表页；同时上调了小游戏面板外框高度，避免局内内容继续挤压混叠。当前进入贪吃蛇后会先停在待开始状态，不再显示额外按钮，而是直接提示“按任意方向键 / WASD 开始”；贪吃蛇食物现在会从空白格里随机刷新，不再反复卡在固定角落。数独提供入门 / 标准 / 挑战三档难度，并已收掉额外数字按钮，只保留“点击格子选中 + 键盘输入”这条主交互，同时压缩面板信息区并允许内容区纵向滚动，减少界面再次溢出被裁；2048 去掉整板闪烁，改为更克制的滑动位移动效；像素鸟则新增轻松 / 标准 / 挑战三档难度，支持空格 / `↑` / `W` 拍翅起飞，穿过管道即可累计积分并写回长期统计。 小游戏面板高度也改为按当前游戏视图分别适配，不再强行共用一套固定高度，减少数独、贪吃蛇等界面再次出现内容挤压和重叠。 同时重新拉开了贪吃蛇与像素鸟的难度速度差，并把“按 xx 开始”的提示改成绝对覆盖层，避免开始后提示消失时把局内内容重新挤动。

**右键菜单**：右键任意节点（数据/功能/蓝图）、节点组、画板或连接线都会先给对应元素高亮选中，再弹出上下文菜单。普通节点支持**打开文件**、**重命名**（笔记节点）、**复制节点**、**从画布删除**；连接线也支持右键直接删除。

**输入警告提示**：AI 功能节点会在运行前直接在节点内显示黄色警告条，尽量提前提示缺失输入，例如：Chat 缺少 Prompt、RAG 缺少问题、图像编辑缺少参考图或文本提示词、TTS/STT 缺少正确输入类型、多图融合缺少第二张图等。

**节点输入框编辑体验**：已补上功能节点 Chat / RAG / 自定义 Prompt / 参数输入框的鼠标拖拽选区保护，支持直接用鼠标框选大段文本后复制、删除或改写；同时同步检查并补齐任务节点、实验记录节点、节点重命名菜单/弹窗里的输入框保护，避免再次被画布拖拽抢走选区。

**模型标签统一**：所有 AI 输出节点（文本 / 图像 / 音频 / 视频 / 转录）现在都会在节点头部显示服务商与模型标签，方便回看产物来源。

**箭头通道与连线高亮**：节点左右通道现已统一改为箭头样式，用来明确“左入右出”的方向语义，降低把文件节点左侧错误接到功能节点右侧这类低级误连线概率；普通数据流连线与 Pipeline 连线在左键或右键选中后都会明显高亮，方便确认当前操作对象。

键盘快捷键：
- 选中节点后按 `Delete` 或 `Backspace` 删除
- `Ctrl+Z` / `Cmd+Z` 撤销；`Ctrl+Shift+Z` / `Cmd+Shift+Z` 重做
- `Ctrl+F` 打开画布搜索（标题 + 内容预览）
- `Ctrl+A` 全选节点；`Ctrl+D` 复制选中节点
- `Ctrl+Enter` 运行第一个选中的功能节点
- `Ctrl+Shift+Enter` 运行选中范围内的 Pipeline 头节点
- `Ctrl+0` 适配视图

**画布搜索**：输入关键词后，匹配节点高亮，非匹配节点自动变淡；按 Enter / Shift+Enter 在匹配项间跳转，ESC 关闭并恢复。

**节点组（Node Group）**：选中 2 个及以上数据节点后可在浮动工具栏点击「📦 创建节点组」。节点组现在以原生 `group_hub` 节点实现：组框支持折叠/展开、重命名、删除和整组拖拽，左右双箭头通道与普通节点一致；默认保持透明底，只保留标题栏、轮廓线、选中反馈与通道，避免误看成另一张文件卡片；组内成员会通过隐藏的 `hub_member` 边汇聚到 hub，因此对外只需要一根可见连线，就能稳定表示“这一批节点作为一个整体输入/输出”。

**蓝图创建**：选中一段包含功能节点的工作流后，可在多选工具栏点击「🔧 创建蓝图」。当前会基于选区生成结构化蓝图草稿，并弹出创建对话框：除了修改蓝图名称、颜色、描述和槽位基础属性外，还会开始显示哪些节点将作为输入/输出占位，哪些数据节点会作为内部结构保留；如果选区仍依赖未选中的上游节点，或直接包含 `group_hub`，会明确提示并阻止创建，避免把隐藏依赖静默带进蓝图定义。

**蓝图库与蓝图实例**：左侧 AI 工具面板现在会显示当前工作区的蓝图库。你可以把某个蓝图拖到画布上，或直接点击 `+` 把它实例化回画布。当前实例化已经开始按完整蓝图定义恢复功能节点、内部数据节点、输入占位节点、输出占位节点，并生成正式的蓝图实例容器节点；这个容器会接管标题、实例状态、输入校验和运行入口，而不再继续复用普通 Board 壳。输入占位现在统一收口为“直接连线传递”；输出则会在运行后优先回填到对应槽位位置。右键蓝图实例标题栏，还可以直接把当前实例结构回灌成新的蓝图草稿，用来做模板分支演化。点击容器上的 `▶ 运行` 后，会先校验必填输入，再仅对该实例内部功能节点生成执行计划并按拓扑运行，中间产物与最终输出会优先就地更新/回填到实例结构中；容器中栏会继续显示当前步骤，而最近一次运行摘要、最近成功时间和最近失败时间也会持久化回画布，便于复盘。当前仍有边界：实例外功能节点不能作为该蓝图实例的 Pipeline 上游。

**节点调整大小**：选中节点后拖拽边角可自由缩放，内容自动适应新尺寸。

**拖拽导入**：从 VSCode 资源管理器或系统文件管理器直接拖拽文件到画布（自动添加到暂存架）。当前已扩展到更多主流文本/代码/图片/音视频格式，例如 `markdown` / `rst` / `adoc`、`doc/docx/docm/dot/dotx/dotm`、`ppt/pptx/pptm/pps/ppsx/ppsm/pot/potx/potm`、`xls/xlsx/xlsm/xlt/xltx/xltm`、`odt/ods/odp/fodt/fods/fodp`、`rtf`、`epub`、`mjs` / `cjs` / `vue` / `svelte` / `php` / `ipynb`、`svg` / `bmp` / `avif`、`ogg` / `m4a` / `flac`、`m4v`。按住 `Shift` 拖拽可直接放入画布。

**画板/工作区**：工具栏「📋 画板」下拉管理画板。画板是半透明彩色矩形区域，用于物理分区隔离节点。移动画板时内部节点跟随移动，8 个控制点可调整大小。新建画板进入暂存架，拖到画布放置。右键画板可编辑名称/颜色或删除；右键菜单会跟随画布元素一起移动，不再固定在屏幕窗口上。

**PDF 预览**：Paper 节点直接渲染 PDF 第一页原图，无需打开外部阅读器即可快速浏览。

**画布内置预览器**：点击节点「预览」按钮，画布内弹出全屏模态窗口预览内容（Markdown 全文、代码行号、PDF 多页、图片全尺寸、音频波形播放、视频播放、表格等），ESC 或点击背景关闭，无需切换到 VSCode 编辑器。

**按需渲染**：视口外的节点不挂载 DOM，节点内容按需懒加载，大量节点时保持流畅。

---

**侧边栏（ResearchSpace 面板）**

点击左侧活动栏的 Research Space 图标，面板中以树形列出所有画布及其节点。

**右键菜单：**
- **数据节点**：Open File（打开关联文件）、Remove from Canvas（从画布移除，不删文件）
- **功能节点**：Run（运行）、Remove from Canvas
- **画布**：Open Canvas（打开画布编辑器）、Delete Canvas（删除 .rsws 文件）

---

## 导出

通过命令面板（`Ctrl+Shift+P`）执行：

- **Research Space: Export as Markdown** — 将画布中的数据节点内容合并导出为单个 Markdown 文件
- **Research Space: Export as JSON** — 导出完整画布数据（`.rsws` 格式的 JSON）

---

## 配置项

在 VSCode 设置中搜索 `researchSpace` 查看所有配置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `researchSpace.ai.provider` | `copilot` | 全局 AI Provider（copilot / anthropic / ollama / omlx） |
| `researchSpace.ai.anthropicApiKey` | — | Anthropic API Key |
| `researchSpace.ai.anthropicModel` | `claude-sonnet-4-6` | Anthropic 全局模型 |
| `researchSpace.ai.ollamaBaseUrl` | `http://localhost:11434` | Ollama 服务地址 |
| `researchSpace.ai.ollamaModel` | `llama3.2` | Ollama 全局模型 |
| `researchSpace.ai.omlxBaseUrl` | `http://localhost:11433/v1` | oMLX 服务地址 |
| `researchSpace.ai.omlxApiKey` | — | oMLX API Key（可选） |
| `researchSpace.ai.omlxModel` | — | oMLX 全局模型 |
| `researchSpace.ai.maxOutputTokens` | `0` | 聊天类功能节点的最大输出 tokens（0 = 自动取模型/Provider 可知最大值） |
| `researchSpace.ai.maxContextTokens` | `0` | 聊天类功能节点的最大上下文 tokens（0 = 自动取模型/Provider 可知最大值） |
| `researchSpace.ai.favoriteModels` | `{}` | 每个 provider 的常用模型列表；功能节点模型下拉优先只显示这里勾选的模型 |
| `researchSpace.ai.aiHubMixApiKey` | — | AIHubMix API Key（多模态工具专用：图像/TTS/STT/视频） |
| `researchSpace.ai.aiHubMixImageGenModel` | — | 图像生成默认模型（空 = gemini-3.1-flash-image-preview） |
| `researchSpace.ai.aiHubMixImageEditModel` | — | 图像编辑默认模型（空 = gemini-3.1-flash-image-preview） |
| `researchSpace.ai.aiHubMixImageFusionModel` | — | 多图融合默认模型（空 = doubao-seedream-4-0-250828） |
| `researchSpace.ai.aiHubMixImageGroupModel` | — | 组图输出默认模型（空 = doubao-seedream-4-0-250828） |
| `researchSpace.ai.aiHubMixTtsModel` | — | TTS 默认模型（空 = gpt-4o-mini-tts） |
| `researchSpace.ai.aiHubMixSttModel` | — | STT 默认模型（空 = whisper-large-v3-turbo） |
| `researchSpace.ai.aiHubMixVideoGenModel` | — | 视频生成默认模型（空 = doubao-seedance-2-0-260128） |
| `researchSpace.canvas.autoSave` | `true` | 画布变更后自动保存 |
| `researchSpace.canvas.maxUndoSteps` | `50` | 最大撤销步数 |
| `researchSpace.pet.enabled` | `false` | 启用宠物伴侣（浮动窗口） |
| `researchSpace.pet.type` | `dog` | 宠物类型（dog / fox / rubber-duck / turtle / crab / clippy / cockatiel） |
| `researchSpace.pet.name` | — | 自定义宠物名字（空 = 使用默认名） |
| `researchSpace.pet.restReminder` | `45` | 休息提醒间隔（分钟，0 = 关闭） |
| `researchSpace.pet.aiSuggestionInterval` | `15` | AI 建议最小间隔（分钟，0 = 关闭） |
| `researchSpace.pet.groundTheme` | `forest` | 漫游窗口场景主题（none / forest / castle / autumn / beach / winter） |
| `researchSpace.pet.aiProvider` | `auto` | 宠物 AI 服务商（auto = 跟随全局） |
| `researchSpace.pet.aiModel` | — | 宠物 AI 模型（空 = 使用服务商默认） |

---

## 文件结构

每个画布拥有独立的工作空间文件夹，实现自然隔离：

```
my-workspace/
├── papers/                        ← 你的研究文件
│   └── attention.pdf
├── MyResearch/                    ← 画布工作空间（自动创建）
│   ├── MyResearch.rsws            ← 画布文件
│   ├── notes/                     ← 笔记、实验记录、任务清单（.md 文件）
│   │   ├── reading-notes.md
│   │   ├── experiment-1.md        ← 实验记录自动同步
│   │   └── sprint-tasks.md        ← 任务清单自动同步
│   ├── outputs/                   ← AI 生成的输出文件
│   │   └── summary_0414_1430.md
│   ├── tools/                     ← 自定义功能节点
│   │   └── my-tool.json
│   └── pet/                       ← 宠物状态与记忆
│       ├── state.json
│       └── memory.md
├── AnotherProject/                ← 另一个画布，完全隔离
│   ├── AnotherProject.rsws
│   ├── notes/
│   ├── outputs/
│   └── ...
```

---

## 开发验证

在 `research-space-vscode/` 目录中：

- `npm run lint` — 检查扩展宿主 TypeScript 代码风格
- `npm run typecheck` — 运行严格 TypeScript 类型检查
- `npm run test:unit` — 运行 Vitest 单元测试（当前已覆盖蓝图草稿、Pipeline 计划、旧 `.rsws` 迁移、nodeGroups / group_hub 旧迁移、board/nodeGroup/blueprint 叠加后的持久化稳定性、加载期迁移立即写盘消息、蓝图输出重开稳定性、蓝图 definitions 晚到时的输出链稳定性、蓝图最终输出历史保留、definitions 晚到后混合历史输出的多次 rerun 顺序稳定性、蓝图失败后从失败点继续执行时的缓存复用与最终输出历史保护、蓝图输出手动改位后重开保持、普通功能节点输出堆叠排布、蓝图输入/输出占位文案去重、蓝图内 pipeline 中间结果隐藏、function-runner 基础契约、CanvasDocument undo/redo 历史契约等基础回归）
- `npm run test:integration` — 运行 VS Code 自定义编辑器集成测试（当前已覆盖自定义编辑器打开冒烟、外部保存后重开恢复、外部把 `.rsws` 改回旧结构后重开自动迁移写回、VS Code 层 undo / redo + 保存回写主链路，以及蓝图最终输出在 definitions 晚到、隐式 slot 重绑、手动/自动历史混合并存、外部再次覆写回旧结构后重开、多历史结果连续追加后重开、失败后继续执行成功/再次失败两类场景下的最终输出历史稳定性，以及 blueprint run history 列表本身的持久化稳定性）
- `npm run verify` — 串行执行 `lint + typecheck + test`

---

## 版本历史

当前版本：**v2.1.1-alpha.66**（2026-04-22）

完整版本历史请查看 [CHANGELOG](CHANGELOG.md)。

---

## 贡献者

- **NNNSX** — 项目发起、产品设计与主要开发
- **[@codex](https://github.com/codex)** — 协作开发、问题排查与实现支持

## 致谢

Research Space 的开发离不开以下优秀的开源项目，在此表示衷心感谢：

| 项目 | 用途 | 许可证 |
|------|------|--------|
| [React](https://react.dev) | Webview UI 框架 | MIT |
| [React Flow](https://reactflow.dev) (@xyflow/react) | 画布节点/边/视口渲染引擎 | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | 轻量状态管理 | MIT |
| [Vite](https://vite.dev) | Webview 前端构建工具 | MIT |
| [esbuild](https://esbuild.github.io) | Extension Host 打包工具 | MIT |
| [pdf-parse](https://gitlab.com/nickerso/pdfjs) | PDF 文本提取 | MIT |
| [pdfjs-dist](https://github.com/nickerso/pdfjs-dist) | PDF 渲染预览 | Apache-2.0 |
| [Mermaid](https://mermaid.js.org) | 图表/流程图渲染 | MIT |
| [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) | Markdown 渲染 | MIT |
| [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) | Anthropic API 接入 | MIT |
| [uuid](https://github.com/uuidjs/uuid) | 唯一 ID 生成 | MIT |
| [vscode-pets](https://github.com/tonybaloney/vscode-pets) | 宠物像素 GIF 动画素材 | MIT |
| [TypeScript](https://www.typescriptlang.org) | 类型安全的 JavaScript 超集 | Apache-2.0 |

同时感谢 [VSCode Extension API](https://code.visualstudio.com/api)、[GitHub Copilot](https://github.com/features/copilot) 和 [Ollama](https://ollama.com) 为本插件提供了强大的运行平台与 AI 能力支持。

---

## 许可证

[MIT License](LICENSE) — 自由使用、修改、分发。
