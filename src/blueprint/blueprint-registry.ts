import * as vscode from 'vscode';
import * as path from 'path';
import type { BlueprintDefinition, BlueprintSlotDef } from './blueprint-types';
import { BLUEPRINT_DEF_VERSION } from './blueprint-types';

export interface BlueprintRegistryEntry {
  id: string;
  title: string;
  description?: string;
  color: string;
  file_name: string;
  file_path: string;
  updated_at: string;
  version: string;
  input_slots: number;
  intermediate_slots: number;
  output_slots: number;
  function_nodes: number;
  input_slot_defs: BlueprintSlotDef[];
  output_slot_defs: BlueprintSlotDef[];
}

function sanitizeBlueprintFileBase(title: string): string {
  const trimmed = title.trim();
  const safe = trimmed
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'blueprint';
}

export function isBlueprintDefinition(value: unknown): value is BlueprintDefinition {
  if (typeof value !== 'object' || value === null) { return false; }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec['id'] === 'string' &&
    typeof rec['title'] === 'string' &&
    typeof rec['color'] === 'string' &&
    Array.isArray(rec['input_slots']) &&
    Array.isArray(rec['intermediate_slots']) &&
    Array.isArray(rec['output_slots']) &&
    Array.isArray(rec['data_nodes']) &&
    Array.isArray(rec['function_nodes']) &&
    Array.isArray(rec['edges']) &&
    typeof rec['metadata'] === 'object' &&
    typeof rec['version'] === 'string'
  );
}

export async function ensureBlueprintDir(canvasDir: string): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(canvasDir, 'blueprints'));
  try {
    await vscode.workspace.fs.createDirectory(dir);
  } catch {
    // ignore
  }
  return dir;
}

function toRegistryEntry(filePath: string, def: BlueprintDefinition): BlueprintRegistryEntry {
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    color: def.color,
    file_name: path.basename(filePath),
    file_path: filePath,
    updated_at: def.metadata.created_at,
    version: def.version,
    input_slots: def.input_slots.length,
    intermediate_slots: def.intermediate_slots.length,
    output_slots: def.output_slots.length,
    function_nodes: def.function_nodes.length,
    input_slot_defs: def.input_slots,
    output_slot_defs: def.output_slots,
  };
}

export async function listBlueprintDefinitions(canvasDir: string): Promise<BlueprintRegistryEntry[]> {
  const dir = await ensureBlueprintDir(canvasDir);
  const entries = await vscode.workspace.fs.readDirectory(dir);
  const results: BlueprintRegistryEntry[] = [];

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !name.endsWith('.blueprint.json')) { continue; }
    const fileUri = vscode.Uri.joinPath(dir, name);
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8'));
      if (!isBlueprintDefinition(parsed)) { continue; }
      results.push(toRegistryEntry(fileUri.fsPath, parsed));
    } catch {
      // Skip malformed blueprint files in the lightweight index.
    }
  }

  results.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return results;
}

export async function readBlueprintDefinition(filePath: string): Promise<BlueprintDefinition> {
  const fileUri = vscode.Uri.file(filePath);
  const bytes = await vscode.workspace.fs.readFile(fileUri);
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf-8'));
  if (!isBlueprintDefinition(parsed)) {
    throw new Error(`蓝图文件格式无效：${path.basename(filePath)}`);
  }
  return parsed;
}

export async function saveBlueprintDefinition(
  canvasDir: string,
  definition: BlueprintDefinition,
): Promise<BlueprintRegistryEntry> {
  const dir = await ensureBlueprintDir(canvasDir);
  const fileBase = sanitizeBlueprintFileBase(definition.title);
  const fileName = `${fileBase}.blueprint.json`;
  const fileUri = vscode.Uri.joinPath(dir, fileName);

  try {
    await vscode.workspace.fs.stat(fileUri);
    throw new Error(`已存在同名蓝图文件：${fileName}。请修改蓝图名称后再保存。`);
  } catch (e) {
    if (!(e instanceof vscode.FileSystemError)) {
      throw e;
    }
  }

  const nextDef: BlueprintDefinition = {
    ...definition,
    version: definition.version || BLUEPRINT_DEF_VERSION,
    title: definition.title.trim(),
    description: definition.description?.trim() ?? '',
    metadata: {
      ...definition.metadata,
      created_at: new Date().toISOString(),
    },
  };

  const encoded = Buffer.from(JSON.stringify(nextDef, null, 2), 'utf-8');
  await vscode.workspace.fs.writeFile(fileUri, encoded);
  return toRegistryEntry(fileUri.fsPath, nextDef);
}
