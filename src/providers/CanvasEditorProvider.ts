import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { CanvasFile, SettingsSnapshot, CustomProviderConfig, CanvasNode } from '../core/canvas-model';
import { readCanvas, writeCanvas, setDataNodeRegistry, ensureAiOutputDir, toRelPath } from '../core/storage';
import { runFunctionNode, runBatchFunctionNode, cancelRun, setToolRegistry } from '../ai/function-runner';
import { getProviderById } from '../ai/provider';
import { ToolRegistry } from '../ai/tool-registry';
import { DataNodeRegistry } from '../core/data-node-registry';
import { readPetState, writePetState, readPetSettings } from '../pet/pet-memory';

// ── Helpers ────────────────────────────────────────────────────────────────

async function ensureNotesDir(canvasDir: string): Promise<string> {
  const notesDir = path.join(canvasDir, 'notes');
  try { await vscode.workspace.fs.stat(vscode.Uri.file(notesDir)); }
  catch { await vscode.workspace.fs.createDirectory(vscode.Uri.file(notesDir)); }
  return notesDir;
}

async function uniqueFile(dir: string, base: string, ext: string): Promise<{ uri: vscode.Uri; safe: string; display: string }> {
  const safeBase = base.replace(/[\\/:*?"<>|]/g, '-');
  let safe = safeBase;
  let suffix = 2;
  while (true) {
    const candidate = vscode.Uri.file(path.join(dir, `${safe}${ext}`));
    try { await vscode.workspace.fs.stat(candidate); safe = `${safeBase}-${suffix++}`; }
    catch { break; }
  }
  return {
    uri: vscode.Uri.file(path.join(dir, `${safe}${ext}`)),
    safe,
    display: safe === safeBase ? base : `${base}-${suffix - 1}`,
  };
}

// ── Canvas Document ─────────────────────────────────────────────────────────

export class CanvasDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  data: CanvasFile;

  // Collected disposables (event listener subscriptions) — cleaned up on dispose()
  readonly disposables: vscode.Disposable[] = [];

  // Set before every internal writeCanvas call; cleared in revertCustomDocument.
  // Prevents VSCode's file-change detection from triggering a full revert/re-init
  // every time the extension itself saves the file (autoSave, AI output, etc.).
  suppressNextRevert = false;

  // Fires on every edit — Provider listens and forwards to VS Code for dirty tracking
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private _onDidDispose = new vscode.EventEmitter<void>();
  readonly onDidDispose = this._onDidDispose.event;

  constructor(uri: vscode.Uri, data: CanvasFile) {
    this.uri = uri;
    this.data = data;
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._onDidDispose.fire();
    this._onDidDispose.dispose();
    for (const d of this.disposables) { d.dispose(); }
    this.disposables.length = 0;
  }
}

// ── Canvas Editor Provider ──────────────────────────────────────────────────

export class CanvasEditorProvider implements vscode.CustomEditorProvider<CanvasDocument> {

  static readonly viewType = 'researchSpace.canvas';
  static readonly activeWebviews = new Map<string, vscode.Webview>();
  static readonly activeDocuments = new Map<string, CanvasDocument>();
  /** Exposed so extension.ts file watcher can call shouldWatchContent() */
  static dataNodeRegistry: DataNodeRegistry | null = null;

  /** Mark the document so the next VSCode-triggered revert (from our own write) is skipped. */
  static suppressRevert(canvasPath: string): void {
    const doc = CanvasEditorProvider.activeDocuments.get(canvasPath);
    if (doc) { doc.suppressNextRevert = true; }
  }

  private readonly _context: vscode.ExtensionContext;
  private readonly _registry: ToolRegistry;
  private readonly _nodeRegistry: DataNodeRegistry;
  private readonly _builtinsReady: Promise<void>;

  // Required by CustomEditorProvider interface for VS Code dirty-state tracking
  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<CanvasDocument>>();
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  constructor(context: vscode.ExtensionContext) {
    this._context = context;
    this._registry = new ToolRegistry();
    this._nodeRegistry = new DataNodeRegistry();
    // Load builtins eagerly; workspace tools are loaded per-canvas in resolveCustomEditor
    this._builtinsReady = this._registry.loadBuiltins(context.extensionPath).then(() => {
      setToolRegistry(this._registry);
    }).catch(e => {
      console.warn('[ToolRegistry] failed to load builtins:', e);
    });
    this._nodeRegistry.loadBuiltins(context.extensionPath).then(() => {
      setDataNodeRegistry(this._nodeRegistry);
      CanvasEditorProvider.dataNodeRegistry = this._nodeRegistry;
    }).catch(e => {
      console.warn('[DataNodeRegistry] failed to load builtins:', e);
    });
  }

  // ── Document lifecycle ────────────────────────────────────────────────────

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<CanvasDocument> {
    const data = await readCanvas(uri);
    const doc = new CanvasDocument(uri, data);

    // Forward document edits to VS Code for dirty-state / undo menu.
    // Disposable is stored on the document so it's cleaned up when the document closes.
    doc.disposables.push(
      doc.onDidChange(() => {
        this._onDidChangeCustomDocument.fire({
          document: doc,
          label: 'Canvas Edit',
          undo: () => doc.undo(),
          redo: () => doc.redo(),
        });
      })
    );

    return doc;
  }

  async resolveCustomEditor(
    document: CanvasDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const canvasDir = path.dirname(document.uri.fsPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspaceRoot = workspaceFolder?.uri.fsPath ?? canvasDir;

    // retainContextWhenHidden is set at registration time (extension.ts), not here
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(canvasDir),
        vscode.Uri.file(workspaceRoot),
        this._context.extensionUri,
      ],
    };

    webviewPanel.webview.html = this._getHtmlForWebview(webviewPanel.webview);

    CanvasEditorProvider.activeWebviews.set(document.uri.fsPath, webviewPanel.webview);
    CanvasEditorProvider.activeDocuments.set(document.uri.fsPath, document);

    // Collect all panel-scoped subscriptions for clean-up on panel close
    const panelDisposables: vscode.Disposable[] = [];

    webviewPanel.onDidDispose(() => {
      CanvasEditorProvider.activeWebviews.delete(document.uri.fsPath);
      CanvasEditorProvider.activeDocuments.delete(document.uri.fsPath);
      for (const d of panelDisposables) { d.dispose(); }
      panelDisposables.length = 0;
    });

    // Messages from webview
    panelDisposables.push(
      webviewPanel.webview.onDidReceiveMessage(
        async (msg: { type: string; [key: string]: unknown }) => {
          try {
            await this._handleMessage(msg, document, webviewPanel.webview, workspaceRoot);
          } catch (e) {
            console.error('[CanvasEditorProvider] unhandled error in message handler:', msg.type, e);
            try {
              webviewPanel.webview.postMessage({
                type: 'toastError',
                message: `Internal error (${msg.type}): ${e instanceof Error ? e.message : String(e)}`,
              });
            } catch { /* webview may be disposed */ }
          }
        }
      )
    );

    // Send initial data immediately; 'ready' message will also trigger a re-send
    webviewPanel.webview.postMessage({ type: 'init', data: document.data, workspaceRoot: canvasDir });
    webviewPanel.webview.postMessage({ type: 'settingsSnapshot', settings: this._buildSettingsSnapshot() });
    // Push node defs (always available since loaded in constructor)
    webviewPanel.webview.postMessage({ type: 'nodeDefs', defs: this._nodeRegistry.getAll() });

    // Load canvas-scoped custom tools, set up hot-reload watcher, then push tool defs
    // Ensure builtins are loaded first to avoid sending an empty tool list
    this._builtinsReady.then(() =>
      this._registry.loadWorkspaceTools(canvasDir)
    ).then(() => {
      webviewPanel.webview.postMessage({ type: 'toolDefs', tools: this._registry.getAll() });
    }).catch(() => {
      webviewPanel.webview.postMessage({ type: 'toolDefs', tools: this._registry.getAll() });
    });

    // Hot-reload: watch tools/*.json for changes without reopening the canvas
    const toolsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(canvasDir, 'tools/*.json')
    );
    const refreshTools = async () => {
      await this._registry.reloadWorkspaceTools(canvasDir);
      webviewPanel.webview.postMessage({ type: 'toolDefs', tools: this._registry.getAll() });
    };
    toolsWatcher.onDidCreate(refreshTools);
    toolsWatcher.onDidChange(refreshTools);
    toolsWatcher.onDidDelete(refreshTools);
    panelDisposables.push(toolsWatcher);
  }

  async saveCustomDocument(
    document: CanvasDocument,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    document.suppressNextRevert = true;
    await writeCanvas(document.uri, document.data);
  }

  async saveCustomDocumentAs(
    document: CanvasDocument,
    destination: vscode.Uri,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    document.suppressNextRevert = true;
    await writeCanvas(destination, document.data);
  }

  async revertCustomDocument(
    document: CanvasDocument,
    _cancellation: vscode.CancellationToken
  ): Promise<void> {
    // If the file change was triggered by the extension itself (autoSave, AI output, etc.)
    // skip re-init to avoid the "canvas disappears and reappears" flicker.
    if (document.suppressNextRevert) {
      document.suppressNextRevert = false;
      return;
    }
    document.data = await readCanvas(document.uri);
    const wv = CanvasEditorProvider.activeWebviews.get(document.uri.fsPath);
    wv?.postMessage({ type: 'init', data: document.data, workspaceRoot: path.dirname(document.uri.fsPath) });
  }

  async backupCustomDocument(
    document: CanvasDocument,
    context: vscode.CustomDocumentBackupContext,
    _cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    await writeCanvas(context.destination, document.data);
    return {
      id: context.destination.toString(),
      delete: async () => {
        try { await vscode.workspace.fs.delete(context.destination); } catch { /* ignore */ }
      },
    };
  }

  // ── Message handling ──────────────────────────────────────────────────────

  private async _handleMessage(
    msg: { type: string; [key: string]: unknown },
    document: CanvasDocument,
    webview: vscode.Webview,
    workspaceRoot: string
  ): Promise<void> {
    const canvasDir = path.dirname(document.uri.fsPath);
    switch (msg.type) {
      case 'ready':
        webview.postMessage({ type: 'init', data: document.data, workspaceRoot: canvasDir });
        webview.postMessage({ type: 'settingsSnapshot', settings: this._buildSettingsSnapshot() });
        webview.postMessage({ type: 'toolDefs', tools: this._registry.getAll() });
        webview.postMessage({ type: 'nodeDefs', defs: this._nodeRegistry.getAll() });
        // Send pet state
        {
          const petSettings = readPetSettings();
          const petState = await readPetState(canvasDir);
          webview.postMessage({
            type: 'petInit',
            petState,
            petEnabled: petSettings.enabled,
            restReminderMin: petSettings.restReminderMin,
            groundTheme: petSettings.groundTheme,
          });
          // Send pet GIF assets base URI
          const petAssetsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'resources', 'pets')
          ).toString();
          webview.postMessage({ type: 'petAssetsBase', uri: petAssetsUri });
        }
        break;

      case 'canvasChanged': {
        const newData = msg['data'] as CanvasFile;
        if (!newData) { break; }
        // Update in-memory data WITHOUT calling pushEdit — pushEdit fires onDidChange
        // which marks the document dirty in VSCode's UI, causing the unsaved-dot.
        // Since we always auto-save to disk immediately, the document is never "dirty"
        // from the user's perspective. We bypass VSCode's dirty/undo tracking entirely
        // for auto-saves; undo/redo is managed inside the canvas webview itself.
        document.data = newData;
        document.suppressNextRevert = true;
        try {
          await writeCanvas(document.uri, document.data);
        } catch (e: unknown) {
          const msg2 = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'toastError', message: `Auto-save failed: ${msg2}` });
        }
        break;
      }

      case 'openFile': {
        const filePath = msg['filePath'] as string;
        if (!filePath) { break; }
        const absPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(path.dirname(document.uri.fsPath), filePath);
        const fileUri = vscode.Uri.file(absPath);
        // Always open inside VSCode — pdf-viewer, image preview, text editor, etc.
        // vscode.open dispatches to the correct built-in viewer for every file type.
        try {
          // ViewColumn.Beside opens in the adjacent column, keeping the canvas tab visible.
          await vscode.commands.executeCommand('vscode.open', fileUri, vscode.ViewColumn.Beside);
        } catch {
          await vscode.env.openExternal(fileUri);
        }
        break;
      }

      case 'previewFile': {
        const filePath = msg['filePath'] as string;
        if (!filePath) { break; }
        const absPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(path.dirname(document.uri.fsPath), filePath);
        const fileUri = vscode.Uri.file(absPath);
        const ext = path.extname(absPath).slice(1).toLowerCase();
        try {
          if (ext === 'md') {
            // Markdown: open rendered preview beside the canvas (half window)
            await vscode.commands.executeCommand('markdown.showPreviewToSide', fileUri);
          } else {
            // All other files: let VSCode dispatch to the correct viewer
            await vscode.commands.executeCommand('vscode.open', fileUri, vscode.ViewColumn.Beside);
          }
        } catch {
          await vscode.env.openExternal(fileUri);
        }
        break;
      }

      case 'newNote': {
        const inputTitle = await vscode.window.showInputBox({
          prompt: '笔记标题',
          placeHolder: '新建笔记',
          value: (msg['title'] as string) || '',
        });
        if (inputTitle === undefined) { break; }  // user cancelled
        const title = inputTitle.trim() || '新建笔记';
        const notesDir = await ensureNotesDir(canvasDir);
        const { uri: noteUri, display: displayTitle } = await uniqueFile(notesDir, title, '.md');
        await vscode.workspace.fs.writeFile(noteUri, Buffer.from(`# ${displayTitle}\n`, 'utf-8'));

        const { toRelPath } = await import('../core/storage');
        const { DEFAULT_SIZES } = await import('../core/canvas-model');
        const relPath = toRelPath(noteUri.fsPath, document.uri);
        const newNode = {
          id: require('uuid').v4(),
          node_type: 'note' as const,
          title: displayTitle,
          position: { x: 0, y: 0 },
          size: DEFAULT_SIZES['note'],
          file_path: relPath,
          meta: { content_preview: `# ${displayTitle}\n` },
        };
        webview.postMessage({ type: 'stageNodes', nodes: [newNode] });
        break;
      }

      case 'newExperimentLog': {
        const inputTitle = await vscode.window.showInputBox({
          prompt: '实验名称',
          placeHolder: '实验记录',
          value: (msg['title'] as string) || '',
        });
        if (inputTitle === undefined) { break; }  // user cancelled
        const title = inputTitle.trim() || '实验记录';
        const notesDir = await ensureNotesDir(canvasDir);
        const { uri: fileUri, display: displayTitle } = await uniqueFile(notesDir, title, '.md');
        const date = new Date().toISOString().slice(0, 10);
        const content = `# ${displayTitle}\n\n- **状态**: 进行中\n- **日期**: ${date}\n- **参数**: \n- **结果**: \n`;
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));

        const { toRelPath } = await import('../core/storage');
        const { DEFAULT_SIZES } = await import('../core/canvas-model');
        const relPath = toRelPath(fileUri.fsPath, document.uri);
        const newNode = {
          id: require('uuid').v4(),
          node_type: 'experiment_log' as const,
          title: displayTitle,
          position: { x: 0, y: 0 },
          size: DEFAULT_SIZES['experiment_log'],
          file_path: relPath,
          meta: { experiment_status: 'running', experiment_date: date, content_preview: content },
        };
        webview.postMessage({ type: 'stageNodes', nodes: [newNode] });
        break;
      }

      case 'newTask': {
        const inputTitle = await vscode.window.showInputBox({
          prompt: '任务清单名称',
          placeHolder: '任务清单',
          value: (msg['title'] as string) || '',
        });
        if (inputTitle === undefined) { break; }  // user cancelled
        const title = inputTitle.trim() || '任务清单';
        const notesDir = await ensureNotesDir(canvasDir);
        const { uri: fileUri, display: displayTitle } = await uniqueFile(notesDir, title, '.md');
        const content = `# ${displayTitle}\n\n*暂无任务*\n`;
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));

        const { toRelPath } = await import('../core/storage');
        const { DEFAULT_SIZES } = await import('../core/canvas-model');
        const relPath = toRelPath(fileUri.fsPath, document.uri);
        const newNode = {
          id: require('uuid').v4(),
          node_type: 'task' as const,
          title: displayTitle,
          position: { x: 0, y: 0 },
          size: DEFAULT_SIZES['task'],
          file_path: relPath,
          meta: { task_items: [], content_preview: content },
        };
        webview.postMessage({ type: 'stageNodes', nodes: [newNode] });
        break;
      }

      case 'syncDataNodeFile': {
        const nodeId = msg['nodeId'] as string;
        const content = msg['content'] as string;
        if (!nodeId || content === undefined || content === null) { break; }
        const node = document.data.nodes.find(n => n.id === nodeId)
                  || document.data.stagingNodes?.find(n => n.id === nodeId);
        if (!node?.file_path) { break; }
        const { toAbsPath } = await import('../core/storage');
        const absPath = toAbsPath(node.file_path, document.uri);
        await vscode.workspace.fs.writeFile(vscode.Uri.file(absPath), Buffer.from(content, 'utf-8'));
        break;
      }

      case 'deleteNote': {
        const relPath = msg['filePath'] as string;
        if (!relPath) { break; }
        const { toAbsPath } = await import('../core/storage');
        const absPath = toAbsPath(relPath, document.uri);
        const fileUri = vscode.Uri.file(absPath);
        try {
          await vscode.workspace.fs.delete(fileUri);
        } catch {
          // File may already be missing — silently ignore
        }
        break;
      }

      case 'renameNode': {
        const renameNodeId = msg['nodeId'] as string;
        const newTitle = (msg['newTitle'] as string)?.trim();
        if (!renameNodeId || !newTitle) { break; }

        const canvas = await readCanvas(document.uri);
        const node = canvas.nodes.find(n => n.id === renameNodeId);
        if (!node || !node.file_path) { break; }

        const { toAbsPath, toRelPath } = await import('../core/storage');
        const absPath = toAbsPath(node.file_path, document.uri);
        const dir = path.dirname(absPath);
        const ext = path.extname(absPath);
        const safeBase = newTitle.replace(/[\\/:*?"<>|]/g, '-');

        // Find a unique destination name
        let safeName = safeBase;
        let suffix = 2;
        while (true) {
          const candidate = path.join(dir, `${safeName}${ext}`);
          if (candidate === absPath) { break; } // Same file — no rename needed
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
            // File exists — ask user
            const answer = await vscode.window.showWarningMessage(
              `文件 "${safeName}${ext}" 已存在，是否使用 "${safeBase}-${suffix}${ext}" 代替？`,
              { modal: true },
              '使用建议名称', '取消'
            );
            if (answer !== '使用建议名称') { break; }
            safeName = `${safeBase}-${suffix++}`;
          } catch {
            break; // File does not exist — safe to use
          }
        }

        const oldUri = vscode.Uri.file(absPath);
        const newFileUri = vscode.Uri.file(path.join(dir, `${safeName}${ext}`));
        if (oldUri.fsPath === newFileUri.fsPath) { break; } // No change

        try {
          // Use WorkspaceEdit so onDidRenameFiles fires correctly
          const edit = new vscode.WorkspaceEdit();
          edit.renameFile(oldUri, newFileUri, { overwrite: false });
          const ok = await vscode.workspace.applyEdit(edit);
          if (!ok) {
            vscode.window.showErrorMessage('重命名失败，请重试。');
            break;
          }

          // Update canvas data and notify webview directly
          // (onDidRenameFiles may also fire but this ensures immediate UI update)
          const newRelPath = toRelPath(newFileUri.fsPath, document.uri);
          const displayTitle = path.basename(newFileUri.fsPath, ext);

          node.file_path = newRelPath;
          node.title = displayTitle;
          if (node.meta) { node.meta.file_missing = false; }

          CanvasEditorProvider.suppressRevert(document.uri.fsPath);
          await writeCanvas(document.uri, canvas);

          webview.postMessage({
            type: 'nodeFileMoved',
            nodeId: renameNodeId,
            newFilePath: newRelPath,
            newTitle: displayTitle,
          });
        } catch (e) {
          vscode.window.showErrorMessage(`重命名失败：${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }

      case 'addFiles': {
        const selected = await vscode.window.showOpenDialog({
          defaultUri: vscode.Uri.file(workspaceRoot),
          canSelectMany: true,
          openLabel: 'Add to Canvas',
        });
        if (selected && selected.length > 0) {
          const { addToCanvas } = await import('../commands/add-to-canvas');
          await addToCanvas(selected, document.uri);
        }
        break;
      }

      case 'dropFiles': {
        const rawUris = msg['uris'] as string[];
        if (!Array.isArray(rawUris) || rawUris.length === 0) { break; }
        const resolved: vscode.Uri[] = [];
        for (const raw of rawUris) {
          try {
            if (raw.startsWith('file://') || raw.startsWith('vscode-file://')) {
              resolved.push(vscode.Uri.parse(raw));
            } else if (path.isAbsolute(raw)) {
              resolved.push(vscode.Uri.file(raw));
            } else {
              resolved.push(vscode.Uri.file(path.join(workspaceRoot, raw)));
            }
          } catch { /* skip malformed */ }
        }
        if (resolved.length > 0) {
          const { addToCanvas } = await import('../commands/add-to-canvas');
          await addToCanvas(resolved, document.uri);
        }
        break;
      }

      case 'requestImageUri': {
        const filePath = msg['filePath'] as string;
        if (!filePath) { break; }
        const absPath = path.isAbsolute(filePath)
          ? filePath
          : path.join(path.dirname(document.uri.fsPath), filePath);
        const uri = webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
        webview.postMessage({ type: 'imageUri', filePath, uri });
        break;
      }

      case 'requestFileContent': {
        const filePath = msg['filePath'] as string;
        const requestId = msg['requestId'] as string;
        if (!filePath || !requestId) { break; }
        try {
          const absPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(path.dirname(document.uri.fsPath), filePath);
          const ext = path.extname(absPath).slice(1).toLowerCase();
          let content = '';
          let language: string | undefined;
          if (ext === 'pdf') {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
            const { extractPdfText } = await import('../core/content-extractor');
            content = await extractPdfText(Buffer.from(bytes));
            language = 'text';
          } else {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
            content = Buffer.from(bytes).toString('utf-8');
            const langMap: Record<string, string> = {
              py: 'python', js: 'javascript', ts: 'typescript', tsx: 'typescriptreact',
              rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', cs: 'csharp',
              rb: 'ruby', swift: 'swift', kt: 'kotlin', r: 'r',
              md: 'markdown', txt: 'text',
            };
            language = langMap[ext] ?? ext;
          }
          webview.postMessage({ type: 'fileContent', requestId, content, language });
        } catch (e) {
          webview.postMessage({ type: 'fileContent', requestId, content: `[读取失败: ${e}]` });
        }
        break;
      }

      case 'requestModels': {
        const providerId = msg['provider'] as string;
        const provider = getProviderById(providerId);
        const models = provider ? await provider.listModels() : [];
        webview.postMessage({ type: 'modelList', provider: providerId, models });
        break;
      }

      case 'runFunction': {
        const nodeId = msg['nodeId'] as string;
        if (!nodeId) { break; }
        runFunctionNode(nodeId, document.data, document.uri, webview).catch(e => {
          webview.postMessage({ type: 'aiError', runId: nodeId, message: String(e) });
        });
        break;
      }

      case 'runBatchFunction': {
        const nodeId = msg['nodeId'] as string;
        if (!nodeId) { break; }
        runBatchFunctionNode(nodeId, document.data, document.uri, webview).catch(e => {
          webview.postMessage({ type: 'aiError', runId: nodeId, message: String(e) });
        });
        break;
      }

      case 'cancelAI': {
        const runId = msg['runId'] as string;
        if (runId) { cancelRun(runId); }
        break;
      }

      case 'requestOutputHistory': {
        const nodeId = msg['nodeId'] as string;
        const filePath = msg['filePath'] as string;
        if (!nodeId || !filePath) { break; }
        try {
          const aiDir = await ensureAiOutputDir(document.uri);
          const entries = await vscode.workspace.fs.readDirectory(aiDir);
          const mdFiles = entries
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
            .map(([name]) => name)
            .sort()
            .reverse(); // newest first

          type HistEntry = import('../core/canvas-model').OutputHistoryEntry;
          const historyEntries: HistEntry[] = [];
          for (const name of mdFiles) {
            const fileUri = vscode.Uri.joinPath(aiDir, name);
            const relFilePath = toRelPath(fileUri.fsPath, document.uri);
            let preview = '';
            try {
              const bytes = await vscode.workspace.fs.readFile(fileUri);
              preview = Buffer.from(bytes).toString('utf-8').slice(0, 200).replace(/\n/g, ' ');
            } catch { /* skip unreadable */ }
            historyEntries.push({
              filePath: relFilePath,
              filename: name,
              preview,
              isCurrent: relFilePath === filePath,
            });
          }
          webview.postMessage({ type: 'outputHistory', nodeId, entries: historyEntries });
        } catch (e) {
          webview.postMessage({ type: 'error', message: `读取历史失败: ${String(e)}` });
        }
        break;
      }

      case 'restoreOutputVersion': {
        const restoreFilePath = msg['filePath'] as string;
        if (!restoreFilePath) { break; }
        try {
          const { DEFAULT_SIZES } = await import('../core/canvas-model');
          const canvas = document.data;
          const { toAbsPath } = await import('../core/storage');
          const absPath = toAbsPath(restoreFilePath, document.uri);
          const fileUri = vscode.Uri.file(absPath);
          let preview = '';
          try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            preview = Buffer.from(bytes).toString('utf-8').slice(0, 300);
          } catch { /* skip */ }

          // Place new node below all existing nodes
          const maxY = canvas.nodes.length > 0
            ? Math.max(...canvas.nodes.map(n => n.position.y + (n.size?.height ?? 160)))
            : 200;
          const newNode: CanvasNode = {
            id: uuid(),
            node_type: 'ai_output',
            title: path.basename(restoreFilePath, '.md') + '（历史版本）',
            position: { x: 100, y: maxY + 40 },
            size: DEFAULT_SIZES['ai_output'],
            file_path: restoreFilePath,
            meta: { content_preview: preview },
          };

          canvas.nodes.push(newNode);
          CanvasEditorProvider.suppressRevert(document.uri.fsPath);
          await writeCanvas(document.uri, canvas);
          webview.postMessage({ type: 'stageNodes', nodes: [newNode] });
        } catch (e) {
          webview.postMessage({ type: 'error', message: `恢复版本失败: ${String(e)}` });
        }
        break;
      }

      case 'webviewError': {
        const errMsg = (msg['message'] as string) ?? '(no message)';
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}]\n${errMsg}\n${'─'.repeat(60)}\n`;
        const logUri = vscode.Uri.file(path.join(canvasDir, 'rs-error.log'));
        try {
          let existing = '';
          try {
            existing = Buffer.from(
              await vscode.workspace.fs.readFile(logUri)
            ).toString('utf-8');
          } catch { /* file may not exist yet */ }
          await vscode.workspace.fs.writeFile(
            logUri,
            Buffer.from(existing + line, 'utf-8')
          );
          vscode.window.showErrorMessage(
            'Research Space: error logged to rs-error.log',
            'Open Log'
          ).then(choice => {
            if (choice === 'Open Log') { vscode.window.showTextDocument(logUri); }
          });
        } catch { /* ignore write failure */ }
        break;
      }

      case 'updateSettings': {
        const key = msg['key'] as string;
        const value = msg['value'];
        if (key) {
          await this._handleUpdateSetting(key, value);
          webview.postMessage({ type: 'settingsSnapshot', settings: this._buildSettingsSnapshot() });
        }
        break;
      }

      case 'importTool': {
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { 'Tool Definition': ['json'] },
          openLabel: 'Import Tool',
        });
        if (!selected || selected.length === 0) { break; }
        let parsed: unknown;
        try {
          const bytes = await vscode.workspace.fs.readFile(selected[0]);
          parsed = JSON.parse(Buffer.from(bytes).toString('utf-8'));
        } catch {
          webview.postMessage({ type: 'toolDefError', message: 'Failed to read or parse the JSON file.' });
          break;
        }
        const { validateToolDef } = await import('../ai/tool-registry');
        const { valid, errors } = validateToolDef(parsed);
        if (!valid) {
          webview.postMessage({ type: 'toolDefError', message: `Invalid tool definition:\n• ${errors.join('\n• ')}` });
          break;
        }
        const def = parsed as { id: string; name: string };
        // Ensure tools dir exists
        const toolsDirUri = vscode.Uri.file(path.join(canvasDir, 'tools'));
        try { await vscode.workspace.fs.createDirectory(toolsDirUri); } catch { /* already exists */ }
        // Resolve ID conflicts: if ANY tool (builtin or custom) with this id exists, assign a new unique id
        let toolId = def.id;
        if (this._registry.get(toolId)) {
          let suffix = 2;
          while (this._registry.get(`${toolId}-${suffix}`)) { suffix++; }
          toolId = `${toolId}-${suffix}`;
          (parsed as Record<string, unknown>)['id'] = toolId;
        }
        // Resolve name conflicts: if any existing tool has the same display name, append numeric suffix
        const toolName = (parsed as Record<string, unknown>)['name'] as string;
        if (toolName) {
          const allTools = this._registry.getAll();
          const nameExists = allTools.some(t => t.name === toolName);
          if (nameExists) {
            let nSuffix = 2;
            while (allTools.some(t => t.name === `${toolName} ${nSuffix}`)) { nSuffix++; }
            (parsed as Record<string, unknown>)['name'] = `${toolName} ${nSuffix}`;
          }
        }
        // Also check if the destination file already exists on disk (orphaned file not in registry)
        let destUri = vscode.Uri.file(path.join(canvasDir, 'tools', `${toolId}.json`));
        try {
          await vscode.workspace.fs.stat(destUri);
          // File exists — find an available filename
          let fSuffix = 2;
          while (true) {
            const candidate = `${toolId}-${fSuffix}`;
            destUri = vscode.Uri.file(path.join(canvasDir, 'tools', `${candidate}.json`));
            try {
              await vscode.workspace.fs.stat(destUri);
              fSuffix++;
            } catch {
              toolId = candidate;
              (parsed as Record<string, unknown>)['id'] = toolId;
              break;
            }
          }
        } catch { /* file does not exist — OK */ }
        // Write to tools/{id}.json
        destUri = vscode.Uri.file(path.join(canvasDir, 'tools', `${toolId}.json`));
        await vscode.workspace.fs.writeFile(destUri, Buffer.from(JSON.stringify(parsed, null, 2), 'utf-8'));
        // The tools watcher will fire onDidCreate/onChange and reload automatically.
        // But if the watcher hasn't fired yet (edge case), push eagerly:
        await this._registry.reloadWorkspaceTools(canvasDir);
        webview.postMessage({ type: 'toolDefs', tools: this._registry.getAll() });
        const importedName = (parsed as Record<string, unknown>)['name'] as string ?? toolId;
        vscode.window.showInformationMessage(`Tool "${importedName}" imported to tools/${toolId}.json`);
        break;
      }

      case 'exportTool': {
        const toolId = msg['toolId'] as string;
        if (!toolId) { break; }
        const toolDef = this._registry.get(toolId);
        if (!toolDef) { break; }
        // Strip runtime-only fields before exporting
        const { _isCustom: _ignored, ...cleanDef } = toolDef as typeof toolDef & { _isCustom?: boolean };
        void _ignored;
        const safeName = toolDef.name.replace(/[\\/:*?"<>|]/g, '-');
        const dest = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(workspaceRoot, `${safeName}.json`)),
          filters: { 'Tool Definition': ['json'] },
          saveLabel: 'Export Tool',
        });
        if (!dest) { break; }
        await vscode.workspace.fs.writeFile(dest, Buffer.from(JSON.stringify(cleanDef, null, 2), 'utf-8'));
        vscode.window.showInformationMessage(`Tool "${toolDef.name}" exported.`);
        break;
      }

      case 'deleteTool': {
        const toolId = msg['toolId'] as string;
        if (!toolId || !this._registry.isCustom(toolId)) { break; }
        const toolDef = this._registry.get(toolId);
        const toolName = toolDef?.name ?? toolId;
        const confirm = await vscode.window.showWarningMessage(
          `Delete custom tool "${toolName}"? This will remove tools/${toolId}.json.`,
          { modal: false },
          'Delete'
        );
        if (confirm !== 'Delete') { break; }
        const fileUri = vscode.Uri.file(path.join(canvasDir, 'tools', `${toolId}.json`));
        try { await vscode.workspace.fs.delete(fileUri); } catch { /* file already gone */ }
        // The tools watcher will fire onDidDelete and reload automatically.
        await this._registry.reloadWorkspaceTools(canvasDir);
        webview.postMessage({ type: 'toolDefs', tools: this._registry.getAll() });
        break;
      }

      case 'createFunctionNode': {
        // Creates a standalone function node on the canvas
        const { toolId: fnToolId, title: fnTitle, paramValues } = msg as {
          type: string; toolId: string; title?: string; paramValues?: Record<string, unknown>;
        };
        if (!fnToolId) { break; }
        const fnToolDef = this._registry.get(fnToolId);
        const newFnNode: CanvasNode = {
          id: uuid(),
          node_type: 'function',
          title: fnTitle || fnToolDef?.name || fnToolId,
          position: { x: 100, y: 100 },
          size: { width: 280, height: 120 },
          meta: {
            ai_tool: fnToolId,
            param_values: { ...(paramValues ?? {}) },
            fn_status: 'idle',
          },
        };
        document.data.nodes.push(newFnNode);
        document.suppressNextRevert = true;
        await writeCanvas(document.uri, document.data);
        webview.postMessage({ type: 'init', data: document.data, workspaceRoot: canvasDir });
        break;
      }

      // ── Pet messages ──

      case 'savePetState': {
        const state = (msg as any).state;
        if (state) {
          await writePetState(canvasDir, state);
        }
        break;
      }

      case 'petSettingChanged': {
        const key = (msg as any).key as string;
        const value = (msg as any).value;
        if (key) {
          const cfg = vscode.workspace.getConfiguration('researchSpace');
          await cfg.update(key, value, vscode.ConfigurationTarget.Global);
        }
        break;
      }

      case 'petAiChat': {
        const { handlePetAiChat } = await import('../pet/pet-ai-handler');
        await handlePetAiChat(webview, document.data, msg as any);
        break;
      }

      case 'petSaveMemory': {
        // Save pet memory as markdown
        const memoryContent = (msg as any).content as string;
        if (memoryContent) {
          const fs = await import('fs');
          const petDir = path.join(canvasDir, 'pet');
          await fs.promises.mkdir(petDir, { recursive: true });
          await fs.promises.writeFile(
            path.join(petDir, 'memory.md'),
            memoryContent,
            'utf-8',
          );
        }
        break;
      }
    }
  }

  private _buildSettingsSnapshot(): SettingsSnapshot {
    const ai = vscode.workspace.getConfiguration('researchSpace.ai');
    const canvas = vscode.workspace.getConfiguration('researchSpace.canvas');
    const pet = vscode.workspace.getConfiguration('researchSpace.pet');
    return {
      globalProvider:           ai.get<string>('provider', 'copilot'),
      copilotModel:             ai.get<string>('copilotModel', ''),
      anthropicApiKey:          ai.get<string>('anthropicApiKey', ''),
      anthropicModel:           ai.get<string>('anthropicModel', 'claude-sonnet-4-5'),
      ollamaBaseUrl:            ai.get<string>('ollamaBaseUrl', 'http://localhost:11434'),
      ollamaModel:              ai.get<string>('ollamaModel', 'llama3.2'),
      autoSave:                 canvas.get<boolean>('autoSave', true),
      customProviders:          ai.get<CustomProviderConfig[]>('customProviders', []),
      aiHubMixApiKey:           ai.get<string>('aiHubMixApiKey', ''),
      aiHubMixImageGenModel:    ai.get<string>('aiHubMixImageGenModel', ''),
      aiHubMixImageEditModel:   ai.get<string>('aiHubMixImageEditModel', ''),
      aiHubMixTtsModel:         ai.get<string>('aiHubMixTtsModel', ''),
      aiHubMixSttModel:         ai.get<string>('aiHubMixSttModel', ''),
      aiHubMixVideoGenModel:    ai.get<string>('aiHubMixVideoGenModel', ''),
      petAiProvider:            pet.get<string>('aiProvider', 'auto'),
      petAiModel:               pet.get<string>('aiModel', ''),
    };
  }

  private async _handleUpdateSetting(key: string, value: unknown): Promise<void> {
    const target = vscode.ConfigurationTarget.Global;
    const ai = vscode.workspace.getConfiguration('researchSpace.ai');
    const canvasCfg = vscode.workspace.getConfiguration('researchSpace.canvas');
    switch (key) {
      case 'globalProvider':          await ai.update('provider', value, target);                break;
      case 'copilotModel':            await ai.update('copilotModel', value, target);            break;
      case 'anthropicApiKey':         await ai.update('anthropicApiKey', value, target);         break;
      case 'anthropicModel':          await ai.update('anthropicModel', value, target);          break;
      case 'ollamaBaseUrl':           await ai.update('ollamaBaseUrl', value, target);           break;
      case 'ollamaModel':             await ai.update('ollamaModel', value, target);             break;
      case 'autoSave':                await canvasCfg.update('autoSave', value, target);         break;
      case 'customProviders':         await ai.update('customProviders', value, target);         break;
      case 'aiHubMixApiKey':          await ai.update('aiHubMixApiKey', value, target);          break;
      case 'aiHubMixImageGenModel':   await ai.update('aiHubMixImageGenModel', value, target);   break;
      case 'aiHubMixImageEditModel':  await ai.update('aiHubMixImageEditModel', value, target);  break;
      case 'aiHubMixTtsModel':        await ai.update('aiHubMixTtsModel', value, target);        break;
      case 'aiHubMixSttModel':        await ai.update('aiHubMixSttModel', value, target);        break;
      case 'aiHubMixVideoGenModel':   await ai.update('aiHubMixVideoGenModel', value, target);   break;
      case 'petAiProvider': {
        const petCfg = vscode.workspace.getConfiguration('researchSpace.pet');
        await petCfg.update('aiProvider', value, target);
        break;
      }
      case 'petAiModel': {
        const petCfg = vscode.workspace.getConfiguration('researchSpace.pet');
        await petCfg.update('aiModel', value, target);
        break;
      }
    }
  }

  // ── HTML ──────────────────────────────────────────────────────────────────

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = uuid().replace(/-/g, '');
    const cspSource = webview.cspSource;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview', 'research-space-webview.css')
    );

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' 'unsafe-eval';
             style-src 'unsafe-inline' ${cspSource};
             img-src data: ${cspSource} blob:;
             media-src ${cspSource} blob:;
             font-src 'self' data: ${cspSource};
             frame-src ${cspSource};
             object-src ${cspSource};
             connect-src ${cspSource} blob:;
             worker-src blob:;">
  <title>Research Canvas</title>
  <link rel="stylesheet" href="${styleUri}"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body,#root{width:100%;height:100%;overflow:hidden}
    body{background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-editor-foreground,#d4d4d4);font-family:var(--vscode-font-family,sans-serif)}
    #rs-loading{display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;color:#888}
  </style>
</head>
<body>
  <div id="root"><div id="rs-loading">Loading Research Space…</div></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
