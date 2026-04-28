import React, { useEffect, useRef, useState } from 'react';
import { ReactFlowProvider, useNodesInitialized } from '@xyflow/react';
import { Canvas } from './components/canvas/Canvas';
import { OutputHistoryModal } from './components/canvas/OutputHistoryModal';
import { CreateBlueprintDialog } from './components/dialogs/CreateBlueprintDialog';
import { PetWidget } from './components/pet/PetWidget';
import { MindMapEditorModal } from './components/mindmap/MindMapEditorModal';
import { useCanvasStore } from './stores/canvas-store';
import { usePetStore } from './stores/pet-store';
import { onMessage, postMessage } from './bridge';
import type { MindMapFile, MindMapImage } from '../../src/mindmap/mindmap-model';

import '@xyflow/react/dist/style.css';

function formatLoadMetricMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) { return '—'; }
  return `${Math.max(0, Math.round(ms))}ms`;
}

// ── Error classification ─────────────────────────────────────────────────────

type ErrorKind = 'api_key' | 'network' | 'file_missing' | 'connection' | 'generic';

function classifyError(msg: string): ErrorKind {
  const lower = msg.toLowerCase();
  if (
    lower.startsWith('连接失败') ||
    lower.includes('槽位“') ||
    lower.includes('蓝图输入占位') ||
    lower.includes('请拖到蓝图输入槽位')
  ) { return 'connection'; }
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
    lower.includes('503') || lower.includes('网络')
  ) { return 'network'; }
  if (
    lower.includes('file') && lower.includes('miss') ||
    lower.includes('找不到文件') || lower.includes('文件不存在') ||
    lower.includes('no such file') || lower.includes('enoent')
  ) { return 'file_missing'; }
  return 'generic';
}

function buildBlueprintRunSummary(args: {
  status: 'succeeded' | 'failed' | 'cancelled';
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  skippedNodes: number;
  warningCount: number;
  issueNodeTitle?: string | null;
}): string {
  const parts = [`完成 ${Math.min(args.completedNodes, args.totalNodes)}/${args.totalNodes}`];
  if (args.failedNodes > 0) { parts.push(`失败 ${args.failedNodes}`); }
  if (args.skippedNodes > 0) { parts.push(`跳过 ${args.skippedNodes}`); }
  if (args.warningCount > 0) { parts.push(`预检警告 ${args.warningCount}`); }
  const prefix = args.status === 'succeeded'
    ? '运行完成'
    : args.status === 'failed'
      ? '运行失败'
      : '运行已取消';
  return `${prefix}：${parts.join('，')}${args.issueNodeTitle ? `；问题节点：${args.issueNodeTitle}` : ''}`;
}

function appendBlueprintRunHistory(
  previous: import('../../src/core/canvas-model').BlueprintRunHistoryEntry[] | undefined,
  entry: import('../../src/core/canvas-model').BlueprintRunHistoryEntry,
): import('../../src/core/canvas-model').BlueprintRunHistoryEntry[] {
  return [entry, ...(previous ?? [])].slice(0, 8);
}

// ── ErrorToast component ─────────────────────────────────────────────────────

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  const setSettingsPanelOpen = useCanvasStore(s => s.setSettingsPanelOpen);
  const kind = classifyError(message);

  // Auto-dismiss after 12s for non-actionable errors
  useEffect(() => {
    if (kind === 'generic' || kind === 'connection') {
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
    connection:   '⚠ 连接失败',
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
      {kind === 'connection' && (
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
          请按槽位提示连接正确类型；若提示单绑定，请先移除旧连接。
        </div>
      )}
    </div>
  );
}

function InitialCanvasLoadingNotice() {
  const active = useCanvasStore(s => s.initialCanvasLoadActive);
  const pending = useCanvasStore(s => s.initialCanvasLoadPending);
  const stats = useCanvasStore(s => s.currentInitialCanvasLoadStats);

  if (!active) { return null; }

  return (
    <div
      style={{
        position: 'fixed',
        top: 56,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9998,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 10,
        background: 'color-mix(in srgb, var(--vscode-editor-background) 88%, transparent)',
        border: '1px solid var(--vscode-panel-border)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
        backdropFilter: 'blur(6px)',
        maxWidth: 'min(620px, calc(100vw - 32px))',
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--vscode-progressBar-background, var(--vscode-button-background))',
          boxShadow: '0 0 0 6px color-mix(in srgb, var(--vscode-progressBar-background, var(--vscode-button-background)) 18%, transparent)',
          animation: 'rsInitialLoadPulse 1.2s ease-in-out infinite',
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-foreground)' }}>
          正在加载画布内容
        </div>
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
          正在恢复预览、全文和节点信息。大型画布初次打开可能短暂卡顿，提示消失后说明首轮加载基本完成。
          {pending > 0 ? ` 当前仍有 ${pending} 项内容待载入。` : ''}
        </div>
        {stats && (
          <div style={{
            marginTop: 6,
            fontSize: 10,
            color: 'var(--vscode-descriptionForeground)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            rowGap: 4,
          }}>
            <span>节点 {stats.nodeCount}</span>
            <span>媒体 {stats.mediaRequestCount}</span>
            <span>全文 {stats.fullContentRequestCount}</span>
            <span>组框重算 {stats.groupBoundsRecalcCount}</span>
            <span>首轮渲染 {formatLoadMetricMs(stats.renderReadyMs)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function InitialCanvasRenderBridge() {
  const active = useCanvasStore(s => s.initialCanvasLoadActive);
  const markInitialCanvasRenderReady = useCanvasStore(s => s.markInitialCanvasRenderReady);
  const nodesInitialized = useNodesInitialized({ includeHiddenNodes: false });

  useEffect(() => {
    if (!active) {
      markInitialCanvasRenderReady(true);
      return;
    }

    if (!nodesInitialized) {
      markInitialCanvasRenderReady(false);
      return;
    }

    const raf = window.requestAnimationFrame(() => {
      markInitialCanvasRenderReady(true);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [active, markInitialCanvasRenderReady, nodesInitialized]);

  return null;
}

// ── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const initCanvas = useCanvasStore(s => s.initCanvas);
  const updateNodeStatus = useCanvasStore(s => s.updateNodeStatus);
  const appendAiChunk = useCanvasStore(s => s.appendAiChunk);
  const finishAiRun = useCanvasStore(s => s.finishAiRun);
  const setImageUris = useCanvasStore(s => s.setImageUris);
  const addNode = useCanvasStore(s => s.addNode);
  const setNodeFileMissing = useCanvasStore(s => s.setNodeFileMissing);
  const updateNodeFilePath = useCanvasStore(s => s.updateNodeFilePath);
  const updateNodePreviews = useCanvasStore(s => s.updateNodePreviews);
  const addToStaging = useCanvasStore(s => s.addToStaging);
  const applyPdfExplosion = useCanvasStore(s => s.applyPdfExplosion);
  const resolveStagingMaterialization = useCanvasStore(s => s.resolveStagingMaterialization);
  const failStagingMaterialization = useCanvasStore(s => s.failStagingMaterialization);
  const setFullContents = useCanvasStore(s => s.setFullContents);
  const setError = useCanvasStore(s => s.setError);
  const clearError = useCanvasStore(s => s.clearError);
  const lastError = useCanvasStore(s => s.lastError);
  const setModelCache = useCanvasStore(s => s.setModelCache);
  const setSettings = useCanvasStore(s => s.setSettings);
  const requestModelCache = useCanvasStore(s => s.requestModelCache);
  const saveNow = useCanvasStore(s => s.saveNow);
  const setToolDefs = useCanvasStore(s => s.setToolDefs);
  const setNodeDefs = useCanvasStore(s => s.setNodeDefs);
  const setPipelineState = useCanvasStore(s => s.setPipelineState);
  const updatePipelineNodeStatus = useCanvasStore(s => s.updatePipelineNodeStatus);
  const setPipelineNodeIssue = useCanvasStore(s => s.setPipelineNodeIssue);
  const incrementPipelineCompleted = useCanvasStore(s => s.incrementPipelineCompleted);
  const setPipelinePaused = useCanvasStore(s => s.setPipelinePaused);
  const setPipelineCancelRequested = useCanvasStore(s => s.setPipelineCancelRequested);
  const addPipelineWarning = useCanvasStore(s => s.addPipelineWarning);
  const setOutputHistory = useCanvasStore(s => s.setOutputHistory);
  const runAutosaveCheck = useCanvasStore(s => s.runAutosaveCheck);
  const markSaveSuccess = useCanvasStore(s => s.markSaveSuccess);
  const markSaveError = useCanvasStore(s => s.markSaveError);
  const blueprintDraft = useCanvasStore(s => s.blueprintDraft);
  const blueprintIndex = useCanvasStore(s => s.blueprintIndex);
  const canvasFile = useCanvasStore(s => s.canvasFile);
  const setBlueprintDraft = useCanvasStore(s => s.setBlueprintDraft);
  const clearBlueprintDraft = useCanvasStore(s => s.clearBlueprintDraft);
  const setBlueprintIndex = useCanvasStore(s => s.setBlueprintIndex);
  const migrateBlueprintDefinitions = useCanvasStore(s => s.migrateBlueprintDefinitions);
  const instantiateBlueprintDefinition = useCanvasStore(s => s.instantiateBlueprintDefinition);
  const syncBlueprintDefinitionAvailability = useCanvasStore(s => s.syncBlueprintDefinitionAvailability);
  const updateNodeMeta = useCanvasStore(s => s.updateNodeMeta);
  const lastInitialCanvasLoadStats = useCanvasStore(s => s.lastInitialCanvasLoadStats);
  const imageUriMap = useCanvasStore(s => s.imageUriMap);
  const [mindMapEditor, setMindMapEditor] = useState<{
    nodeId: string;
    filePath: string;
    mindmap: MindMapFile;
  } | null>(null);
  const [mindMapSaveState, setMindMapSaveState] = useState<{
    nodeId: string;
    status: 'saving' | 'saved' | 'error';
    message?: string;
  } | null>(null);
  const [mindMapPickedImage, setMindMapPickedImage] = useState<{
    nodeId: string;
    itemId: string;
    image: MindMapImage;
    uri?: string;
  } | null>(null);
  const petInit = usePetStore(s => s.init);
  const petSetAssets = usePetStore(s => s.setAssetsBaseUri);
  const aiChunkBufferRef = useRef(new Map<string, string>());
  const aiChunkFlushRafRef = useRef<number | null>(null);
  const imageUriBufferRef = useRef(new Map<string, string>());
  const imageUriFlushRafRef = useRef<number | null>(null);
  const nodePreviewBufferRef = useRef(new Map<string, { preview: string; metaPatch?: Partial<import('../../src/core/canvas-model').NodeMeta> }>());
  const nodePreviewFlushRafRef = useRef<number | null>(null);
  const fileContentBufferRef = useRef(new Map<string, string>());
  const fileContentFlushRafRef = useRef<number | null>(null);
  const lastAutoRequestedBlueprintDefinitionsKeyRef = useRef('');
  const activeCanvasSessionIdRef = useRef(0);
  const isAliveRef = useRef(true);
  const lastLoggedInitialLoadSessionRef = useRef<number | null>(null);

  useEffect(() => {
    isAliveRef.current = true;
    return () => {
      isAliveRef.current = false;
    };
  }, []);

  const settings = useCanvasStore(s => s.settings);

  useEffect(() => {
    if (!settings) { return; }
    requestModelCache('copilot');
    requestModelCache('ollama');
    if (settings.anthropicApiKey?.trim()) {
      requestModelCache('anthropic');
    }
    for (const provider of (settings.customProviders ?? [])) {
      if (provider.baseUrl?.trim() && provider.apiKey?.trim()) {
        requestModelCache(provider.id);
      }
    }
  }, [requestModelCache, settings]);

  const flushAiChunks = () => {
    aiChunkFlushRafRef.current = null;
    if (!isAliveRef.current) { return; }
    const buffered = aiChunkBufferRef.current;
    if (buffered.size === 0) { return; }
    aiChunkBufferRef.current = new Map();
    for (const [runId, chunk] of buffered.entries()) {
      appendAiChunk(runId, chunk);
    }
  };

  const flushAiChunksForRun = (runId: string) => {
    if (!isAliveRef.current) { return; }
    const chunk = aiChunkBufferRef.current.get(runId);
    if (!chunk) { return; }
    aiChunkBufferRef.current.delete(runId);
    appendAiChunk(runId, chunk);
  };

  const enqueueAiChunk = (runId: string, chunk: string) => {
    if (!isAliveRef.current) { return; }
    const current = aiChunkBufferRef.current.get(runId) ?? '';
    aiChunkBufferRef.current.set(runId, current + chunk);
    if (aiChunkFlushRafRef.current !== null) { return; }
    aiChunkFlushRafRef.current = window.requestAnimationFrame(flushAiChunks);
  };

  const flushImageUris = () => {
    imageUriFlushRafRef.current = null;
    if (!isAliveRef.current) { return; }
    const buffered = imageUriBufferRef.current;
    if (buffered.size === 0) { return; }
    imageUriBufferRef.current = new Map();
    setImageUris(Array.from(buffered.entries()).map(([filePath, uri]) => ({ filePath, uri })));
  };

  const enqueueImageUri = (filePath: string, uri: string) => {
    if (!isAliveRef.current) { return; }
    imageUriBufferRef.current.set(filePath, uri);
    if (imageUriFlushRafRef.current !== null) { return; }
    imageUriFlushRafRef.current = window.requestAnimationFrame(flushImageUris);
  };

  const flushNodePreviews = () => {
    nodePreviewFlushRafRef.current = null;
    if (!isAliveRef.current) { return; }
    const buffered = nodePreviewBufferRef.current;
    if (buffered.size === 0) { return; }
    nodePreviewBufferRef.current = new Map();
    updateNodePreviews(
      Array.from(buffered.entries()).map(([nodeId, entry]) => ({
        nodeId,
        preview: entry.preview,
        metaPatch: entry.metaPatch,
      }))
    );
  };

  const enqueueNodePreview = (
    nodeId: string,
    preview: string,
    metaPatch?: Partial<import('../../src/core/canvas-model').NodeMeta>
  ) => {
    if (!isAliveRef.current) { return; }
    nodePreviewBufferRef.current.set(nodeId, { preview, metaPatch });
    if (nodePreviewFlushRafRef.current !== null) { return; }
    nodePreviewFlushRafRef.current = window.requestAnimationFrame(flushNodePreviews);
  };

  const flushFileContents = () => {
    fileContentFlushRafRef.current = null;
    if (!isAliveRef.current) { return; }
    const buffered = fileContentBufferRef.current;
    if (buffered.size === 0) { return; }
    fileContentBufferRef.current = new Map();
    setFullContents(
      Array.from(buffered.entries()).map(([nodeId, content]) => ({ nodeId, content }))
    );
  };

  const enqueueFileContent = (nodeId: string, content: string) => {
    if (!isAliveRef.current) { return; }
    fileContentBufferRef.current.set(nodeId, content);
    if (fileContentFlushRafRef.current !== null) { return; }
    fileContentFlushRafRef.current = window.requestAnimationFrame(flushFileContents);
  };

  useEffect(() => {
    const styleId = 'rs-initial-load-style';
    if (document.getElementById(styleId)) { return; }
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes rsInitialLoadPulse {
        0% { transform: scale(0.9); opacity: 0.7; }
        50% { transform: scale(1.08); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0.7; }
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    const blueprintFilePaths = Array.from(new Set(
      (canvasFile?.nodes ?? [])
        .filter(node => node.node_type === 'blueprint' && typeof node.meta?.blueprint_file_path === 'string' && node.meta.blueprint_file_path.length > 0)
        .map(node => node.meta!.blueprint_file_path as string)
    )).sort();
    const nextKey = blueprintFilePaths.join('||');

    if (!nextKey) {
      lastAutoRequestedBlueprintDefinitionsKeyRef.current = '';
      return;
    }
    if (lastAutoRequestedBlueprintDefinitionsKeyRef.current === nextKey) {
      return;
    }

    lastAutoRequestedBlueprintDefinitionsKeyRef.current = nextKey;
    postMessage({
      type: 'requestBlueprintDefinitions',
      filePaths: blueprintFilePaths,
      sessionId: activeCanvasSessionIdRef.current,
    });
  }, [canvasFile]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      runAutosaveCheck();
    }, 3 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [runAutosaveCheck]);

  useEffect(() => {
    const flushPendingCanvasState = () => {
      const state = useCanvasStore.getState();
      if (state.saveState === 'pending') {
        saveNow();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPendingCanvasState();
      }
    };

    window.addEventListener('pagehide', flushPendingCanvasState);
    window.addEventListener('beforeunload', flushPendingCanvasState);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', flushPendingCanvasState);
      window.removeEventListener('pagehide', flushPendingCanvasState);
    };
  }, [saveNow]);

  useEffect(() => {
    if (!lastInitialCanvasLoadStats) { return; }
    if (lastLoggedInitialLoadSessionRef.current === lastInitialCanvasLoadStats.sessionId) { return; }
    lastLoggedInitialLoadSessionRef.current = lastInitialCanvasLoadStats.sessionId;

    const payload = {
      nodeCount: lastInitialCanvasLoadStats.nodeCount,
      mediaRequestCount: lastInitialCanvasLoadStats.mediaRequestCount,
      fullContentRequestCount: lastInitialCanvasLoadStats.fullContentRequestCount,
      groupBoundsRecalcCount: lastInitialCanvasLoadStats.groupBoundsRecalcCount,
      renderReadyMs: lastInitialCanvasLoadStats.renderReadyMs,
      totalMs: lastInitialCanvasLoadStats.totalMs,
      finishedByTimeout: lastInitialCanvasLoadStats.finishedByTimeout,
    };

    if (lastInitialCanvasLoadStats.finishedByTimeout) {
      console.warn('[ResearchSpace] initial canvas load timed out', payload);
      return;
    }

    console.info('[ResearchSpace] initial canvas load', payload);
  }, [lastInitialCanvasLoadStats]);

  useEffect(() => () => {
    if (aiChunkFlushRafRef.current !== null) {
      window.cancelAnimationFrame(aiChunkFlushRafRef.current);
      aiChunkFlushRafRef.current = null;
    }
    aiChunkBufferRef.current.clear();
    if (imageUriFlushRafRef.current !== null) {
      window.cancelAnimationFrame(imageUriFlushRafRef.current);
      imageUriFlushRafRef.current = null;
    }
    imageUriBufferRef.current.clear();
    if (nodePreviewFlushRafRef.current !== null) {
      window.cancelAnimationFrame(nodePreviewFlushRafRef.current);
      nodePreviewFlushRafRef.current = null;
    }
    nodePreviewBufferRef.current.clear();
    if (fileContentFlushRafRef.current !== null) {
      window.cancelAnimationFrame(fileContentFlushRafRef.current);
      fileContentFlushRafRef.current = null;
    }
    fileContentBufferRef.current.clear();
  }, []);

  useEffect(() => {
    const unsubscribe = onMessage(msg => {
      if (!isAliveRef.current) { return; }
      switch (msg.type) {
        case 'init':
          if (msg.data && msg.workspaceRoot !== undefined) {
            activeCanvasSessionIdRef.current = typeof msg.sessionId === 'number'
              ? msg.sessionId
              : activeCanvasSessionIdRef.current + 1;
            lastAutoRequestedBlueprintDefinitionsKeyRef.current = '';
            initCanvas(msg.data, msg.workspaceRoot);
          }
          break;
        case 'canvasSaveStatus':
          if (msg.status === 'saved') {
            markSaveSuccess(msg.savedAt, msg.requestId);
          } else if (msg.status === 'error') {
            markSaveError(msg.message ?? '未知保存错误', msg.requestId);
          }
          break;
        // ── Pet messages ──
        case 'petInit':
          petInit(
            msg.petState ?? null,
            !!msg.petEnabled,
            msg.restReminderMin ?? 45,
            msg.groundTheme ?? 'forest',
            msg.suggestionActivity,
            msg.displayMode,
            msg.longTermMemory,
          );
          break;
        case 'petAssetsBase':
          petSetAssets(msg.uri ?? '');
          break;
        case 'petMemorySummary':
          usePetStore.getState().setMemorySummary({
            profile: {
              frequentEventTypes: Array.isArray((msg.profile as any)?.frequentEventTypes) ? (msg.profile as any).frequentEventTypes : [],
              frequentNodeTypes: Array.isArray((msg.profile as any)?.frequentNodeTypes) ? (msg.profile as any).frequentNodeTypes : [],
              frequentTools: Array.isArray((msg.profile as any)?.frequentTools) ? (msg.profile as any).frequentTools : [],
              frequentScenes: Array.isArray((msg.profile as any)?.frequentScenes) ? (msg.profile as any).frequentScenes : [],
              suggestionStats: {
                shown: Number((msg.profile as any)?.suggestionStats?.shown) || 0,
                accepted: Number((msg.profile as any)?.suggestionStats?.accepted) || 0,
                later: Number((msg.profile as any)?.suggestionStats?.later) || 0,
                muted: Number((msg.profile as any)?.suggestionStats?.muted) || 0,
              },
              suggestionActivity: typeof (msg.profile as any)?.suggestionActivity === 'string' ? (msg.profile as any).suggestionActivity : 'balanced',
              displayMode: typeof (msg.profile as any)?.displayMode === 'string' ? (msg.profile as any).displayMode : 'panel',
              updatedAt: typeof (msg.profile as any)?.updatedAt === 'string' ? (msg.profile as any).updatedAt : undefined,
            },
            records: Array.isArray(msg.records) ? msg.records as any[] : [],
          });
          break;
        case 'petAiChatResponse': {
          // Handle AI suggestion responses (auto-triggered, not user chat)
          if (msg.requestId?.startsWith('suggest-') && msg.text) {
            const petStore = usePetStore.getState();
            petStore.showBubble(msg.text, 10000);
            petStore.addExp(5);
            usePetStore.setState({ waitingForAi: false });
          }
          // Chat responses handled by PetWidget's message listener
          break;
        }
        case 'fnStatusUpdate':
          if (msg.nodeId && msg.status) {
            updateNodeStatus(msg.nodeId, msg.status, msg.progressText, msg.issueKind, msg.issueMessage);
          }
          break;
        case 'aiChunk':
          if (msg.runId && msg.chunk !== undefined) {
            enqueueAiChunk(msg.runId, msg.chunk);
          }
          break;
        case 'aiDone':
          if (msg.runId && msg.node && msg.edge) {
            flushAiChunksForRun(msg.runId);
            finishAiRun(msg.runId, msg.node, msg.edge);
            const outputNode = msg.node as import('../../src/core/canvas-model').CanvasNode;
            usePetStore.getState().notifyCanvasEvent('tool_run_completed', {
              nodeId: outputNode.id,
              nodeType: outputNode.node_type,
              title: outputNode.title,
            });
          }
          break;
        case 'aiError':
          if (msg.message) {
            if (msg.runId) {
              flushAiChunksForRun(msg.runId);
            }
            if (msg.nodeId) {
              updateNodeStatus(msg.nodeId, 'error', undefined, msg.issueKind ?? 'run_failed', msg.message as string);
            }
            setError(msg.message as string);
            usePetStore.getState().notifyCanvasEvent('tool_run_failed');
          }
          break;
        case 'modelList':
          if (msg.provider && Array.isArray(msg.models)) {
            setModelCache(msg.provider as string, msg.models as import('../../src/core/canvas-model').ModelInfo[]);
          }
          break;
        case 'settingsSnapshot':
          if (msg.settings) {
            setSettings(msg.settings as import('../../src/core/canvas-model').SettingsSnapshot);
          }
          break;
        case 'imageUri':
          if (msg.filePath && msg.uri) {
            enqueueImageUri(msg.filePath, msg.uri);
          }
          break;
        case 'pdfExploded':
          if (msg.sourceNodeId && msg.groupName && Array.isArray(msg.nodes) && msg.nodes.length > 0) {
            applyPdfExplosion(
              msg.sourceNodeId as string,
              typeof msg.producerNodeId === 'string' ? msg.producerNodeId : undefined,
              msg.groupName as string,
              msg.nodes as import('../../src/core/canvas-model').CanvasNode[],
            );
          }
          break;
        case 'stageNodes':
          if (Array.isArray(msg.nodes)) {
            const stagedNodes = msg.nodes as import('../../src/core/canvas-model').CanvasNode[];
            addToStaging(stagedNodes);
            usePetStore.getState().notifyCanvasEvent('node_added', stagedNodes[0] ? {
              nodeId: stagedNodes[0].id,
              nodeType: stagedNodes[0].node_type,
              title: stagedNodes[0].title,
            } : undefined);
          }
          break;
        case 'stagingNodeMaterialized':
          if (msg.sourceNodeId && msg.node && msg.position) {
            resolveStagingMaterialization(
              msg.sourceNodeId as string,
              msg.node as import('../../src/core/canvas-model').CanvasNode,
              msg.position as { x: number; y: number },
            );
          }
          break;
        case 'stagingNodeMaterializeFailed':
          if (msg.sourceNodeId) {
            failStagingMaterialization(msg.sourceNodeId as string);
          }
          if (msg.message) {
            setError(msg.message as string);
          }
          break;
        case 'nodeAdded':
          // Legacy: redirect to staging area
          if (msg.node) {
            const addedNode = msg.node as import('../../src/core/canvas-model').CanvasNode;
            addToStaging([addedNode]);
            usePetStore.getState().notifyCanvasEvent('node_added', {
              nodeId: addedNode.id,
              nodeType: addedNode.node_type,
              title: addedNode.title,
            });
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
            enqueueNodePreview(msg.nodeId, msg.preview as string, msg.metaPatch);
          }
          break;
        case 'mindMapFileLoaded':
          if (msg.nodeId && msg.filePath && msg.mindmap) {
            setMindMapPickedImage(null);
            setMindMapSaveState(null);
            setMindMapEditor({
              nodeId: msg.nodeId as string,
              filePath: msg.filePath as string,
              mindmap: msg.mindmap as MindMapFile,
            });
          }
          break;
        case 'mindMapFileSaved':
          if (msg.nodeId && msg.filePath && msg.title) {
            updateNodeFilePath(msg.nodeId as string, msg.filePath as string, msg.title as string);
          }
          if (msg.nodeId && msg.preview !== undefined) {
            enqueueNodePreview(msg.nodeId as string, msg.preview as string, {
              mindmap_summary: msg.summary as import('../../src/mindmap/mindmap-model').MindMapSummary,
            });
          }
          if (msg.nodeId && msg.filePath && msg.mindmap) {
            setMindMapSaveState({
              nodeId: msg.nodeId as string,
              status: 'saved',
              message: '已保存到导图文件，画布节点摘要已同步。',
            });
            setMindMapEditor({
              nodeId: msg.nodeId as string,
              filePath: msg.filePath as string,
              mindmap: msg.mindmap as MindMapFile,
            });
          }
          break;
        case 'mindMapImagePicked':
          if (msg.nodeId && msg.itemId && msg.image) {
            const picked = msg as { nodeId: string; itemId: string; image: MindMapImage; uri?: string };
            if (picked.uri) {
              enqueueImageUri(picked.image.file_path, picked.uri);
            }
            setMindMapPickedImage({
              nodeId: picked.nodeId,
              itemId: picked.itemId,
              image: picked.image,
              uri: picked.uri,
            });
          }
          break;
        case 'mindMapError':
          if (msg.message) {
            setError(msg.message as string);
            if (msg.nodeId && String(msg.message).startsWith('思维导图保存失败')) {
              setMindMapSaveState({
                nodeId: msg.nodeId as string,
                status: 'error',
                message: `${msg.message as string}。当前弹窗中的编辑内容仍保留，磁盘文件未被确认覆盖。`,
              });
            }
          }
          break;
        case 'toastError':
          if (msg.message) {
            setError(msg.message as string);
          }
          break;
        case 'error':
          console.error('[ResearchSpace]', msg.message);
          break;
        case 'toolDefs':
          if (Array.isArray((msg as { tools?: unknown }).tools)) {
            setToolDefs((msg as { tools: import('../../src/core/canvas-model').JsonToolDef[] }).tools);
          }
          break;
        case 'toolDefError':
          if ((msg as { message?: unknown }).message) {
            setError((msg as { message: string }).message);
          }
          break;
        case 'nodeDefs':
          if (Array.isArray((msg as { defs?: unknown }).defs)) {
            setNodeDefs((msg as { defs: import('../../src/core/canvas-model').DataNodeDef[] }).defs);
          }
          break;
        case 'fileContent': {
          const fc = msg as { requestId: string; content: string };
          if (fc.requestId && fc.content !== undefined) {
            enqueueFileContent(fc.requestId, fc.content);
          }
          break;
        }
        case 'outputHistory': {
          const oh = msg as import('../../src/core/canvas-model').OutputHistoryPayload;
          if (oh.nodeId && Array.isArray(oh.entries)) {
            setOutputHistory(oh);
          }
          break;
        }
        case 'blueprintDraftCreated':
          if (msg.draft) {
            setBlueprintDraft(msg.draft);
          }
          break;
        case 'blueprintDraftSaved':
          clearBlueprintDraft();
          break;
        case 'blueprintIndex':
          if (typeof msg.sessionId === 'number' && msg.sessionId !== activeCanvasSessionIdRef.current) {
            break;
          }
          if (Array.isArray(msg.entries)) {
            setBlueprintIndex(msg.entries);
            const blueprintFilePaths = Array.from(new Set(
              (useCanvasStore.getState().canvasFile?.nodes ?? [])
                .filter(node => node.node_type === 'blueprint' && typeof node.meta?.blueprint_file_path === 'string' && node.meta.blueprint_file_path.length > 0)
                .map(node => node.meta!.blueprint_file_path as string)
            ));
            if (blueprintFilePaths.length > 0) {
              postMessage({
                type: 'requestBlueprintDefinitions',
                filePaths: blueprintFilePaths,
                sessionId: activeCanvasSessionIdRef.current,
              });
            }
          }
          break;
        case 'blueprintDefinitions':
          if (typeof msg.sessionId === 'number' && msg.sessionId !== activeCanvasSessionIdRef.current) {
            break;
          }
          if (Array.isArray(msg.definitions)) {
            const definitions = msg.definitions as Array<{ filePath: string; definition: import('../../src/blueprint/blueprint-types').BlueprintDefinition }>;
            migrateBlueprintDefinitions(definitions);
            syncBlueprintDefinitionAvailability(
              definitions.map(item => item.filePath),
              Array.isArray((msg as { failedPaths?: unknown }).failedPaths)
                ? ((msg as { failedPaths: unknown[] }).failedPaths.filter((item): item is string => typeof item === 'string' && item.length > 0))
                : [],
            );
            if (Array.isArray((msg as { failedPaths?: unknown }).failedPaths) && (msg as { failedPaths: unknown[] }).failedPaths.length > 0) {
              console.warn('[ResearchSpace] blueprint definitions unavailable on load', (msg as { failedPaths: unknown[] }).failedPaths);
            }
          }
          break;
        case 'blueprintInstantiated':
          if (msg.entry && msg.definition) {
            instantiateBlueprintDefinition(msg.entry, msg.definition, msg.position);
          }
          break;
        case 'blueprintRunRejected': {
          const bm = msg as { containerNodeId: string; message: string; runMode?: 'full' | 'resume'; reusedCachedNodeCount?: number };
          if (bm.containerNodeId && bm.message) {
            const finishedAt = new Date().toISOString();
            const containerNode = useCanvasStore.getState().canvasFile?.nodes.find(node => node.id === bm.containerNodeId);
            const runMode = bm.runMode ?? useCanvasStore.getState().pipelineState?.runMode ?? 'full';
            const historyEntry: import('../../src/core/canvas-model').BlueprintRunHistoryEntry = {
              id: `${bm.containerNodeId}-${finishedAt}`,
              finishedAt,
              status: 'failed',
              summary: bm.message,
              totalNodes: 0,
              completedNodes: 0,
              failedNodes: 0,
              skippedNodes: 0,
              warningCount: 0,
              mode: runMode,
              reusedCachedNodeCount: bm.reusedCachedNodeCount ?? 0,
            };
            updateNodeMeta(bm.containerNodeId, {
              blueprint_last_run_status: 'failed',
              blueprint_last_run_summary: bm.message,
              blueprint_last_run_finished_at: finishedAt,
              blueprint_last_run_failed_at: finishedAt,
              blueprint_last_run_total_nodes: 0,
              blueprint_last_run_completed_nodes: 0,
              blueprint_last_run_failed_nodes: 0,
              blueprint_last_run_skipped_nodes: 0,
              blueprint_last_run_warning_count: 0,
              blueprint_last_issue_node_id: undefined,
              blueprint_last_issue_node_title: undefined,
              blueprint_run_history: appendBlueprintRunHistory(containerNode?.meta?.blueprint_run_history, historyEntry),
            }, 'immediate');
            setError(bm.message);
          }
          break;
        }
        // ── Pipeline progress messages ──
        case 'pipelineStarted': {
          const pm = msg as import('../../src/core/canvas-model').PipelineStartPayload;
          const statuses: Record<string, 'waiting' | 'running' | 'done' | 'failed' | 'skipped'> = {};
          for (const id of pm.nodeIds) { statuses[id] = pm.initialNodeStatuses?.[id] ?? 'waiting'; }
          setPipelineState({
            pipelineId: pm.pipelineId,
            triggerNodeId: pm.triggerNodeId,
            nodeStatuses: statuses,
            nodeIssues: {},
            totalNodes: pm.totalNodes,
            completedNodes: pm.initialCompletedNodes ?? 0,
            isRunning: true,
            isPaused: false,
            cancelRequested: false,
            completionStatus: null,
            currentNodeId: null,
            validationWarnings: [],
            runMode: pm.runMode ?? 'full',
            reusedCachedNodeCount: pm.reusedCachedNodeCount ?? 0,
          });
          break;
        }
        case 'pipelineNodeStart': {
          const pm = msg as { pipelineId: string; nodeId: string };
          setPipelineNodeIssue(pm.nodeId, null);
          updatePipelineNodeStatus(pm.nodeId, 'running');
          break;
        }
        case 'pipelineNodeComplete': {
          const pm = msg as { pipelineId: string; nodeId: string; outputNodeId: string };
          updatePipelineNodeStatus(pm.nodeId, 'done');
          incrementPipelineCompleted();
          break;
        }
        case 'pipelineNodeError': {
          const pm = msg as { pipelineId: string; nodeId: string; error: string; issueKind?: import('../../src/core/canvas-model').RunIssueKind };
          updatePipelineNodeStatus(pm.nodeId, 'failed');
          setPipelineNodeIssue(pm.nodeId, {
            kind: pm.issueKind ?? 'run_failed',
            message: pm.error,
          });
          incrementPipelineCompleted();
          break;
        }
        case 'pipelineNodeSkipped': {
          const pm = msg as { pipelineId: string; nodeId: string; reason?: string; issueKind?: import('../../src/core/canvas-model').RunIssueKind };
          updatePipelineNodeStatus(pm.nodeId, 'skipped');
          if (pm.reason) {
            setPipelineNodeIssue(pm.nodeId, {
              kind: pm.issueKind ?? 'skipped',
              message: pm.reason,
            });
          }
          incrementPipelineCompleted();
          break;
        }
        case 'pipelineComplete': {
          const pm = msg as { pipelineId: string; totalNodes: number; completedNodes: number; status: 'succeeded' | 'failed' | 'cancelled' };
          // Update final state and schedule cleanup after 5s
          const finalPs = useCanvasStore.getState().pipelineState;
          if (finalPs) {
            const blueprintContainer = useCanvasStore.getState().canvasFile?.nodes.find(node => node.id === finalPs.triggerNodeId);
            const isBlueprintRun = blueprintContainer?.node_type === 'blueprint' && !!blueprintContainer.meta?.blueprint_instance_id;
            if (isBlueprintRun) {
              const finishedAt = new Date().toISOString();
              const statuses = Object.values(finalPs.nodeStatuses);
              const failedNodes = statuses.filter(status => status === 'failed').length;
              const skippedNodes = statuses.filter(status => status === 'skipped').length;
              const warningCount = finalPs.validationWarnings.length;
              const canvasFile = useCanvasStore.getState().canvasFile;
              const issueNodeId = pm.status === 'cancelled'
                ? finalPs.currentNodeId
                : Object.keys(finalPs.nodeIssues).find(nodeId => finalPs.nodeIssues[nodeId]?.kind !== 'skipped') ?? null;
              const issueNodeTitle = issueNodeId
                ? canvasFile?.nodes.find(node => node.id === issueNodeId)?.title ?? issueNodeId
                : null;
              const summary = buildBlueprintRunSummary({
                status: pm.status,
                totalNodes: pm.totalNodes,
                completedNodes: pm.completedNodes,
                failedNodes,
                skippedNodes,
                warningCount,
                issueNodeTitle,
              });
              const historyEntry: import('../../src/core/canvas-model').BlueprintRunHistoryEntry = {
                id: `${finalPs.triggerNodeId}-${finishedAt}`,
                finishedAt,
                status: pm.status,
                summary,
                totalNodes: pm.totalNodes,
                completedNodes: pm.completedNodes,
                failedNodes,
                skippedNodes,
                warningCount,
                issueNodeId: issueNodeId ?? undefined,
                issueNodeTitle: issueNodeTitle ?? undefined,
                mode: finalPs.runMode ?? 'full',
                reusedCachedNodeCount: finalPs.reusedCachedNodeCount ?? 0,
              };
              const existingBlueprintNode = canvasFile?.nodes.find(node => node.id === finalPs.triggerNodeId);
              updateNodeMeta(finalPs.triggerNodeId, {
                blueprint_last_run_status: pm.status,
                blueprint_last_run_summary: summary,
                blueprint_last_run_finished_at: finishedAt,
                blueprint_last_run_total_nodes: pm.totalNodes,
                blueprint_last_run_completed_nodes: pm.completedNodes,
                blueprint_last_run_failed_nodes: failedNodes,
                blueprint_last_run_skipped_nodes: skippedNodes,
                blueprint_last_run_warning_count: warningCount,
                blueprint_last_issue_node_id: issueNodeId ?? undefined,
                blueprint_last_issue_node_title: issueNodeTitle ?? undefined,
                blueprint_run_history: appendBlueprintRunHistory(existingBlueprintNode?.meta?.blueprint_run_history, historyEntry),
                ...(pm.status === 'succeeded'
                  ? { blueprint_last_run_succeeded_at: finishedAt }
                  : {}),
                ...(pm.status === 'failed'
                  ? { blueprint_last_run_failed_at: finishedAt }
                  : {}),
              }, 'immediate');
            }
            setPipelineState({
              ...finalPs,
              totalNodes: pm.totalNodes,
              completedNodes: pm.completedNodes,
              isRunning: false,
              isPaused: false,
              cancelRequested: false,
              completionStatus: pm.status,
              currentNodeId: null,
            });
            // Auto-dismiss after 5 seconds
            setTimeout(() => {
              setPipelineState(null);
            }, 5000);
          }
          break;
        }
        case 'pipelineValidationWarning': {
          const pm = msg as { nodeId: string; message: string };
          addPipelineWarning(pm.nodeId, pm.message);
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
            <InitialCanvasRenderBridge />
            <Canvas />
          </ReactFlowProvider>
        </div>
        {blueprintDraft && (
          <CreateBlueprintDialog
            draft={blueprintDraft}
            existingBlueprints={blueprintIndex}
            onSave={nextDraft => postMessage({ type: 'saveBlueprintDraft', draft: nextDraft })}
            onClose={clearBlueprintDraft}
          />
        )}
        <OutputHistoryModal />
        {mindMapEditor && (
          <MindMapEditorModal
            nodeId={mindMapEditor.nodeId}
            filePath={mindMapEditor.filePath}
            mindmap={mindMapEditor.mindmap}
            pickedImage={mindMapPickedImage?.nodeId === mindMapEditor.nodeId ? mindMapPickedImage : null}
            imageUriMap={imageUriMap}
            saveState={mindMapSaveState?.nodeId === mindMapEditor.nodeId ? mindMapSaveState : null}
            onSave={mindmap => {
              setMindMapSaveState({
                nodeId: mindMapEditor.nodeId,
                status: 'saving',
                message: '正在保存导图文件…',
              });
              postMessage({
                type: 'saveMindMapFile',
                nodeId: mindMapEditor.nodeId,
                filePath: mindMapEditor.filePath,
                mindmap,
              });
            }}
            onPickImage={itemId => postMessage({
              type: 'pickMindMapImage',
              nodeId: mindMapEditor.nodeId,
              itemId,
            })}
            onOpenImage={imageFilePath => postMessage({ type: 'openFile', filePath: imageFilePath })}
            onExportMarkdown={mindmap => postMessage({
              type: 'exportMindMapMarkdown',
              nodeId: mindMapEditor.nodeId,
              filePath: mindMapEditor.filePath,
              mindmap,
            })}
            onExportXMind={mindmap => postMessage({
              type: 'exportMindMapXMind',
              nodeId: mindMapEditor.nodeId,
              filePath: mindMapEditor.filePath,
              mindmap,
            })}
            onClose={() => {
              setMindMapEditor(null);
              setMindMapPickedImage(null);
            }}
          />
        )}
        <InitialCanvasLoadingNotice />
        {lastError && <ErrorToast message={lastError} onClose={clearError} />}
      </div>
      <PetWidget />
    </>
  );
}
