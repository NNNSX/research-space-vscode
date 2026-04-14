import * as vscode from 'vscode';
import * as path from 'path';
import type { DataNodeDef } from './canvas-model';

// Re-export for convenience
export type { DataNodeDef } from './canvas-model';

// ── DataNodeRegistry ─────────────────────────────────────────────────────────

export class DataNodeRegistry {
  private defs = new Map<string, DataNodeDef>();
  /** ext (lowercase, no dot) → node type id */
  private extMap = new Map<string, string>();

  // ── Loading ───────────────────────────────────────────────────────────────

  async loadBuiltins(extensionPath: string): Promise<void> {
    const nodesDir = path.join(extensionPath, 'resources', 'nodes');
    try {
      const dirUri = vscode.Uri.file(nodesDir);
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      const jsonFiles = entries
        .filter(([name]) => name.endsWith('.json'))
        .sort(([a], [b]) => a.localeCompare(b));
      for (const [name] of jsonFiles) {
        await this._loadFile(path.join(nodesDir, name));
      }
    } catch {
      // resources/nodes dir missing — not fatal
    }
  }

  private async _loadFile(filePath: string): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(bytes).toString('utf-8'));
      } catch {
        console.warn(`[DataNodeRegistry] JSON parse error in ${filePath}`);
        return;
      }
      const def = parsed as DataNodeDef;
      if (!def.id || !def.label) {
        console.warn(`[DataNodeRegistry] skipping ${filePath}: missing id or label`);
        return;
      }
      this.defs.set(def.id, def);
      for (const ext of def.extensions ?? []) {
        this.extMap.set(ext.toLowerCase(), def.id);
      }
    } catch (e) {
      console.warn(`[DataNodeRegistry] failed to load ${filePath}:`, e);
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getAll(): DataNodeDef[] {
    return [...this.defs.values()];
  }

  get(id: string): DataNodeDef | undefined {
    return this.defs.get(id);
  }

  /**
   * Returns the node type id for a file extension (without dot), or null if unrecognised.
   * Replaces the hardcoded EXT_TO_NODE_TYPE map in storage.ts.
   */
  typeFromExtension(ext: string): string | null {
    return this.extMap.get(ext.toLowerCase()) ?? null;
  }

  /**
   * Returns the language label for a file path (from the code node's languageMap),
   * or undefined if not a code node or extension unknown.
   * Replaces the hardcoded EXT_TO_LANGUAGE / detectLanguage in storage.ts.
   */
  languageForFile(filePath: string): string | undefined {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const nodeTypeId = this.typeFromExtension(ext);
    if (!nodeTypeId) { return undefined; }
    const def = this.defs.get(nodeTypeId);
    return def?.languageMap?.[ext];
  }

  /**
   * Returns whether file content changes should refresh the node's content_preview.
   * Replaces the hardcoded skip-list in extension.ts file watcher.
   */
  shouldWatchContent(ext: string): boolean {
    const nodeTypeId = this.extMap.get(ext.toLowerCase());
    if (!nodeTypeId) { return false; }
    const def = this.defs.get(nodeTypeId);
    return def?.watchContent ?? false;
  }
}
