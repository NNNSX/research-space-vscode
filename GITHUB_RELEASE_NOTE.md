本版本完成宠物陪伴系统升级，并修复文件转换依赖缺失问题，建议所有 alpha 用户更新。

## 新增与优化

- 宠物系统升级为更完整的画布陪伴助手，支持全画布跟随、低打扰建议、长期记忆摘要、可解释建议卡片和成长展示。
- 宠物小游戏调整为“短休息”入口，避免干扰画布工作主线。
- 文件转换继续支持 PDF、Word、PPT 转 PNG 以及表格转 Markdown / TeX。
- 优化 VSIX 依赖完整性检查，确保 PDF 转 PNG 所需的 PDF worker 和 canvas runtime 随包携带。

## 修复

- 修复部分情况下 PDF 转整页 PNG 报 `pdf.worker.mjs` 缺失的问题。
- 修复宠物全画布跟随拖动偏移问题。
- 修复宠物建议卡片靠近屏幕边缘时可能越界的问题。
- 修正扩展包仓库元数据，确保指向正确的 GitHub 仓库。

## 注意事项

- API Key 仍只保存在本机 VS Code 设置中。
- PDF / Word / PPT 转 PNG 依赖本机运行环境与随包 native runtime；如遇转换失败，请先查看节点错误提示。

## 下载说明

- 下载附件中的 `research-space-2.3.2-alpha.1.vsix`，在 VS Code 中执行 `Extensions: Install from VSIX...` 安装。
