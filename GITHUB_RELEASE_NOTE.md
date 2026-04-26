这是一次面向文件转换、多节点画布流畅度、误删防护与画布自检的 alpha 汇总更新。

## 新增

- “文件爆炸”统一改为“文件转换”，旧画布和旧蓝图继续兼容原工具 ID。
- 文件转换支持 PDF、Word、PPT、图片、XLS / XLSX 等输入。
- 表格文件可转换为 Markdown 表格或 TeX `tabular`，不再走 MinerU。
- PDF / Word / PPT 可选择仅转 PNG，或拆解为文字 + 图片。
- 新增转换环境诊断，可检查 Word、PowerPoint、LibreOffice / soffice、PDF 渲染 runtime、MinerU 配置与表格转换能力。
- 新增画布数据健康检查，可查看悬挂连线、节点组引用、画板边界、蓝图绑定等结构问题。
- 画布健康检查支持在确认后执行低风险修复，包括移除悬挂连线、清理缺失节点组成员引用、去重节点组成员。

## 修复与优化

- 原独立“PDF 转 PNG”入口已合并到“文件转换”节点，减少重复功能入口。
- Word 转 PNG 优先使用本机 Microsoft Word 转 PDF，再转 PNG；失败时回退 LibreOffice / soffice。
- PPT 转 PNG 走 PPT → PDF → PNG 链路，提升整页渲染稳定性。
- 多次转换同一文件时默认保留旧结果，避免覆盖用户产出。
- 优化多节点画布缩放与拖拽流畅度，远视角下自动进入摘要态，减少富内容渲染压力。
- 画板在摘要态显示置顶大标题，便于全局视角快速定位功能区。
- 画板和可调边界的角点在缩放时保持更稳定的屏幕尺寸，低缩放下更容易拖拽。
- 节点、连线、画板、节点组、暂存项、任务项、配置项和对话清空等删除入口补齐确认层。
- 补充画布健康检查、低风险修复、迁移、蓝图、保存重载等自动化测试护栏。

## 注意事项

- 建议在试用 alpha 版本前备份工作区。
- PPT / Word 转 PNG 依赖本机可用的 PowerPoint、Microsoft Word 或 LibreOffice / soffice；缺失时可在设置中运行转换环境诊断。
- MinerU Token 只应配置在本机 VS Code 设置中，不应写入源码、工作区文件或发布说明。
- 中风险画布修复目前只展示计划，不会自动执行。

## 下载说明

- 下载附件中的 `research-space-2.2.2-alpha.6.vsix`，在 VS Code 中执行 `Extensions: Install from VSIX...` 安装。
