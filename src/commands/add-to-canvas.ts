import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { readCanvas, writeCanvas, toRelPath, fileExtToNodeType, calcNewNodePosition, detectLanguage } from '../core/storage';
import { DEFAULT_SIZES } from '../core/canvas-model';
import { CanvasNode } from '../core/canvas-model';
import { extractPreview, extractPreviewWithMeta, getPdfPageCount } from '../core/content-extractor';
import { CanvasEditorProvider } from '../providers/CanvasEditorProvider';

// Re-export so CanvasEditorProvider can use it
export { addToCanvas };

async function addToCanvas(
  uris: vscode.Uri[],
  targetCanvasUri?: vscode.Uri
): Promise<void> {
  // 1. Determine target canvas
  let target = targetCanvasUri;
  if (!target) {
    const rswsFiles = await vscode.workspace.findFiles('**/*.rsws');
    if (rswsFiles.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        'No .rsws canvas file found. Create one first.',
        'New Canvas'
      );
      if (choice === 'New Canvas') {
        await vscode.commands.executeCommand('researchSpace.newCanvas');
      }
      return;
    }
    if (rswsFiles.length === 1) {
      target = rswsFiles[0];
    } else {
      const items = rswsFiles.map(f => ({
        label: path.basename(f.fsPath),
        description: vscode.workspace.asRelativePath(f),
        uri: f,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select target canvas',
      });
      if (!picked) { return; }
      target = picked.uri;
    }
  }

  const canvas = await readCanvas(target);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Adding ${uris.length} file(s) to canvas…`,
      cancellable: false,
    },
    async () => {
      const newNodes: CanvasNode[] = [];

      for (let i = 0; i < uris.length; i++) {
        const uri = uris[i];
        const ext = path.extname(uri.fsPath).slice(1).toLowerCase();
        const nodeType = fileExtToNodeType(ext);
        if (!nodeType || nodeType === 'ai_output') { continue; }

        const relPath = toRelPath(uri.fsPath, target!);
        let preview = '';
        let pageCount: number | undefined;
        let aiReadableChars: number | undefined;
        let aiReadablePages: number | undefined;
        let hasUnreadableContent: boolean | undefined;
        let unreadableHint: string | undefined;
        let csvRows: number | undefined;
        let csvCols: number | undefined;

        try {
          const result = await extractPreviewWithMeta(uri, nodeType);
          preview = result.preview;
          aiReadableChars = result.ai_readable_chars;
          aiReadablePages = result.ai_readable_pages;
          hasUnreadableContent = result.has_unreadable_content;
          unreadableHint = result.unreadable_hint;
          csvRows = result.csv_rows;
          csvCols = result.csv_cols;
          if (aiReadablePages) { pageCount = aiReadablePages; }
        } catch { /* ignore */ }
        if (!pageCount) {
          try { pageCount = await getPdfPageCount(uri); } catch { /* ignore */ }
        }

        const node: CanvasNode = {
          id: uuid(),
          node_type: nodeType,
          title: path.basename(uri.fsPath, path.extname(uri.fsPath)),
          position: { x: 0, y: 0 },
          size: DEFAULT_SIZES[nodeType],
          file_path: relPath,
          meta: {
            content_preview: preview || undefined,
            page_count: pageCount,
            language: nodeType === 'code' ? detectLanguage(uri.fsPath) : undefined,
            ai_readable_chars: aiReadableChars,
            ai_readable_pages: aiReadablePages,
            has_unreadable_content: hasUnreadableContent || undefined,
            unreadable_hint: unreadableHint,
            csv_rows: csvRows,
            csv_cols: csvCols,
            staging_origin: 'workspace_file',
          },
        };

        newNodes.push(node);
      }

      if (newNodes.length === 0) { return; }

      const activeWebview = CanvasEditorProvider.activeWebviews.get(target!.fsPath);
      if (activeWebview) {
        // Webview is open — send to staging area; canvas write happens when user commits from staging
        activeWebview.postMessage({ type: 'stageNodes', nodes: newNodes });
      } else {
        // Webview not open — write nodes directly to canvas file
        const pos0 = canvas.nodes.length;
        newNodes.forEach((node, i) => {
          node.position = calcNewNodePosition(canvas.nodes, pos0 + i);
          canvas.nodes.push(node);
        });
        CanvasEditorProvider.suppressRevert(target!.fsPath);
        await writeCanvas(target!, canvas);
      }
    }
  );
}

export function registerAddToCanvas(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'researchSpace.addToCanvas',
      async (uri: vscode.Uri, selectedUris?: vscode.Uri[]) => {
        const targets = selectedUris && selectedUris.length > 0 ? selectedUris : [uri];
        await addToCanvas(targets);
      }
    )
  );
}
