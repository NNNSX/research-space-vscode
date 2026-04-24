这是一次面向文件转换、文档拆解、AI 消费链路和误删防护的 alpha 汇总更新。

## 新增

- “文件爆炸”UI 改为“文件转换”，内部继续兼容旧工具 ID，旧画布无需迁移
- 文件转换支持 PDF、Word、PPT、图片、XLS/XLSX 等多种输入
- 原独立“PDF 转 PNG”工具入口已移除，PDF 转 PNG 统一从“文件转换”节点中选择
- XLS / XLSX 可选择转换为 Markdown 表格或 TeX `tabular` 片段，不再进入 MinerU
- PDF / Word / PPT 可选择仅转 PNG，或拆解为文字 + 图片
- 新增 MinerU 在线解析配置入口，支持 Token、模式、模型版本、轮询参数与本地 fallback 设置
- 拆解与转换结果会生成关系索引，帮助后续 AI 按“关系索引 → 文本/图片节点”的顺序读取内容
- PDF 转 PNG 直接逐页转换，PPT 转 PNG 走 PPT → PDF → PNG，Word 转 PNG 走 Word → PDF → PNG
- Word 转 PDF 优先使用本机 Microsoft Word，失败或未安装时回退 LibreOffice / soffice

## 修复与优化

- 多次转换同一文件时默认保留旧结果，并将新结果自动排到旧结果下方
- PPT/PPTX 整页渲染改为更稳定的 PDF 到逐页 PNG 链路，并补齐 PowerPoint / LibreOffice / Quick Look 等后端检测与错误提示
- XLS / XLSX 不再误上传到 MinerU，避免 MinerU 在线接口返回不支持表格文件
- MinerU 在线轮询、下载、鉴权、限流、超时与结果缺失等错误提示更明确
- 文件转换节点的状态、配置提示、运行前检查和执行阶段提示更清晰
- 画布节点、连线、节点组、画板、暂存项、任务项、设置项和对话清空等删除入口统一补齐确认层
- 顶栏排版收口，窄宽度下保存状态、标题和按钮区不再挤成多行

## 注意事项

- 这是 alpha 测试版，建议先备份工作区，再在副本中试用
- PPT / Word 转 PNG 依赖本机可用的 PowerPoint、Microsoft Word 或 LibreOffice / soffice；缺失时会给出明确提示
- MinerU Token 只应配置在本机 VS Code 设置中，不应写入源码、工作区文件或发布说明

## 下载说明

- 下载附件中的 `research-space-2.2.1-alpha.2.vsix`
