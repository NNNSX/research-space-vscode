import * as vscode from 'vscode';
import * as path from 'path';
import { writeCanvas, emptyCanvas } from '../core/storage';

export function registerNewCanvas(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('researchSpace.newCanvas', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Open a folder first to create a canvas.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: '画布名称（将创建同名文件夹）',
        value: 'research',
        validateInput(v) {
          if (!v.trim()) { return 'Name cannot be empty'; }
          if (/[\\/:*?"<>|]/.test(v)) { return 'Name contains invalid characters'; }
          return undefined;
        },
      });
      if (!name) { return; }

      const root = workspaceFolders[0].uri.fsPath;
      const canvasDir = path.join(root, name);
      const fileUri = vscode.Uri.file(path.join(canvasDir, `${name}.rsws`));

      // Check if folder already exists
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(canvasDir));
        // Folder exists — check if .rsws file exists inside
        try {
          await vscode.workspace.fs.stat(fileUri);
          // .rsws exists — ask to open
          const choice = await vscode.window.showWarningMessage(
            `Canvas "${name}" already exists. Open it?`,
            'Open',
            'Cancel'
          );
          if (choice !== 'Open') { return; }
        } catch {
          // Folder exists but no .rsws — create the canvas file
          await writeCanvas(fileUri, emptyCanvas(name));
        }
      } catch {
        // Folder does not exist — create it and the .rsws file
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(canvasDir));
        await writeCanvas(fileUri, emptyCanvas(name));
      }

      await vscode.commands.executeCommand('vscode.openWith', fileUri, 'researchSpace.canvas');
    })
  );
}
