import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { Handle, Position, NodeResizer, useUpdateNodeInternals } from '@xyflow/react';
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
import { buildBlueprintOutputSlotIssueMap } from '../../utils/blueprint-slot-issues';
import { buildBlueprintOutputSlotBindingState } from '../../utils/blueprint-output-bindings';

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

const BLUEPRINT_ACCEPT_TYPE_LABELS: Partial<Record<CanvasNode['node_type'], string>> = {
  paper: 'PDF / 论文',
  note: '笔记文本',
  code: '代码文本',
  image: '图像',
  ai_output: 'AI 文本输出',
  audio: '音频',
  video: '视频',
  data: '表格数据',
  experiment_log: '实验记录',
  task: '任务清单',
};

function describeBlueprintAcceptType(type: CanvasNode['node_type']): string {
  return BLUEPRINT_ACCEPT_TYPE_LABELS[type] ?? type;
}

// Node types that support the preview button (opens in VSCode native viewer)
const PREVIEWABLE = new Set(['paper', 'note', 'code', 'image', 'ai_output', 'audio', 'video', 'data']);
const CARD_HYDRATABLE_NODE_TYPES = new Set<CanvasNode['node_type']>(['note', 'ai_output', 'code', 'data']);
const PLACEHOLDER_AUTO_HEIGHT_PADDING = 18;

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
  const updateNodeInternals = useUpdateNodeInternals();
  const canvasNodes = useCanvasStore(s => s.canvasFile?.nodes ?? []);
  const edges = useCanvasStore(s => s.edges);
  const settings = useCanvasStore(s => s.settings);
  const imageUriMap = useCanvasStore(s => s.imageUriMap);
  const nodeDefs = useCanvasStore(s => s.nodeDefs);
  const previewNodeSize = useCanvasStore(s => s.previewNodeSize);
  const updateNodeSize = useCanvasStore(s => s.updateNodeSize);
  const openPreview = useCanvasStore(s => s.openPreview);
  const fullContent = useCanvasStore(s => s.fullContentCache[data.id]);
  const selectExclusiveNode = useCanvasStore(s => s.selectExclusiveNode);
  const pipelineState = useCanvasStore(s => s.pipelineState);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const placeholderMeasureRef = useRef<HTMLDivElement | null>(null);
  const placeholderHeightOuterRafRef = useRef<number | null>(null);
  const placeholderHeightInnerRafRef = useRef<number | null>(null);
  const placeholderHeightRetryTimeoutsRef = useRef<number[]>([]);
  const lastAutoPlaceholderHeightRef = useRef<number>(data.size?.height ?? 0);

  // Resolve icon/color/previewType from registry (falls back to hardcoded values)
  const nodeDef = nodeDefs.find(d => d.id === data.node_type);
  const isBlueprintPlaceholder = !!data.meta?.blueprint_placeholder_kind;
  const isBlueprintInputPlaceholder = data.meta?.blueprint_placeholder_kind === 'input';
  const blueprintBoundKind = data.meta?.blueprint_bound_slot_kind;
  const isBlueprintBoundNode = !!blueprintBoundKind;
  const placeholderKindLabel = data.meta?.blueprint_placeholder_kind === 'input' ? '输入占位' : '输出占位';
  const placeholderSemanticTitle = data.meta?.blueprint_placeholder_title ?? '';
  const accentColor = data.meta?.blueprint_color
    ?? nodeDef?.color
    ?? FALLBACK_COLORS[data.node_type]
    ?? 'var(--vscode-foreground)';
  const nodeIcon    = isBlueprintPlaceholder
    ? '⟫'
    : (nodeDef?.icon  ?? FALLBACK_ICONS[data.node_type]  ?? '📁');
  const displayTitle = isBlueprintPlaceholder ? placeholderKindLabel : (data.title || '无标题');
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
  const placeholderBindingInfo = useMemo(() => {
    if (data.meta?.blueprint_placeholder_kind !== 'input') { return null; }
    const bindingEdges = edges.filter(edge =>
      edge.target === data.id && edge.data?.edge_type === 'data_flow'
    );
    const boundNodeTitles = bindingEdges
      .map(edge => canvasNodes.find(node => node.id === edge.source)?.title)
      .filter((title): title is string => !!title);
    return {
      count: bindingEdges.length,
      accepts: data.meta?.blueprint_placeholder_accepts ?? [],
      required: !!data.meta?.blueprint_placeholder_required,
      allowMultiple: !!data.meta?.blueprint_placeholder_allow_multiple,
      titles: boundNodeTitles,
    };
  }, [canvasNodes, data.id, data.meta?.blueprint_placeholder_accepts, data.meta?.blueprint_placeholder_allow_multiple, data.meta?.blueprint_placeholder_kind, data.meta?.blueprint_placeholder_required, edges]);

  useEffect(() => {
    ensureNodeChromeStyles();
  }, []);

  const placeholderPreviewText = useMemo(() => {
    if (!placeholderBindingInfo) { return null; }
    if (placeholderBindingInfo.count > 0) {
      if (placeholderBindingInfo.titles.length > 0) {
        return `当前通过连线接入：${placeholderBindingInfo.titles.slice(0, 3).join('、')}${placeholderBindingInfo.titles.length > 3 ? ` 等 ${placeholderBindingInfo.titles.length} 个节点` : ''}`;
      }
      return `当前已通过连线绑定 ${placeholderBindingInfo.count} 个上游节点。`;
    }
    return data.meta?.blueprint_placeholder_hint || '请将外部节点直接连到此输入占位，作为蓝图实例输入传递。';
  }, [data.meta?.blueprint_placeholder_hint, placeholderBindingInfo]);
  const inputPlaceholderPrimaryNodeId = useMemo(() => {
    if (!placeholderBindingInfo || placeholderBindingInfo.count === 0) { return null; }
    const bindingEdges = edges.filter(edge =>
      edge.target === data.id && edge.data?.edge_type === 'data_flow'
    );
    return bindingEdges[bindingEdges.length - 1]?.source ?? null;
  }, [data.id, edges, placeholderBindingInfo]);
  const inputPlaceholderStatusText = useMemo(() => {
    if (!placeholderBindingInfo) { return null; }
    if (placeholderBindingInfo.count > 0) {
      return placeholderBindingInfo.titles.length > 0
        ? `当前输入：${placeholderBindingInfo.titles.slice(0, 3).join('、')}${placeholderBindingInfo.titles.length > 3 ? ` 等 ${placeholderBindingInfo.titles.length} 个节点` : ''}`
        : `当前已接入 ${placeholderBindingInfo.count} 个输入节点。`;
    }
    return data.meta?.blueprint_placeholder_hint || '该输入槽位当前还没有接入外部节点。';
  }, [data.meta?.blueprint_placeholder_hint, placeholderBindingInfo]);
  const outputSlotRuntimeInfo = useMemo(() => {
    const outputSlotId = data.meta?.blueprint_placeholder_kind === 'output'
      ? data.meta?.blueprint_placeholder_slot_id
      : data.meta?.blueprint_bound_slot_kind === 'output'
        ? data.meta?.blueprint_bound_slot_id
        : undefined;
    const instanceId = data.meta?.blueprint_placeholder_kind === 'output'
      ? data.meta?.blueprint_instance_id
      : data.meta?.blueprint_bound_slot_kind === 'output'
        ? data.meta?.blueprint_bound_instance_id
        : undefined;
    if (!outputSlotId || !instanceId) { return null; }

    const containerNode = canvasNodes.find(node =>
      node.node_type === 'blueprint' && node.meta?.blueprint_instance_id === instanceId
    );
    const outputSlots = containerNode?.meta?.blueprint_output_slot_defs ?? [];
    const slotDef = outputSlots.find(slot => slot.id === outputSlotId);
    const { outputBindings, boundNodesBySlot } = buildBlueprintOutputSlotBindingState({
      instanceId,
      outputSlots: slotDef ? [slotDef] : [],
      canvasNodes,
    });
    const boundNodes = boundNodesBySlot.get(outputSlotId) ?? [];
    const issueCards = settings?.testMode ? [] : Object.entries(pipelineState?.nodeIssues ?? {}).map(([nodeId, issue]) => ({
      nodeId,
      title: canvasNodes.find(node => node.id === nodeId)?.title ?? nodeId,
      kind: issue.kind,
      message: issue.message,
    }));
    if (!settings?.testMode && issueCards.length === 0 && containerNode?.meta?.blueprint_last_run_status === 'failed' && containerNode.meta?.blueprint_last_issue_node_title) {
      issueCards.push({
        nodeId: containerNode.meta?.blueprint_last_issue_node_id,
        title: containerNode.meta.blueprint_last_issue_node_title,
        kind: 'run_failed',
        message: containerNode.meta?.blueprint_last_run_summary ?? '最近一次运行失败',
      });
    }
    const issue = buildBlueprintOutputSlotIssueMap({
      canvasNodes,
      edges,
      instanceId,
      outputSlots: slotDef ? [slotDef] : [],
      outputBindings,
      issueCards,
      instanceRunning: !!pipelineState?.isRunning,
      nodeStatuses: pipelineState?.nodeStatuses,
    }).get(outputSlotId);

    return {
      slotId: outputSlotId,
      instanceId,
      slotDef,
      issue,
      boundNodes,
      currentNode: boundNodes[boundNodes.length - 1],
      lastRunStatus: containerNode?.meta?.blueprint_last_run_status,
      instanceRunning: !!pipelineState?.isRunning,
    };
  }, [
    canvasNodes,
    data.meta?.blueprint_bound_slot_id,
    data.meta?.blueprint_bound_slot_kind,
    data.meta?.blueprint_bound_instance_id,
    data.meta?.blueprint_placeholder_kind,
    data.meta?.blueprint_placeholder_slot_id,
    data.meta?.blueprint_instance_id,
    edges,
    pipelineState?.isRunning,
    pipelineState?.nodeIssues,
    pipelineState?.nodeStatuses,
    settings?.testMode,
  ]);
  const inputPlaceholderMissingRequired = !!(
    placeholderBindingInfo &&
    placeholderBindingInfo.required &&
    placeholderBindingInfo.count === 0
  );
  const outputSlotFailedWithoutOutput = !!(
    outputSlotRuntimeInfo &&
    !outputSlotRuntimeInfo.currentNode &&
    !settings?.testMode &&
    (outputSlotRuntimeInfo.issue?.kind === 'upstream_failed' || outputSlotRuntimeInfo.lastRunStatus === 'failed')
  );
  const outputSlotCancelledWithoutOutput = !!(
    outputSlotRuntimeInfo &&
    !outputSlotRuntimeInfo.currentNode &&
    outputSlotRuntimeInfo.lastRunStatus === 'cancelled'
  );
  const outputSlotWaiting = !!(
    outputSlotRuntimeInfo &&
    !outputSlotRuntimeInfo.currentNode &&
    (outputSlotRuntimeInfo.issue?.kind === 'waiting_output' || outputSlotRuntimeInfo.instanceRunning)
  );
  const isBlueprintOutputPlaceholder = data.meta?.blueprint_placeholder_kind === 'output';
  const shouldCompactInputPlaceholder = false;
  const placeholderPortVariant = isBlueprintPlaceholder ? 'blueprint-placeholder' : 'default';
  const placeholderStatusBadge = useMemo(() => {
    if (placeholderBindingInfo) {
      return {
        title: '蓝图输入绑定状态',
        text: placeholderBindingInfo.count > 0 ? `已绑定 ${placeholderBindingInfo.count}` : '待绑定',
        background: placeholderBindingInfo.count > 0
          ? withAlpha(accentColor, 0.14, 'transparent')
          : 'var(--vscode-badge-background)',
        color: placeholderBindingInfo.count > 0 ? accentColor : 'var(--vscode-badge-foreground)',
        border: `1px solid ${withAlpha(accentColor, 0.4, 'var(--vscode-panel-border)')}`,
      };
    }
    if (outputSlotRuntimeInfo) {
      return {
        title: '蓝图输出槽位运行状态',
        text: outputSlotRuntimeInfo.currentNode
          ? '已回填'
          : outputSlotFailedWithoutOutput
            ? '未产出'
            : outputSlotCancelledWithoutOutput
              ? '已取消'
              : outputSlotWaiting
                ? '等待产出'
                : '待回填',
        background: outputSlotFailedWithoutOutput
          ? 'var(--vscode-inputValidation-errorBackground, rgba(190,17,0,0.18))'
          : outputSlotWaiting
            ? withAlpha(accentColor, 0.14, 'transparent')
            : outputSlotRuntimeInfo.currentNode
              ? withAlpha(accentColor, 0.14, 'transparent')
              : 'var(--vscode-badge-background)',
        color: outputSlotFailedWithoutOutput
          ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
          : outputSlotWaiting
            ? accentColor
            : outputSlotRuntimeInfo.currentNode
              ? accentColor
              : 'var(--vscode-badge-foreground)',
        border: `1px solid ${outputSlotFailedWithoutOutput
          ? 'var(--vscode-inputValidation-errorBorder, #be1100)'
          : withAlpha(accentColor, 0.4, 'var(--vscode-panel-border)')}`,
      };
    }
    return null;
  }, [
    accentColor,
    outputSlotCancelledWithoutOutput,
    outputSlotFailedWithoutOutput,
    outputSlotRuntimeInfo,
    outputSlotWaiting,
    placeholderBindingInfo,
  ]);
  const placeholderPrimaryText = isBlueprintInputPlaceholder
    ? inputPlaceholderStatusText
    : outputSlotRuntimeInfo
      ? (outputSlotRuntimeInfo.currentNode
        ? `当前输出：${outputSlotRuntimeInfo.currentNode.title}`
        : outputSlotFailedWithoutOutput
          ? (outputSlotRuntimeInfo.issue?.message ?? '该输出槽位最近一次运行未成功产出。')
          : outputSlotCancelledWithoutOutput
            ? '该输出槽位在最近一次运行取消前未完成产出。'
            : outputSlotWaiting
              ? (outputSlotRuntimeInfo.issue?.message ?? '该输出槽位正在等待实例内部上游节点继续产出。')
              : '该输出槽位当前还没有回填结果。')
      : null;
  const placeholderSecondaryText = isBlueprintInputPlaceholder
    ? null
    : outputSlotRuntimeInfo?.issue?.relatedNodeTitle
      ? `关联节点：${outputSlotRuntimeInfo.issue.relatedNodeTitle}`
      : null;
  const placeholderAction = isBlueprintInputPlaceholder
    ? (inputPlaceholderPrimaryNodeId
      ? {
          label: '定位输入节点',
          nodeId: inputPlaceholderPrimaryNodeId,
        }
      : null)
    : outputSlotRuntimeInfo?.issue?.relatedNodeId
      ? {
          label: outputSlotFailedWithoutOutput ? '定位问题节点' : '定位上游节点',
          nodeId: outputSlotRuntimeInfo.issue.relatedNodeId,
        }
      : null;
  const placeholderFooterTitle = isBlueprintInputPlaceholder
    ? (placeholderSemanticTitle ? `输入槽位：${placeholderSemanticTitle}` : '输入槽位')
    : (placeholderSemanticTitle
      ? `输出槽位：${placeholderSemanticTitle}`
      : outputSlotRuntimeInfo?.slotDef?.title
        ? `输出槽位：${outputSlotRuntimeInfo.slotDef.title}`
        : '输出槽位');
  const placeholderFooterChips = isBlueprintInputPlaceholder
    ? [
        placeholderBindingInfo?.accepts?.length
          ? `接受 ${placeholderBindingInfo.accepts.map(type => describeBlueprintAcceptType(type)).join(' / ')}`
          : '接受任意数据',
        placeholderBindingInfo?.required ? '必填槽位' : '可选槽位',
        placeholderBindingInfo?.allowMultiple ? '允许多个输入' : '单绑定',
      ]
    : [
        outputSlotRuntimeInfo?.slotDef?.allow_multiple ? '允许多个输出' : '单输出',
        outputSlotRuntimeInfo?.currentNode ? '已回填结果' : '等待回填',
        outputSlotRuntimeInfo?.boundNodes.length
          ? `累计 ${outputSlotRuntimeInfo.boundNodes.length} 个结果`
          : '暂未生成结果',
      ];

  useEffect(() => {
    lastAutoPlaceholderHeightRef.current = data.size?.height ?? lastAutoPlaceholderHeightRef.current;
  }, [data.size?.height]);

  const schedulePlaceholderHeightSync = useCallback(() => {
    if (!isBlueprintPlaceholder) { return; }
    const el = rootRef.current;
    const measureEl = placeholderMeasureRef.current;
    if (!el || !measureEl) { return; }
    if (placeholderHeightOuterRafRef.current !== null) {
      window.cancelAnimationFrame(placeholderHeightOuterRafRef.current);
      placeholderHeightOuterRafRef.current = null;
    }
    if (placeholderHeightInnerRafRef.current !== null) {
      window.cancelAnimationFrame(placeholderHeightInnerRafRef.current);
      placeholderHeightInnerRafRef.current = null;
    }
    placeholderHeightOuterRafRef.current = window.requestAnimationFrame(() => {
      placeholderHeightOuterRafRef.current = null;
      placeholderHeightInnerRafRef.current = window.requestAnimationFrame(() => {
        placeholderHeightInnerRafRef.current = null;
        if (!el.isConnected || rootRef.current !== el) { return; }
        const measuredHeight = Math.max(
          Math.ceil(measureEl.scrollHeight),
          Math.ceil(measureEl.clientHeight),
          Math.ceil(measureEl.offsetHeight),
        );
        if (measuredHeight <= 0) { return; }
        const currentWidth = data.size?.width ?? DEFAULT_SIZES[data.node_type].width;
        const currentHeight = data.size?.height ?? DEFAULT_SIZES[data.node_type].height;
        const requiredHeight = Math.max(
          DEFAULT_SIZES[data.node_type].height,
          measuredHeight + PLACEHOLDER_AUTO_HEIGHT_PADDING,
        );
        if (Math.abs(requiredHeight - currentHeight) > 2) {
          if (Math.abs(requiredHeight - lastAutoPlaceholderHeightRef.current) <= 2) {
            return;
          }
          lastAutoPlaceholderHeightRef.current = requiredHeight;
          updateNodeSize(data.id, currentWidth, requiredHeight);
        } else {
          updateNodeInternals(data.id);
        }
      });
    });
  }, [data.id, data.node_type, data.size?.height, data.size?.width, isBlueprintPlaceholder, updateNodeInternals, updateNodeSize]);

  useLayoutEffect(() => {
    schedulePlaceholderHeightSync();
  }, [
    isBlueprintPlaceholder,
    shouldCompactInputPlaceholder,
    placeholderBindingInfo?.count,
    placeholderBindingInfo?.titles.length,
    placeholderBindingInfo?.accepts.join('|'),
    placeholderSemanticTitle,
    outputSlotRuntimeInfo?.currentNode?.id,
    outputSlotRuntimeInfo?.issue?.kind,
    outputSlotRuntimeInfo?.issue?.message,
    outputSlotRuntimeInfo?.issue?.relatedNodeId,
    schedulePlaceholderHeightSync,
  ]);

  useEffect(() => {
    if (!isBlueprintPlaceholder) { return; }
    schedulePlaceholderHeightSync();
    placeholderHeightRetryTimeoutsRef.current.forEach(timeoutId => window.clearTimeout(timeoutId));
    placeholderHeightRetryTimeoutsRef.current = [
      window.setTimeout(schedulePlaceholderHeightSync, 32),
      window.setTimeout(schedulePlaceholderHeightSync, 120),
      window.setTimeout(schedulePlaceholderHeightSync, 260),
      window.setTimeout(schedulePlaceholderHeightSync, 520),
      window.setTimeout(schedulePlaceholderHeightSync, 900),
    ];
    return () => {
      placeholderHeightRetryTimeoutsRef.current.forEach(timeoutId => window.clearTimeout(timeoutId));
      placeholderHeightRetryTimeoutsRef.current = [];
    };
  }, [isBlueprintPlaceholder, schedulePlaceholderHeightSync]);

  useEffect(() => {
    if (!isBlueprintPlaceholder) { return; }
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts?.ready) { return; }
    let cancelled = false;
    fonts.ready.then(() => {
      if (!cancelled) {
        schedulePlaceholderHeightSync();
      }
    }).catch(() => {
      // ignore font readiness failures
    });
    return () => {
      cancelled = true;
    };
  }, [isBlueprintPlaceholder, schedulePlaceholderHeightSync]);

  useEffect(() => {
    if (!isBlueprintPlaceholder) { return; }
    const el = rootRef.current;
    const measureEl = placeholderMeasureRef.current;
    if ((!el && !measureEl) || typeof ResizeObserver === 'undefined') { return; }
    const observer = new ResizeObserver(() => {
      schedulePlaceholderHeightSync();
    });
    if (el) {
      observer.observe(el);
    }
    if (measureEl && measureEl !== el) {
      observer.observe(measureEl);
    }
    return () => {
      observer.disconnect();
      if (placeholderHeightOuterRafRef.current !== null) {
        window.cancelAnimationFrame(placeholderHeightOuterRafRef.current);
        placeholderHeightOuterRafRef.current = null;
      }
      if (placeholderHeightInnerRafRef.current !== null) {
        window.cancelAnimationFrame(placeholderHeightInnerRafRef.current);
        placeholderHeightInnerRafRef.current = null;
      }
      placeholderHeightRetryTimeoutsRef.current.forEach(timeoutId => window.clearTimeout(timeoutId));
      placeholderHeightRetryTimeoutsRef.current = [];
    };
  }, [isBlueprintPlaceholder, schedulePlaceholderHeightSync]);

  const blueprintNodeBorderColor = inputPlaceholderMissingRequired
    ? 'var(--vscode-inputValidation-warningBorder)'
    : outputSlotFailedWithoutOutput
      ? 'var(--vscode-inputValidation-errorBorder, #be1100)'
      : outputSlotWaiting
        ? withAlpha(accentColor, 0.95, 'var(--vscode-panel-border)')
        : (isBlueprintPlaceholder ? withAlpha(accentColor, 0.85, 'var(--vscode-panel-border)') : 'var(--vscode-panel-border)');
  const blueprintNodeBackground = outputSlotFailedWithoutOutput
    ? 'linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 88%, #be1100 12%) 0%, var(--vscode-editor-background) 48%)'
    : inputPlaceholderMissingRequired
      ? 'linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 88%, #b89500 12%) 0%, var(--vscode-editor-background) 48%)'
      : outputSlotWaiting
        ? `linear-gradient(180deg, ${withAlpha(accentColor, 0.12, 'var(--vscode-editor-background)')} 0%, var(--vscode-editor-background) 44%)`
        : isBlueprintPlaceholder
          ? `linear-gradient(180deg, ${withAlpha(accentColor, 0.08, 'var(--vscode-editor-background)')} 0%, var(--vscode-editor-background) 42%)`
          : 'var(--vscode-editor-background)';
  const blueprintNodeBoxShadow = outputSlotFailedWithoutOutput
    ? `0 0 0 1px color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #be1100) 38%, transparent), 0 10px 24px rgba(190,17,0,0.18)`
    : inputPlaceholderMissingRequired
      ? `0 0 0 1px color-mix(in srgb, var(--vscode-inputValidation-warningBorder, #b89500) 42%, transparent), 0 10px 24px rgba(184,149,0,0.16)`
      : outputSlotWaiting
        ? `0 0 0 1px ${withAlpha(accentColor, 0.26, 'transparent')}, 0 10px 24px ${withAlpha(accentColor, 0.18, 'rgba(0,0,0,0.16)')}`
        : undefined;

  // Card body follows the node's own display mode; cached full content is only used in full mode.
  const displayContent = isBlueprintInputPlaceholder ? null : (placeholderPreviewText ?? (
    desiredCardContentMode === 'full'
      ? (fullContent ?? data.meta?.content_preview)
      : data.meta?.content_preview
  ));

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
      ref={rootRef}
      className={`rs-node-surface rs-node-surface--interactive${selected ? ' rs-node-surface--selected' : ''}`}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      style={{
        width: '100%',
        height: '100%',
        background: blueprintNodeBackground,
        border: `${selected ? NODE_SELECTED_BORDER_WIDTH : NODE_BORDER_WIDTH}px ${isBlueprintPlaceholder ? 'dashed' : 'solid'} ${selected ? accentColor : blueprintNodeBorderColor}`,
        borderRadius: NODE_RADIUS,
        display: 'flex',
        /* NO overflow:hidden here — it clips the ReactFlow Handle dots */
        cursor: 'default',
        boxShadow: selected
          ? `0 0 0 1px ${withAlpha(accentColor, 0.2, 'transparent')}, 0 10px 24px ${withAlpha(accentColor, 0.16, 'rgba(0,0,0,0.18)')}`
          : (blueprintNodeBoxShadow ?? '0 3px 10px rgba(0,0,0,0.18)'),
        position: 'relative',
      }}
    >
      {/* Resize handles — visible when selected */}
      <NodeResizer
        isVisible={selected && !isBlueprintPlaceholder}
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
      <div style={{ width: isBlueprintPlaceholder ? 5 : 4, background: accentColor, flexShrink: 0, borderRadius: `${NODE_RADIUS}px 0 0 ${NODE_RADIUS}px` }} />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div
          ref={isBlueprintPlaceholder ? placeholderMeasureRef : undefined}
          style={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            ...(isBlueprintPlaceholder ? {} : { flex: 1, minHeight: 0 }),
          }}
        >
          {/* Header — fixed, never scrolls with content */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            overflow: 'hidden',
            flexShrink: 0,
            background: isBlueprintPlaceholder
              ? withAlpha(accentColor, 0.05, 'var(--vscode-editor-background)')
              : 'var(--vscode-editor-background)',
            padding: `9px ${NODE_CONTENT_GUTTER}px 7px`,
          }}>
            <span style={{ fontSize: NODE_HEADER_ICON_SIZE, lineHeight: 1 }}>{nodeIcon}</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                ...NODE_HEADER_TITLE_STYLE,
                flex: 1,
              }}>
                {displayTitle}
              </span>
              {isBlueprintPlaceholder && placeholderSemanticTitle && (
                <span style={{
                  fontSize: 10,
                  color: 'var(--vscode-descriptionForeground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  槽位语义：{placeholderSemanticTitle}
                </span>
              )}
            </div>
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
                专属槽位
              </span>
            )}
            {placeholderStatusBadge && (
              <span title={placeholderStatusBadge.title} style={{
                background: placeholderStatusBadge.background,
                color: placeholderStatusBadge.color,
                border: placeholderStatusBadge.border,
                borderRadius: 4,
                fontSize: 10,
                padding: '1px 5px',
                flexShrink: 0,
              }}>
                {placeholderStatusBadge.text}
              </span>
            )}
            {isBlueprintBoundNode && (
              <span title="该节点已回填到蓝图实例槽位" style={{
                background: withAlpha(accentColor, 0.12, 'transparent'),
                color: accentColor,
                border: `1px solid ${withAlpha(accentColor, 0.4, 'var(--vscode-panel-border)')}`,
                borderRadius: 4,
                fontSize: 10,
                padding: '1px 5px',
                flexShrink: 0,
              }}>
                {blueprintBoundKind === 'output' ? '输出回填' : '输入绑定'}
              </span>
            )}
          </div>

          {/* Body — the only scrollable area inside the node */}
          <div style={{
            flex: isBlueprintPlaceholder ? '0 0 auto' : 1,
            minHeight: isBlueprintPlaceholder ? 'auto' : 0,
            minWidth: 0,
            overflow: shouldCompactInputPlaceholder ? 'hidden' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: shouldCompactInputPlaceholder ? 6 : 4,
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
          {isBlueprintPlaceholder && (placeholderPrimaryText || placeholderSecondaryText || placeholderAction) && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              marginTop: 4,
              flex: '0 0 auto',
              padding: '2px 0 0',
            }}>
              {placeholderPrimaryText && (
                <div style={{
                  fontSize: 10,
                  color: isBlueprintInputPlaceholder
                    ? (inputPlaceholderMissingRequired
                      ? 'var(--vscode-inputValidation-warningForeground)'
                      : placeholderBindingInfo?.count
                        ? accentColor
                        : 'var(--vscode-descriptionForeground)')
                    : outputSlotFailedWithoutOutput
                      ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
                      : outputSlotWaiting
                        ? accentColor
                        : 'var(--vscode-descriptionForeground)',
                  fontWeight: 600,
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                }}>
                  {placeholderPrimaryText}
                </div>
              )}
              {placeholderSecondaryText && (
                <div style={{
                  fontSize: 10,
                  color: 'var(--vscode-descriptionForeground)',
                  lineHeight: 1.45,
                  wordBreak: 'break-word',
                }}>
                  {placeholderSecondaryText}
                </div>
              )}
              {placeholderAction && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => selectExclusiveNode(placeholderAction.nodeId)}
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${withAlpha(accentColor, 0.28, 'var(--vscode-panel-border)')}`,
                      background: withAlpha(accentColor, 0.08, 'transparent'),
                      color: accentColor,
                      padding: '2px 8px',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {placeholderAction.label}
                  </button>
                </div>
              )}
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
        {!shouldCompactInputPlaceholder && (
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

          {isBlueprintBoundNode && data.meta?.blueprint_bound_slot_title && (
            <div style={{
              fontSize: 10,
              color: 'var(--vscode-descriptionForeground)',
              lineHeight: 1.4,
              wordBreak: 'break-word',
            }}>
              槽位：{data.meta.blueprint_bound_slot_title}
            </div>
          )}

          {isBlueprintPlaceholder && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '2px 0 0',
            }}>
              <div style={{
                fontSize: 10,
                color: accentColor,
                fontWeight: 700,
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}>
                {placeholderFooterTitle}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {placeholderFooterChips.map(chip => (
                  <span
                    key={chip}
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      background: withAlpha(accentColor, 0.08, 'transparent'),
                      color: accentColor,
                      border: `1px solid ${withAlpha(accentColor, 0.2, 'var(--vscode-panel-border)')}`,
                      borderRadius: 10,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          )}

          {PREVIEWABLE.has(data.node_type) && (data.meta?.ai_provider || data.meta?.ai_model) && (
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

          {!isBlueprintPlaceholder && <AiReadabilityBadge data={data} />}
        </div>
        )}
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
        style={buildNodePortStyle(accentColor, 'out', placeholderPortVariant)}
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
        style={buildNodePortStyle(accentColor, 'in', placeholderPortVariant)}
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
