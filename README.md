# Research Space

**当前版本：v2.3.2-alpha.1**

Research Space 是一个 VS Code 插件，用可视化画布组织研究资料、AI 工具链和工作流。你可以把 PDF、Markdown、图片、代码、音视频、表格等文件放到画布上，再连接 AI 工具节点完成摘要、翻译、审稿、文件转换和多步骤处理。

---

## 安装

1. 前往 [GitHub Releases](https://github.com/NNNSX/research-space-vscode/releases) 下载最新版 `.vsix`。
2. 在 VS Code 中执行命令：`Extensions: Install from VSIX...`
3. 选择下载的 `research-space-2.3.2-alpha.1.vsix`。
4. 打开一个文件夹后，点击左侧活动栏的 **Research Space** 图标开始使用。

也可以用命令行安装：

```bash
code --install-extension research-space-2.3.2-alpha.1.vsix --force
```

---

## 快速上手

1. 打开任意工作区文件夹。
2. 在 Research Space 面板中点击 **+ New Canvas** 新建画布。
3. 从 VS Code Explorer 右键文件，选择 **Add to Canvas**，或直接拖拽文件到画布。
4. 从 **AI Tools** 中拖出功能节点。
5. 从数据节点右侧通道连到功能节点左侧通道。
6. 点击功能节点上的 **Run** 运行。
7. 结果会作为新节点回到画布中，可继续连接到后续工具节点。

---

## 主要功能

- **可视化研究画布**：用节点和连线组织论文、笔记、代码、图片、音视频、表格和思维导图。
- **思维导图节点**：可新建轻量导图节点，用大纲或脑图式图形模式编辑中心主题和多级分支，一级分支有颜色与统一 SVG 曲线连线，支持鼠标拖动画布、滚轮缩放、Markdown / XMind 导出和 .xmind 拖入导入，支持本地图片引用、图片大小调整，并在大纲中保留图片引用位置与尺寸信息；画布节点以轻量导图缩略图展示一级结构，超过 4 条分支时显示“+N 更多”。
- **AI 工具节点**：支持摘要、翻译、润色、审稿、文献综述、大纲生成、RAG 问答、自由对话等；选中材料后会显示轻量下一步建议，可一键创建并连接对应工具节点。
- **文件转换**：支持 PDF、Word、PPT、图片、XLS/XLSX 等输入；表格可转 Markdown 或 TeX，PDF/Word/PPT 可转 PNG 或拆解为文字 + 图片。
- **画板与节点组**：用画板划分功能区，用节点组管理一批输入或输出；导出节点组时会展开其成员节点。
- **蓝图工作流**：把一段常用节点流程保存为可复用蓝图。
- **画布内预览**：在画布中预览 Markdown、代码、PDF、图片、音频、视频和表格。
- **多节点性能优化**：缩放到全局视角时自动进入摘要态，减少大量节点同屏时的渲染压力。
- **画布宠物陪伴**：宠物可在本地感知画布结构、节点事件和 AI 运行状态，并以低频气泡给出整理、导图、错误恢复和休息提醒；支持勿扰 / 安静 / 平衡 / 活跃四档主动建议，并可切换固定小面板或全画布跟随显示；跟随模式支持拖动手动放置，双击或重置按钮恢复自动跟随；宠物长期记忆默认本地保存，可在设置中关闭、清空和查看“我学到了”摘要；部分建议会显示可解释建议卡片，确认后可新建导图、整理笔记、打开 AI 设置或宠物设置，且卡片会说明操作边界；设置中提供成长与进化卡片，用于查看阶段、已获得伙伴 / 能力、下一目标和工作节奏；宠物小游戏定位为短休息入口，不会替代画布主线。
- **依据追踪、节点建议与导出**：普通 AI 文本输出会尽量在正文中嵌入 [资料1] 这类来源引用，AI 编排提示词也会提醒自定义工具兼容该规则；选中节点可查看下一步建议并导出为 Markdown；高成本图像 / 视频工具运行前会显示费用提示和短确认倒计时；删除节点、连线、画板、节点组、暂存项、任务项和配置项前会弹出确认。

---

## AI 与模型配置

Research Space 支持多种 AI Provider：

- GitHub Copilot
- Anthropic
- Ollama
- oMLX
- 自定义 OpenAI 兼容服务
- AIHubMix 多模态工具能力（图像生成 / 编辑、TTS / STT 与视频工具；图像预设含 GPT Image、Gemini 与 Doubao）

配置入口在画布顶部 **Settings** 面板中。API Key 只保存在本机 VS Code 设置中，不应写入项目文件或提交到仓库。

---

## 文件转换说明

文件转换节点位于 **AI Tools → 通用 → 文件转换**。

- XLS / XLSX：可转 Markdown 表格或 TeX `tabular`。
- PDF：可逐页转 PNG，或拆解为文字 + 图片。
- PPT：按 PPT → PDF → PNG 链路转换。
- Word：优先使用本机 Microsoft Word 转 PDF，再转 PNG；失败时回退 LibreOffice / soffice。
- PDF / Word / PPT 转 PNG 依赖 VSIX 内随包携带的 PDF worker 与原生 canvas runtime；如果运行环境缺少对应原生运行时，该能力会给出明确错误提示。
- 文字 + 图片拆解需要配置 MinerU Token；表格转换和 PNG 转换不调用 MinerU。

---

## 数据与安全

- 画布数据保存在工作区内的 `.rsws` 文件中。
- 节点默认保存文件路径引用，不复制源文件内容。
- 从画布移除外部文件节点不会删除源文件。
- 建议在试用 alpha 版本前备份工作区。

---

## 版本历史

当前版本：**v2.3.2-alpha.1**（2026-04-28）

完整变更记录请查看 [CHANGELOG.md](CHANGELOG.md)。
最新安装包请查看 [GitHub Releases](https://github.com/NNNSX/research-space-vscode/releases)。

---

## 许可

本项目使用 MIT License。详见 [LICENSE](LICENSE)。
