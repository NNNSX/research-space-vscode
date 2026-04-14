import * as vscode from 'vscode';
import * as path from 'path';
import type { JsonToolDef } from '../core/canvas-model';

// Re-export so existing callers can import from either location
export type { JsonToolDef } from '../core/canvas-model';

// Runtime type that includes the _isCustom marker (not persisted to JSON)
export type RuntimeToolDef = JsonToolDef & { _isCustom: boolean };

// ── Validation ────────────────────────────────────────────────────────────────

export function validateToolDef(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, errors: ['Root value must be a JSON object'] };
  }
  const def = obj as Record<string, unknown>;

  // Required string fields
  // systemPromptTemplate is allowed to be empty for multimodal tools (apiType set)
  const isMultimodal = typeof def['apiType'] === 'string' && (def['apiType'] as string).length > 0;
  for (const field of ['id', 'name', 'description'] as const) {
    if (typeof def[field] !== 'string' || !(def[field] as string).trim()) {
      errors.push(`"${field}" is required and must be a non-empty string`);
    }
  }
  if (typeof def['systemPromptTemplate'] !== 'string') {
    errors.push('"systemPromptTemplate" must be a string');
  } else if (!isMultimodal && !(def['systemPromptTemplate'] as string).trim()) {
    errors.push('"systemPromptTemplate" must be non-empty for LLM tools (or set "apiType" for multimodal tools)');
  }

  // id: no spaces, safe for filenames
  if (typeof def['id'] === 'string' && /\s/.test(def['id'])) {
    errors.push('"id" must not contain whitespace');
  }

  // outputNodeType enum
  const validOutputTypes = ['ai_output', 'image', 'audio', 'video'];
  if (!validOutputTypes.includes(def['outputNodeType'] as string)) {
    errors.push(`"outputNodeType" must be one of: ${validOutputTypes.join(', ')}`);
  }

  // supportsImages boolean
  if (typeof def['supportsImages'] !== 'boolean') {
    errors.push('"supportsImages" must be a boolean');
  }

  // params array
  if (!Array.isArray(def['params'])) {
    errors.push('"params" must be an array');
  } else {
    (def['params'] as unknown[]).forEach((p, i) => {
      if (typeof p !== 'object' || p === null) {
        errors.push(`params[${i}] must be an object`);
        return;
      }
      const param = p as Record<string, unknown>;
      if (typeof param['name'] !== 'string' || !param['name']) {
        errors.push(`params[${i}].name is required`);
      }
      if (!['select', 'text', 'number', 'boolean'].includes(param['type'] as string)) {
        errors.push(`params[${i}].type must be "select", "text", "number", or "boolean"`);
      }
      if (typeof param['label'] !== 'string' || !param['label']) {
        errors.push(`params[${i}].label is required`);
      }
      if (param['type'] === 'select' && !Array.isArray(param['options'])) {
        errors.push(`params[${i}].options must be an array for select type`);
      }
    });
  }

  // postProcessType: null or known string
  const ppt = def['postProcessType'];
  if (ppt !== null && ppt !== undefined) {
    if (typeof ppt !== 'string') {
      errors.push('"postProcessType" must be null or a string');
    }
    // Unknown but valid string values are allowed (extensible)
  }

  return { valid: errors.length === 0, errors };
}

// ── ToolRegistry ────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, JsonToolDef>();
  private customIds = new Set<string>();  // tracks which ids come from workspace

  // ── Loading ───────────────────────────────────────────────────────────────

  async loadBuiltins(extensionPath: string): Promise<void> {
    const toolsDir = path.join(extensionPath, 'resources', 'tools');
    try {
      const dirUri = vscode.Uri.file(toolsDir);
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      // Sort for deterministic ordering
      const jsonFiles = entries
        .filter(([name]) => name.endsWith('.json'))
        .sort(([a], [b]) => a.localeCompare(b));
      for (const [name] of jsonFiles) {
        await this._loadFile(path.join(toolsDir, name), false);
      }
    } catch {
      // tools dir missing — not fatal
    }
  }

  async loadWorkspaceTools(canvasDir: string): Promise<void> {
    const toolsDir = path.join(canvasDir, 'tools');
    try {
      const dirUri = vscode.Uri.file(toolsDir);
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      const jsonFiles = entries
        .filter(([name]) => name.endsWith('.json'))
        .sort(([a], [b]) => a.localeCompare(b));
      for (const [name] of jsonFiles) {
        await this._loadFile(path.join(toolsDir, name), true);
      }
    } catch {
      // tools dir missing — not fatal
    }
  }

  /** Reload workspace tools: clear existing custom tools first, then re-scan. */
  async reloadWorkspaceTools(canvasDir: string): Promise<void> {
    // Remove previously loaded custom tools from the map
    for (const id of this.customIds) {
      this.tools.delete(id);
    }
    this.customIds.clear();
    // Re-scan
    await this.loadWorkspaceTools(canvasDir);
  }

  private async _loadFile(filePath: string, isCustom: boolean): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(bytes).toString('utf-8'));
      } catch {
        console.warn(`[ToolRegistry] JSON parse error in ${filePath}`);
        return;
      }

      const { valid, errors } = validateToolDef(parsed);
      if (!valid) {
        console.warn(`[ToolRegistry] skipping ${filePath}: ${errors.join('; ')}`);
        return;
      }

      const def = { paramMaps: {}, ...parsed as JsonToolDef };
      // Custom tools override builtins with the same id; builtins don't override customs
      if (isCustom) {
        this.tools.set(def.id, def);
        this.customIds.add(def.id);
      } else if (!this.tools.has(def.id)) {
        this.tools.set(def.id, def);
      }
    } catch (e) {
      console.warn(`[ToolRegistry] failed to load ${filePath}:`, e);
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  /** Returns all tools with a runtime `_isCustom` marker for UI grouping. */
  getAll(): RuntimeToolDef[] {
    return [...this.tools.values()].map(def => ({
      ...def,
      _isCustom: this.customIds.has(def.id),
    }));
  }

  get(id: string): JsonToolDef | undefined {
    return this.tools.get(id);
  }

  isCustom(id: string): boolean {
    return this.customIds.has(id);
  }

  // ── Template rendering ────────────────────────────────────────────────────

  buildSystem(id: string, params: Record<string, unknown>): string {
    const def = this.tools.get(id);
    if (!def) { return ''; }

    return def.systemPromptTemplate.replace(
      /\{\{(\w+)(?::(\w+))?\}\}/g,
      (_match, paramName: string, modifier?: string) => {
        const rawValue = params[paramName];
        // Treat undefined/null as empty string — never output "undefined"
        const strValue = (rawValue !== undefined && rawValue !== null) ? String(rawValue) : '';

        if (modifier === 'map') {
          const maps = def.paramMaps ?? {};
          const mapEntry = maps[paramName];
          return (mapEntry && strValue in mapEntry) ? mapEntry[strValue] : strValue;
        }
        return strValue;
      }
    );
  }

  // ── Post-processing ───────────────────────────────────────────────────────

  postProcess(id: string, raw: string): string {
    const def = this.tools.get(id);
    if (!def?.postProcessType) { return raw; }

    switch (def.postProcessType) {
      case 'extractMermaidBlock': {
        const match = raw.match(/```mermaid\s*([\s\S]*?)```/);
        return match ? match[1].trim() : raw.trim();
      }
      default:
        console.warn(`[ToolRegistry] unknown postProcessType "${def.postProcessType}" for tool "${id}"`);
        return raw;
    }
  }
}
