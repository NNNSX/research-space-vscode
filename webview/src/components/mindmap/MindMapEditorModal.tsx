import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MindMapFile, MindMapImage, MindMapItem } from '../../../../src/mindmap/mindmap-model';
import { mindMapToOutlineText, outlineTextToMindMap } from '../../utils/mindmap-outline';
import {
  addMindMapChild,
  addMindMapImage,
  addMindMapSibling,
  findMindMapItem,
  removeMindMapItem,
  toggleMindMapItemCollapsed,
  updateMindMapImageSize,
  updateMindMapItemText,
} from '../../utils/mindmap-graph';
import { postMessage } from '../../bridge';

interface PickedMindMapImage {
  nodeId: string;
  itemId: string;
  image: MindMapImage;
  uri?: string;
}

interface MindMapConnectorPath {
  id: string;
  d: string;
  color: string;
  depth: number;
}

interface MindMapConnectorSpec {
  parentId: string;
  childId: string;
  side: 'left' | 'right';
  color: string;
  depth: number;
}

interface MindMapEditorModalProps {
  nodeId: string;
  filePath: string;
  mindmap: MindMapFile;
  pickedImage: PickedMindMapImage | null;
  imageUriMap: Record<string, string>;
  saveState: { status: 'saving' | 'saved' | 'error'; message?: string } | null;
  onSave: (mindmap: MindMapFile) => void;
  onPickImage: (itemId: string) => void;
  onOpenImage: (filePath: string) => void;
  onExportMarkdown: (mindmap: MindMapFile) => void;
  onExportXMind: (mindmap: MindMapFile) => void;
  onClose: () => void;
}

function safeId(): string {
  return `mm-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

const BRANCH_COLORS = [
  '#60a5fa',
  '#f97316',
  '#22c55e',
  '#a78bfa',
  '#ec4899',
  '#14b8a6',
  '#facc15',
  '#fb7185',
];

function areConnectorPathsEqual(left: MindMapConnectorPath[], right: MindMapConnectorPath[]): boolean {
  if (left.length !== right.length) { return false; }
  return left.every((path, index) => {
    const other = right[index];
    return path.id === other.id && path.d === other.d && path.color === other.color && path.depth === other.depth;
  });
}

export function MindMapEditorModal({
  nodeId,
  filePath,
  mindmap,
  pickedImage,
  imageUriMap,
  saveState,
  onSave,
  onPickImage,
  onOpenImage,
  onExportMarkdown,
  onExportXMind,
  onClose,
}: MindMapEditorModalProps) {
  const [mode, setMode] = useState<'outline' | 'graph'>('outline');
  const [draft, setDraft] = useState<MindMapFile>(() => mindmap);
  const [outlineText, setOutlineText] = useState(() => mindMapToOutlineText(mindmap));
  const [selectedItemId, setSelectedItemId] = useState(mindmap.root.id);
  const [error, setError] = useState<string | null>(null);
  const handledPickedImageIdsRef = useRef<Set<string>>(new Set());

  const selectedItem = useMemo(() => findMindMapItem(draft.root, selectedItemId) ?? draft.root, [draft.root, selectedItemId]);

  useEffect(() => {
    setDraft(mindmap);
    setOutlineText(mindMapToOutlineText(mindmap));
    setSelectedItemId(mindmap.root.id);
    setError(null);
    handledPickedImageIdsRef.current.clear();
  }, [nodeId, filePath]);

  useEffect(() => {
    const paths = new Set<string>();
    const visit = (item: MindMapItem) => {
      for (const image of item.images ?? []) {
        if (image.file_path && !imageUriMap[image.file_path]) {
          paths.add(image.file_path);
        }
      }
      item.children.forEach(visit);
    };
    visit(draft.root);
    paths.forEach(path => postMessage({ type: 'requestImageUri', filePath: path }));
  }, [draft.root, imageUriMap]);

  const syncDraft = (next: MindMapFile) => {
    setDraft(next);
    setOutlineText(mindMapToOutlineText(next));
  };

  useEffect(() => {
    if (!pickedImage || pickedImage.nodeId !== nodeId) { return; }
    if (handledPickedImageIdsRef.current.has(pickedImage.image.id)) { return; }
    handledPickedImageIdsRef.current.add(pickedImage.image.id);
    syncDraft(addMindMapImage(draft, pickedImage.itemId, pickedImage.image));
    setSelectedItemId(pickedImage.itemId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedImage?.image.id]);

  const parseOutline = (): MindMapFile | null => {
    try {
      const next = outlineTextToMindMap(outlineText, draft);
      if (!next.root.text.trim()) {
        setError('中心主题不能为空。');
        return null;
      }
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const handleSave = () => {
    const next = mode === 'outline' ? parseOutline() : draft;
    if (!next) { return; }
    onSave(next);
  };

  const handleExportMarkdown = () => {
    const next = mode === 'outline' ? parseOutline() : draft;
    if (!next) { return; }
    onExportMarkdown(next);
  };

  const handleExportXMind = () => {
    const next = mode === 'outline' ? parseOutline() : draft;
    if (!next) { return; }
    onExportXMind(next);
  };

  const switchMode = (nextMode: 'outline' | 'graph') => {
    if (nextMode === mode) { return; }
    if (mode === 'outline') {
      const next = parseOutline();
      if (!next) { return; }
      setDraft(next);
      setSelectedItemId(next.root.id);
    }
    setMode(nextMode);
  };

  const handleOutlineChange = (value: string) => {
    setOutlineText(value);
    try {
      setDraft(outlineTextToMindMap(value, draft));
      setError(null);
    } catch {
      // Keep the previous valid graph draft until the outline becomes parseable again.
    }
  };

  const handleOutlineKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') { return; }
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const value = target.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const selectedEnd = lineEnd === -1 ? value.length : lineEnd;
    const selected = value.slice(lineStart, selectedEnd);
    const lines = selected.split('\n');
    const nextLines = event.shiftKey
      ? lines.map(line => line.startsWith('  ') ? line.slice(2) : line.startsWith('\t') ? line.slice(1) : line)
      : lines.map(line => line.trim().length > 0 ? `  ${line}` : line);
    const nextValue = `${value.slice(0, lineStart)}${nextLines.join('\n')}${value.slice(selectedEnd)}`;
    handleOutlineChange(nextValue);
    window.requestAnimationFrame(() => {
      const delta = nextValue.length - value.length;
      target.selectionStart = Math.max(lineStart, start + (event.shiftKey ? Math.min(0, delta) : 2));
      target.selectionEnd = Math.max(target.selectionStart, end + delta);
    });
  };

  const graphAction = (next: MindMapFile, nextSelectedId = selectedItemId) => {
    syncDraft(next);
    setSelectedItemId(nextSelectedId);
    setError(null);
  };

  const deleteSelected = () => {
    if (selectedItemId === draft.root.id) {
      setError('中心主题不能删除。');
      return;
    }
    const item = findMindMapItem(draft.root, selectedItemId);
    if (!item) { return; }
    if (item.children.length > 0) {
      const ok = window.confirm(`“${item.text}”包含 ${item.children.length} 个子分支，确认删除整个分支？`);
      if (!ok) { return; }
    }
    graphAction(removeMindMapItem(draft, selectedItemId), draft.root.id);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={backdropStyle}
      onMouseDown={event => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div style={modalStyle}>
        <div style={headerStyle}>
          <span style={{ fontSize: 20 }}>🧠</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {draft.root.text || mindmap.title || '思维导图'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filePath}
            </div>
          </div>
          <button onClick={() => switchMode('outline')} style={tabStyle(mode === 'outline')}>大纲编辑</button>
          <button onClick={() => switchMode('graph')} style={tabStyle(mode === 'graph')}>图形编辑</button>
          <button onClick={onClose} title="关闭" style={iconButtonStyle}>✕</button>
        </div>

        <div style={bodyStyle}>
          {mode === 'outline' ? (
            <OutlineEditor
              outlineText={outlineText}
              onChange={handleOutlineChange}
              onKeyDown={handleOutlineKeyDown}
            />
          ) : (
            <GraphEditor
              file={draft}
              selectedItemId={selectedItemId}
              selectedItem={selectedItem}
              imageUriMap={{
                ...imageUriMap,
                ...(pickedImage?.uri && pickedImage.nodeId === nodeId ? { [pickedImage.image.file_path]: pickedImage.uri } : {}),
              }}
              onSelect={setSelectedItemId}
              onUpdateText={(itemId, text) => graphAction(updateMindMapItemText(draft, itemId, text), itemId)}
              onAddSibling={() => {
                const nextId = safeId();
                graphAction(addMindMapSibling(draft, selectedItemId, '新分支', () => nextId), nextId);
              }}
              onAddChild={() => {
                const nextId = safeId();
                graphAction(addMindMapChild(draft, selectedItemId, '新子分支', () => nextId), nextId);
              }}
              onAddRootChild={() => {
                const nextId = safeId();
                graphAction(addMindMapChild(draft, draft.root.id, '第一个分支', () => nextId), nextId);
              }}
              onUpdateImageSize={(imageId, size) => graphAction(updateMindMapImageSize(draft, selectedItemId, imageId, size), selectedItemId)}
              onToggleCollapse={() => graphAction(toggleMindMapItemCollapsed(draft, selectedItemId), selectedItemId)}
              onDelete={deleteSelected}
              onPickImage={() => onPickImage(selectedItemId)}
              onOpenImage={onOpenImage}
            />
          )}
          {error && (
            <div style={{ color: 'var(--vscode-inputValidation-errorForeground)', fontSize: 12 }}>
              {error}
            </div>
          )}
          {saveState?.message && (
            <div style={{
              color: saveState.status === 'error'
                ? 'var(--vscode-inputValidation-errorForeground)'
                : saveState.status === 'saved'
                  ? 'var(--vscode-terminal-ansiGreen)'
                  : 'var(--vscode-descriptionForeground)',
              fontSize: 12,
              lineHeight: 1.45,
            }}>
              {saveState.status === 'saving' ? '⏳ ' : saveState.status === 'saved' ? '✓ ' : '⚠ '}
              {saveState.message}
            </div>
          )}
        </div>

        <div style={footerStyle}>
          <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
            {mode === 'graph'
              ? `当前条目：${selectedItem.text || '未命名条目'}`
              : `节点 ID：${nodeId}`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleExportMarkdown} style={secondaryButtonStyle}>导出 Markdown</button>
            <button onClick={handleExportXMind} style={secondaryButtonStyle}>导出 XMind</button>
            <button onClick={onClose} style={secondaryButtonStyle}>取消</button>
            <button onClick={handleSave} disabled={saveState?.status === 'saving'} style={primaryButtonStyle}>
              {saveState?.status === 'saving' ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OutlineEditor({
  outlineText,
  onChange,
  onKeyDown,
}: {
  outlineText: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
        第一行 `# 标题` 是中心主题；使用两个空格或 Tab 表示层级。这里只保存结构，不会自动替你改写内容。
      </div>
      <textarea
        value={outlineText}
        onChange={event => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        style={textareaStyle}
      />
    </>
  );
}

function GraphEditor({
  file,
  selectedItemId,
  selectedItem,
  imageUriMap,
  onSelect,
  onUpdateText,
  onAddSibling,
  onAddChild,
  onAddRootChild,
  onUpdateImageSize,
  onToggleCollapse,
  onDelete,
  onPickImage,
  onOpenImage,
}: {
  file: MindMapFile;
  selectedItemId: string;
  selectedItem: MindMapItem;
  imageUriMap: Record<string, string>;
  onSelect: (itemId: string) => void;
  onUpdateText: (itemId: string, text: string) => void;
  onAddSibling: () => void;
  onAddChild: () => void;
  onAddRootChild: () => void;
  onUpdateImageSize: (imageId: string, size: { width?: number; height?: number }) => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
  onPickImage: () => void;
  onOpenImage: (filePath: string) => void;
}) {
  const [graphViewport, setGraphViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [connectorPaths, setConnectorPaths] = useState<MindMapConnectorPath[]>([]);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const topicRefsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pointerId: number;
  } | null>(null);
  const branchEntries = useMemo(() => file.root.children.map((item, index) => ({
    item,
    index,
    color: BRANCH_COLORS[index % BRANCH_COLORS.length],
  })), [file.root.children]);
  const leftBranches = branchEntries.filter(entry => entry.index % 2 === 1);
  const rightBranches = branchEntries.filter(entry => entry.index % 2 === 0);
  const connectorSpecs = useMemo(() => {
    const specs: MindMapConnectorSpec[] = [];
    const visit = (parent: MindMapItem, side: 'left' | 'right', color: string, depth: number) => {
      if (parent.collapsed) { return; }
      for (const child of parent.children) {
        specs.push({ parentId: parent.id, childId: child.id, side, color, depth });
        visit(child, side, color, depth + 1);
      }
    };
    for (const entry of branchEntries) {
      const side = entry.index % 2 === 1 ? 'left' : 'right';
      specs.push({ parentId: file.root.id, childId: entry.item.id, side, color: entry.color, depth: 1 });
      visit(entry.item, side, entry.color, 2);
    }
    return specs;
  }, [branchEntries, file.root.id]);
  const registerTopicElement = useCallback((itemId: string, element: HTMLDivElement | null) => {
    if (element) {
      topicRefsRef.current.set(itemId, element);
    } else {
      topicRefsRef.current.delete(itemId);
    }
  }, []);
  const setGraphScale = (nextScale: number) => {
    setGraphViewport(prev => ({ ...prev, scale: Math.min(1.8, Math.max(0.45, nextScale)) }));
  };
  const resetGraphViewport = () => setGraphViewport({ x: 0, y: 0, scale: 1 });
  const canStartPan = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el) { return false; }
    return !el.closest('input, textarea, button, select, [data-mindmap-topic]');
  };
  const updateConnectorPaths = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      setConnectorPaths([]);
      return;
    }
    const surfaceRect = surface.getBoundingClientRect();
    const scale = graphViewport.scale || 1;
    const toLocalRect = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        left: (rect.left - surfaceRect.left) / scale,
        right: (rect.right - surfaceRect.left) / scale,
        centerY: (rect.top + rect.height / 2 - surfaceRect.top) / scale,
      };
    };
    const nextPaths = connectorSpecs.flatMap(spec => {
      const parentElement = topicRefsRef.current.get(spec.parentId);
      const childElement = topicRefsRef.current.get(spec.childId);
      if (!parentElement || !childElement) { return []; }
      const parentRect = toLocalRect(parentElement);
      const childRect = toLocalRect(childElement);
      const startX = spec.side === 'right' ? parentRect.right : parentRect.left;
      const endX = spec.side === 'right' ? childRect.left : childRect.right;
      const startY = parentRect.centerY;
      const endY = childRect.centerY;
      const distance = Math.abs(endX - startX);
      const controlOffset = Math.max(42, Math.min(150, distance * 0.48));
      const sx = Math.round(startX * 10) / 10;
      const sy = Math.round(startY * 10) / 10;
      const ex = Math.round(endX * 10) / 10;
      const ey = Math.round(endY * 10) / 10;
      const co = Math.round(controlOffset * 10) / 10;
      const d = spec.side === 'right'
        ? `M ${sx} ${sy} C ${sx + co} ${sy}, ${ex - co} ${ey}, ${ex} ${ey}`
        : `M ${sx} ${sy} C ${sx - co} ${sy}, ${ex + co} ${ey}, ${ex} ${ey}`;
      return [{ id: `${spec.parentId}->${spec.childId}`, d, color: spec.color, depth: spec.depth }];
    });
    setConnectorPaths(prev => areConnectorPathsEqual(prev, nextPaths) ? prev : nextPaths);
  }, [connectorSpecs, graphViewport.scale]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(updateConnectorPaths);
    return () => window.cancelAnimationFrame(frame);
  }, [updateConnectorPaths, file.root, imageUriMap]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) { return undefined; }
    const observer = new ResizeObserver(() => updateConnectorPaths());
    observer.observe(surface);
    topicRefsRef.current.forEach(element => observer.observe(element));
    window.addEventListener('resize', updateConnectorPaths);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateConnectorPaths);
    };
  }, [connectorSpecs, updateConnectorPaths]);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 260px', gap: 12 }}>
      <div
        style={{
          ...graphCanvasStyle,
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
        onPointerDown={event => {
          if (!canStartPan(event.target)) { return; }
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStateRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: graphViewport.x,
            originY: graphViewport.y,
            pointerId: event.pointerId,
          };
          setIsPanning(true);
        }}
        onPointerMove={event => {
          const drag = dragStateRef.current;
          if (!drag || drag.pointerId !== event.pointerId) { return; }
          event.preventDefault();
          setGraphViewport(prev => ({
            ...prev,
            x: drag.originX + event.clientX - drag.startX,
            y: drag.originY + event.clientY - drag.startY,
          }));
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          dragStateRef.current = null;
          setIsPanning(false);
        }}
        onPointerCancel={() => {
          dragStateRef.current = null;
          setIsPanning(false);
        }}
        onWheel={event => {
          event.preventDefault();
          event.stopPropagation();
          const delta = event.deltaY > 0 ? -0.08 : 0.08;
          setGraphScale(graphViewport.scale + delta);
        }}
      >
        <div style={graphViewportControlsStyle}>
          <button style={miniControlButtonStyle} onClick={() => setGraphScale(graphViewport.scale - 0.1)}>−</button>
          <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', minWidth: 42, textAlign: 'center' }}>
            {Math.round(graphViewport.scale * 100)}%
          </span>
          <button style={miniControlButtonStyle} onClick={() => setGraphScale(graphViewport.scale + 0.1)}>+</button>
          <button style={miniControlButtonStyle} onClick={resetGraphViewport}>居中</button>
        </div>
        <div
          ref={surfaceRef}
          style={{
            ...mindMapSurfaceStyle,
            transform: `translate(${graphViewport.x}px, ${graphViewport.y}px) scale(${graphViewport.scale})`,
            transformOrigin: 'center center',
          }}
        >
          <svg style={connectorLayerStyle} aria-hidden="true">
            {connectorPaths.map(path => (
              <path
                key={path.id}
                d={path.d}
                fill="none"
                stroke={`color-mix(in srgb, ${path.color} ${path.depth === 1 ? 82 : 68}%, var(--vscode-panel-border))`}
                strokeWidth={path.depth === 1 ? 3 : 2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={path.depth === 1 ? 0.94 : Math.max(0.46, 0.82 - path.depth * 0.08)}
              />
            ))}
          </svg>
          <div style={mindMapSideStyle('left')}>
            {leftBranches.map(entry => (
              <MindMapBranch
                key={entry.item.id}
                item={entry.item}
                side="left"
                depth={1}
                branchColor={entry.color}
                selectedItemId={selectedItemId}
                imageUriMap={imageUriMap}
                onSelect={onSelect}
                onUpdateText={onUpdateText}
                onOpenImage={onOpenImage}
                registerTopicElement={registerTopicElement}
              />
            ))}
          </div>
          <div style={rootColumnStyle}>
            <MindMapTopicBox
              item={file.root}
              depth={0}
              selected={file.root.id === selectedItemId}
              branchColor="#7c3aed"
              imageUriMap={imageUriMap}
              onSelect={onSelect}
              onUpdateText={onUpdateText}
              onOpenImage={onOpenImage}
              registerTopicElement={registerTopicElement}
            />
          </div>
          <div style={mindMapSideStyle('right')}>
            {rightBranches.map(entry => (
              <MindMapBranch
                key={entry.item.id}
                item={entry.item}
                side="right"
                depth={1}
                branchColor={entry.color}
                selectedItemId={selectedItemId}
                imageUriMap={imageUriMap}
                onSelect={onSelect}
                onUpdateText={onUpdateText}
                onOpenImage={onOpenImage}
                registerTopicElement={registerTopicElement}
              />
            ))}
          </div>
        </div>
        {file.root.children.length === 0 && (
          <div style={emptyGraphStateStyle}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>🧠</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>还没有分支</div>
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5, textAlign: 'center' }}>
              先保留中心主题，再添加第一个分支。导图不会自动替你生成结构。
            </div>
            <button
              style={{ ...primaryButtonStyle, padding: '5px 12px', fontSize: 12 }}
              onClick={event => {
                event.stopPropagation();
                onAddRootChild();
              }}
            >
              添加第一个分支
            </button>
          </div>
        )}
      </div>
      <div style={inspectorStyle}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>图形编辑</div>
        <label style={fieldLabelStyle}>条目文本</label>
        <textarea
          value={selectedItem.text}
          onChange={event => onUpdateText(selectedItem.id, event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onAddSibling();
            } else if (event.key === 'Tab') {
              event.preventDefault();
              onAddChild();
            } else if (event.key === 'Delete' && selectedItem.id !== file.root.id && !event.currentTarget.value.trim()) {
              event.preventDefault();
              onDelete();
            }
          }}
          style={{ ...textareaStyle, flex: '0 0 92px', fontSize: 12 }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button style={secondaryButtonStyle} onClick={onAddSibling}>+ 同级</button>
          <button style={secondaryButtonStyle} onClick={onAddChild}>+ 子级</button>
          <button style={secondaryButtonStyle} onClick={onToggleCollapse}>
            {selectedItem.collapsed ? '展开' : '折叠'}
          </button>
          <button style={dangerButtonStyle} onClick={onDelete} disabled={selectedItem.id === file.root.id}>删除</button>
        </div>
        <button style={{ ...primaryButtonStyle, width: '100%' }} onClick={onPickImage}>添加图片引用</button>
        {selectedItem.images && selectedItem.images.length > 0 && (
          <div style={imageInspectorStyle}>
            <div style={{ fontSize: 11, fontWeight: 700 }}>图片引用</div>
            {selectedItem.images.map(image => {
              const width = image.width ?? 96;
              const height = image.height ?? 72;
              return (
                <div key={image.id} style={imageInspectorItemStyle}>
                  <div title={image.file_path} style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {image.caption || image.file_path}
                  </div>
                  <label style={imageSizeRowStyle}>
                    <span>宽</span>
                    <input
                      type="range"
                      min={32}
                      max={220}
                      value={width}
                      onChange={event => onUpdateImageSize(image.id, { width: Number(event.target.value), height })}
                      style={{ flex: 1 }}
                    />
                    <span>{width}px</span>
                  </label>
                  <label style={imageSizeRowStyle}>
                    <span>高</span>
                    <input
                      type="range"
                      min={24}
                      max={160}
                      value={height}
                      onChange={event => onUpdateImageSize(image.id, { width, height: Number(event.target.value) })}
                      style={{ flex: 1 }}
                    />
                    <span>{height}px</span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
          Enter 新增同级，Tab 新增子级。空白处拖动画布，滚轮缩放。删除含子级条目前会确认。
        </div>
      </div>
    </div>
  );
}

function MindMapBranch({
  item,
  side,
  depth,
  branchColor,
  selectedItemId,
  imageUriMap,
  onSelect,
  onUpdateText,
  onOpenImage,
  registerTopicElement,
}: {
  item: MindMapItem;
  side: 'left' | 'right';
  depth: number;
  branchColor: string;
  selectedItemId: string;
  imageUriMap: Record<string, string>;
  onSelect: (itemId: string) => void;
  onUpdateText: (itemId: string, text: string) => void;
  onOpenImage: (filePath: string) => void;
  registerTopicElement: (itemId: string, element: HTMLDivElement | null) => void;
}) {
  const selected = item.id === selectedItemId;
  const collapsed = !!item.collapsed && item.children.length > 0;
  const topic = (
    <MindMapTopicBox
      item={item}
      depth={depth}
      selected={selected}
      branchColor={branchColor}
      imageUriMap={imageUriMap}
      onSelect={onSelect}
      onUpdateText={onUpdateText}
      onOpenImage={onOpenImage}
      registerTopicElement={registerTopicElement}
    />
  );
  const childColumn = !collapsed && item.children.length > 0 ? (
    <div style={branchChildrenStyle(side)}>
      {item.children.map(child => (
        <MindMapBranch
          key={child.id}
          item={child}
          side={side}
          depth={depth + 1}
          branchColor={branchColor}
          selectedItemId={selectedItemId}
          imageUriMap={imageUriMap}
          onSelect={onSelect}
          onUpdateText={onUpdateText}
          onOpenImage={onOpenImage}
          registerTopicElement={registerTopicElement}
        />
      ))}
    </div>
  ) : null;

  return (
    <div style={branchRowStyle(side, depth)}>
      {side === 'left' && childColumn}
      {topic}
      {side === 'right' && childColumn}
      {collapsed && (
        <span style={{
          margin: side === 'left' ? '0 8px 0 0' : '0 0 0 8px',
          fontSize: 11,
          color: 'var(--vscode-descriptionForeground)',
          whiteSpace: 'nowrap',
          order: side === 'left' ? -1 : undefined,
        }}>
          已折叠 {item.children.length} 项
        </span>
      )}
    </div>
  );
}

function MindMapTopicBox({
  item,
  depth,
  selected,
  branchColor,
  imageUriMap,
  onSelect,
  onUpdateText,
  onOpenImage,
  registerTopicElement,
}: {
  item: MindMapItem;
  depth: number;
  selected: boolean;
  branchColor: string;
  imageUriMap: Record<string, string>;
  onSelect: (itemId: string) => void;
  onUpdateText: (itemId: string, text: string) => void;
  onOpenImage: (filePath: string) => void;
  registerTopicElement: (itemId: string, element: HTMLDivElement | null) => void;
}) {
  const isRoot = depth === 0;
  const hasImages = !!item.images?.length;
  return (
    <div
      ref={element => registerTopicElement(item.id, element)}
      data-mindmap-topic=""
      onClick={() => onSelect(item.id)}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: hasImages ? 8 : 6,
        maxWidth: isRoot ? 360 : 300,
        minWidth: isRoot ? 150 : 92,
        padding: hasImages
          ? (isRoot ? '10px 12px 12px' : '8px 10px 10px')
          : (isRoot ? '12px 18px' : depth === 1 ? '8px 12px' : '6px 10px'),
        borderRadius: hasImages ? 16 : isRoot ? 18 : 999,
        background: hasImages
          ? `linear-gradient(180deg, color-mix(in srgb, ${branchColor} 10%, var(--vscode-editor-background)), var(--vscode-input-background))`
          : isRoot
            ? 'linear-gradient(135deg, var(--vscode-button-background), color-mix(in srgb, var(--vscode-button-background) 72%, #7c3aed 28%))'
            : depth === 1
              ? `color-mix(in srgb, ${branchColor} 18%, var(--vscode-input-background))`
              : 'var(--vscode-input-background)',
        color: isRoot ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)',
        border: selected
          ? '2px solid var(--vscode-focusBorder)'
          : `1px solid ${isRoot ? 'color-mix(in srgb, var(--vscode-button-background) 75%, white)' : `color-mix(in srgb, ${branchColor} ${depth === 1 ? 58 : 32}%, var(--vscode-panel-border))`}`,
        boxShadow: selected
          ? `0 0 0 3px color-mix(in srgb, ${branchColor} 26%, transparent), 0 10px 26px rgba(0,0,0,0.24)`
          : isRoot
            ? '0 12px 34px rgba(0,0,0,0.28)'
            : `0 4px 14px color-mix(in srgb, ${branchColor} 12%, rgba(0,0,0,0.16))`,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      <div style={hasImages ? topicTitlePillStyle(isRoot, depth, branchColor) : undefined}>
        <input
          value={item.text}
          onChange={event => onUpdateText(item.id, event.target.value)}
          onFocus={() => onSelect(item.id)}
          style={{
            minWidth: 60,
            maxWidth: '100%',
            width: hasImages ? '100%' : undefined,
            background: 'transparent',
            color: 'inherit',
            border: 'none',
            outline: 'none',
            textAlign: isRoot ? 'center' : 'left',
            fontSize: isRoot ? 18 : depth === 1 ? 13 : 12,
            fontWeight: isRoot ? 850 : depth === 1 ? 750 : 600,
          }}
        />
      </div>
      {item.images && item.images.length > 0 && (
        <div style={topicImagesStyle(isRoot)}>
          {item.images.map(image => (
            <button
              key={image.id}
              title={image.file_path}
              onClick={event => {
                event.stopPropagation();
                onOpenImage(image.file_path);
              }}
              style={{
                width: Math.min(isRoot ? 260 : 220, image.width ?? (isRoot ? 96 : 80)),
                height: Math.min(isRoot ? 190 : 160, image.height ?? (isRoot ? 72 : 60)),
                padding: 0,
                border: `1px solid color-mix(in srgb, ${branchColor} 28%, var(--vscode-panel-border))`,
                borderRadius: 10,
                background: 'var(--vscode-editor-background)',
                overflow: 'hidden',
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(0,0,0,0.24)',
              }}
            >
              {imageUriMap[image.file_path] ? (
                <img
                  src={imageUriMap[image.file_path]}
                  alt={image.caption || image.file_path}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <span style={{ fontSize: 9, color: 'var(--vscode-descriptionForeground)' }}>未加载/缺失</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100200,
  background: 'rgba(0,0,0,0.42)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const modalStyle: React.CSSProperties = {
  width: 'min(1020px, 94vw)',
  height: 'min(760px, 88vh)',
  background: 'var(--vscode-editor-background)',
  color: 'var(--vscode-foreground)',
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 10,
  boxShadow: '0 18px 48px rgba(0,0,0,0.42)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px',
  borderBottom: '1px solid var(--vscode-panel-border)',
  background: 'var(--vscode-sideBar-background)',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: 14,
  gap: 10,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderTop: '1px solid var(--vscode-panel-border)',
  background: 'var(--vscode-sideBar-background)',
};

const graphCanvasStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: 'hidden',
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 6,
  padding: 24,
  position: 'relative',
  touchAction: 'none',
  userSelect: 'none',
  background: `
    radial-gradient(circle at center, color-mix(in srgb, var(--vscode-button-background) 12%, transparent) 0, transparent 28%),
    linear-gradient(135deg, color-mix(in srgb, var(--vscode-input-background) 92%, #1d4ed8 8%), var(--vscode-input-background))
  `,
};

const graphViewportControlsStyle: React.CSSProperties = {
  position: 'absolute',
  right: 10,
  top: 10,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 6px',
  borderRadius: 999,
  border: '1px solid var(--vscode-panel-border)',
  background: 'color-mix(in srgb, var(--vscode-editor-background) 86%, transparent)',
  boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
  cursor: 'default',
};

const emptyGraphStateStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  zIndex: 3,
  transform: 'translate(-50%, -50%)',
  width: 220,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '16px 18px',
  borderRadius: 12,
  border: '1px solid var(--vscode-panel-border)',
  background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, transparent)',
  boxShadow: '0 12px 30px rgba(0,0,0,0.26)',
  cursor: 'default',
};

const miniControlButtonStyle: React.CSSProperties = {
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 999,
  background: 'var(--vscode-button-secondaryBackground)',
  color: 'var(--vscode-button-secondaryForeground)',
  minWidth: 24,
  height: 22,
  padding: '0 7px',
  fontSize: 11,
  cursor: 'pointer',
};

const mindMapSurfaceStyle: React.CSSProperties = {
  minWidth: 980,
  minHeight: 560,
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  columnGap: 0,
  padding: '34px 18px',
  position: 'relative',
};

const connectorLayerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  pointerEvents: 'none',
  zIndex: 0,
};

function mindMapSideStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: side === 'left' ? 'flex-end' : 'flex-start',
    justifyContent: 'center',
    gap: 22,
    minHeight: 260,
    padding: side === 'left' ? '0 44px 0 0' : '0 0 0 44px',
    position: 'relative',
    zIndex: 1,
  };
}

const rootColumnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyItems: 'center',
  position: 'relative',
  zIndex: 1,
};

function branchRowStyle(side: 'left' | 'right', depth: number): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: side === 'left' ? 'row' : 'row',
    alignItems: 'center',
    justifyContent: side === 'left' ? 'flex-end' : 'flex-start',
    gap: depth === 1 ? 34 : 24,
    margin: depth === 1 ? '4px 0' : '7px 0',
  };
}

function topicTitlePillStyle(isRoot: boolean, depth: number, branchColor: string): React.CSSProperties {
  return {
    minWidth: isRoot ? 150 : 110,
    maxWidth: '100%',
    padding: isRoot ? '8px 14px' : depth === 1 ? '6px 10px' : '5px 9px',
    borderRadius: 999,
    background: isRoot
      ? 'linear-gradient(135deg, var(--vscode-button-background), color-mix(in srgb, var(--vscode-button-background) 72%, #7c3aed 28%))'
      : `color-mix(in srgb, ${branchColor} ${depth === 1 ? 18 : 10}%, var(--vscode-input-background))`,
    border: `1px solid ${isRoot ? 'color-mix(in srgb, var(--vscode-button-background) 75%, white)' : `color-mix(in srgb, ${branchColor} ${depth === 1 ? 56 : 30}%, var(--vscode-panel-border))`}`,
    boxSizing: 'border-box',
  };
}

function topicImagesStyle(isRoot: boolean): React.CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: isRoot ? 'center' : 'flex-start',
    alignItems: 'center',
  };
}

function branchChildrenStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: side === 'left' ? 'flex-end' : 'flex-start',
    gap: 12,
    padding: 0,
  };
}

const inspectorStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 6,
  padding: 12,
  background: 'var(--vscode-sideBar-background)',
};

const imageInspectorStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 9,
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 6,
  background: 'var(--vscode-editor-background)',
};

const imageInspectorItemStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  padding: '7px 8px',
  borderRadius: 6,
  background: 'var(--vscode-input-background)',
};

const imageSizeRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '18px 1fr 44px',
  alignItems: 'center',
  gap: 6,
  fontSize: 10,
  color: 'var(--vscode-descriptionForeground)',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--vscode-descriptionForeground)',
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  resize: 'none',
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
  borderRadius: 6,
  padding: 12,
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  fontSize: 13,
  lineHeight: 1.55,
  outline: 'none',
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? 'var(--vscode-button-background)' : 'var(--vscode-panel-border)'}`,
    background: active ? 'var(--vscode-button-background)' : 'var(--vscode-button-secondaryBackground)',
    color: active ? 'var(--vscode-button-foreground)' : 'var(--vscode-button-secondaryForeground)',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  };
}

const iconButtonStyle: React.CSSProperties = {
  border: '1px solid var(--vscode-panel-border)',
  background: 'transparent',
  color: 'var(--vscode-foreground)',
  borderRadius: 5,
  padding: '3px 8px',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--vscode-panel-border)',
  background: 'var(--vscode-button-secondaryBackground)',
  color: 'var(--vscode-button-secondaryForeground)',
  borderRadius: 5,
  padding: '5px 9px',
  cursor: 'pointer',
  fontSize: 12,
};

const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  color: 'var(--vscode-inputValidation-errorForeground, #f48771)',
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--vscode-button-background)',
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  borderRadius: 5,
  padding: '6px 16px',
  fontWeight: 700,
  cursor: 'pointer',
};
