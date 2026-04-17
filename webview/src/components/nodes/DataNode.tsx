import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-expect-error — Vite ?raw import returns file content as string
import pdfjsWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import { DEFAULT_SIZES, type CanvasNode } from '../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import { NodeContextMenu } from './NodeContextMenu';
import { ExperimentLogBody } from './ExperimentLogBody';
import { TaskBody } from './TaskBody';
import { AiReadabilityBadge } from './AiReadabilityBadge';
import { buildNodePortStyle, getNodePortLabel, NODE_PORT_CLASSNAME, NODE_PORT_IDS } from '../../utils/node-port';
import { closeAllCanvasContextMenus } from '../../utils/context-menu';
import {
  ensureNodeChromeStyles,
  NODE_BORDER_WIDTH,
  NODE_CONTENT_GUTTER,
  NODE_HEADER_ICON_SIZE,
  NODE_HEADER_TITLE_STYLE,
  NODE_RADIUS,
  NODE_RESIZE_HANDLE_SIZE,
  NODE_RESIZE_HIT_THICKNESS,
  NODE_SELECTED_BORDER_WIDTH,
  withAlpha,
} from '../../utils/node-chrome';

// Create blob worker URL from inlined source (CSP: worker-src blob:)
const workerBlob = new Blob([pdfjsWorkerSrc], { type: 'application/javascript' });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

interface DataNodeProps {
  data: CanvasNode;
  selected: boolean;
}

// Fallback values used before nodeDefs are loaded from the registry
const FALLBACK_COLORS: Record<string, string> = {
  paper:     'var(--vscode-terminal-ansiRed)',
  note:      'var(--vscode-terminal-ansiYellow)',
  code:      'var(--vscode-terminal-ansiCyan)',
  image:     'var(--vscode-terminal-ansiMagenta)',
  ai_output: 'var(--vscode-terminal-ansiGreen)',
  audio:     'var(--vscode-terminal-ansiBlue)',
  video:     'var(--vscode-terminal-ansiYellow)',
  data:      'var(--vscode-terminal-ansiGreen)',
};

const FALLBACK_ICONS: Record<string, string> = {
  paper:     '\u{1F4C4}',
  note:      '\u{1F4DD}',
  code:      '\u{1F4BB}',
  image:     '\u{1F5BC}\uFE0F',
  ai_output: '\u{1F916}',
  audio:     '\u{1F3B5}',
  video:     '\u{1F3AC}',
  data:      '\u{1F4CA}',
};

// Node types that support the preview button (opens in VSCode native viewer)
const PREVIEWABLE = new Set(['paper', 'note', 'code', 'image', 'ai_output', 'audio', 'video', 'data']);
const CARD_HYDRATABLE_NODE_TYPES = new Set<CanvasNode['node_type']>(['note', 'ai_output', 'code', 'data']);

function resolveCardContentMode(node: CanvasNode, width?: number, height?: number): 'preview' | 'full' | undefined {
  if (!CARD_HYDRATABLE_NODE_TYPES.has(node.node_type)) { return undefined; }
  const defaultSize = DEFAULT_SIZES[node.node_type];
  const nextWidth = width ?? node.size?.width ?? defaultSize.width;
  const nextHeight = height ?? node.size?.height ?? defaultSize.height;
  const expandedEnough =
    nextHeight >= defaultSize.height + 60 ||
    nextWidth >= defaultSize.width + 80;
  return expandedEnough ? 'full' : 'preview';
}

export const DataNode = memo(DataNodeInner);

function DataNodeInner({ data, selected }: DataNodeProps) {
  const imageUriMap = useCanvasStore(s => s.imageUriMap);
  const nodeDefs = useCanvasStore(s => s.nodeDefs);
  const previewNodeSize = useCanvasStore(s => s.previewNodeSize);
  const updateNodeSize = useCanvasStore(s => s.updateNodeSize);
  const openPreview = useCanvasStore(s => s.openPreview);
  const fullContent = useCanvasStore(s => s.fullContentCache[data.id]);
  const selectExclusiveNode = useCanvasStore(s => s.selectExclusiveNode);

  // Resolve icon/color/previewType from registry (falls back to hardcoded values)
  const nodeDef = nodeDefs.find(d => d.id === data.node_type);
  const isBlueprintPlaceholder = !!data.meta?.blueprint_placeholder_kind;
  const accentColor = data.meta?.blueprint_color
    ?? nodeDef?.color
    ?? FALLBACK_COLORS[data.node_type]
    ?? 'var(--vscode-foreground)';
  const nodeIcon    = nodeDef?.icon  ?? FALLBACK_ICONS[data.node_type]  ?? '📁';
  const previewType = nodeDef?.previewType ?? (
    data.node_type === 'note' || data.node_type === 'ai_output' ? 'markdown' : 'text'
  );

  const isMissing  = data.meta?.file_missing;
  const canPreview = PREVIEWABLE.has(data.node_type) && !isMissing && !!data.file_path;
  const desiredCardContentMode = data.meta?.card_content_mode ?? resolveCardContentMode(data);
  const shouldHydrateCardContent =
    desiredCardContentMode === 'full' &&
    !!data.file_path &&
    !isMissing &&
    fullContent === undefined;

  useEffect(() => {
    ensureNodeChromeStyles();
  }, []);

  // Card body follows the node's own display mode; cached full content is only used in full mode.
  const displayContent = desiredCardContentMode === 'full'
    ? (fullContent ?? data.meta?.content_preview)
    : data.meta?.content_preview;

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // ── Resize handler — persist new size to canvas store ──
  const handleResize = useCallback((_event: unknown, params: { width: number; height: number }) => {
    previewNodeSize(data.id, params.width, params.height);
  }, [data.id, previewNodeSize]);

  const handleResizeEnd = useCallback((_event: unknown, params: { width: number; height: number }) => {
    const nextMode = resolveCardContentMode(data, params.width, params.height);
    updateNodeSize(
      data.id,
      params.width,
      params.height,
      nextMode ? { card_content_mode: nextMode } : undefined,
    );
  }, [data, updateNodeSize]);

  // Preview button click → open in-canvas modal preview
  const handlePreviewClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canPreview) { return; }
    openPreview(data.id);
  }, [canPreview, data.id, openPreview]);

  // Double click → open in VSCode editor (original behaviour)
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.file_path) {
      postMessage({ type: 'openFile', filePath: data.file_path });
    }
  }, [data.file_path]);

  // Right click → context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    closeAllCanvasContextMenus();
    selectExclusiveNode(data.id);
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    setCtxMenu({ x: e.clientX - rect.left + 8, y: e.clientY - rect.top + 8 });
  }, [data.id, selectExclusiveNode]);

  useEffect(() => {
    if (!shouldHydrateCardContent || !data.file_path) { return; }
    postMessage({ type: 'requestFileContent', filePath: data.file_path, requestId: data.id });
  }, [data.file_path, data.id, shouldHydrateCardContent]);

  return (
    <div
      className={`rs-node-surface rs-node-surface--interactive${selected ? ' rs-node-surface--selected' : ''}`}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--vscode-editor-background)',
        border: `${selected ? NODE_SELECTED_BORDER_WIDTH : NODE_BORDER_WIDTH}px ${isBlueprintPlaceholder ? 'dashed' : 'solid'} ${selected ? accentColor : (isBlueprintPlaceholder ? withAlpha(accentColor, 0.85, 'var(--vscode-panel-border)') : 'var(--vscode-panel-border)')}`,
        borderRadius: NODE_RADIUS,
        display: 'flex',
        /* NO overflow:hidden here — it clips the ReactFlow Handle dots */
        cursor: 'default',
        boxShadow: selected
          ? `0 0 0 1px ${withAlpha(accentColor, 0.2, 'transparent')}, 0 10px 24px ${withAlpha(accentColor, 0.16, 'rgba(0,0,0,0.18)')}`
          : '0 3px 10px rgba(0,0,0,0.18)',
        position: 'relative',
      }}
    >
      {/* Resize handles — visible when selected */}
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={120}
        color={accentColor}
        handleStyle={{
          width: NODE_RESIZE_HANDLE_SIZE,
          height: NODE_RESIZE_HANDLE_SIZE,
          borderWidth: 2,
          borderRadius: 3,
        }}
        lineStyle={{
          width: NODE_RESIZE_HIT_THICKNESS,
          height: NODE_RESIZE_HIT_THICKNESS,
        }}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
      />
      {/* Left accent bar */}
      <div style={{ width: 4, background: accentColor, flexShrink: 0, borderRadius: `${NODE_RADIUS}px 0 0 ${NODE_RADIUS}px` }} />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header — fixed, never scrolls with content */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--vscode-editor-background)',
          padding: `9px ${NODE_CONTENT_GUTTER}px 7px`,
        }}>
          <span style={{ fontSize: NODE_HEADER_ICON_SIZE, lineHeight: 1 }}>{nodeIcon}</span>
          <span style={{
            ...NODE_HEADER_TITLE_STYLE,
            flex: 1,
          }}>
            {data.title || '无标题'}
          </span>
          {canPreview && (
            <button
              onClick={handlePreviewClick}
              title="预览"
              style={{
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
                border: '1px solid var(--vscode-button-border, transparent)',
                borderRadius: 3,
                padding: '1px 6px',
                fontSize: 10,
                cursor: 'pointer',
                flexShrink: 0,
                lineHeight: 1.4,
              }}
            >
              预览
            </button>
          )}
          {isMissing && (
            <span title="文件不存在" style={{
              background: 'var(--vscode-inputValidation-warningBackground)',
              color: 'var(--vscode-inputValidation-warningForeground)',
              borderRadius: 4, fontSize: 10, padding: '1px 5px', flexShrink: 0,
            }}>
              缺失
            </span>
          )}
          {isBlueprintPlaceholder && (
            <span title="蓝图占位节点" style={{
              background: withAlpha(accentColor, 0.12, 'transparent'),
              color: accentColor,
              border: `1px solid ${withAlpha(accentColor, 0.4, 'var(--vscode-panel-border)')}`,
              borderRadius: 4,
              fontSize: 10,
              padding: '1px 5px',
              flexShrink: 0,
            }}>
              {data.meta?.blueprint_placeholder_kind === 'input' ? '输入占位' : '输出占位'}
            </span>
          )}
        </div>

        {/* Body — the only scrollable area inside the node */}
        <div style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: `0 ${NODE_CONTENT_GUTTER}px 6px`,
        }}>

          {/* Experiment log UI */}
          {data.node_type === 'experiment_log' && (
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <ExperimentLogBody node={data} />
            </div>
          )}

          {/* Task list UI */}
          {data.node_type === 'task' && (
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <TaskBody node={data} />
            </div>
          )}

          {/* Image preview */}
          {data.node_type === 'image' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <ImagePreview node={data} imageUriMap={imageUriMap} />
            </div>
          )}

          {/* Paper/PDF first page preview */}
          {data.node_type === 'paper' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <PdfPreview node={data} imageUriMap={imageUriMap} />
            </div>
          )}

          {/* Audio preview — waveform + click to play */}
          {data.node_type === 'audio' && (
            <AudioPreview node={data} imageUriMap={imageUriMap} />
          )}

          {/* Video preview — thumbnail + modal */}
          {data.node_type === 'video' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <VideoPreview node={data} imageUriMap={imageUriMap} />
            </div>
          )}

          {/* Data/CSV table preview */}
          {data.node_type === 'data' && displayContent && (
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <TablePreview source={displayContent as string} />
            </div>
          )}

          {/* Text preview — skip node types that have dedicated body renderers or media previews */}
          {data.node_type !== 'image' && data.node_type !== 'paper' && data.node_type !== 'audio' && data.node_type !== 'video' && data.node_type !== 'data' && data.node_type !== 'experiment_log' && data.node_type !== 'task' && displayContent && (
            <div style={{
              fontSize: 11,
              color: 'var(--vscode-descriptionForeground)',
              overflow: 'auto',
              flex: 1,
              minHeight: 0,
              lineHeight: 1.4,
            }}>
              {data.node_type === 'code' ? (
                <CodePreview source={displayContent as string} filePath={data.file_path} />
              ) : previewType === 'markdown' ? (
                <MarkdownPreview source={displayContent as string} />
              ) : (
                <span style={{
                  display: 'block',
                  overflow: 'hidden',
                }}>
                  {displayContent}
                </span>
              )}
            </div>
          )}

        </div>

        {/* Footer — fixed metadata area, never shrinks with the content body */}
        <div style={{
          flexShrink: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: `6px ${NODE_CONTENT_GUTTER}px 8px`,
          borderTop: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-editor-background)',
        }}>
          {data.file_path && (
            <div style={{
              fontSize: 10,
              color: 'var(--vscode-descriptionForeground)',
              opacity: 0.6,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {data.file_path}
            </div>
          )}

          {data.node_type === 'ai_output' && (data.meta?.ai_provider || data.meta?.ai_model) && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {data.meta.ai_provider && (
                <span style={{
                  fontSize: 9, padding: '1px 5px',
                  background: 'var(--vscode-badge-background)',
                  color: 'var(--vscode-badge-foreground)',
                  borderRadius: 10, fontWeight: 600, whiteSpace: 'nowrap',
                }}>
                  {data.meta.ai_provider as string}
                </span>
              )}
              {data.meta.ai_model && (
                <span style={{
                  fontSize: 9, padding: '1px 5px',
                  background: 'var(--vscode-inputOption-activeBackground, var(--vscode-input-background))',
                  color: 'var(--vscode-descriptionForeground)',
                  border: '1px solid var(--vscode-panel-border)',
                  borderRadius: 10, whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                }}>
                  {data.meta.ai_model as string}
                </span>
              )}
            </div>
          )}

          <AiReadabilityBadge data={data} />
        </div>
      </div>

      {/* Handles */}
      <Handle
        className={NODE_PORT_CLASSNAME}
        type="source"
        position={Position.Right}
        id={NODE_PORT_IDS.out}
        title={getNodePortLabel('out')}
        aria-label={getNodePortLabel('out')}
        data-rs-port-label={getNodePortLabel('out')}
        isConnectable
        isConnectableStart
        isConnectableEnd={false}
        style={buildNodePortStyle(accentColor, 'out')}
      />
      <Handle
        className={NODE_PORT_CLASSNAME}
        type="target"
        position={Position.Left}
        id={NODE_PORT_IDS.in}
        title={getNodePortLabel('in')}
        aria-label={getNodePortLabel('in')}
        data-rs-port-label={getNodePortLabel('in')}
        isConnectable
        isConnectableStart={false}
        isConnectableEnd
        style={buildNodePortStyle(accentColor, 'in')}
      />

      {/* Context menu */}
      {ctxMenu && (
        <NodeContextMenu
          nodeId={data.id}
          nodeType={data.node_type}
          nodeTitle={data.title || ''}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          filePath={data.file_path}
          canDuplicate={true}
        />
      )}
    </div>
  );
}

// ── Image preview (node card thumbnail) ────────────────────────────────────

function ImagePreview({
  node,
  imageUriMap,
}: {
  node: CanvasNode;
  imageUriMap: Record<string, string>;
}) {
  const uri = node.file_path ? imageUriMap[node.file_path] : undefined;
  const [loadError, setLoadError] = React.useState(false);

  if (loadError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0',
        color: 'var(--vscode-inputValidation-errorForeground)', fontSize: 11 }}>
        图像加载失败
      </div>
    );
  }

  if (!uri) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0',
        color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>
        加载中…
      </div>
    );
  }

  return (
    <img
      src={uri}
      alt={node.title}
      onError={() => setLoadError(true)}
      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, flex: 1, minHeight: 0 }}
    />
  );
}

// ── PDF first-page preview (node card thumbnail) ─────────────────────────────

function PdfPreview({
  node,
  imageUriMap,
}: {
  node: CanvasNode;
  imageUriMap: Record<string, string>;
}) {
  const uri = node.file_path ? imageUriMap[node.file_path] : undefined;
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const renderedUri = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!uri || uri === renderedUri.current) { return; }
    let cancelled = false;
    let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;

    (async () => {
      try {
        pdfDoc = await pdfjsLib.getDocument({ url: uri, cMapUrl: undefined, cMapPacked: true }).promise;
        if (cancelled) { pdfDoc.destroy(); return; }
        const page = await pdfDoc.getPage(1);

        const canvas = canvasRef.current;
        if (!canvas || cancelled) { pdfDoc.destroy(); return; }

        const ctx = canvas.getContext('2d');
        if (!ctx) { pdfDoc.destroy(); return; }

        const scale = 1.5;
        const viewport = page.getViewport({ scale });
        const dpr = window.devicePixelRatio || 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        ctx.scale(dpr, dpr);

        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) {
          renderedUri.current = uri;
          setLoading(false);
        }
        pdfDoc.destroy();
        pdfDoc = null;
      } catch (e) {
        console.error('[RS] PdfPreview render failed:', e);
        if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
        if (!cancelled) { setError(true); setLoading(false); }
      }
    })();

    return () => {
      cancelled = true;
      if (pdfDoc) { pdfDoc.destroy(); }
    };
  }, [uri]);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0',
        color: 'var(--vscode-inputValidation-errorForeground)', fontSize: 11 }}>
        PDF 渲染失败
      </div>
    );
  }

  if (!uri) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0',
        color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>
        加载中…
      </div>
    );
  }

  return (
    <>
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0',
          color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>
          渲染中…
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
          borderRadius: 4, display: loading ? 'none' : 'block',
        }}
      />
    </>
  );
}

// ── Code preview (node card — monospace with line numbers) ────────────────

function fileExtToLang(filePath?: string): string {
  if (!filePath) { return ''; }
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    py: 'python', js: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
    rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
    cs: 'csharp', rb: 'ruby', sh: 'bash', zsh: 'bash', fish: 'bash',
    html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml',
    yml: 'yaml', toml: 'toml', xml: 'xml', sql: 'sql', swift: 'swift',
    kt: 'kotlin', lua: 'lua', r: 'r', m: 'matlab', php: 'php',
  };
  return map[ext] ?? ext;
}

function CodePreview({ source, filePath }: { source: string; filePath?: string }) {
  const lang = fileExtToLang(filePath);
  const lines = source.split('\n');
  return (
    <div style={{
      background: 'rgba(0,0,0,0.25)',
      borderRadius: 4,
      padding: '4px 0',
      flex: 1,
      minHeight: 0,
      overflow: 'auto',
      fontFamily: 'var(--vscode-editor-font-family, "Fira Code", "Consolas", monospace)',
      fontSize: 10,
      lineHeight: 1.5,
    }}>
      {lang && (
        <div style={{
          padding: '0 8px 2px',
          fontSize: 9,
          color: 'var(--vscode-descriptionForeground)',
          opacity: 0.6,
          fontFamily: 'var(--vscode-font-family, sans-serif)',
        }}>
          {lang}
        </div>
      )}
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', whiteSpace: 'pre', overflow: 'hidden' }}>
          <span style={{
            display: 'inline-block',
            width: 24,
            textAlign: 'right',
            paddingRight: 6,
            color: 'var(--vscode-editorLineNumber-foreground, rgba(255,255,255,0.25))',
            flexShrink: 0,
            userSelect: 'none',
          }}>
            {i + 1}
          </span>
          <span style={{ color: 'var(--vscode-editor-foreground)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {line}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Markdown preview (node card compact) ───────────────────────────────────

function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="rs-md-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p:      ({ children }) => <span style={{ display: 'block', marginBottom: 2 }}>{children}</span>,
          h1:     ({ children }) => <strong style={{ display: 'block', fontSize: 12 }}>{children}</strong>,
          h2:     ({ children }) => <strong style={{ display: 'block', fontSize: 11 }}>{children}</strong>,
          h3:     ({ children }) => <strong style={{ display: 'block' }}>{children}</strong>,
          h4:     ({ children }) => <strong style={{ display: 'block' }}>{children}</strong>,
          h5:     ({ children }) => <strong>{children}</strong>,
          h6:     ({ children }) => <strong>{children}</strong>,
          ul:     ({ children }) => <span style={{ display: 'block', paddingLeft: 12 }}>{children}</span>,
          ol:     ({ children }) => <span style={{ display: 'block', paddingLeft: 12 }}>{children}</span>,
          li:     ({ children }) => <span style={{ display: 'block' }}>• {children}</span>,
          code:   ({ children }) => <code style={{ fontFamily: 'monospace', fontSize: 10, background: 'rgba(255,255,255,0.08)', padding: '0 2px', borderRadius: 2 }}>{children}</code>,
          pre:    ({ children }) => <span style={{ display: 'block', fontFamily: 'monospace', fontSize: 10, background: 'rgba(255,255,255,0.06)', padding: 4, borderRadius: 3, overflow: 'hidden' }}>{children}</span>,
          a:      ({ children }) => <span style={{ color: 'var(--vscode-textLink-foreground)', textDecoration: 'underline' }}>{children}</span>,
          strong: ({ children }) => <strong>{children}</strong>,
          em:     ({ children }) => <em>{children}</em>,
          blockquote: ({ children }) => <span style={{ display: 'block', borderLeft: '2px solid var(--vscode-panel-border)', paddingLeft: 6, opacity: 0.8 }}>{children}</span>,
          hr:     () => <span style={{ display: 'block', borderTop: '1px solid var(--vscode-panel-border)', margin: '2px 0' }} />,
          table:  ({ children }) => <span style={{ display: 'block', fontSize: 10 }}>{children}</span>,
          img:    () => null,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

// ── Table preview (CSV/TSV node card) ─────────────────────────────────────

function TablePreview({ source }: { source: string }) {
  // Parse CSV/TSV: detect delimiter, split into rows
  const delimiter = source.includes('\t') ? '\t' : ',';
  const lines = source.split(/\r?\n/).filter(l => l.trim());
  const rows = lines.map(line => {
    // Simple CSV parse (handles basic cases, not quoted commas)
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === delimiter && !inQuotes) { cells.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    cells.push(current.trim());
    return cells;
  });

  if (rows.length === 0) { return null; }

  const header = rows[0];
  const body = rows.slice(1);
  const totalRows = lines.length - 1; // exclude header

  return (
    <div style={{
      overflow: 'auto', fontSize: 10, lineHeight: 1.3,
      border: '1px solid var(--vscode-panel-border)', borderRadius: 4,
      flex: 1, minHeight: 0,
    }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        tableLayout: 'fixed',
      }}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} style={{
                padding: '2px 4px',
                background: 'var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.06))',
                fontWeight: 600, fontSize: 9,
                borderBottom: '1px solid var(--vscode-panel-border)',
                borderRight: i < header.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: 'var(--vscode-foreground)',
              }}>
                {h || `Col ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '1px 4px', fontSize: 9,
                  borderBottom: ri < body.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                  borderRight: ci < row.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: 'var(--vscode-descriptionForeground)',
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{
        padding: '2px 4px', fontSize: 9,
        color: 'var(--vscode-descriptionForeground)',
        borderTop: '1px solid var(--vscode-panel-border)',
        background: 'var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04))',
      }}>
        {header.length} 列 x {totalRows} 行
      </div>
    </div>
  );
}

// ── Video preview — thumbnail card + modal player ──────────────────────────

function VideoPreview({ node, imageUriMap }: { node: CanvasNode; imageUriMap: Record<string, string> }) {
  const uri = node.file_path ? imageUriMap[node.file_path] : undefined;
  const thumbRef = React.useRef<HTMLVideoElement>(null);

  // Seek to first frame for thumbnail
  React.useEffect(() => {
    const v = thumbRef.current;
    if (!v || !uri) { return; }
    v.src = uri;
    v.currentTime = 0.001;
  }, [uri]);

  if (!uri) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0' }}>
        <span style={{ fontSize: 28 }}>🎬</span>
        <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>加载中…</span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', borderRadius: 4, background: '#000',
      }}
    >
      <video
        ref={thumbRef}
        muted playsInline preload="metadata"
        style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', pointerEvents: 'none' }}
      />
    </div>
  );
}

// ── Audio waveform helpers ──────────────────────────────────────────────────

/** Downsample audio buffer to N bars for waveform rendering */
function extractWaveform(audioBuffer: AudioBuffer, bars: number): number[] {
  const raw = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(raw.length / bars);
  const result: number[] = [];
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    const start = i * blockSize;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(raw[start + j]);
    }
    result.push(sum / blockSize);
  }
  // Normalize to 0..1
  const max = Math.max(...result, 0.001);
  return result.map(v => v / max);
}

/** Draw a static waveform onto a canvas */
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  bars: number[],
  width: number,
  height: number,
  color: string,
  playedColor: string,
  progress: number,
) {
  ctx.clearRect(0, 0, width, height);
  const barW = Math.max(1, (width / bars.length) * 0.7);
  const gap = width / bars.length;
  const mid = height / 2;

  for (let i = 0; i < bars.length; i++) {
    const x = i * gap + (gap - barW) / 2;
    const h = Math.max(2, bars[i] * (height - 4));
    ctx.fillStyle = (i / bars.length) < progress ? playedColor : color;
    ctx.beginPath();
    ctx.roundRect(x, mid - h / 2, barW, h, barW / 2);
    ctx.fill();
  }
}

/** Shared hook to fetch and decode audio, returning waveform bars */
function useWaveform(uri: string | undefined, bars: number) {
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!uri) { return; }
    let cancelled = false;

    // Try to get duration from an <audio> element (reliable in webview)
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = uri;
    audio.addEventListener('loadedmetadata', () => {
      if (!cancelled && audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    });

    // Try Web Audio API for real waveform, fall back to simulated bars
    (async () => {
      let ctx: AudioContext | null = null;
      try {
        const res = await fetch(uri);
        if (!res.ok) { throw new Error('fetch failed'); }
        const buf = await res.arrayBuffer();
        ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) { return; }
        setWaveform(extractWaveform(decoded, bars));
        if (decoded.duration && isFinite(decoded.duration)) {
          setDuration(decoded.duration);
        }
      } catch {
        // Fallback: generate plausible-looking bars (seeded from URI for consistency)
        if (!cancelled) {
          let seed = 0;
          for (let i = 0; i < uri.length; i++) { seed = ((seed << 5) - seed + uri.charCodeAt(i)) | 0; }
          const fakeBars: number[] = [];
          for (let i = 0; i < bars; i++) {
            seed = (seed * 16807 + 0) % 2147483647;
            fakeBars.push(0.15 + (seed / 2147483647) * 0.7);
          }
          setWaveform(fakeBars);
        }
      } finally {
        ctx?.close();
      }
    })();

    return () => { cancelled = true; audio.src = ''; };
  }, [uri, bars]);

  return { waveform, duration };
}

// ── AudioPreview — node card waveform thumbnail ─────────────────────────────

function AudioPreview({ node, imageUriMap }: { node: CanvasNode; imageUriMap: Record<string, string> }) {
  const uri = node.file_path ? imageUriMap[node.file_path] : undefined;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { waveform, duration } = useWaveform(uri, 48);

  // Draw waveform when ready
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs || !waveform) { return; }
    const ctx = cvs.getContext('2d');
    if (!ctx) { return; }
    const dpr = window.devicePixelRatio || 1;
    const w = cvs.clientWidth;
    const h = cvs.clientHeight;
    cvs.width = w * dpr;
    cvs.height = h * dpr;
    ctx.scale(dpr, dpr);
    drawWaveform(ctx, waveform, w, h, 'rgba(100,160,255,0.45)', 'rgba(100,160,255,0.45)', 0);
  }, [waveform]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!uri) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0',
        color: 'var(--vscode-descriptionForeground)', fontSize: 11 }}>
        加载中…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 48, borderRadius: 4 }}
      />
      {duration > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
          <span>0:00</span>
          <span>{fmt(duration)}</span>
        </div>
      )}
    </div>
  );
}
