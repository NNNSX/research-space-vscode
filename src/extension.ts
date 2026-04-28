import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import { CanvasEditorProvider } from './providers/CanvasEditorProvider';
import { WorkspaceTreeProvider, ResearchSpaceTreeItem } from './providers/WorkspaceTreeProvider';
import { registerAddToCanvas } from './commands/add-to-canvas';
import { registerNewCanvas } from './commands/new-canvas';
import { readCanvas, writeCanvas } from './core/storage';
import { toAbsPath, toRelPath } from './core/storage';
import { extractPreviewWithMeta } from './core/content-extractor';
import { getProvider, type AIContent } from './ai/provider';
import { readMindMapFile } from './mindmap/mindmap-storage';
import { saveMindMapToCanvasNode } from './mindmap/mindmap-canvas-sync';

function getTestAuditLogPath(): string | null {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) { return null; }
  return path.join(workspaceRoot, 'rs-test-audit.jsonl');
}

async function appendTestAuditEntry(entry: Record<string, unknown>): Promise<string | null> {
  const auditPath = getTestAuditLogPath();
  if (!auditPath) { return null; }
  const payload = `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  })}\n`;
  await fs.appendFile(auditPath, payload, 'utf8');
  return auditPath;
}

export function activate(context: vscode.ExtensionContext): void {
  // ── Custom Editor Provider ────────────────────────────────────────────────
  const editorProvider = new CanvasEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      CanvasEditorProvider.viewType,
      editorProvider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'researchSpace.test.getCanvasState',
      (canvasUri?: vscode.Uri) => {
        const target = canvasUri
          ? CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath)
          : Array.from(CanvasEditorProvider.activeDocuments.values())[0];
        return target?.data ?? null;
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.applyCanvasTitleEdit',
      (title: string, canvasUri?: vscode.Uri) => {
        const target = canvasUri
          ? CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath)
          : Array.from(CanvasEditorProvider.activeDocuments.values())[0];
        if (!target || !title.trim()) { return false; }
        const next = JSON.parse(JSON.stringify(target.data));
        next.metadata = {
          ...next.metadata,
          title,
          updated_at: new Date().toISOString(),
        };
        if (Array.isArray(next.nodes) && next.nodes.length > 0) {
          next.nodes[0] = {
            ...next.nodes[0],
            title,
          };
        }
        return editorProvider.applyTestEdit(target, next);
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.undoCanvasEdit',
      (canvasUri?: vscode.Uri) => {
        const target = canvasUri
          ? CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath)
          : Array.from(CanvasEditorProvider.activeDocuments.values())[0];
        if (!target) { return false; }
        return editorProvider.undoTestEdit(target);
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.redoCanvasEdit',
      (canvasUri?: vscode.Uri) => {
        const target = canvasUri
          ? CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath)
          : Array.from(CanvasEditorProvider.activeDocuments.values())[0];
        if (!target) { return false; }
        return editorProvider.redoTestEdit(target);
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.isCanvasReady',
      (canvasUri?: vscode.Uri) => {
        const targetPath = canvasUri?.fsPath;
        if (targetPath) {
          return CanvasEditorProvider.canvasSessionIds.has(targetPath);
        }
        return CanvasEditorProvider.canvasSessionIds.size > 0;
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.readMindMapFile',
      async (fileUri: vscode.Uri) => {
        return readMindMapFile(fileUri);
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.saveMindMapFile',
      async (canvasUri: vscode.Uri, nodeId: string, filePath: string, mindmap: unknown) => {
        const saved = await saveMindMapToCanvasNode(canvasUri, nodeId, filePath, mindmap);
        const activeDoc = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
        if (activeDoc) {
          activeDoc.data = await readCanvas(canvasUri);
        }
        return saved;
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.postCanvasMessage',
      async (message: unknown, canvasUri?: vscode.Uri) => {
        const targetPath = canvasUri?.fsPath;
        const webview = targetPath
          ? CanvasEditorProvider.activeWebviews.get(targetPath)
          : Array.from(CanvasEditorProvider.activeWebviews.values())[0];
        if (!webview || !message || typeof message !== 'object') { return false; }
        if (targetPath && !CanvasEditorProvider.canvasSessionIds.has(targetPath)) { return false; }
        return webview.postMessage(message as Record<string, unknown>);
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.runOllamaSmoke',
      async () => {
        const provider = await getProvider('ollama');
        const model = await provider.resolveModel();
        const contents: AIContent[] = [
          {
            type: 'text',
            title: 'smoke-test',
            text: '只回复 RS_OK，不要输出其他内容。',
          },
        ];
        const streamOpts = {
          model,
          maxTokens: 16,
          signal: AbortSignal.timeout(20000),
          think: false,
        };
        let text = '';
        for await (const chunk of provider.stream('', contents, streamOpts)) {
          text += chunk;
          if (text.length >= 128) { break; }
        }
        console.log(`[Research Space Test] Ollama smoke completed via ${model}: ${text.trim() || '<empty>'}`);
        const auditPath = await appendTestAuditEntry({
          kind: 'ollama-smoke',
          providerId: provider.id,
          model,
          text: text.trim(),
        });
        return {
          providerId: provider.id,
          model,
          text: text.trim(),
          auditPath,
        };
      }
    ),
    vscode.commands.registerCommand(
      'researchSpace.test.inspectOllamaProvider',
      async () => {
        const provider = await getProvider('ollama');
        const model = await provider.resolveModel();
        const models = await provider.listModels();
        const capabilities = provider.getModelCapabilities
          ? await provider.getModelCapabilities(model)
          : null;
        console.log(
          `[Research Space Test] Ollama provider inspection via ${model}: ` +
          `${models.length} models, capabilities=${capabilities ? 'ok' : 'missing'}`
        );
        const auditPath = await appendTestAuditEntry({
          kind: 'ollama-provider-inspection',
          providerId: provider.id,
          model,
          modelCount: models.length,
          capabilities,
        });
        return {
          providerId: provider.id,
          model,
          models,
          capabilities,
          auditPath,
        };
      }
    )
  );

  // ── Sidebar TreeView ──────────────────────────────────────────────────────
  const treeProvider = new WorkspaceTreeProvider();
  const treeView = vscode.window.createTreeView('researchSpace.explorer', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Refresh tree when .rsws files change
  const rsWatcher = vscode.workspace.createFileSystemWatcher('**/*.rsws');
  rsWatcher.onDidCreate(() => treeProvider.refresh());
  rsWatcher.onDidChange(() => treeProvider.refresh());
  rsWatcher.onDidDelete(() => treeProvider.refresh());
  context.subscriptions.push(rsWatcher);

  // ── Commands ──────────────────────────────────────────────────────────────
  registerAddToCanvas(context);
  registerNewCanvas(context);

  // New Note — creates note in the active canvas's notes/ directory
  context.subscriptions.push(
    vscode.commands.registerCommand('researchSpace.newNote', async () => {
      // Find the active canvas
      const activeDoc = Array.from(CanvasEditorProvider.activeDocuments.values())[0];
      if (!activeDoc) {
        vscode.window.showWarningMessage('Open a canvas first to create a note.');
        return;
      }
      const canvasDir = path.dirname(activeDoc.uri.fsPath);
      const title = await vscode.window.showInputBox({ prompt: 'Note title', value: 'New Note' });
      if (!title) { return; }
      const notesDir = path.join(canvasDir, 'notes');
      try { await vscode.workspace.fs.createDirectory(vscode.Uri.file(notesDir)); } catch { /* exists */ }
      const safeName = title.replace(/[\\/:*?"<>|]/g, '-');
      const noteUri = vscode.Uri.file(path.join(notesDir, `${safeName}.md`));
      await vscode.workspace.fs.writeFile(noteUri, Buffer.from(`# ${title}\n`, 'utf-8'));
      vscode.window.showInformationMessage(`Note "${title}" created.`);
    })
  );

  // Run Function (from tree view)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'researchSpace.runFunction',
      async (nodeId: string, canvasUri: vscode.Uri) => {
        const webview = CanvasEditorProvider.activeWebviews.get(canvasUri.fsPath);
        if (!webview) {
          await vscode.commands.executeCommand('vscode.openWith', canvasUri, 'researchSpace.canvas');
          vscode.window.showInformationMessage('Canvas opened. Please click Run inside the canvas.');
          return;
        }
        webview.postMessage({ type: 'runFunction', nodeId });
      }
    )
  );

  // Export Markdown
  context.subscriptions.push(
    vscode.commands.registerCommand('researchSpace.exportMarkdown', async () => {
      const rswsFiles = await vscode.workspace.findFiles('**/*.rsws');
      if (rswsFiles.length === 0) {
        vscode.window.showWarningMessage('No canvas file found.');
        return;
      }
      const target = rswsFiles.length === 1 ? rswsFiles[0] : await pickCanvas(rswsFiles);
      if (!target) { return; }
      await exportMarkdown(target);
    })
  );

  // Export JSON
  context.subscriptions.push(
    vscode.commands.registerCommand('researchSpace.exportJson', async () => {
      const rswsFiles = await vscode.workspace.findFiles('**/*.rsws');
      if (rswsFiles.length === 0) { return; }
      const target = rswsFiles.length === 1 ? rswsFiles[0] : await pickCanvas(rswsFiles);
      if (!target) { return; }
      await exportJson(target);
    })
  );

  // Open Settings
  context.subscriptions.push(
    vscode.commands.registerCommand('researchSpace.openSettings', () => {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:research-space'
      );
    })
  );

  // ── Tree view context menu commands ──────────────────────────────────────

  // Open File (data nodes)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'researchSpace.tree.openFile',
      async (item: ResearchSpaceTreeItem) => {
        if (!item.node?.file_path || !item.canvasUri) { return; }
        const absPath = toAbsPath(item.node.file_path, item.canvasUri);
        const fileUri = vscode.Uri.file(absPath);
        try {
          await vscode.commands.executeCommand('vscode.open', fileUri);
        } catch {
          await vscode.env.openExternal(fileUri);
        }
      }
    )
  );

  // Remove from Canvas (any node — does not delete the file)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'researchSpace.tree.removeFromCanvas',
      async (item: ResearchSpaceTreeItem) => {
        if (!item.node || !item.canvasUri) { return; }
        const confirm = await vscode.window.showWarningMessage(
          `Remove "${item.node.title}" from canvas? (The file will not be deleted.)`,
          { modal: true },
          'Remove'
        );
        if (confirm !== 'Remove') { return; }
        const { canvas, document } = await getCanvasState(item.canvasUri);
        canvas.nodes = canvas.nodes.filter(n => n.id !== item.node!.id);
        canvas.edges = canvas.edges.filter(
          e => e.source !== item.node!.id && e.target !== item.node!.id
        );
        if (document) {
          document.data = canvas;
        }
        CanvasEditorProvider.suppressRevert(item.canvasUri.fsPath);
        await writeCanvas(item.canvasUri, canvas);
        treeProvider.refresh();
        // Notify open webview if any
        const webview = CanvasEditorProvider.activeWebviews.get(item.canvasUri.fsPath);
        if (webview) {
          const sessionId = CanvasEditorProvider.bumpCanvasSession(item.canvasUri.fsPath);
          webview.postMessage({
            type: 'init',
            data: canvas,
            workspaceRoot: path.dirname(item.canvasUri.fsPath),
            sessionId,
          });
        }
      }
    )
  );

  // Run function node from tree
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'researchSpace.tree.runNode',
      async (item: ResearchSpaceTreeItem) => {
        if (!item.node || !item.canvasUri) { return; }
        const webview = CanvasEditorProvider.activeWebviews.get(item.canvasUri.fsPath);
        if (!webview) {
          await vscode.commands.executeCommand('vscode.openWith', item.canvasUri, 'researchSpace.canvas');
          vscode.window.showInformationMessage('Canvas opened. Please click Run inside the canvas.');
          return;
        }
        webview.postMessage({ type: 'runFunction', nodeId: item.node.id });
      }
    )
  );

  // Open Canvas from tree
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'researchSpace.tree.openCanvas',
      async (item: ResearchSpaceTreeItem) => {
        if (!item.canvasUri) { return; }
        await vscode.commands.executeCommand('vscode.openWith', item.canvasUri, 'researchSpace.canvas');
      }
    )
  );

  // Delete Canvas (deletes the entire canvas folder)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'researchSpace.tree.deleteCanvas',
      async (item: ResearchSpaceTreeItem) => {
        if (!item.canvasUri) { return; }
        const canvasDir = path.dirname(item.canvasUri.fsPath);
        const folderName = path.basename(canvasDir);
        const confirm = await vscode.window.showWarningMessage(
          `Delete canvas "${folderName}" and all its contents (notes, outputs, tools, pet)? This cannot be undone.`,
          { modal: true },
          'Delete'
        );
        if (confirm !== 'Delete') { return; }
        await vscode.workspace.fs.delete(vscode.Uri.file(canvasDir), { recursive: true });
        treeProvider.refresh();
      }
    )
  );

  // ── File watcher for workspace files ─────────────────────────────────────
  setupFileWatcher(context);
}

export function deactivate(): void {
  // Nothing to clean up
}

// ── File watcher ──────────────────────────────────────────────────────────

async function getCanvasState(canvasUri: vscode.Uri): Promise<{
  canvas: import('./core/canvas-model').CanvasFile;
  document: import('./providers/CanvasEditorProvider').CanvasDocument | undefined;
}> {
  const document = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
  if (document) {
    return { canvas: document.data, document };
  }
  return { canvas: await readCanvas(canvasUri), document: undefined };
}

function metaPatchChanged(
  meta: Record<string, unknown> | undefined,
  preview: string,
  metaPatch: Record<string, unknown>,
  fileMissing: boolean,
): boolean {
  if ((meta?.content_preview ?? '') !== preview) { return true; }
  if ((meta?.file_missing ?? false) !== fileMissing) { return true; }
  for (const [key, value] of Object.entries(metaPatch)) {
    if ((meta?.[key] ?? undefined) !== value) { return true; }
  }
  return false;
}

function setupFileWatcher(context: vscode.ExtensionContext): void {
  let changeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let deleteDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingChangeUris = new Map<string, vscode.Uri>();
  const pendingDeleteUris = new Map<string, vscode.Uri>();

  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{pdf,md,markdown,mdown,mkd,txt,text,rst,adoc,doc,dot,docx,docm,dotx,dotm,rtf,ppt,pps,pot,pptx,pptm,ppsx,ppsm,potx,potm,odt,odp,fodt,fodp,epub,py,js,mjs,cjs,ts,mts,cts,tsx,jsx,rs,go,java,c,cc,cpp,cxx,cs,h,hh,hpp,hxx,m,mm,rb,swift,kt,r,php,phtml,lua,pl,pm,scala,groovy,gradle,dart,jl,zig,nim,sh,bash,zsh,fish,ps1,psm1,psd1,bat,cmd,yaml,yml,json,jsonl,ndjson,toml,tex,bib,bst,ipynb,xml,html,css,scss,less,vue,svelte,astro,sql,graphql,proto,ini,cfg,env,log,conf,csv,tsv,xls,xlt,xlsx,xlsm,xltx,xltm,ods,fods,png,jpg,jpeg,gif,webp,svg,bmp,avif,ico,mp3,wav,opus,aac,flac,m4a,ogg,oga,mp4,mov,webm,m4v}'
  );

  // ── File changed: update content_preview ──────────────────────────────────
  watcher.onDidChange(uri => {
    pendingDeleteUris.delete(uri.fsPath);
    pendingChangeUris.set(uri.fsPath, uri);
    if (changeDebounceTimer) { clearTimeout(changeDebounceTimer); }
    changeDebounceTimer = setTimeout(async () => {
      const uris = Array.from(pendingChangeUris.values());
      pendingChangeUris.clear();
      changeDebounceTimer = undefined;
      if (uris.length === 0) { return; }
      const rswsFiles = await vscode.workspace.findFiles('**/*.rsws');
      for (const uri of uris) {
        for (const canvasUri of rswsFiles) {
          const webview = CanvasEditorProvider.activeWebviews.get(canvasUri.fsPath);
          try {
            const { canvas, document } = await getCanvasState(canvasUri);
            const canvasDir = path.dirname(canvasUri.fsPath);
            // Compute path relative to canvas directory (not workspace root)
            const relPath = path.relative(canvasDir, uri.fsPath).split(path.sep).join('/');
            let changed = false;
            for (const node of canvas.nodes) {
              if (node.file_path !== relPath) { continue; }
              const wasMissing = !!node.meta?.file_missing;
              if (wasMissing) {
                node.meta = { ...node.meta, file_missing: false };
                webview?.postMessage({ type: 'nodeFileStatus', nodeId: node.id, missing: false });
                changed = true;
              }
              // Refresh content preview for text-based nodes (ai_output, note, code, data, etc.)
              // Use node type to decide: ai_output has watchContent=true but no extensions,
              // so check the node's own type definition rather than relying solely on extension lookup.
              const ext = path.extname(uri.fsPath).slice(1).toLowerCase();
              const nodeDef = CanvasEditorProvider.dataNodeRegistry?.get(node.node_type);
              const shouldWatch = nodeDef?.watchContent ?? CanvasEditorProvider.dataNodeRegistry?.shouldWatchContent(ext) ?? false;
              if (shouldWatch) {
                try {
                  const result = await extractPreviewWithMeta(uri, node.node_type);
                  const preview = result.preview;
                  const metaPatch = {
                    ai_readable_chars: result.ai_readable_chars,
                    ai_readable_pages: result.ai_readable_pages,
                    has_unreadable_content: result.has_unreadable_content,
                    unreadable_hint: result.unreadable_hint,
                    csv_rows: result.csv_rows,
                    csv_cols: result.csv_cols,
                  };
                  if (metaPatchChanged(node.meta as Record<string, unknown> | undefined, preview, metaPatch, false)) {
                    node.meta = { ...node.meta, content_preview: preview, file_missing: false, ...metaPatch };
                    webview?.postMessage({ type: 'nodeContentUpdate', nodeId: node.id, preview, metaPatch });
                    changed = true;
                  }
                } catch { /* ignore read errors */ }
              }
            }
            if (changed) {
              if (document) {
                document.data = canvas;
              }
              CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
              await writeCanvas(canvasUri, canvas);
            }
          } catch { /* ignore */ }
        }
      }
    }, 800);
  });

  // ── File deleted: mark missing ────────────────────────────────────────────
  watcher.onDidDelete(uri => {
    pendingChangeUris.delete(uri.fsPath);
    pendingDeleteUris.set(uri.fsPath, uri);
    if (deleteDebounceTimer) { clearTimeout(deleteDebounceTimer); }
    deleteDebounceTimer = setTimeout(async () => {
      const uris = Array.from(pendingDeleteUris.values());
      pendingDeleteUris.clear();
      deleteDebounceTimer = undefined;
      if (uris.length === 0) { return; }
      const rswsFiles = await vscode.workspace.findFiles('**/*.rsws');
      for (const uri of uris) {
        try {
          await vscode.workspace.fs.stat(uri);
          continue;
        } catch {
          // confirmed missing
        }
        for (const canvasUri of rswsFiles) {
          const webview = CanvasEditorProvider.activeWebviews.get(canvasUri.fsPath);
          try {
            const { canvas, document } = await getCanvasState(canvasUri);
            const canvasDir = path.dirname(canvasUri.fsPath);
            const relPath = path.relative(canvasDir, uri.fsPath).split(path.sep).join('/');
            if (relPath.startsWith('outputs/')) { continue; }
            let changed = false;
            for (const node of canvas.nodes) {
              if (node.file_path === relPath && !node.meta?.file_missing) {
                node.meta = { ...node.meta, file_missing: true };
                webview?.postMessage({ type: 'nodeFileStatus', nodeId: node.id, missing: true });
                changed = true;
              }
            }
            if (changed) {
              if (document) {
                document.data = canvas;
              }
              CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
              await writeCanvas(canvasUri, canvas);
            }
          } catch { /* ignore */ }
        }
      }
    }, 600);
  });

  watcher.onDidCreate(uri => {
    pendingDeleteUris.delete(uri.fsPath);
    pendingChangeUris.set(uri.fsPath, uri);
    if (changeDebounceTimer) { clearTimeout(changeDebounceTimer); }
    changeDebounceTimer = setTimeout(async () => {
      const uris = Array.from(pendingChangeUris.values());
      pendingChangeUris.clear();
      changeDebounceTimer = undefined;
      if (uris.length === 0) { return; }
      const rswsFiles = await vscode.workspace.findFiles('**/*.rsws');
      for (const uri of uris) {
        for (const canvasUri of rswsFiles) {
          const webview = CanvasEditorProvider.activeWebviews.get(canvasUri.fsPath);
          try {
            const { canvas, document } = await getCanvasState(canvasUri);
            const canvasDir = path.dirname(canvasUri.fsPath);
            const relPath = path.relative(canvasDir, uri.fsPath).split(path.sep).join('/');
            let changed = false;
            for (const node of canvas.nodes) {
              if (node.file_path !== relPath) { continue; }
              const wasMissing = !!node.meta?.file_missing;
              if (wasMissing) {
                node.meta = { ...node.meta, file_missing: false };
                webview?.postMessage({ type: 'nodeFileStatus', nodeId: node.id, missing: false });
                changed = true;
              }
            }
            if (changed) {
              if (document) {
                document.data = canvas;
              }
              CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
              await writeCanvas(canvasUri, canvas);
            }
          } catch { /* ignore */ }
        }
      }
    }, 200);
  });

  context.subscriptions.push(watcher);

  // ── File renamed: update node.file_path in all canvases ──────────────────
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async e => {
      const rswsFiles = await vscode.workspace.findFiles('**/*.rsws');
      for (const canvasUri of rswsFiles) {
        let canvas;
        let document;
        try { ({ canvas, document } = await getCanvasState(canvasUri)); } catch { continue; }
        const canvasDir = path.dirname(canvasUri.fsPath);

        let changed = false;
        for (const { oldUri, newUri } of e.files) {
          const oldRel = path.relative(canvasDir, oldUri.fsPath).split(path.sep).join('/');
          const newRel = path.relative(canvasDir, newUri.fsPath).split(path.sep).join('/');
          const newTitle = path.basename(newUri.fsPath, path.extname(newUri.fsPath));

          for (const node of canvas.nodes) {
            if (node.file_path === oldRel) {
              node.file_path = newRel;
              node.title = newTitle;
              if (node.meta) { node.meta.file_missing = false; }
              changed = true;

              const webview = CanvasEditorProvider.activeWebviews.get(canvasUri.fsPath);
              webview?.postMessage({
                type: 'nodeFileMoved',
                nodeId: node.id,
                newFilePath: newRel,
                newTitle,
              });
            }
          }
        }

        if (changed) {
          if (document) {
            document.data = canvas;
          }
          CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
          await writeCanvas(canvasUri, canvas);
        }
      }
    })
  );
}

// ── Export helpers ────────────────────────────────────────────────────────

async function pickCanvas(uris: vscode.Uri[]): Promise<vscode.Uri | undefined> {
  const items = uris.map(u => ({
    label: path.basename(u.fsPath),
    description: vscode.workspace.asRelativePath(u),
    uri: u,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select canvas' });
  return picked?.uri;
}

async function exportMarkdown(canvasUri: vscode.Uri): Promise<void> {
  const { canvas } = await getCanvasState(canvasUri);
  const dataNodes = canvas.nodes
    .filter(n => ['paper', 'note', 'code', 'ai_output', 'image', 'data'].includes(n.node_type))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  const sections: string[] = [`# ${canvas.metadata.title}\n`];
  for (const node of dataNodes) {
    sections.push(`## ${node.title}\n`);
    if (node.file_path) {
      try {
        const absPath = toAbsPath(node.file_path, canvasUri);
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
        const content = Buffer.from(bytes).toString('utf-8');
        sections.push(content + '\n');
      } catch {
        sections.push(node.meta?.content_preview ?? '_[File not available]_' + '\n');
      }
    } else {
      sections.push(node.meta?.content_preview ?? '' + '\n');
    }
    sections.push('---\n');
  }

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(
      path.join(path.dirname(canvasUri.fsPath), `${canvas.metadata.title}.md`)
    ),
    filters: { Markdown: ['md'] },
  });
  if (!saveUri) { return; }
  await vscode.workspace.fs.writeFile(saveUri, Buffer.from(sections.join('\n'), 'utf-8'));
  vscode.window.showInformationMessage(`Exported to ${path.basename(saveUri.fsPath)}`);
}

async function exportJson(canvasUri: vscode.Uri): Promise<void> {
  const { canvas } = await getCanvasState(canvasUri);
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(
      path.join(path.dirname(canvasUri.fsPath), `${canvas.metadata.title}.json`)
    ),
    filters: { JSON: ['json'] },
  });
  if (!saveUri) { return; }
  await vscode.workspace.fs.writeFile(
    saveUri,
    Buffer.from(JSON.stringify(canvas, null, 2), 'utf-8')
  );
  vscode.window.showInformationMessage(`Exported to ${path.basename(saveUri.fsPath)}`);
}
