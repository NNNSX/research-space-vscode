import React, { useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../../../../src/core/canvas-model';
import type { BlueprintSlotDef } from '../../../../src/blueprint/blueprint-types';
import { postMessage } from '../../bridge';
import { useCanvasStore } from '../../stores/canvas-store';
import { buildNodePortStyle, getNodePortLabel, NODE_PORT_CLASSNAME, NODE_PORT_IDS } from '../../utils/node-port';
import { closeAllCanvasContextMenus } from '../../utils/context-menu';
import { buildBlueprintInputSlotBindingMap } from '../../utils/blueprint-bindings';
import { buildBlueprintOutputSlotBindingState } from '../../utils/blueprint-output-bindings';
import {
  ensureNodeChromeStyles,
  NODE_BORDER_WIDTH,
  NODE_HEADER_ICON_SIZE,
  NODE_HEADER_TITLE_STYLE,
  NODE_RADIUS,
  NODE_SELECTED_BORDER_WIDTH,
  withAlpha,
} from '../../utils/node-chrome';
import { NodeContextMenu } from './NodeContextMenu';
import { buildBlueprintOutputSlotIssueMap, type BlueprintOutputSlotIssue } from '../../utils/blueprint-slot-issues';

function formatBlueprintRunTime(value?: string): string {
  if (!value) { return '—'; }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { return '—'; }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBlueprintRunStatusLabel(status: CanvasNode['meta']['blueprint_last_run_status']): string {
  switch (status) {
    case 'succeeded': return '成功';
    case 'failed': return '失败';
    case 'cancelled': return '取消';
    default: return '未知';
  }
}

export function BlueprintContainerNode({ id, data, selected }: NodeProps) {
  const blueprint = data as CanvasNode;
  const accent = blueprint.meta?.blueprint_color ?? '#2f7d68';
  const edges = useCanvasStore(s => s.edges);
  const canvasNodes = useCanvasStore(s => s.canvasFile?.nodes ?? []);
  const pipelineState = useCanvasStore(s => s.pipelineState);
  const selectExclusiveNode = useCanvasStore(s => s.selectExclusiveNode);
  const inputSlots = blueprint.meta?.blueprint_input_slot_defs ?? [];
  const outputSlots = blueprint.meta?.blueprint_output_slot_defs ?? [];
  const instanceId = blueprint.meta?.blueprint_instance_id;
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    ensureNodeChromeStyles();
  }, []);

  const slotBindings = useMemo(() => {
    return buildBlueprintInputSlotBindingMap({
      blueprintNodeId: id,
      instanceId,
      inputSlots,
      canvasNodes,
      edges,
    });
  }, [canvasNodes, edges, id, inputSlots, instanceId]);

  const instanceChildren = useMemo(() => {
    if (!instanceId) { return []; }
    return canvasNodes.filter(node =>
      node.id !== blueprint.id &&
      (
        node.meta?.blueprint_instance_id === instanceId ||
        node.meta?.blueprint_bound_instance_id === instanceId
      )
    );
  }, [blueprint.id, canvasNodes, instanceId]);
  const { outputBindings, boundNodesBySlot: outputBoundNodesBySlot } = useMemo(() => {
    return buildBlueprintOutputSlotBindingState({
      instanceId,
      outputSlots,
      canvasNodes,
    });
  }, [canvasNodes, instanceId, outputSlots]);

  const internalFunctionNodes = useMemo(() => {
    if (!instanceId) { return []; }
    return canvasNodes.filter(node =>
      node.meta?.blueprint_instance_id === instanceId &&
      node.node_type === 'function'
    );
  }, [canvasNodes, instanceId]);

  const inputPortStyle = useMemo(() => buildNodePortStyle(accent, 'in'), [accent]);
  const outputPortStyle = useMemo(() => buildNodePortStyle(accent, 'out'), [accent]);
  const requiredInputCount = inputSlots.filter(slot => slot.required).length;
  const missingRequiredCount = inputSlots.filter(slot => slot.required && (slotBindings.get(slot.id) ?? 0) === 0).length;
  const validationLabel = missingRequiredCount === 0 ? '可运行' : `缺少 ${missingRequiredCount} 个必填输入`;
  const validationColor = missingRequiredCount === 0
    ? accent
    : 'var(--vscode-inputValidation-warningBorder, #b89500)';
  const instanceFunctionNodeIds = useMemo(() => new Set(internalFunctionNodes.map(node => node.id)), [internalFunctionNodes]);
  const instancePipelineState = useMemo(() => {
    if (!pipelineState || instanceFunctionNodeIds.size === 0) { return null; }
    const matches = Object.keys(pipelineState.nodeStatuses).some(nodeId => instanceFunctionNodeIds.has(nodeId));
    return matches ? pipelineState : null;
  }, [instanceFunctionNodeIds, pipelineState]);
  const instanceStatusCounts = useMemo(() => {
    const counts = { waiting: 0, running: 0, done: 0, failed: 0, skipped: 0 };
    for (const node of internalFunctionNodes) {
      const status = instancePipelineState?.nodeStatuses[node.id];
      if (!status) { continue; }
      counts[status] += 1;
    }
    return counts;
  }, [instancePipelineState, internalFunctionNodes]);
  const instanceDoneCount = instancePipelineState
    ? internalFunctionNodes.filter(node => instancePipelineState.nodeStatuses[node.id] === 'done').length
    : internalFunctionNodes.filter(node => node.meta?.fn_status === 'done').length;
  const instanceFailedCount = instancePipelineState
    ? internalFunctionNodes.filter(node => instancePipelineState.nodeStatuses[node.id] === 'failed').length
    : internalFunctionNodes.filter(node => node.meta?.fn_status === 'error').length;
  const instanceSkippedCount = instancePipelineState
    ? internalFunctionNodes.filter(node => instancePipelineState.nodeStatuses[node.id] === 'skipped').length
    : Number(blueprint.meta?.blueprint_last_run_skipped_nodes ?? 0);
  const instanceTotalCount = internalFunctionNodes.length || Number(blueprint.meta?.blueprint_last_run_total_nodes ?? 0);
  const instanceSettledCount = instancePipelineState
    ? (instanceStatusCounts.done + instanceStatusCounts.failed + instanceStatusCounts.skipped)
    : Number(blueprint.meta?.blueprint_last_run_completed_nodes ?? 0);
  const instanceProgressRatio = instanceTotalCount > 0
    ? Math.min(1, Math.max(0, instanceSettledCount / instanceTotalCount))
    : 0;
  const instanceRunning = !!instancePipelineState?.isRunning;
  const currentRunningNodeTitle = instancePipelineState?.currentNodeId
    ? canvasNodes.find(node => node.id === instancePipelineState.currentNodeId)?.title ?? instancePipelineState.currentNodeId
    : null;
  const activeWarningCount = instancePipelineState?.validationWarnings.length ?? 0;
  const activeReusedCachedNodeCount = instancePipelineState?.reusedCachedNodeCount ?? 0;
  const lastRunStatus = blueprint.meta?.blueprint_last_run_status;
  const lastRunSummary = blueprint.meta?.blueprint_last_run_summary;
  const lastRunFinishedAt = blueprint.meta?.blueprint_last_run_finished_at;
  const lastSucceededAt = blueprint.meta?.blueprint_last_run_succeeded_at;
  const lastFailedAt = blueprint.meta?.blueprint_last_run_failed_at;
  const lastIssueNodeId = blueprint.meta?.blueprint_last_issue_node_id;
  const lastIssueNodeTitle = blueprint.meta?.blueprint_last_issue_node_title;
  const runHistory = blueprint.meta?.blueprint_run_history ?? [];
  const definitionMissing = !!blueprint.meta?.blueprint_definition_missing;
  const definitionMissingMessage = blueprint.meta?.blueprint_definition_missing_message;
  const cancelRequested = !!instancePipelineState?.cancelRequested;
  const instanceRunBlocked = missingRequiredCount > 0 || internalFunctionNodes.length === 0 || !!pipelineState?.isRunning;
  const resumeBlocked =
    instanceRunBlocked ||
    lastRunStatus !== 'failed' ||
    !lastIssueNodeId ||
    !instanceFunctionNodeIds.has(lastIssueNodeId);
  const instanceStatusLabel = missingRequiredCount > 0
    ? '等待输入补齐'
    : instanceRunning
      ? (cancelRequested ? `取消中 ${instanceDoneCount}/${internalFunctionNodes.length}` : `运行中 ${instanceDoneCount}/${internalFunctionNodes.length}`)
      : lastRunStatus === 'failed'
        ? '最近一次运行失败'
        : lastRunStatus === 'cancelled'
          ? '最近一次运行已取消'
          : lastRunStatus === 'succeeded' || instanceDoneCount > 0
          ? '最近一次运行完成'
          : instanceFailedCount > 0
            ? `已结束（失败 ${instanceFailedCount}）`
            : '结构已接通';
  const runButtonTitle = missingRequiredCount > 0
    ? '请先补齐必填输入后再运行'
    : pipelineState?.isRunning
      ? '当前已有 Pipeline / 蓝图执行中'
      : internalFunctionNodes.length === 0
        ? '当前蓝图实例内没有可执行的功能节点'
        : '运行该蓝图实例内部工作流';
  const progressBarColor = cancelRequested
    ? 'var(--vscode-terminal-ansiYellow)'
    : instanceFailedCount > 0
      ? 'var(--vscode-terminal-ansiRed)'
      : accent;
  const currentIssueCards = useMemo(() => {
    if (!instancePipelineState) { return []; }
    return Object.entries(instancePipelineState.nodeIssues)
      .map(([nodeId, issue]) => ({
        nodeId,
        title: canvasNodes.find(node => node.id === nodeId)?.title ?? nodeId,
        kind: issue.kind,
        message: issue.message,
      }))
      .slice(-3)
      .reverse();
  }, [canvasNodes, instancePipelineState]);
  const fallbackIssueCard = lastRunStatus === 'failed' && lastIssueNodeTitle
    ? {
        nodeId: lastIssueNodeId,
        title: lastIssueNodeTitle,
        kind: 'run_failed' as const,
        message: lastRunSummary ?? '最近一次运行失败',
      }
    : null;
  const issueCards = currentIssueCards.length > 0
    ? currentIssueCards
    : (fallbackIssueCard ? [fallbackIssueCard] : []);
  const outputSlotIssueMap = useMemo(() => {
    return buildBlueprintOutputSlotIssueMap({
      canvasNodes,
      edges,
      instanceId,
      outputSlots,
      outputBindings,
      issueCards,
      instanceRunning,
      nodeStatuses: instancePipelineState?.nodeStatuses,
    });
  }, [canvasNodes, edges, instanceId, instancePipelineState?.nodeStatuses, instanceRunning, issueCards, outputBindings, outputSlots]);

  return (
    <div
      style={{
        width: blueprint.size.width,
        height: blueprint.size.height,
        pointerEvents: 'none',
        borderRadius: NODE_RADIUS,
        border: `${selected ? NODE_SELECTED_BORDER_WIDTH : NODE_BORDER_WIDTH}px solid ${accent}`,
        background: 'transparent',
        boxSizing: 'border-box',
        boxShadow: selected
          ? `0 0 0 1px ${withAlpha(accent, 0.18, 'transparent')}, 0 10px 24px ${withAlpha(accent, 0.14, 'rgba(0,0,0,0.16)')}`
          : `0 8px 18px ${withAlpha(accent, 0.08, 'rgba(0,0,0,0.10)')}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
        position: 'relative',
        color: 'var(--vscode-foreground)',
      }}
    >
      <div
        className="rs-blueprint-header"
        onMouseDown={() => {
          closeAllCanvasContextMenus();
          selectExclusiveNode(id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          closeAllCanvasContextMenus();
          selectExclusiveNode(id);
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          setCtxMenu({ x: e.clientX - rect.left + 8, y: e.clientY - rect.top + 8 });
        }}
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '0 12px',
          borderBottom: `1px solid ${withAlpha(accent, 0.4, 'var(--vscode-panel-border)')}`,
          background: 'transparent',
          pointerEvents: 'all',
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: NODE_HEADER_ICON_SIZE + 1, lineHeight: 1, color: accent }}>⬚</span>
          <span style={{ ...NODE_HEADER_TITLE_STYLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {blueprint.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {definitionMissing && (
            <span
              title={definitionMissingMessage ?? '源蓝图定义未读取成功，当前仅保留实例快照。'}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--vscode-inputValidation-warningForeground)',
                background: 'var(--vscode-inputValidation-warningBackground)',
                border: '1px solid var(--vscode-inputValidation-warningBorder)',
                borderRadius: 999,
                padding: '2px 8px',
                whiteSpace: 'nowrap',
              }}
            >
              源定义缺失
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: accent,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Blueprint
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: 'none',
          gridTemplateColumns: '1.05fr 0.8fr 1.05fr',
          gap: 12,
          padding: '12px 12px 10px',
          background: 'transparent',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700 }}>输入槽位</div>
          {inputSlots.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              当前蓝图没有显式输入槽位。
            </div>
          )}
          {inputSlots.map(slot => (
            <InputSlotRow
              key={slot.id}
              slot={slot}
              count={slotBindings.get(slot.id) ?? 0}
              accent={accent}
              missingRequired={slot.required && (slotBindings.get(slot.id) ?? 0) === 0}
            />
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700 }}>实例状态</div>
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${validationColor}`,
              background: missingRequiredCount === 0
                ? withAlpha(accent, 0.06, 'transparent')
                : 'color-mix(in srgb, var(--vscode-editor-background) 90%, #b89500 10%)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>输入校验</div>
            <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, color: 'var(--vscode-foreground)' }}>{validationLabel}</div>
          </div>
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${withAlpha(accent, 0.26, 'var(--vscode-panel-border)')}`,
              background: withAlpha(accent, 0.04, 'transparent'),
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>实例阶段</div>
              <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700 }}>{instanceStatusLabel}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                disabled={instanceRunBlocked}
                title={runButtonTitle}
                onClick={() => {
                  if (instanceRunBlocked) { return; }
                  postMessage({
                    type: 'runBlueprint',
                    nodeId: blueprint.id,
                    canvas: useCanvasStore.getState().canvasFile ?? undefined,
                  });
                }}
                style={{
                  borderRadius: 6,
                  border: `1px solid ${withAlpha(accent, 0.34, 'var(--vscode-panel-border)')}`,
                  background: instanceRunBlocked
                    ? withAlpha(accent, 0.12, 'transparent')
                    : withAlpha(accent, 0.18, 'transparent'),
                  color: accent,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: instanceRunBlocked ? 'not-allowed' : 'pointer',
                  opacity: instanceRunBlocked ? 0.72 : 1,
                }}
              >
                {cancelRequested ? '◼ 取消中…' : instanceRunning ? '▶ 运行中…' : '▶ 运行'}
              </button>
              {!instanceRunning && (
                <button
                  type="button"
                  disabled={resumeBlocked}
                  title={resumeBlocked
                    ? (lastRunStatus !== 'failed'
                      ? '只有最近一次运行失败时，才可以从失败点继续执行'
                      : !lastIssueNodeId || !instanceFunctionNodeIds.has(lastIssueNodeId)
                        ? '找不到上一次失败的实例内节点'
                        : runButtonTitle)
                    : '从上一次失败节点继续执行，已成功上游默认视为缓存'}
                  onClick={() => {
                    if (resumeBlocked) { return; }
                    postMessage({
                      type: 'runBlueprint',
                      nodeId: blueprint.id,
                      canvas: useCanvasStore.getState().canvasFile ?? undefined,
                      resumeFromFailure: true,
                    });
                  }}
                  style={{
                    borderRadius: 6,
                    border: `1px solid ${resumeBlocked
                      ? 'var(--vscode-panel-border)'
                      : withAlpha(accent, 0.34, 'var(--vscode-panel-border)')}`,
                    background: resumeBlocked
                      ? 'transparent'
                      : withAlpha(accent, 0.08, 'transparent'),
                    color: resumeBlocked ? 'var(--vscode-descriptionForeground)' : accent,
                    padding: '6px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: resumeBlocked ? 'not-allowed' : 'pointer',
                    opacity: resumeBlocked ? 0.68 : 1,
                  }}
                >
                  ↻ 失败后继续
                </button>
              )}
              {instanceRunning && instancePipelineState?.pipelineId && (
                <button
                  type="button"
                  disabled={cancelRequested}
                  title="取消当前蓝图实例运行"
                  onClick={() => {
                    if (cancelRequested) { return; }
                    postMessage({ type: 'pipelineCancel', pipelineId: instancePipelineState.pipelineId });
                    useCanvasStore.getState().setPipelineCancelRequested(true);
                  }}
                  style={{
                    borderRadius: 6,
                    border: '1px solid var(--vscode-inputValidation-errorBorder, #be1100)',
                    background: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
                    color: 'var(--vscode-inputValidation-errorForeground, #f48771)',
                    padding: '6px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: cancelRequested ? 'not-allowed' : 'pointer',
                    opacity: cancelRequested ? 0.72 : 1,
                  }}
                >
                  {cancelRequested ? '◼ 取消中…' : '✕ 取消'}
                </button>
              )}
            </div>
          </div>
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: `1px solid ${withAlpha(accent, 0.24, 'var(--vscode-panel-border)')}`,
              background: withAlpha(accent, 0.04, 'transparent'),
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>总进度</div>
              <div style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {Math.min(instanceSettledCount, instanceTotalCount)}/{instanceTotalCount || '—'}
              </div>
            </div>
            <div
              style={{
                height: 7,
                borderRadius: 999,
                overflow: 'hidden',
                background: 'var(--vscode-progressBar-background, rgba(255,255,255,0.08))',
              }}
            >
              <div
                style={{
                  width: `${Math.round(instanceProgressRatio * 100)}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: progressBarColor,
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <ProgressPill label="完成" value={instanceStatusCounts.done || Number(blueprint.meta?.blueprint_last_run_completed_nodes ?? 0)} tone="success" />
              <ProgressPill label="失败" value={instanceFailedCount} tone="danger" />
              <ProgressPill label="跳过" value={instanceSkippedCount} tone="muted" />
              {instanceRunning && <ProgressPill label="运行中" value={instanceStatusCounts.running} tone="running" />}
              {instanceRunning && <ProgressPill label="等待中" value={instanceStatusCounts.waiting} tone="muted" />}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <Stat label="输入" value={String(blueprint.meta?.blueprint_input_slots ?? '—')} accent={accent} />
            <Stat label="中间" value={String(blueprint.meta?.blueprint_intermediate_slots ?? '—')} accent={accent} />
            <Stat label="输出" value={String(blueprint.meta?.blueprint_output_slots ?? '—')} accent={accent} />
            <Stat label="功能节点" value={String(blueprint.meta?.blueprint_function_count ?? '—')} accent={accent} />
          </div>
          {(instanceRunning || lastRunSummary) && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${instanceRunning
                  ? withAlpha(accent, 0.24, 'var(--vscode-panel-border)')
                  : lastRunStatus === 'failed'
                  ? 'var(--vscode-inputValidation-errorBorder, #be1100)'
                  : withAlpha(accent, 0.24, 'var(--vscode-panel-border)')}`,
                background: instanceRunning
                  ? withAlpha(accent, 0.05, 'transparent')
                  : lastRunStatus === 'failed'
                    ? 'color-mix(in srgb, var(--vscode-editor-background) 90%, #be1100 10%)'
                    : withAlpha(accent, 0.04, 'transparent'),
              }}
            >
              <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                {instanceRunning ? '当前步骤' : '最近运行'}
              </div>
              <div style={{ marginTop: 2, fontSize: 12, fontWeight: 700, lineHeight: 1.45 }}>
                {instanceRunning
                  ? (currentRunningNodeTitle ?? '等待当前层节点完成')
                  : lastRunSummary}
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
                {instanceRunning
                  ? (cancelRequested
                    ? '已发出取消请求，当前节点结束后停止。'
                    : instancePipelineState?.runMode === 'resume' && activeReusedCachedNodeCount > 0
                      ? `本次继续执行已复用 ${activeReusedCachedNodeCount} 个成功上游节点缓存`
                    : activeWarningCount > 0
                      ? `当前预检警告 ${activeWarningCount} 条`
                      : '继续沿实例内部拓扑执行')
                  : `结束时间 ${formatBlueprintRunTime(lastRunFinishedAt)}`}
              </div>
              {!instanceRunning && lastIssueNodeTitle && (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                    问题节点：{lastIssueNodeTitle}
                  </span>
                  {lastIssueNodeId && (
                    <button
                      type="button"
                      onClick={() => selectExclusiveNode(lastIssueNodeId)}
                      style={{
                        borderRadius: 999,
                        border: `1px solid ${withAlpha(accent, 0.28, 'var(--vscode-panel-border)')}`,
                        background: withAlpha(accent, 0.08, 'transparent'),
                        color: accent,
                        padding: '2px 8px',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      定位节点
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {issueCards.length > 0 && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--vscode-inputValidation-errorBorder, #be1100)',
                background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, #be1100 8%)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--vscode-inputValidation-errorForeground, #f48771)' }}>
                错误面板
              </div>
              {issueCards.map(card => (
                <div
                  key={`${card.nodeId ?? 'unknown'}-${card.title}`}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: '1px solid color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #be1100) 72%, transparent)',
                    background: 'color-mix(in srgb, var(--vscode-editor-background) 96%, #be1100 4%)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--vscode-foreground)' }}>{card.title}</span>
                    <span style={{ fontSize: 10, color: 'var(--vscode-inputValidation-errorForeground, #f48771)' }}>{card.kind}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
                    {card.message}
                  </div>
                  {card.nodeId && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => selectExclusiveNode(card.nodeId!)}
                        style={{
                          borderRadius: 999,
                          border: `1px solid ${withAlpha(accent, 0.28, 'var(--vscode-panel-border)')}`,
                          background: withAlpha(accent, 0.08, 'transparent'),
                          color: accent,
                          padding: '2px 8px',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        定位节点
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <RunStamp label="最近成功" value={formatBlueprintRunTime(lastSucceededAt)} accent={accent} tone="success" />
            <RunStamp label="最近失败" value={formatBlueprintRunTime(lastFailedAt)} accent={accent} tone="danger" />
          </div>
          {runHistory.length > 0 && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${withAlpha(accent, 0.22, 'var(--vscode-panel-border)')}`,
                background: withAlpha(accent, 0.035, 'transparent'),
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--vscode-descriptionForeground)' }}>
                实例运行历史
              </div>
              {runHistory.slice(0, 4).map(entry => (
                <div
                  key={entry.id}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: `1px solid ${entry.status === 'failed'
                      ? 'color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #be1100) 50%, transparent)'
                      : withAlpha(accent, 0.18, 'var(--vscode-panel-border)')}`,
                    background: entry.status === 'failed'
                      ? 'color-mix(in srgb, var(--vscode-editor-background) 96%, #be1100 4%)'
                      : withAlpha(accent, 0.03, 'transparent'),
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--vscode-foreground)' }}>
                      {formatBlueprintRunStatusLabel(entry.status)}
                      {entry.mode === 'resume' ? ' · 继续执行' : ' · 全量执行'}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                      {formatBlueprintRunTime(entry.finishedAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
                    {entry.summary}
                  </div>
                  {entry.mode === 'resume' && typeof entry.reusedCachedNodeCount === 'number' && entry.reusedCachedNodeCount > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
                      本次继续执行复用了 {entry.reusedCachedNodeCount} 个成功上游节点缓存。
                    </div>
                  )}
                  {entry.issueNodeTitle && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                        问题节点：{entry.issueNodeTitle}
                      </span>
                      {entry.issueNodeId && (
                        <button
                          type="button"
                          onClick={() => selectExclusiveNode(entry.issueNodeId!)}
                          style={{
                            borderRadius: 999,
                            border: `1px solid ${withAlpha(accent, 0.28, 'var(--vscode-panel-border)')}`,
                            background: withAlpha(accent, 0.08, 'transparent'),
                            color: accent,
                            padding: '2px 8px',
                            fontSize: 10,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          定位
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
            必填输入 {requiredInputCount}，当前已满足 {Math.max(0, requiredInputCount - missingRequiredCount)}。
          </div>
          <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
            重跑语义：当前重新运行会从头开始，已生成的中间/输出节点默认保留，并在新结果产出后逐步替换。
          </div>
          {instanceId && (
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
              实例内节点 {instanceChildren.length} 个，当前容器已替代普通画板作为蓝图实例外壳。
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700 }}>输出槽位</div>
          {outputSlots.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              当前蓝图没有显式输出槽位。
            </div>
          )}
          {outputSlots.map(slot => (
            <OutputSlotRow
              key={slot.id}
              slot={slot}
              count={outputBindings.get(slot.id) ?? 0}
              accent={accent}
              boundNodes={outputBoundNodesBySlot.get(slot.id) ?? []}
              onLocateNode={(nodeId) => selectExclusiveNode(nodeId)}
              lastRunStatus={lastRunStatus}
              instanceRunning={instanceRunning}
              slotIssue={outputSlotIssueMap.get(slot.id)}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          display: 'none',
          padding: '0 12px 10px',
          fontSize: 10,
          color: 'var(--vscode-descriptionForeground)',
          wordBreak: 'break-all',
          lineHeight: 1.45,
        }}
      >
        {blueprint.meta?.blueprint_file_path ?? '未绑定蓝图文件'}
      </div>

      {!instanceId && inputSlots.map((slot, index) => {
        const top = inputSlots.length <= 1
          ? 74
          : 74 + (index * Math.max(44, 132 / Math.max(1, inputSlots.length - 1)));
        return (
          <Handle
            key={slot.id}
            className={NODE_PORT_CLASSNAME}
            type="target"
            position={Position.Left}
            id={slot.id}
            title={getNodePortLabel('in')}
            aria-label={getNodePortLabel('in')}
            data-rs-port-label={getNodePortLabel('in')}
            isConnectable
            isConnectableStart={false}
            isConnectableEnd
            style={{
              ...inputPortStyle,
              top,
            }}
          />
        );
      })}

      {!instanceId && (
        <Handle
          className={NODE_PORT_CLASSNAME}
          type="source"
          position={Position.Right}
          id={NODE_PORT_IDS.out}
          title={getNodePortLabel('out')}
          aria-label={getNodePortLabel('out')}
          data-rs-port-label={getNodePortLabel('out')}
          isConnectable={false}
          isConnectableStart={false}
          isConnectableEnd={false}
          style={{ ...outputPortStyle, opacity: 0 }}
        />
      )}
      {!instanceId && outputSlots.map((slot, index) => {
        const top = outputSlots.length <= 1
          ? 74
          : 74 + (index * Math.max(44, 132 / Math.max(1, outputSlots.length - 1)));
        return (
          <Handle
            key={`out-${slot.id}`}
            className={NODE_PORT_CLASSNAME}
            type="source"
            position={Position.Right}
            id={slot.id}
            title={getNodePortLabel('out')}
            aria-label={getNodePortLabel('out')}
            data-rs-port-label={getNodePortLabel('out')}
            isConnectable={false}
            isConnectableStart={false}
            isConnectableEnd={false}
            style={{
              ...outputPortStyle,
              top,
              opacity: 0.8,
            }}
          />
        );
      })}

      {ctxMenu && (
        <NodeContextMenu
          nodeId={blueprint.id}
          nodeType={blueprint.node_type}
          nodeTitle={blueprint.title || ''}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          canDuplicate={true}
        />
      )}
    </div>
  );
}

function InputSlotRow({
  slot,
  count,
  accent,
  missingRequired,
}: {
  slot: BlueprintSlotDef;
  count: number;
  accent: string;
  missingRequired: boolean;
}) {
  const boundEnough = count > 0 || !slot.required;
  const statusText = count > 0
    ? `已绑定 ${count}`
    : slot.required
      ? '缺少必填输入'
      : '可选未绑定';
  const statusColor = count > 0
    ? accent
    : slot.required
      ? 'var(--vscode-inputValidation-warningForeground, #d7ba7d)'
      : 'var(--vscode-descriptionForeground)';
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${boundEnough ? withAlpha(accent, 0.28, 'var(--vscode-panel-border)') : 'var(--vscode-inputValidation-warningBorder, #b89500)'}`,
        background: boundEnough
          ? withAlpha(accent, 0.05, 'transparent')
          : 'color-mix(in srgb, var(--vscode-editor-background) 90%, #b89500 10%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>{slot.title}</span>
        <span style={{ fontSize: 10, color: statusColor }}>
          {statusText}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4 }}>
        {slot.accepts.join(', ')}
        {slot.required ? ' · 必填' : ' · 可选'}
        {slot.allow_multiple ? ' · 多输入' : ' · 单输入'}
      </div>
      {missingRequired && (
        <div style={{ fontSize: 10, color: 'var(--vscode-inputValidation-warningForeground, #d7ba7d)', lineHeight: 1.4 }}>
          该输入槽位是必填项；补齐后蓝图实例才可运行。
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${withAlpha(accent, 0.3, 'var(--vscode-panel-border)')}`,
        background: withAlpha(accent, 0.06, 'transparent'),
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 13, fontWeight: 700, color: 'var(--vscode-foreground)' }}>{value}</div>
    </div>
  );
}

function OutputSlotRow({
  slot,
  count,
  accent,
  boundNodes,
  onLocateNode,
  lastRunStatus,
  instanceRunning,
  slotIssue,
}: {
  slot: BlueprintSlotDef;
  count: number;
  accent: string;
  boundNodes: CanvasNode[];
  onLocateNode: (nodeId: string) => void;
  lastRunStatus?: CanvasNode['meta']['blueprint_last_run_status'];
  instanceRunning: boolean;
  slotIssue?: OutputSlotIssue;
}) {
  const filled = count > 0;
  const currentNode = boundNodes[boundNodes.length - 1];
  const hasMultiple = boundNodes.length > 1;
  const failedWithoutOutput = !filled && (slotIssue?.kind === 'upstream_failed' || lastRunStatus === 'failed');
  const cancelledWithoutOutput = !filled && lastRunStatus === 'cancelled';
  const waitingForOutput = !filled && (slotIssue?.kind === 'waiting_output' || instanceRunning);
  const border = failedWithoutOutput
    ? 'var(--vscode-inputValidation-errorBorder, #be1100)'
    : waitingForOutput
      ? withAlpha(accent, 0.32, 'var(--vscode-panel-border)')
      : filled
        ? withAlpha(accent, 0.3, 'var(--vscode-panel-border)')
        : withAlpha(accent, 0.22, 'var(--vscode-panel-border)');
  const background = failedWithoutOutput
    ? 'color-mix(in srgb, var(--vscode-editor-background) 90%, #be1100 10%)'
    : waitingForOutput
      ? withAlpha(accent, 0.06, 'transparent')
      : filled
        ? withAlpha(accent, 0.07, 'transparent')
        : withAlpha(accent, 0.04, 'transparent');
  const statusText = filled
    ? (slot.allow_multiple ? `已保留 ${count}` : `已回填 ${count}`)
    : waitingForOutput
      ? '等待产出'
      : failedWithoutOutput
        ? '运行失败，未产出'
        : cancelledWithoutOutput
          ? '运行取消，未产出'
          : '待回填';
  const statusColor = failedWithoutOutput
    ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
    : filled
      ? accent
      : 'var(--vscode-descriptionForeground)';
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${border}`,
        background,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>{slot.title}</span>
        <span style={{ fontSize: 10, color: statusColor }}>
          {statusText}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4 }}>
        {slot.accepts.join(', ')}
        {slot.allow_multiple ? ' · 多输出' : ' · 单输出'}
      </div>
      {currentNode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4 }}>
            {slot.allow_multiple
              ? `当前最新输出：${currentNode.title}${hasMultiple ? `（本槽位共保留 ${count} 个输出）` : ''}`
              : `当前输出：${currentNode.title}${hasMultiple ? '（检测到历史残留，默认定位最新一个）' : ''}`}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button
              type="button"
              onClick={() => onLocateNode(currentNode.id)}
              style={{
                borderRadius: 999,
                border: `1px solid ${withAlpha(accent, 0.28, 'var(--vscode-panel-border)')}`,
                background: withAlpha(accent, 0.08, 'transparent'),
                color: accent,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                }}
              >
                {slot.allow_multiple ? '定位最新输出' : '定位输出'}
              </button>
            {currentNode.file_path && (
              <button
                type="button"
                onClick={() => postMessage({ type: 'openFile', filePath: currentNode.file_path! })}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${withAlpha(accent, 0.28, 'var(--vscode-panel-border)')}`,
                  background: withAlpha(accent, 0.08, 'transparent'),
                  color: accent,
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                打开文件
              </button>
            )}
            {currentNode.file_path && (
              <button
                type="button"
                onClick={() => postMessage({
                  type: 'requestOutputHistory',
                  nodeId: currentNode.id,
                  filePath: currentNode.file_path!,
                  blueprintInstanceId: currentNode.meta?.blueprint_bound_instance_id,
                  blueprintSlotId: currentNode.meta?.blueprint_bound_slot_id,
                  blueprintSlotTitle: slot.title,
                })}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${withAlpha(accent, 0.28, 'var(--vscode-panel-border)')}`,
                  background: withAlpha(accent, 0.08, 'transparent'),
                  color: accent,
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                历史
              </button>
            )}
          </div>
        </div>
      )}
      {!filled && (failedWithoutOutput || cancelledWithoutOutput || waitingForOutput) && (
        <div
          style={{
            marginTop: 2,
            fontSize: 10,
            lineHeight: 1.4,
            color: failedWithoutOutput
              ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
              : 'var(--vscode-descriptionForeground)',
          }}
        >
          {failedWithoutOutput
            ? (slotIssue?.message ?? '该输出槽位在最近一次运行中未成功产出，请优先检查对应上游功能节点与错误面板。')
            : cancelledWithoutOutput
              ? '该输出槽位在最近一次运行被取消前未完成产出。'
              : (slotIssue?.message ?? '该输出槽位正在等待实例内部节点继续产出结果。')}
        </div>
      )}
      {!filled && slotIssue?.relatedNodeTitle && (
        <div
          style={{
            marginTop: 2,
            padding: '6px 8px',
            borderRadius: 8,
            border: `1px solid ${slotIssue.kind === 'upstream_failed'
              ? 'color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #be1100) 70%, transparent)'
              : withAlpha(accent, 0.24, 'var(--vscode-panel-border)')}`,
            background: slotIssue.kind === 'upstream_failed'
              ? 'color-mix(in srgb, var(--vscode-editor-background) 95%, #be1100 5%)'
              : withAlpha(accent, 0.05, 'transparent'),
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: slotIssue.kind === 'upstream_failed'
                  ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
                  : accent,
              }}
            >
              {slotIssue.kind === 'upstream_failed' ? '关联问题节点' : '关联上游节点'}
            </span>
            {slotIssue.relatedIssueKind && (
              <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                {slotIssue.relatedIssueKind}
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--vscode-foreground)', lineHeight: 1.4 }}>
            {slotIssue.relatedNodeTitle}
          </div>
          {slotIssue.relatedNodeMessage && (
            <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4 }}>
              {slotIssue.relatedNodeMessage}
            </div>
          )}
          {slotIssue.relatedNodeId && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => onLocateNode(slotIssue.relatedNodeId!)}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${withAlpha(accent, 0.28, 'var(--vscode-panel-border)')}`,
                  background: withAlpha(accent, 0.08, 'transparent'),
                  color: accent,
                  padding: '2px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {slotIssue.kind === 'upstream_failed' ? '定位问题节点' : '定位上游节点'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunStamp(
  { label, value, accent, tone }: { label: string; value: string; accent: string; tone: 'success' | 'danger' }
) {
  const border = tone === 'danger'
    ? 'var(--vscode-inputValidation-errorBorder, #be1100)'
    : withAlpha(accent, 0.24, 'var(--vscode-panel-border)');
  const background = tone === 'danger'
    ? 'color-mix(in srgb, var(--vscode-editor-background) 92%, #be1100 8%)'
    : withAlpha(accent, 0.04, 'transparent');
  const color = tone === 'danger'
    ? 'var(--vscode-inputValidation-errorForeground, #f48771)'
    : accent;
  return (
    <div
      style={{
        minWidth: 0,
        padding: '6px 8px',
        borderRadius: 999,
        border: `1px solid ${border}`,
        background,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

function ProgressPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'success' | 'danger' | 'muted' | 'running';
}) {
  const colors = tone === 'success'
    ? {
        fg: 'var(--vscode-terminal-ansiGreen)',
        bg: 'color-mix(in srgb, var(--vscode-editor-background) 88%, #2ea043 12%)',
        border: 'color-mix(in srgb, var(--vscode-panel-border) 60%, #2ea043 40%)',
      }
    : tone === 'danger'
      ? {
          fg: 'var(--vscode-terminal-ansiRed)',
          bg: 'color-mix(in srgb, var(--vscode-editor-background) 88%, #be1100 12%)',
          border: 'color-mix(in srgb, var(--vscode-panel-border) 60%, #be1100 40%)',
        }
      : tone === 'running'
        ? {
            fg: 'var(--vscode-terminal-ansiBlue)',
            bg: 'color-mix(in srgb, var(--vscode-editor-background) 88%, #0e70c0 12%)',
            border: 'color-mix(in srgb, var(--vscode-panel-border) 60%, #0e70c0 40%)',
          }
        : {
            fg: 'var(--vscode-descriptionForeground)',
            bg: 'var(--vscode-editor-background)',
            border: 'var(--vscode-panel-border)',
          };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        borderRadius: 999,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.fg,
        padding: '2px 8px',
        fontSize: 10,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </span>
  );
}
