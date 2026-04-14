import React, { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './components/canvas/Canvas';
import { PetWidget } from './components/pet/PetWidget';
import { useCanvasStore } from './stores/canvas-store';
import { usePetStore } from './stores/pet-store';
import { onMessage, postMessage } from './bridge';

import '@xyflow/react/dist/style.css';

// ── Error classification ─────────────────────────────────────────────────────

type ErrorKind = 'api_key' | 'network' | 'file_missing' | 'generic';

function classifyError(msg: string): ErrorKind {
  const lower = msg.toLowerCase();
  if (
    lower.includes('api key') || lower.includes('apikey') ||
    lower.includes('未配置') && lower.includes('key') ||
    lower.includes('401') || lower.includes('unauthorized') ||
    lower.includes('authentication')
  ) { return 'api_key'; }
  if (
    lower.includes('fetch failed') || lower.includes('network') ||
    lower.includes('econnrefused') || lower.includes('enotfound') ||
    lower.includes('timeout') || lower.includes('502') ||
    lower.includes('503') || lower.includes('连接') || lower.includes('网络')
  ) { return 'network'; }
  if (
    lower.includes('file') && lower.includes('miss') ||
    lower.includes('找不到文件') || lower.includes('文件不存在') ||
    lower.includes('no such file') || lower.includes('enoent')
  ) { return 'file_missing'; }
  return 'generic';
}

// ── ErrorToast component ─────────────────────────────────────────────────────

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  const { setSettingsPanelOpen } = useCanvasStore();
  const kind = classifyError(message);

  // Auto-dismiss after 12s for non-actionable errors
  useEffect(() => {
    if (kind === 'generic') {
      const t = setTimeout(onClose, 12000);
      return () => clearTimeout(t);
    }
  }, [kind, onClose]);

  const actionButton = (label: string, onClick: () => void) => (
    <button
      onClick={e => { e.stopPropagation(); onClick(); onClose(); }}
      style={{
        marginTop: 6,
        padding: '3px 10px',
        background: 'var(--vscode-button-background)',
        color: 'var(--vscode-button-foreground)',
        border: 'none',
        borderRadius: 3,
        fontSize: 11,
        cursor: 'pointer',
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );

  const kindLabel: Record<ErrorKind, string> = {
    api_key:      '⚠ API Key 错误',
    network:      '⚠ 网络错误',
    file_missing: '⚠ 文件缺失',
    generic:      '⚠ AI 错误',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        maxWidth: 500,
        background: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
        border: '1px solid var(--vscode-inputValidation-errorBorder, #be1100)',
        color: 'var(--vscode-inputValidation-errorForeground, #f48771)',
        borderRadius: 6,
        padding: '10px 16px',
        fontSize: 12,
        zIndex: 9999,
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 280,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontWeight: 700, flexShrink: 0 }}>{kindLabel[kind]}</span>
        <span style={{ flex: 1, wordBreak: 'break-word' }}>{message}</span>
        <span style={{ flexShrink: 0, opacity: 0.7 }}>✕</span>
      </div>
      {kind === 'api_key' && (
        <div onClick={e => e.stopPropagation()}>
          {actionButton('打开设置', () => setSettingsPanelOpen(true))}
        </div>
      )}
      {kind === 'network' && (
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
          请检查网络连接或 Ollama 服务是否运行，然后重新运行节点。
        </div>
      )}
      {kind === 'file_missing' && (
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
          右键节点 → 从画布删除，然后重新导入该文件。
        </div>
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const {
    initCanvas, updateNodeStatus,
    appendAiChunk, finishAiRun, setImageUri, addNode,
    setNodeFileMissing, updateNodeFilePath, updateNodePreview,
    addToStaging, setFullContent,
    setError, clearError, lastError, setModelCache,
    setSettings, setToolDefs, setNodeDefs,
  } = useCanvasStore();
  const petInit = usePetStore(s => s.init);
  const petSetAssets = usePetStore(s => s.setAssetsBaseUri);

  useEffect(() => {
    const unsubscribe = onMessage(msg => {
      switch (msg.type) {
        case 'init':
          if (msg.data && msg.workspaceRoot !== undefined) {
            initCanvas(msg.data, msg.workspaceRoot);
          }
          break;
        // ── Pet messages ──
        case 'petInit':
          petInit(
            (msg as any).petState ?? null,
            !!(msg as any).petEnabled,
            (msg as any).restReminderMin ?? 45,
            (msg as any).groundTheme ?? 'forest',
          );
          break;
        case 'petAssetsBase':
          petSetAssets((msg as any).uri ?? '');
          break;
        case 'petAiChatResponse': {
          // Handle AI suggestion responses (auto-triggered, not user chat)
          const resp = msg as any;
          if (resp.requestId?.startsWith('suggest-') && resp.text) {
            const petStore = usePetStore.getState();
            petStore.showBubble(resp.text, 10000);
            petStore.addExp(5);
            usePetStore.setState({ waitingForAi: false });
          }
          // Chat responses handled by PetWidget's message listener
          break;
        }
        case 'fnStatusUpdate':
          if (msg.nodeId && msg.status) {
            updateNodeStatus(msg.nodeId, msg.status, msg.progressText);
          }
          break;
        case 'aiChunk':
          if (msg.runId && msg.chunk !== undefined) {
            appendAiChunk(msg.runId, msg.chunk);
          }
          break;
        case 'aiDone':
          if (msg.runId && msg.node && msg.edge) {
            finishAiRun(msg.runId, msg.node, msg.edge);
            usePetStore.getState().notifyCanvasEvent('aiDone');
          }
          break;
        case 'aiError':
          if (msg.message) {
            setError(msg.message as string);
            usePetStore.getState().notifyCanvasEvent('aiError');
          }
          break;
        case 'modelList':
          if (msg.provider && Array.isArray(msg.models)) {
            setModelCache(msg.provider as string, msg.models as import('../../../src/core/canvas-model').ModelInfo[]);
          }
          break;
        case 'settingsSnapshot':
          if (msg.settings) {
            setSettings(msg.settings as import('../../../src/core/canvas-model').SettingsSnapshot);
          }
          break;
        case 'imageUri':
          if (msg.filePath && msg.uri) {
            setImageUri(msg.filePath, msg.uri);
          }
          break;
        case 'stageNodes':
          if (Array.isArray(msg.nodes)) {
            addToStaging(msg.nodes as import('../../../src/core/canvas-model').CanvasNode[]);
            usePetStore.getState().notifyCanvasEvent('nodeAdded');
          }
          break;
        case 'nodeAdded':
          // Legacy: redirect to staging area
          if (msg.node) {
            addToStaging([msg.node as import('../../../src/core/canvas-model').CanvasNode]);
            usePetStore.getState().notifyCanvasEvent('nodeAdded');
          }
          break;
        case 'nodeFileStatus':
          if (msg.nodeId !== undefined) {
            setNodeFileMissing(msg.nodeId, !!msg.missing);
          }
          break;
        case 'nodeFileMoved':
          if (msg.nodeId && msg.newFilePath && msg.newTitle) {
            updateNodeFilePath(msg.nodeId, msg.newFilePath as string, msg.newTitle as string);
          }
          break;
        case 'nodeContentUpdate':
          if (msg.nodeId && msg.preview !== undefined) {
            updateNodePreview(msg.nodeId, msg.preview as string);
          }
          break;
        case 'error':
          console.error('[ResearchSpace]', msg.message);
          break;
        case 'toolDefs':
          if (Array.isArray((msg as { tools?: unknown }).tools)) {
            setToolDefs((msg as { tools: import('../../../src/core/canvas-model').JsonToolDef[] }).tools);
          }
          break;
        case 'toolDefError':
          if ((msg as { message?: unknown }).message) {
            setError((msg as { message: string }).message);
          }
          break;
        case 'nodeDefs':
          if (Array.isArray((msg as { defs?: unknown }).defs)) {
            setNodeDefs((msg as { defs: import('../../../src/core/canvas-model').DataNodeDef[] }).defs);
          }
          break;
        case 'fileContent': {
          const fc = msg as { requestId: string; content: string };
          if (fc.requestId && fc.content !== undefined) {
            setFullContent(fc.requestId, fc.content);
          }
          break;
        }
      }
    });

    // Tell extension host we're ready
    postMessage({ type: 'ready' });

    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
        </div>
        {lastError && <ErrorToast message={lastError} onClose={clearError} />}
      </div>
      <PetWidget />
    </>
  );
}
