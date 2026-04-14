# Contributing to Research Space

感谢你对 Research Space 的关注！欢迎任何形式的贡献。

## 如何贡献

### 报告 Bug

在 [Issues](https://github.com/NNNSX/research-space-vscode/issues) 中创建新 Issue，请包含：

- 操作系统和 VSCode 版本
- Research Space 插件版本
- 复现步骤
- 期望行为 vs 实际行为
- 相关截图或错误日志（VSCode → Help → Toggle Developer Tools → Console）

### 功能建议

同样在 Issues 中提交，标注 `feature request`，描述你的使用场景和期望效果。

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 安装依赖：`npm install && cd webview && npm install`
4. 开发并测试：`npm run build`
5. 提交：`git commit -m "feat: your feature description"`
6. 推送并创建 Pull Request

### Commit 规范

```
feat: 新功能
fix: Bug 修复
docs: 文档更新
refactor: 重构（不改变功能）
style: 样式/格式调整
perf: 性能优化
```

## 项目结构

```
research-space-vscode/
├── src/                  # Extension Host（Node.js 侧）
│   ├── extension.ts      # 入口
│   ├── ai/               # AI Provider + 工具运行器
│   ├── core/             # 画布模型、内容提取、存储
│   ├── providers/        # Webview Provider、侧边栏 TreeView
│   └── pet/              # 宠物 AI 处理
├── webview/src/          # Webview UI（React + ReactFlow）
│   ├── components/       # 节点、面板、画布组件
│   ├── stores/           # Zustand 状态管理
│   └── pet/              # 宠物引擎
├── resources/            # 图标、工具定义 JSON、宠物素材
└── dist/                 # 构建输出（gitignore）
```

关键约束：
- Webview 运行在沙盒 iframe 中，不能直接访问文件系统，所有 I/O 通过 `postMessage` 与 Extension Host 通信
- 本地图片必须通过 `webview.asWebviewUri()` 转换后才能显示

## 开发环境

- Node.js >= 18
- VSCode >= 1.93.0
- 构建：`npm run build`（esbuild + Vite）
- 调试：VSCode 按 F5 启动 Extension Development Host

## 许可证

本项目采用 [MIT License](LICENSE)。提交代码即表示你同意以相同许可证授权。
