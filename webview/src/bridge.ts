// bridge.ts — postMessage bridge between Webview and Extension Host

import type { CanvasFile } from '../../src/core/canvas-model';
import type { WebviewMessage, ExtensionMessage } from '../../src/core/canvas-model';

export type { WebviewMessage, ExtensionMessage };

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type VsCodeApi = ReturnType<typeof acquireVsCodeApi>;
declare global {
  interface Window { __rsVsCodeApi?: VsCodeApi; }
}

// Initialise IMMEDIATELY (module top-level) so it's available before any React code runs.
// acquireVsCodeApi() can only be called once — cache on window to survive HMR re-evals.
if (!window.__rsVsCodeApi) {
  try {
    window.__rsVsCodeApi = acquireVsCodeApi();
  } catch (e) {
    // Outside VSCode (e.g. browser preview) — no-op shim
    window.__rsVsCodeApi = {
      postMessage: (msg) => console.log('[bridge] postMessage (no-op):', msg),
      getState: () => null,
      setState: () => {},
    };
  }
}

export function postMessage(msg: WebviewMessage): void {
  window.__rsVsCodeApi!.postMessage(msg);
}

export function onMessage(handler: (msg: ExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== 'object' || !event.data.type) { return; }
    handler(event.data as ExtensionMessage);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function saveState(state: CanvasFile): void {
  window.__rsVsCodeApi!.setState(state);
}

export function getState(): CanvasFile | null {
  return (window.__rsVsCodeApi!.getState() as CanvasFile) ?? null;
}
