import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { PetState } from '../core/canvas-model';
import { normalizePetState } from '../core/pet-state';

const PET_DIR = 'pet';
const STATE_FILE = 'state.json';

/**
 * Read the persisted pet state from pet/state.json in the canvas directory.
 * Returns null if file doesn't exist.
 */
export async function readPetState(canvasDir: string): Promise<PetState | null> {
  const filePath = path.join(canvasDir, PET_DIR, STATE_FILE);
  try {
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    return normalizePetState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Write pet state to pet/state.json, creating the directory if needed.
 */
export async function writePetState(canvasDir: string, state: unknown): Promise<void> {
  const dir = path.join(canvasDir, PET_DIR);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, STATE_FILE);
    const normalized = normalizePetState(state);
    if (!normalized) { return; }
    await fs.promises.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
  } catch (err) {
    console.error('[PetMemory] Failed to write state:', err);
  }
}

/**
 * Read pet settings from VSCode configuration.
 */
export function readPetSettings(): {
  enabled: boolean;
  petType: string;
  petName: string;
  restReminderMin: number;
  groundTheme: string;
} {
  const cfg = vscode.workspace.getConfiguration('researchSpace.pet');
  return {
    enabled: cfg.get<boolean>('enabled', false),
    petType: cfg.get<string>('type', 'dog'),
    petName: cfg.get<string>('name', ''),
    restReminderMin: cfg.get<number>('restReminder', 45),
    groundTheme: cfg.get<string>('groundTheme', 'forest'),
  };
}

/**
 * Send pet init data to webview after canvas is ready.
 */
export async function sendPetInit(
  panel: vscode.WebviewPanel | { webview: vscode.Webview },
  canvasDir: string,
): Promise<void> {
  const settings = readPetSettings();
  const petState = await readPetState(canvasDir);

  (panel as any).webview.postMessage({
    type: 'petInit',
    petState,
    petEnabled: settings.enabled,
    restReminderMin: settings.restReminderMin,
  });
}
