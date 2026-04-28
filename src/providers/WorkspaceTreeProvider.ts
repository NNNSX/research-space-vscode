import * as vscode from 'vscode';
import * as path from 'path';
import { readCanvas } from '../core/storage';
import { CanvasFile, CanvasNode, NodeType } from '../core/canvas-model';

// ── Tree item types ─────────────────────────────────────────────────────────

type ItemKind = 'root' | 'canvas' | 'node' | 'addCanvas';

export class ResearchSpaceTreeItem extends vscode.TreeItem {
  constructor(
    readonly kind: ItemKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly canvasUri?: vscode.Uri,
    public readonly node?: CanvasNode
  ) {
    super(label, collapsibleState);
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

export class WorkspaceTreeProvider
  implements vscode.TreeDataProvider<ResearchSpaceTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<ResearchSpaceTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ResearchSpaceTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ResearchSpaceTreeItem): Promise<ResearchSpaceTreeItem[]> {
    if (!element) {
      return this._getRootItems();
    }
    if (element.kind === 'canvas' && element.canvasUri) {
      return this._getCanvasChildren(element.canvasUri);
    }
    return [];
  }

  // ── Root: list all .rsws files ──────────────────────────────────────────

  private async _getRootItems(): Promise<ResearchSpaceTreeItem[]> {
    const rswsFiles = await vscode.workspace.findFiles('**/*.rsws');
    const items: ResearchSpaceTreeItem[] = rswsFiles.map(uri => {
      const item = new ResearchSpaceTreeItem(
        'canvas',
        path.basename(uri.fsPath),
        vscode.TreeItemCollapsibleState.Collapsed,
        uri
      );
      item.iconPath = new vscode.ThemeIcon('notebook');
      item.tooltip = vscode.workspace.asRelativePath(uri);
      item.contextValue = 'canvas';
      item.command = {
        command: 'vscode.openWith',
        title: 'Open Canvas',
        arguments: [uri, 'researchSpace.canvas'],
      };
      return item;
    });

    // Add "New Canvas" inline button
    const addItem = new ResearchSpaceTreeItem(
      'addCanvas',
      '+ New Canvas',
      vscode.TreeItemCollapsibleState.None
    );
    addItem.command = {
      command: 'researchSpace.newCanvas',
      title: 'New Canvas',
    };
    addItem.iconPath = new vscode.ThemeIcon('add');
    items.push(addItem);

    return items;
  }

  // ── Canvas children: list nodes ─────────────────────────────────────────

  private async _getCanvasChildren(
    canvasUri: vscode.Uri
  ): Promise<ResearchSpaceTreeItem[]> {
    let canvas: CanvasFile;
    try {
      canvas = await readCanvas(canvasUri);
    } catch {
      return [];
    }

    return canvas.nodes.map(node => {
      const item = new ResearchSpaceTreeItem(
        'node',
        node.title || 'Untitled',
        vscode.TreeItemCollapsibleState.None,
        canvasUri,
        node
      );
      item.iconPath = new vscode.ThemeIcon(nodeTypeToIcon(node.node_type));
      item.contextValue = `node-${node.node_type}`;

      if (node.node_type === 'function') {
        item.command = {
          command: 'researchSpace.runFunction',
          title: 'Run',
          arguments: [node.id, canvasUri],
        };
      } else if (node.file_path) {
        const absPath = path.join(
          path.dirname(canvasUri.fsPath),
          node.file_path.split('/').join(path.sep)
        );
        item.command = {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(absPath)],
        };
      }
      return item;
    });
  }
}

// ── Icon mapping ─────────────────────────────────────────────────────────

function nodeTypeToIcon(type: NodeType): string {
  switch (type) {
    case 'paper':     return 'file-pdf';
    case 'note':      return 'notebook';
    case 'code':      return 'code';
    case 'image':     return 'file-media';
    case 'function':  return 'zap';
    case 'group_hub': return 'symbol-array';
    case 'ai_output': return 'sparkle';
    case 'mindmap':   return 'type-hierarchy';
    default:          return 'file';
  }
}
