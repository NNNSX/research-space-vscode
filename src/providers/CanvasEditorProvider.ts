import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { CanvasFile, SettingsSnapshot, CustomProviderConfig, CanvasNode, NodeMeta, isBlueprintInstanceContainerNode, isCanvasFile, isFunctionNode } from '../core/canvas-model';
import { readCanvas, writeCanvas, setDataNodeRegistry, ensureAiOutputDir, toRelPath } from '../core/storage';
import { runFunctionNode, runBatchFunctionNode, cancelRun, cancelRunByNodeId, setToolRegistry } from '../ai/function-runner';
import { runPipeline, pausePipeline, resumePipeline, cancelPipeline } from '../pipeline/pipeline-runner';
import { getProviderById } from '../ai/provider';
import { ToolRegistry } from '../ai/tool-registry';
import { DataNodeRegistry } from '../core/data-node-registry';
import { readPetState, writePetState, readPetSettings } from '../pet/pet-memory';
import { extractPreviewWithMeta } from '../core/content-extractor';
import { deleteBlueprintDefinition, listBlueprintDefinitions, readBlueprintDefinition, saveBlueprintDefinition } from '../blueprint/blueprint-registry';
import { runBlueprintInstance } from '../blueprint/blueprint-runner';
import { explodeDocumentNodeViaMinerU } from '../explosion/mineru-pdf-explosion';
import { isMinerUSupportedFilePath, MINERU_SUPPORTED_FILE_HINT } from '../core/explosion-file-types';
import { MinerUError, formatMinerUErrorForDisplay } from '../explosion/mineru-adapter';
import { runConversionDiagnostics } from '../explosion/conversion-diagnostics';
import { buildSelectedNodesMarkdown, type SelectedMarkdownContent } from '../export/selected-markdown';
import { createDefaultMindMap, mindMapSummaryToPreview, normalizeMindMapFile, summarizeMindMap } from '../mindmap/mindmap-model';
import type { MindMapFile, MindMapItem } from '../mindmap/mindmap-model';
import { createMindMapFile, readMindMapFile } from '../mindmap/mindmap-storage';
import { mindMapToMarkdown } from '../mindmap/mindmap-markdown';
import { mindMapToXMindBuffer } from '../mindmap/xmind-codec';
import { saveMindMapToCanvasNode } from '../mindmap/mindmap-canvas-sync';

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

type OutputHistoryNodeType = 'ai_output' | 'image' | 'audio' | 'video';

function inferOutputHistoryNodeType(filePath: string, fallback?: string): OutputHistoryNodeType {
  if (fallback === 'image' || fallback === 'audio' || fallback === 'video' || fallback === 'ai_output') {
    return fallback;
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'].includes(ext)) {
    return 'image';
  }
  if (['mp3', 'wav', 'opus', 'aac', 'flac', 'm4a', 'ogg', 'oga', 'webm'].includes(ext)) {
    return 'audio';
  }
  if (['mp4', 'mov', 'm4v'].includes(ext)) {
    return 'video';
  }
  return 'ai_output';
}

function extractOutputHistoryFamilyKey(filePath: string): string | null {
  const basename = path.basename(filePath);
  const match = basename.match(/^(.*)_\d{4}_\d{6}(?:_\d+)?\.[^.]+$/);
  return match?.[1] ?? null;
}

function extractOutputHistorySortKey(filePath: string): string {
  const basename = path.basename(filePath);
  const match = basename.match(/_(\d{4}_\d{6})(?:_\d+)?\.[^.]+$/);
  return match?.[1] ?? '';
}

function buildBlueprintCopyTitle(title: string, existingTitles: Set<string>): string {
  const baseTitle = (title.trim() || '新蓝图').replace(/\s*-\s*副本(?:\s+\d+)?$/, '');
  const firstCandidate = `${baseTitle} - 副本`;
  if (!existingTitles.has(firstCandidate)) { return firstCandidate; }
  let index = 2;
  while (existingTitles.has(`${baseTitle} - 副本 ${index}`)) {
    index += 1;
  }
  return `${baseTitle} - 副本 ${index}`;
}

const MARKDOWN_EXPORT_TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdown', 'mkd', 'txt', 'text', 'rst', 'adoc',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'cc', 'cpp', 'cxx',
  'cs', 'rb', 'swift', 'kt', 'r', 'php', 'lua', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'yaml', 'yml', 'json', 'jsonl', 'toml', 'tex', 'bib', 'xml', 'html', 'css', 'scss',
  'sql', 'graphql', 'proto', 'ini', 'cfg', 'env', 'log', 'conf', 'csv', 'tsv',
]);

function sanitizeExportFilename(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
  return cleaned || 'research-space-export';
}

function shouldReadNodeFileForMarkdownExport(node: CanvasNode): boolean {
  if (!node.file_path) { return false; }
  if (['image', 'audio', 'video', 'paper'].includes(node.node_type)) { return false; }
  const ext = path.extname(node.file_path).slice(1).toLowerCase();
  return MARKDOWN_EXPORT_TEXT_EXTENSIONS.has(ext);
}

async function resolveNodeMarkdownExportContent(node: CanvasNode, canvasUri: vscode.Uri): Promise<SelectedMarkdownContent> {
  if (node.node_type === 'mindmap' && node.file_path) {
    try {
      const absPath = path.isAbsolute(node.file_path)
        ? node.file_path
        : path.join(path.dirname(canvasUri.fsPath), node.file_path);
      const mindmap = await readMindMapFile(vscode.Uri.file(absPath));
      const missingImagePaths = await findMissingMindMapImagePaths(mindmap, canvasUri);
      return {
        nodeId: node.id,
        content: mindMapToMarkdown(mindmap, { missingImagePaths }),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        content: node.meta?.content_preview ?? '',
        note: `思维导图读取失败，已使用节点预览内容：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (!node.file_path || !shouldReadNodeFileForMarkdownExport(node)) {
    return {
      nodeId: node.id,
      content: node.meta?.content_preview ?? '',
      note: node.file_path ? '当前文件类型未直接读取，已使用节点预览内容。' : undefined,
    };
  }

  try {
    const absPath = path.isAbsolute(node.file_path)
      ? node.file_path
      : path.join(path.dirname(canvasUri.fsPath), node.file_path);
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
    return {
      nodeId: node.id,
      content: Buffer.from(bytes).toString('utf-8'),
    };
  } catch (error) {
    return {
      nodeId: node.id,
      content: node.meta?.content_preview ?? '',
      note: `文件读取失败，已使用节点预览内容：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function expandSelectedMarkdownNodes(canvas: CanvasFile, selectedNodeIds: string[]): CanvasNode[] {
  const nodesById = new Map(canvas.nodes.map(node => [node.id, node]));
  const selectedIdSet = new Set(selectedNodeIds);
  const added = new Set<string>();
  const result: CanvasNode[] = [];

  const addNode = (node: CanvasNode | undefined) => {
    if (!node || added.has(node.id)) { return; }
    added.add(node.id);
    result.push(node);
  };

  for (const nodeId of selectedNodeIds) {
    const node = nodesById.get(nodeId);
    addNode(node);
    if (node?.node_type !== 'group_hub') { continue; }
    const group = (canvas.nodeGroups ?? []).find(candidate =>
      candidate.hubNodeId === node.id || candidate.id === node.meta?.hub_group_id
    );
    for (const memberId of group?.nodeIds ?? []) {
      addNode(nodesById.get(memberId));
    }
  }

  for (const node of canvas.nodes) {
    if (selectedIdSet.has(node.id)) {
      addNode(node);
    }
  }

  return result;
}

function collectMindMapImagePaths(file: MindMapFile): string[] {
  const paths: string[] = [];
  const visit = (item: MindMapItem) => {
    for (const image of item.images ?? []) {
      if (image.file_path) {
        paths.push(image.file_path);
      }
    }
    for (const child of item.children ?? []) {
      visit(child);
    }
  };
  visit(file.root);
  return paths;
}

async function findMissingMindMapImagePaths(file: MindMapFile, canvasUri: vscode.Uri): Promise<Set<string>> {
  const missing = new Set<string>();
  for (const imagePath of collectMindMapImagePaths(file)) {
    const absPath = path.isAbsolute(imagePath)
      ? imagePath
      : path.join(path.dirname(canvasUri.fsPath), imagePath);
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
    } catch {
      missing.add(imagePath);
    }
  }
  return missing;
}

// ── Canvas Document ─────────────────────────────────────────────────────────

export class CanvasDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  data: CanvasFile;
  private readonly _undoStack: CanvasFile[] = [];
  private readonly _redoStack: CanvasFile[] = [];

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

  private _cloneCanvas(data: CanvasFile): CanvasFile {
    return JSON.parse(JSON.stringify(data)) as CanvasFile;
  }

  applyEdit(nextData: CanvasFile): void {
    if (JSON.stringify(nextData) === JSON.stringify(this.data)) { return; }
    this._undoStack.push(this._cloneCanvas(this.data));
    if (this._undoStack.length > 100) {
      this._undoStack.shift();
    }
    this._redoStack.length = 0;
    this.data = this._cloneCanvas(nextData);
    this._onDidChange.fire();
  }

  undo(): void {
    const previous = this._undoStack.pop();
    if (!previous) { return; }
    this._redoStack.push(this._cloneCanvas(this.data));
    this.data = previous;
  }

  redo(): void {
    const next = this._redoStack.pop();
    if (!next) { return; }
    this._undoStack.push(this._cloneCanvas(this.data));
    this.data = next;
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
  static readonly canvasSessionIds = new Map<string, number>();
  /** Exposed so extension.ts file watcher can call shouldWatchContent() */
  static dataNodeRegistry: DataNodeRegistry | null = null;

  /** Mark the document so the next VSCode-triggered revert (from our own write) is skipped. */
  static suppressRevert(canvasPath: string): void {
    const doc = CanvasEditorProvider.activeDocuments.get(canvasPath);
    if (doc) { doc.suppressNextRevert = true; }
  }

  static bumpCanvasSession(canvasPath: string): number {
    const next = (CanvasEditorProvider.canvasSessionIds.get(canvasPath) ?? 0) + 1;
    CanvasEditorProvider.canvasSessionIds.set(canvasPath, next);
    return next;
  }

  static getCanvasSession(canvasPath: string): number {
    return CanvasEditorProvider.canvasSessionIds.get(canvasPath) ?? 0;
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

  private _syncDocumentToWebview(document: CanvasDocument): void {
    const wv = CanvasEditorProvider.activeWebviews.get(document.uri.fsPath);
    const sessionId = CanvasEditorProvider.bumpCanvasSession(document.uri.fsPath);
    wv?.postMessage({
      type: 'init',
      data: document.data,
      workspaceRoot: path.dirname(document.uri.fsPath),
      sessionId,
    });
  }

  applyTestEdit(document: CanvasDocument, nextData: CanvasFile): boolean {
    const before = JSON.stringify(document.data);
    document.applyEdit(nextData);
    if (JSON.stringify(document.data) === before) { return false; }
    this._syncDocumentToWebview(document);
    return true;
  }

  undoTestEdit(document: CanvasDocument): boolean {
    const before = JSON.stringify(document.data);
    this._undoDocumentEdit(document);
    return JSON.stringify(document.data) !== before;
  }

  redoTestEdit(document: CanvasDocument): boolean {
    const before = JSON.stringify(document.data);
    this._redoDocumentEdit(document);
    return JSON.stringify(document.data) !== before;
  }

  private _undoDocumentEdit(document: CanvasDocument): void {
    document.undo();
    this._syncDocumentToWebview(document);
  }

  private _redoDocumentEdit(document: CanvasDocument): void {
    document.redo();
    this._syncDocumentToWebview(document);
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
          undo: () => this._undoDocumentEdit(doc),
          redo: () => this._redoDocumentEdit(doc),
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
    const initialCanvasSessionId = CanvasEditorProvider.bumpCanvasSession(document.uri.fsPath);

    // Collect all panel-scoped subscriptions for clean-up on panel close
    const panelDisposables: vscode.Disposable[] = [];

    webviewPanel.onDidDispose(() => {
      CanvasEditorProvider.activeWebviews.delete(document.uri.fsPath);
      CanvasEditorProvider.activeDocuments.delete(document.uri.fsPath);
      CanvasEditorProvider.canvasSessionIds.delete(document.uri.fsPath);
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
    webviewPanel.webview.postMessage({
      type: 'init',
      data: document.data,
      workspaceRoot: canvasDir,
      sessionId: initialCanvasSessionId,
    });
    webviewPanel.webview.postMessage({ type: 'settingsSnapshot', settings: this._buildSettingsSnapshot() });
    // Push node defs (always available since loaded in constructor)
    webviewPanel.webview.postMessage({ type: 'nodeDefs', defs: this._nodeRegistry.getAll() });
    await this._postPetBootstrap(webviewPanel.webview, canvasDir);
    listBlueprintDefinitions(canvasDir).then(entries => {
      webviewPanel.webview.postMessage({ type: 'blueprintIndex', entries, sessionId: initialCanvasSessionId });
    }).catch(() => {
      webviewPanel.webview.postMessage({ type: 'blueprintIndex', entries: [], sessionId: initialCanvasSessionId });
    });

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

    const blueprintsWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(canvasDir, 'blueprints/*.blueprint.json')
    );
    const refreshBlueprints = async () => {
      const sessionId = CanvasEditorProvider.canvasSessionIds.get(document.uri.fsPath) ?? 0;
      const entries = await listBlueprintDefinitions(canvasDir);
      webviewPanel.webview.postMessage({ type: 'blueprintIndex', entries, sessionId });
    };
    blueprintsWatcher.onDidCreate(refreshBlueprints);
    blueprintsWatcher.onDidChange(refreshBlueprints);
    blueprintsWatcher.onDidDelete(refreshBlueprints);
    panelDisposables.push(blueprintsWatcher);
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
    this._syncDocumentToWebview(document);
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

  private async _prepareExecutionCanvas(
    msg: { [key: string]: unknown },
    document: CanvasDocument
  ): Promise<CanvasFile> {
    const incomingCanvas = msg['canvas'];
    if (isCanvasFile(incomingCanvas)) {
      document.data = incomingCanvas;
    }
    document.suppressNextRevert = true;
    await writeCanvas(document.uri, document.data);
    return document.data;
  }

  private async _prepareExecutionContext(
    msg: { [key: string]: unknown },
    document: CanvasDocument,
    targetKey: 'nodeId' | 'triggerNodeId',
  ): Promise<{ canvas: CanvasFile; targetNode: CanvasNode }> {
    const executionCanvas = await this._prepareExecutionCanvas(msg, document);
    const rawTargetId = msg[targetKey];
    const targetId = typeof rawTargetId === 'string' ? rawTargetId : '';
    const targetNode = executionCanvas.nodes.find(node => node.id === targetId);
    if (!targetNode) {
      throw new Error(targetKey === 'triggerNodeId' ? '找不到 Pipeline 触发节点。' : '找不到要运行的功能节点。');
    }
    if (!isFunctionNode(targetNode)) {
      throw new Error('执行入口只能绑定到功能节点。');
    }
    return { canvas: executionCanvas, targetNode };
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
      case 'ready': {
        const sessionId = CanvasEditorProvider.bumpCanvasSession(document.uri.fsPath);
        webview.postMessage({ type: 'init', data: document.data, workspaceRoot: canvasDir, sessionId });
        webview.postMessage({ type: 'settingsSnapshot', settings: this._buildSettingsSnapshot() });
        webview.postMessage({ type: 'toolDefs', tools: this._registry.getAll() });
        webview.postMessage({ type: 'nodeDefs', defs: this._nodeRegistry.getAll() });
        webview.postMessage({ type: 'blueprintIndex', entries: await listBlueprintDefinitions(canvasDir), sessionId });
        await this._postPetBootstrap(webview, canvasDir);
        break;
      }

      case 'requestSettingsSnapshot':
        webview.postMessage({ type: 'settingsSnapshot', settings: this._buildSettingsSnapshot() });
        break;

      case 'requestConversionDiagnostics': {
        try {
          const report = await runConversionDiagnostics();
          webview.postMessage({ type: 'conversionDiagnostics', report });
        } catch (e) {
          webview.postMessage({
            type: 'conversionDiagnosticsError',
            message: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }

      case 'canvasStateSync': {
        const newData = msg['data'] as CanvasFile;
        if (!newData) { break; }
        // Keep extension-side in-memory canvas state aligned with the live webview
        // without writing to disk or touching save status. This lets file watchers,
        // rename handlers, and execution prep see newly created / moved nodes
        // immediately instead of waiting for the next canvas save.
        document.data = newData;
        break;
      }

      case 'canvasChanged': {
        const newData = msg['data'] as CanvasFile;
        const requestId = msg['requestId'] as number | undefined;
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
          webview.postMessage({ type: 'canvasSaveStatus', status: 'saved', savedAt: Date.now(), mode: 'auto', requestId });
        } catch (e: unknown) {
          const msg2 = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'canvasSaveStatus', status: 'error', message: msg2, mode: 'auto', requestId });
          webview.postMessage({ type: 'toastError', message: `Auto-save failed: ${msg2}` });
        }
        break;
      }

      case 'saveCanvas': {
        const newData = msg['data'] as CanvasFile;
        const requestId = msg['requestId'] as number | undefined;
        if (!newData) { break; }
        document.data = newData;
        document.suppressNextRevert = true;
        try {
          await writeCanvas(document.uri, document.data);
          webview.postMessage({ type: 'canvasSaveStatus', status: 'saved', savedAt: Date.now(), mode: 'manual', requestId });
        } catch (e: unknown) {
          const msg2 = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'canvasSaveStatus', status: 'error', message: msg2, mode: 'manual', requestId });
          webview.postMessage({ type: 'toastError', message: `保存失败: ${msg2}` });
        }
        break;
      }

      case 'exportSelectedMarkdown': {
        const selectedNodeIds = Array.isArray(msg['selectedNodeIds'])
          ? msg['selectedNodeIds'].filter((id): id is string => typeof id === 'string')
          : [];
        const executionCanvas = isCanvasFile(msg['canvas']) ? msg['canvas'] : document.data;
        const selectedNodes = expandSelectedMarkdownNodes(executionCanvas, selectedNodeIds);
        if (selectedNodes.length === 0) {
          webview.postMessage({ type: 'toastError', message: '请先选择要导出的节点。' });
          break;
        }

        const contents = await Promise.all(
          selectedNodes.map(node => resolveNodeMarkdownExportContent(node, document.uri))
        );
        const markdown = buildSelectedNodesMarkdown({
          canvasTitle: executionCanvas.metadata.title,
          nodes: selectedNodes,
          contents,
        });
        const defaultName = `${sanitizeExportFilename(executionCanvas.metadata.title)}-selected.md`;
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(path.join(canvasDir, defaultName)),
          filters: { Markdown: ['md'] },
          saveLabel: '导出选中节点',
        });
        if (!saveUri) { break; }
        await vscode.workspace.fs.writeFile(saveUri, Buffer.from(markdown, 'utf-8'));
        vscode.window.showInformationMessage(`已导出选中节点：${path.basename(saveUri.fsPath)}`);
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
        const { DEFAULT_SIZES } = await import('../core/canvas-model');
        const initialContent = `# ${title}\n`;
        const newNode = {
          id: require('uuid').v4(),
          node_type: 'note' as const,
          title,
          position: { x: 0, y: 0 },
          size: DEFAULT_SIZES['note'],
          meta: {
            content_preview: initialContent,
            staging_origin: 'draft' as const,
            staging_materialize_kind: 'note' as const,
            staging_initial_content: initialContent,
          },
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
        const date = new Date().toISOString().slice(0, 10);
        const content = `# ${title}\n\n- **状态**: 进行中\n- **日期**: ${date}\n- **参数**: \n- **结果**: \n`;
        const { DEFAULT_SIZES } = await import('../core/canvas-model');
        const newNode = {
          id: require('uuid').v4(),
          node_type: 'experiment_log' as const,
          title,
          position: { x: 0, y: 0 },
          size: DEFAULT_SIZES['experiment_log'],
          meta: {
            experiment_status: 'running',
            experiment_date: date,
            content_preview: content,
            staging_origin: 'draft' as const,
            staging_materialize_kind: 'experiment_log' as const,
            staging_initial_content: content,
          },
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
        const content = `# ${title}\n\n*暂无任务*\n`;
        const { DEFAULT_SIZES } = await import('../core/canvas-model');
        const newNode = {
          id: require('uuid').v4(),
          node_type: 'task' as const,
          title,
          position: { x: 0, y: 0 },
          size: DEFAULT_SIZES['task'],
          meta: {
            task_items: [],
            content_preview: content,
            staging_origin: 'draft' as const,
            staging_materialize_kind: 'task' as const,
            staging_initial_content: content,
          },
        };
        webview.postMessage({ type: 'stageNodes', nodes: [newNode] });
        break;
      }

      case 'newMindMap': {
        const inputTitle = await vscode.window.showInputBox({
          prompt: '思维导图标题',
          placeHolder: '思维导图',
          value: (msg['title'] as string) || '',
        });
        if (inputTitle === undefined) { break; }
        const title = inputTitle.trim() || '思维导图';
        const mindmap = createDefaultMindMap(title);
        const summary = summarizeMindMap(mindmap);
        const { DEFAULT_SIZES } = await import('../core/canvas-model');
        const newNode = {
          id: require('uuid').v4(),
          node_type: 'mindmap' as const,
          title,
          position: { x: 0, y: 0 },
          size: DEFAULT_SIZES['mindmap'],
          meta: {
            content_preview: mindMapSummaryToPreview(summary),
            mindmap_summary: summary,
            staging_origin: 'draft' as const,
            staging_materialize_kind: 'mindmap' as const,
            staging_initial_content: JSON.stringify(mindmap),
          },
        };
        webview.postMessage({ type: 'stageNodes', nodes: [newNode] });
        break;
      }

      case 'materializeStagingNode': {
        const sourceNodeId = msg['sourceNodeId'] as string;
        const nodeType = msg['nodeType'] as 'note' | 'experiment_log' | 'task' | 'mindmap';
        const rawTitle = msg['title'] as string;
        const content = msg['content'] as string;
        const position = msg['position'] as { x: number; y: number } | undefined;
        if (!sourceNodeId || !nodeType || !rawTitle || !position) { break; }
        try {
          const title = rawTitle.trim() || (
            nodeType === 'note' ? '新建笔记' :
            nodeType === 'experiment_log' ? '实验记录' :
            nodeType === 'task' ? '任务清单' :
            '思维导图'
          );
          const stagedNode = document.data.stagingNodes?.find(node => node.id === sourceNodeId);
          const baseMeta = { ...(stagedNode?.meta ?? {}) };
          delete baseMeta.staging_origin;
          delete baseMeta.staging_materialize_kind;
          delete baseMeta.staging_initial_content;

          let displayTitle = title;
          let relPath = '';
          let preview = content;
          let previewMeta: Partial<NodeMeta> = {};

          if (nodeType === 'mindmap') {
            let parsed: unknown;
            try {
              parsed = content ? JSON.parse(content) : undefined;
            } catch {
              parsed = undefined;
            }
            const created = await createMindMapFile(document.uri, title, parsed ?? createDefaultMindMap(title));
            displayTitle = created.displayTitle;
            relPath = created.relPath;
            const summary = summarizeMindMap(created.file);
            preview = mindMapSummaryToPreview(summary);
            previewMeta = {
              mindmap_summary: summary,
              ai_readable_chars: preview.length,
            };
          } else {
            const notesDir = await ensureNotesDir(canvasDir);
            const { uri: fileUri, display } = await uniqueFile(notesDir, title, '.md');
            displayTitle = display;
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content || `# ${displayTitle}\n`, 'utf-8'));

            const { toRelPath } = await import('../core/storage');
            const { extractPreviewWithMeta } = await import('../core/content-extractor');
            relPath = toRelPath(fileUri.fsPath, document.uri);
            const previewData = await extractPreviewWithMeta(fileUri, nodeType);
            preview = previewData.preview || content;
            previewMeta = {
              ai_readable_chars: previewData.ai_readable_chars,
              ai_readable_pages: previewData.ai_readable_pages,
              has_unreadable_content: previewData.has_unreadable_content || undefined,
              unreadable_hint: previewData.unreadable_hint,
              csv_rows: previewData.csv_rows,
              csv_cols: previewData.csv_cols,
            };
          }

          const newNode: CanvasNode = {
            id: sourceNodeId,
            node_type: nodeType,
            title: displayTitle,
            position: { x: 0, y: 0 },
            size: stagedNode?.size ?? ({
              note: { width: 280, height: 160 },
              experiment_log: { width: 320, height: 300 },
              task: { width: 300, height: 240 },
              mindmap: { width: 340, height: 240 },
            }[nodeType]),
            file_path: relPath,
            meta: {
              ...baseMeta,
              content_preview: preview,
              file_missing: false,
              ...previewMeta,
            },
          };

          webview.postMessage({ type: 'stagingNodeMaterialized', sourceNodeId, node: newNode, position });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'stagingNodeMaterializeFailed', sourceNodeId, message });
        }
        break;
      }

      case 'readMindMapFile': {
        const nodeId = msg['nodeId'] as string;
        const filePath = msg['filePath'] as string;
        if (!nodeId || !filePath) { break; }
        try {
          const { toAbsPath } = await import('../core/storage');
          const absPath = toAbsPath(filePath, document.uri);
          const mindmap = await readMindMapFile(vscode.Uri.file(absPath));
          webview.postMessage({ type: 'mindMapFileLoaded', nodeId, filePath, mindmap });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'mindMapError', nodeId, message: `思维导图读取失败：${message}` });
        }
        break;
      }

      case 'saveMindMapFile': {
        const nodeId = msg['nodeId'] as string;
        const filePath = msg['filePath'] as string;
        const input = msg['mindmap'] as unknown;
        if (!nodeId || !filePath || !input) { break; }
        try {
          const saved = await saveMindMapToCanvasNode(document.uri, nodeId, filePath, input);
          document.data = await readCanvas(document.uri);
          webview.postMessage({
            type: 'mindMapFileSaved',
            nodeId,
            filePath,
            title: saved.title,
            mindmap: saved.written,
            summary: saved.summary,
            preview: saved.preview,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'mindMapError', nodeId, message: `思维导图保存失败：${message}` });
        }
        break;
      }

      case 'pickMindMapImage': {
        const nodeId = msg['nodeId'] as string;
        const itemId = msg['itemId'] as string;
        if (!nodeId || !itemId) { break; }
        try {
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            title: '选择要嵌入思维导图的图片',
            filters: {
              Images: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
            },
          });
          const uri = picked?.[0];
          if (!uri) { break; }
          const { toRelPath } = await import('../core/storage');
          const relPath = toRelPath(uri.fsPath, document.uri);
          webview.postMessage({
            type: 'mindMapImagePicked',
            nodeId,
            itemId,
            image: {
              id: uuid(),
              file_path: relPath,
              caption: path.basename(uri.fsPath),
            },
            uri: webview.asWebviewUri(uri).toString(),
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'mindMapError', nodeId, message: `选择图片失败：${message}` });
        }
        break;
      }

      case 'exportMindMapMarkdown': {
        const nodeId = msg['nodeId'] as string;
        const filePath = msg['filePath'] as string;
        const input = msg['mindmap'] as unknown;
        if (!nodeId || !filePath || !input) { break; }
        try {
          const mindmap = normalizeMindMapFile(input);
          const missingImagePaths = await findMissingMindMapImagePaths(mindmap, document.uri);
          const markdown = mindMapToMarkdown(mindmap, { missingImagePaths });
          const defaultName = `${sanitizeExportFilename(mindmap.root.text || mindmap.title || '思维导图')}.md`;
          const dest = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(canvasDir, defaultName)),
            filters: { Markdown: ['md'] },
            saveLabel: '导出思维导图 Markdown',
          });
          if (!dest) { break; }
          await vscode.workspace.fs.writeFile(dest, Buffer.from(markdown, 'utf-8'));
          vscode.window.showInformationMessage(`已导出思维导图：${path.basename(dest.fsPath)}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'mindMapError', nodeId, message: `导出思维导图失败：${message}` });
        }
        break;
      }

      case 'exportMindMapXMind': {
        const nodeId = msg['nodeId'] as string;
        const filePath = msg['filePath'] as string;
        const input = msg['mindmap'] as unknown;
        if (!nodeId || !filePath || !input) { break; }
        try {
          const mindmap = normalizeMindMapFile(input);
          const xmind = mindMapToXMindBuffer(mindmap);
          const defaultName = `${sanitizeExportFilename(mindmap.root.text || mindmap.title || '思维导图')}.xmind`;
          const dest = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(canvasDir, defaultName)),
            filters: { XMind: ['xmind'] },
            saveLabel: '导出 XMind',
          });
          if (!dest) { break; }
          await vscode.workspace.fs.writeFile(dest, xmind);
          vscode.window.showInformationMessage(`已导出 XMind：${path.basename(dest.fsPath)}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          webview.postMessage({ type: 'mindMapError', nodeId, message: `导出 XMind 失败：${message}` });
        }
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
        // Guardrail: no current webview UI should call deleteNote directly.
        // If a future UI re-exposes this action to users, it must provide at
        // least one explicit confirmation layer in the webview or host.
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

      case 'explodePdfNode': {
        const nodeId = msg['nodeId'] as string;
        if (!nodeId) { break; }
        const sourceNode = document.data.nodes.find(node => node.id === nodeId);
        if (!sourceNode) {
          webview.postMessage({ type: 'toastError', message: '找不到要转换的文件节点。' });
          break;
        }
        if (!isMinerUSupportedFilePath(sourceNode.file_path)) {
          webview.postMessage({ type: 'toastError', message: `当前节点不是受支持的文件，MinerU 当前仅支持 ${MINERU_SUPPORTED_FILE_HINT}。` });
          break;
        }
        try {
          const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Research Space：正在拆解 ${sourceNode.title || '文件'}`,
            cancellable: false,
          }, async progress => explodeDocumentNodeViaMinerU(sourceNode, document.uri, {
            onProgress: message => {
              progress.report({ message });
            },
          }));
          webview.postMessage({
            type: 'pdfExploded',
            sourceNodeId: result.sourceNodeId,
            groupName: result.groupName,
            nodes: result.nodes,
            warnings: result.warnings,
          });
          if (result.warnings.length > 0) {
            vscode.window.showWarningMessage(`文件转换已完成，但有 ${result.warnings.length} 条提示：${result.warnings[0]}`);
          }
        } catch (e) {
          const message = formatMinerUErrorForDisplay(e);
          webview.postMessage({ type: 'toastError', message: `文件转换失败: ${message}` });
          if (e instanceof MinerUError && (e.code === 'config_missing_token' || e.code === 'api_auth_failed')) {
            const action = await vscode.window.showErrorMessage(
              message,
              '打开 MinerU 设置',
            );
            if (action === '打开 MinerU 设置') {
              await vscode.commands.executeCommand('workbench.action.openSettings', 'researchSpace.explosion.mineru');
            }
          }
        }
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
          } else if (['doc', 'dot', 'docx', 'docm', 'dotx', 'dotm', 'ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm', 'xls', 'xlt', 'xlsx', 'xlsm', 'xltx', 'xltm', 'rtf', 'odt', 'ods', 'odp', 'fodt', 'fods', 'fodp', 'epub'].includes(ext)) {
            const { extractStructuredTextFile } = await import('../core/content-extractor');
            content = await extractStructuredTextFile(absPath, ext);
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
        const { canvas, targetNode } = await this._prepareExecutionContext(msg, document, 'nodeId');
        runFunctionNode(targetNode.id, canvas, document.uri, webview).catch(e => {
          webview.postMessage({ type: 'aiError', runId: targetNode.id, nodeId: targetNode.id, message: String(e), issueKind: 'run_failed' });
        });
        break;
      }

      case 'runBatchFunction': {
        const nodeId = msg['nodeId'] as string;
        if (!nodeId) { break; }
        const { canvas, targetNode } = await this._prepareExecutionContext(msg, document, 'nodeId');
        runBatchFunctionNode(targetNode.id, canvas, document.uri, webview).catch(e => {
          webview.postMessage({ type: 'aiError', runId: targetNode.id, nodeId: targetNode.id, message: String(e), issueKind: 'run_failed' });
        });
        break;
      }

      case 'cancelAI': {
        const runId = msg['runId'] as string;
        if (runId) { cancelRun(runId); }
        break;
      }

      case 'cancelFunction': {
        const nodeId = msg['nodeId'] as string;
        if (nodeId) {
          cancelRunByNodeId(nodeId);
          webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
        }
        break;
      }

      case 'runPipeline': {
        const triggerNodeId = msg['triggerNodeId'] as string;
        if (!triggerNodeId) { break; }
        const { canvas, targetNode } = await this._prepareExecutionContext(msg, document, 'triggerNodeId');
        runPipeline(targetNode.id, canvas, document.uri, webview).catch(e => {
          webview.postMessage({ type: 'error', message: `Pipeline 执行失败: ${String(e)}` });
        });
        break;
      }

      case 'runBlueprint': {
        const nodeId = msg['nodeId'] as string;
        const resumeFromFailure = msg['resumeFromFailure'] === true;
        if (!nodeId) { break; }
        const canvas = await this._prepareExecutionCanvas(msg, document);
        const targetNode = canvas.nodes.find(node => node.id === nodeId);
        if (!targetNode) {
          webview.postMessage({ type: 'error', message: '找不到蓝图实例容器。' });
          break;
        }
        if (!isBlueprintInstanceContainerNode(targetNode)) {
          webview.postMessage({ type: 'error', message: '蓝图运行入口只能绑定到正式蓝图实例容器。' });
          break;
        }
        runBlueprintInstance(targetNode.id, canvas, document.uri, webview, { resumeFromFailure }).catch(e => {
          webview.postMessage({ type: 'error', message: `蓝图执行失败: ${String(e)}` });
        });
        break;
      }

      case 'createBlueprintDraft': {
        const selectedNodeIds = Array.isArray(msg['selectedNodeIds'])
          ? (msg['selectedNodeIds'] as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0)
          : [];
        if (selectedNodeIds.length === 0) {
          webview.postMessage({ type: 'toastError', message: '请先选择一段工作流，再创建蓝图。' });
          break;
        }
        try {
          const canvas = (msg['canvas'] as import('../core/canvas-model').CanvasFile | undefined) ?? document.data;
          const { buildBlueprintDraftFromSelection } = await import('../blueprint/blueprint-builder');
          const draft = buildBlueprintDraftFromSelection(selectedNodeIds, canvas);
          webview.postMessage({ type: 'blueprintDraftCreated', draft });
        } catch (e) {
          webview.postMessage({ type: 'toastError', message: `创建蓝图草稿失败: ${String(e)}` });
        }
        break;
      }

      case 'createBlueprintDraftFromInstance': {
        const nodeId = typeof msg['nodeId'] === 'string' ? msg['nodeId'].trim() : '';
        if (!nodeId) {
          webview.postMessage({ type: 'toastError', message: '蓝图实例无效，无法基于当前实例生成蓝图草稿。' });
          break;
        }
        try {
          const canvas = (msg['canvas'] as import('../core/canvas-model').CanvasFile | undefined) ?? document.data;
          const { buildBlueprintDraftFromInstance } = await import('../blueprint/blueprint-builder');
          const draft = buildBlueprintDraftFromInstance(nodeId, canvas);
          const entries = await listBlueprintDefinitions(canvasDir);
          draft.title = buildBlueprintCopyTitle(draft.title, new Set(entries.map(entry => entry.title.trim())));
          webview.postMessage({ type: 'blueprintDraftCreated', draft });
        } catch (e) {
          webview.postMessage({ type: 'toastError', message: `基于当前实例创建蓝图草稿失败: ${String(e)}` });
        }
        break;
      }

      case 'editBlueprintDraft': {
        const filePath = typeof msg['filePath'] === 'string' ? msg['filePath'].trim() : '';
        if (!filePath) {
          webview.postMessage({ type: 'toastError', message: '蓝图文件路径无效，无法进入编辑。' });
          break;
        }
        try {
          const definition = await readBlueprintDefinition(filePath);
          webview.postMessage({
            type: 'blueprintDraftCreated',
            draft: {
              ...definition,
              source_node_ids: [],
              issues: [],
              source_file_path: filePath,
              source_mode: 'edit',
            },
          });
        } catch (e) {
          webview.postMessage({ type: 'toastError', message: `读取蓝图失败: ${String(e)}` });
        }
        break;
      }

      case 'saveBlueprintDraft': {
        const draft = msg['draft'];
        if (!draft || typeof draft !== 'object') {
          webview.postMessage({ type: 'toastError', message: '蓝图草稿无效，无法保存。' });
          break;
        }
        try {
          const overwriteFilePath = typeof (draft as { source_file_path?: unknown }).source_file_path === 'string'
            ? (draft as { source_file_path: string }).source_file_path
            : undefined;
          const entry = await saveBlueprintDefinition(
            canvasDir,
            draft as import('../blueprint/blueprint-types').BlueprintDefinition,
            overwriteFilePath,
          );
          webview.postMessage({ type: 'blueprintDraftSaved', entry });
          webview.postMessage({
            type: 'blueprintIndex',
            entries: await listBlueprintDefinitions(canvasDir),
            sessionId: CanvasEditorProvider.getCanvasSession(document.uri.fsPath),
          });
        } catch (e) {
          webview.postMessage({ type: 'toastError', message: `保存蓝图失败: ${String(e)}` });
        }
        break;
      }

      case 'requestBlueprintIndex': {
        try {
          const requestSessionId = typeof msg['sessionId'] === 'number'
            ? msg['sessionId']
            : CanvasEditorProvider.getCanvasSession(document.uri.fsPath);
          webview.postMessage({
            type: 'blueprintIndex',
            entries: await listBlueprintDefinitions(canvasDir),
            sessionId: requestSessionId,
          });
        } catch (e) {
          webview.postMessage({ type: 'toastError', message: `读取蓝图库失败: ${String(e)}` });
        }
        break;
      }

      case 'requestBlueprintDefinitions': {
        const filePaths = Array.isArray(msg['filePaths'])
          ? (msg['filePaths'] as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [];
        const requestSessionId = typeof msg['sessionId'] === 'number' ? msg['sessionId'] : undefined;
        if (filePaths.length === 0) { break; }
        try {
          const uniquePaths = Array.from(new Set(filePaths));
          const definitions: Array<{ filePath: string; definition: import('../blueprint/blueprint-types').BlueprintDefinition }> = [];
          const failedPaths: string[] = [];
          for (const filePath of uniquePaths) {
            try {
              definitions.push({
                filePath,
                definition: await readBlueprintDefinition(filePath),
              });
            } catch {
              failedPaths.push(filePath);
            }
          }
          webview.postMessage({
            type: 'blueprintDefinitions',
            definitions,
            failedPaths,
            sessionId: requestSessionId,
          });
          break;
        } catch (e) {
          webview.postMessage({ type: 'toastError', message: `读取蓝图定义失败: ${String(e)}` });
        }
        break;
      }

      case 'instantiateBlueprint': {
        const filePath = msg['filePath'];
        if (typeof filePath !== 'string' || !filePath.trim()) {
          webview.postMessage({ type: 'toastError', message: '蓝图文件路径无效，无法实例化。' });
          break;
        }
        try {
          const { readBlueprintDefinition } = await import('../blueprint/blueprint-registry');
          const entries = await listBlueprintDefinitions(canvasDir);
          const entry = entries.find(item => item.file_path === filePath);
          if (!entry) {
            throw new Error(`找不到蓝图索引：${filePath}`);
          }
          const definition = await readBlueprintDefinition(filePath);
          const position = (msg['position'] && typeof msg['position'] === 'object')
            ? (msg['position'] as { x: number; y: number })
            : undefined;
          webview.postMessage({ type: 'blueprintInstantiated', entry, definition, position });
        } catch (e) {
          webview.postMessage({ type: 'toastError', message: `读取蓝图定义失败: ${String(e)}` });
        }
        break;
      }

      case 'deleteBlueprint': {
        const filePath = msg['filePath'];
        if (typeof filePath !== 'string' || !filePath.trim()) {
          webview.postMessage({ type: 'toastError', message: '蓝图文件路径无效，无法删除。' });
          break;
        }
        try {
          const blueprintDir = path.resolve(canvasDir, 'blueprints');
          const normalizedFilePath = path.resolve(filePath);
          const relativePath = path.relative(blueprintDir, normalizedFilePath);
          const isInsideBlueprintDir =
            relativePath.length > 0 &&
            !relativePath.startsWith('..') &&
            !path.isAbsolute(relativePath);
          if (!isInsideBlueprintDir || !normalizedFilePath.endsWith('.blueprint.json')) {
            throw new Error('只能删除当前画布 blueprints/ 目录下的蓝图文件。');
          }

          const entries = await listBlueprintDefinitions(canvasDir);
          const entry = entries.find(item => path.resolve(item.file_path) === normalizedFilePath);
          let fileExists = false;
          try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(normalizedFilePath));
            fileExists = stat.type === vscode.FileType.File;
          } catch {
            fileExists = false;
          }
          if (!entry && !fileExists) {
            webview.postMessage({
              type: 'blueprintIndex',
              entries,
              sessionId: CanvasEditorProvider.getCanvasSession(document.uri.fsPath),
            });
            vscode.window.showInformationMessage(`蓝图文件已不存在：${path.basename(normalizedFilePath)}`);
            break;
          }

          const linkedInstanceCount = document.data.nodes.filter(node =>
            node.node_type === 'blueprint' &&
            typeof node.meta?.blueprint_file_path === 'string' &&
            path.resolve(node.meta.blueprint_file_path) === normalizedFilePath
          ).length;

          const detail = linkedInstanceCount > 0
            ? `当前画布中还有 ${linkedInstanceCount} 个蓝图实例引用该文件。删除后，这些旧实例会保留在画布里，但后续无法再从该蓝图文件恢复定义。`
            : `这会删除 blueprints/${entry?.file_name ?? path.basename(normalizedFilePath)}。`;
          const displayTitle = entry?.title ?? path.basename(normalizedFilePath, '.blueprint.json');
          const confirm = await vscode.window.showWarningMessage(
            `删除蓝图“${displayTitle}”？`,
            { modal: false, detail },
            '删除',
          );
          if (confirm !== '删除') { break; }

          await deleteBlueprintDefinition(normalizedFilePath);
          webview.postMessage({
            type: 'blueprintIndex',
            entries: await listBlueprintDefinitions(canvasDir),
            sessionId: CanvasEditorProvider.getCanvasSession(document.uri.fsPath),
          });
          vscode.window.showInformationMessage(`已删除蓝图：${displayTitle}`);
        } catch (e) {
          webview.postMessage({ type: 'toastError', message: `删除蓝图失败: ${String(e)}` });
        }
        break;
      }

      case 'pipelinePause': {
        const pipelineId = msg['pipelineId'] as string;
        if (pipelineId) { pausePipeline(pipelineId); }
        break;
      }

      case 'pipelineResume': {
        const pipelineId = msg['pipelineId'] as string;
        if (pipelineId) { resumePipeline(pipelineId); }
        break;
      }

      case 'pipelineCancel': {
        const pipelineId = msg['pipelineId'] as string;
        if (pipelineId) { cancelPipeline(pipelineId); }
        break;
      }

      case 'requestOutputHistory': {
        const nodeId = msg['nodeId'] as string;
        const filePath = msg['filePath'] as string;
        const blueprintInstanceId = msg['blueprintInstanceId'] as string | undefined;
        const blueprintSlotId = msg['blueprintSlotId'] as string | undefined;
        const blueprintSlotTitle = msg['blueprintSlotTitle'] as string | undefined;
        if (!nodeId || !filePath) { break; }
        try {
          const aiDir = await ensureAiOutputDir(document.uri);
          const currentNode = document.data.nodes.find(node => node.id === nodeId);
          const currentNodeType = inferOutputHistoryNodeType(filePath, currentNode?.node_type);
          const currentFamilyKey = extractOutputHistoryFamilyKey(filePath);
          const slotBoundNodes = blueprintInstanceId && blueprintSlotId
            ? document.data.nodes.filter(node =>
              node.meta?.blueprint_bound_instance_id === blueprintInstanceId &&
              node.meta?.blueprint_bound_slot_kind === 'output' &&
              node.meta?.blueprint_bound_slot_id === blueprintSlotId &&
              !!node.file_path
            )
            : [];
          const knownFamilyKeys = new Set<string>();
          if (currentFamilyKey) {
            knownFamilyKeys.add(currentFamilyKey);
          }
          for (const node of slotBoundNodes) {
            const familyKey = extractOutputHistoryFamilyKey(node.file_path!);
            if (familyKey) {
              knownFamilyKeys.add(familyKey);
            }
          }
          const entries = await vscode.workspace.fs.readDirectory(aiDir);
          const candidateFiles = entries
            .filter(([, type]) => type === vscode.FileType.File)
            .map(([name]) => name)
            .filter(name => inferOutputHistoryNodeType(name) === currentNodeType);

          const familyMatchedFiles = knownFamilyKeys.size > 0
            ? candidateFiles.filter(name => {
              const familyKey = extractOutputHistoryFamilyKey(name);
              return !!familyKey && knownFamilyKeys.has(familyKey);
            })
            : [];
          const selectedFiles = (familyMatchedFiles.length > 0 ? familyMatchedFiles : candidateFiles)
            .sort((a, b) => {
              const sortKeyDiff = extractOutputHistorySortKey(b).localeCompare(extractOutputHistorySortKey(a));
              if (sortKeyDiff !== 0) { return sortKeyDiff; }
              return b.localeCompare(a);
            });

          type HistEntry = import('../core/canvas-model').OutputHistoryEntry;
          const historyEntries: HistEntry[] = [];
          let previousMarked = false;
          for (const name of selectedFiles) {
            const fileUri = vscode.Uri.joinPath(aiDir, name);
            const relFilePath = toRelPath(fileUri.fsPath, document.uri);
            let preview = '';
            try {
              const result = await extractPreviewWithMeta(fileUri, currentNodeType);
              preview = result.preview.slice(0, 200).replace(/\n/g, ' ');
            } catch { /* skip unreadable */ }
            const sourceNode = document.data.nodes.find(node => node.file_path === relFilePath);
            historyEntries.push({
              filePath: relFilePath,
              filename: name,
              nodeType: currentNodeType,
              preview,
              isCurrent: relFilePath === filePath,
              isPrevious: relFilePath !== filePath && !previousMarked,
              versionRole: relFilePath === filePath
                ? 'current'
                : (!previousMarked ? 'previous' : 'history'),
              sourceNodeId: sourceNode?.id,
              sourceNodeTitle: sourceNode?.title,
            });
            if (relFilePath !== filePath && !previousMarked) {
              previousMarked = true;
            }
          }
          webview.postMessage({
            type: 'outputHistory',
            nodeId,
            entries: historyEntries,
            scope: blueprintInstanceId && blueprintSlotId ? 'blueprint_slot' : 'node',
            title: blueprintInstanceId && blueprintSlotId
              ? (blueprintSlotTitle ? `输出槽位历史 · ${blueprintSlotTitle}` : '输出槽位历史')
              : '生成历史',
            subtitle: blueprintInstanceId && blueprintSlotId
              ? '按当前槽位的输出家族聚合；当前版本仍以槽位当前输出为准。'
              : '按当前输出节点的结果家族聚合。',
          });
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
          const restoreNodeType = inferOutputHistoryNodeType(restoreFilePath, msg['nodeType'] as string | undefined);
          let preview = '';
          let metaPatch = {};
          try {
            const result = await extractPreviewWithMeta(fileUri, restoreNodeType);
            preview = result.preview;
            metaPatch = {
              ai_readable_chars: result.ai_readable_chars,
              ai_readable_pages: result.ai_readable_pages,
              has_unreadable_content: result.has_unreadable_content,
              unreadable_hint: result.unreadable_hint,
              csv_rows: result.csv_rows,
              csv_cols: result.csv_cols,
            };
          } catch { /* skip */ }

          // Place new node below all existing nodes
          const maxY = canvas.nodes.length > 0
            ? Math.max(...canvas.nodes.map(n => n.position.y + (n.size?.height ?? 160)))
            : 200;
          const newNode: CanvasNode = {
            id: uuid(),
            node_type: restoreNodeType,
            title: `${path.basename(restoreFilePath, path.extname(restoreFilePath))}（历史版本）`,
            position: { x: 100, y: maxY + 40 },
            size: DEFAULT_SIZES[restoreNodeType],
            file_path: restoreFilePath,
            meta: {
              ...(restoreNodeType === 'image' ? { display_mode: 'file' as const } : {}),
              ...(preview ? { content_preview: preview } : {}),
              ...metaPatch,
            },
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
          size: { width: 280, height: 220 },
          meta: {
            ai_tool: fnToolId,
            param_values: { ...(paramValues ?? {}) },
            fn_status: 'idle',
          },
        };
        document.data.nodes.push(newFnNode);
        document.suppressNextRevert = true;
        await writeCanvas(document.uri, document.data);
        const sessionId = CanvasEditorProvider.bumpCanvasSession(document.uri.fsPath);
        webview.postMessage({ type: 'init', data: document.data, workspaceRoot: canvasDir, sessionId });
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

  private async _postPetBootstrap(webview: vscode.Webview, canvasDir: string): Promise<void> {
    const petSettings = readPetSettings();
    const petState = await readPetState(canvasDir);
    webview.postMessage({
      type: 'petInit',
      petState,
      petEnabled: petSettings.enabled,
      restReminderMin: petSettings.restReminderMin,
      groundTheme: petSettings.groundTheme,
    });
    const petAssetsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'resources', 'pets')
    ).toString();
    webview.postMessage({ type: 'petAssetsBase', uri: petAssetsUri });
  }

  private _buildSettingsSnapshot(): SettingsSnapshot {
    const ai = vscode.workspace.getConfiguration('researchSpace.ai');
    const canvas = vscode.workspace.getConfiguration('researchSpace.canvas');
    const pet = vscode.workspace.getConfiguration('researchSpace.pet');
    const explosion = vscode.workspace.getConfiguration('researchSpace.explosion');
    return {
      globalProvider:           ai.get<string>('provider', 'copilot'),
      copilotModel:             ai.get<string>('copilotModel', 'gpt-4.1') || 'gpt-4.1',
      anthropicApiKey:          ai.get<string>('anthropicApiKey', ''),
      anthropicModel:           ai.get<string>('anthropicModel', 'claude-sonnet-4-6'),
      ollamaBaseUrl:            ai.get<string>('ollamaBaseUrl', 'http://localhost:11434'),
      ollamaModel:              ai.get<string>('ollamaModel', 'llama3.2'),
      omlxBaseUrl:              ai.get<string>('omlxBaseUrl', 'http://localhost:11433/v1'),
      omlxApiKey:               ai.get<string>('omlxApiKey', ''),
      omlxModel:                ai.get<string>('omlxModel', ''),
      maxOutputTokens:          ai.get<number>('maxOutputTokens', 0),
      maxContextTokens:         ai.get<number>('maxContextTokens', 0),
      autoSave:                 canvas.get<boolean>('autoSave', true),
      customProviders:          ai.get<CustomProviderConfig[]>('customProviders', []),
      favoriteModels:           ai.get<Record<string, string[]>>('favoriteModels', {}),
      aiHubMixApiKey:           ai.get<string>('aiHubMixApiKey', ''),
      aiHubMixImageGenModel:    ai.get<string>('aiHubMixImageGenModel', ''),
      aiHubMixImageEditModel:   ai.get<string>('aiHubMixImageEditModel', ''),
      aiHubMixImageFusionModel: ai.get<string>('aiHubMixImageFusionModel', ''),
      aiHubMixImageGroupModel:  ai.get<string>('aiHubMixImageGroupModel', ''),
      aiHubMixTtsModel:         ai.get<string>('aiHubMixTtsModel', ''),
      aiHubMixSttModel:         ai.get<string>('aiHubMixSttModel', ''),
      aiHubMixVideoGenModel:    ai.get<string>('aiHubMixVideoGenModel', ''),
      mineruApiMode:            explosion.get<'precise' | 'agent' | 'local'>('mineru.apiMode', 'precise'),
      mineruApiBaseUrl:         explosion.get<string>('mineru.apiBaseUrl', 'https://mineru.net'),
      mineruApiToken:           explosion.get<string>('mineru.apiToken', ''),
      mineruModelVersion:       explosion.get<'pipeline' | 'vlm' | 'MinerU-HTML'>('mineru.modelVersion', 'pipeline'),
      mineruPollIntervalMs:     explosion.get<number>('mineru.pollIntervalMs', 2500),
      mineruPollTimeoutMs:      explosion.get<number>('mineru.pollTimeoutMs', 300000),
      mineruLocalApiUrl:        explosion.get<string>('mineru.apiUrl', 'http://localhost:8000'),
      petAiProvider:            pet.get<string>('aiProvider', 'auto'),
      petAiModel:               pet.get<string>('aiModel', ''),
      testMode:                 process.env.RESEARCH_SPACE_TEST_MODE === '1',
    };
  }

  private async _handleUpdateSetting(key: string, value: unknown): Promise<void> {
    const target = vscode.ConfigurationTarget.Global;
    const ai = vscode.workspace.getConfiguration('researchSpace.ai');
    const canvasCfg = vscode.workspace.getConfiguration('researchSpace.canvas');
    const explosionCfg = vscode.workspace.getConfiguration('researchSpace.explosion');
    switch (key) {
      case 'globalProvider':          await ai.update('provider', value, target);                break;
      case 'copilotModel':            await ai.update('copilotModel', value, target);            break;
      case 'anthropicApiKey':         await ai.update('anthropicApiKey', value, target);         break;
      case 'anthropicModel':          await ai.update('anthropicModel', value, target);          break;
      case 'ollamaBaseUrl':           await ai.update('ollamaBaseUrl', value, target);           break;
      case 'ollamaModel':             await ai.update('ollamaModel', value, target);             break;
      case 'omlxBaseUrl':             await ai.update('omlxBaseUrl', value, target);             break;
      case 'omlxApiKey':              await ai.update('omlxApiKey', value, target);              break;
      case 'omlxModel':               await ai.update('omlxModel', value, target);               break;
      case 'maxOutputTokens':         await ai.update('maxOutputTokens', value, target);         break;
      case 'maxContextTokens':        await ai.update('maxContextTokens', value, target);        break;
      case 'autoSave':                await canvasCfg.update('autoSave', value, target);         break;
      case 'customProviders':         await ai.update('customProviders', value, target);         break;
      case 'favoriteModels':         await ai.update('favoriteModels', value, target);          break;
      case 'aiHubMixApiKey':          await ai.update('aiHubMixApiKey', value, target);          break;
      case 'aiHubMixImageGenModel':   await ai.update('aiHubMixImageGenModel', value, target);   break;
      case 'aiHubMixImageEditModel':  await ai.update('aiHubMixImageEditModel', value, target);  break;
      case 'aiHubMixImageFusionModel': await ai.update('aiHubMixImageFusionModel', value, target); break;
      case 'aiHubMixImageGroupModel':  await ai.update('aiHubMixImageGroupModel', value, target);  break;
      case 'aiHubMixTtsModel':        await ai.update('aiHubMixTtsModel', value, target);        break;
      case 'aiHubMixSttModel':        await ai.update('aiHubMixSttModel', value, target);        break;
      case 'aiHubMixVideoGenModel':   await ai.update('aiHubMixVideoGenModel', value, target);   break;
      case 'mineruApiMode':           await explosionCfg.update('mineru.apiMode', value, target); break;
      case 'mineruApiBaseUrl':        await explosionCfg.update('mineru.apiBaseUrl', value, target); break;
      case 'mineruApiToken':          await explosionCfg.update('mineru.apiToken', value, target); break;
      case 'mineruModelVersion':      await explosionCfg.update('mineru.modelVersion', value, target); break;
      case 'mineruPollIntervalMs':    await explosionCfg.update('mineru.pollIntervalMs', value, target); break;
      case 'mineruPollTimeoutMs':     await explosionCfg.update('mineru.pollTimeoutMs', value, target); break;
      case 'mineruLocalApiUrl':       await explosionCfg.update('mineru.apiUrl', value, target); break;
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
