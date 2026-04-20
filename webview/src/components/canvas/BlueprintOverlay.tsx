import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import type { CanvasNode } from '../../../../src/core/canvas-model';
import { useCanvasStore, startBlueprintDrag, endBlueprintDrag } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import { closeAllCanvasContextMenus } from '../../utils/context-menu';
import { buildBlueprintInputSlotBindingMap } from '../../utils/blueprint-bindings';
import {
  NODE_BORDER_WIDTH,
  NODE_HEADER_ICON_SIZE,
  NODE_HEADER_TITLE_STYLE,
  NODE_RADIUS,
  withAlpha,
} from '../../utils/node-chrome';
import { NodeContextMenu } from '../nodes/NodeContextMenu';

interface BlueprintOverlayProps {
  blueprint: CanvasNode;
}

const EMPTY_CANVAS_NODES: CanvasNode[] = [];
const BLUEPRINT_OVERLAY_STYLE_ID = 'rs-blueprint-overlay-animations';

function ensureBlueprintOverlayAnimations() {
  if (typeof document === 'undefined') { return; }
  if (document.getElementById(BLUEPRINT_OVERLAY_STYLE_ID)) { return; }
  const style = document.createElement('style');
  style.id = BLUEPRINT_OVERLAY_STYLE_ID;
  style.textContent = `
    @keyframes rsBlueprintRunPulse {
      0% {
        box-shadow: 0 6px 16px rgba(0,120,255,0.20), 0 0 0 0 rgba(0,173,255,0.00), 0 0 0 1px rgba(255,255,255,0.16) inset;
        transform: translateY(0) scale(1);
      }
      35% {
        box-shadow: 0 8px 18px rgba(0,120,255,0.24), 0 0 0 5px rgba(0,173,255,0.08), 0 0 14px 2px rgba(0,173,255,0.18), 0 0 0 1px rgba(255,255,255,0.18) inset;
        transform: translateY(-0.5px) scale(1.012);
      }
      65% {
        box-shadow: 0 10px 22px rgba(0,120,255,0.28), 0 0 0 10px rgba(0,173,255,0.10), 0 0 18px 3px rgba(0,173,255,0.26), 0 0 0 1px rgba(255,255,255,0.22) inset;
        transform: translateY(-0.75px) scale(1.02);
      }
      100% {
        box-shadow: 0 6px 16px rgba(0,120,255,0.20), 0 0 0 0 rgba(0,173,255,0.00), 0 0 0 1px rgba(255,255,255,0.16) inset;
        transform: translateY(0) scale(1);
      }
    }
    @keyframes rsBlueprintContinuePulse {
      0% {
        box-shadow: 0 6px 16px rgba(255,159,26,0.20), 0 0 0 0 rgba(255,176,32,0.00), 0 0 0 1px rgba(255,255,255,0.14) inset;
        transform: translateY(0) scale(1);
      }
      35% {
        box-shadow: 0 8px 18px rgba(255,159,26,0.24), 0 0 0 5px rgba(255,176,32,0.08), 0 0 14px 2px rgba(255,176,32,0.16), 0 0 0 1px rgba(255,255,255,0.16) inset;
        transform: translateY(-0.5px) scale(1.012);
      }
      65% {
        box-shadow: 0 10px 22px rgba(255,159,26,0.28), 0 0 0 10px rgba(255,176,32,0.10), 0 0 18px 3px rgba(255,176,32,0.24), 0 0 0 1px rgba(255,255,255,0.20) inset;
        transform: translateY(-0.75px) scale(1.02);
      }
      100% {
        box-shadow: 0 6px 16px rgba(255,159,26,0.20), 0 0 0 0 rgba(255,176,32,0.00), 0 0 0 1px rgba(255,255,255,0.14) inset;
        transform: translateY(0) scale(1);
      }
    }
    @keyframes rsBlueprintSearchPulse {
      0% {
        box-shadow: 0 0 0 0 rgba(255,221,87,0.00), 0 0 0 1px rgba(255,221,87,0.34) inset;
      }
      50% {
        box-shadow: 0 0 0 6px rgba(255,221,87,0.14), 0 0 18px 4px rgba(255,221,87,0.18), 0 0 0 1px rgba(255,221,87,0.42) inset;
      }
      100% {
        box-shadow: 0 0 0 0 rgba(255,221,87,0.00), 0 0 0 1px rgba(255,221,87,0.34) inset;
      }
    }
  `;
  document.head.appendChild(style);
}

function BlueprintOverlay({ blueprint }: BlueprintOverlayProps) {
  const selectExclusiveNode = useCanvasStore(s => s.selectExclusiveNode);
  const moveBlueprintInstance = useCanvasStore(s => s.moveBlueprintInstance);
  const nodes = useCanvasStore(s => s.nodes);
  const canvasNodes = useCanvasStore(s => s.canvasFile?.nodes ?? EMPTY_CANVAS_NODES);
  const edges = useCanvasStore(s => s.edges);
  const pipelineState = useCanvasStore(s => s.pipelineState);
  const searchOpen = useCanvasStore(s => s.searchOpen);
  const searchMatches = useCanvasStore(s => s.searchMatches);
  const searchIndex = useCanvasStore(s => s.searchIndex);
  const { screenToFlowPosition } = useReactFlow();
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [pendingLaunchMode, setPendingLaunchMode] = useState<'full' | 'resume' | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const instanceId = blueprint.meta?.blueprint_instance_id;
  const accent = blueprint.meta?.blueprint_color ?? '#2f7d68';
  const inputSlots = blueprint.meta?.blueprint_input_slot_defs ?? [];
  const searchHasMatches = searchOpen && searchMatches.length > 0;
  const searchMatchSet = useMemo(() => new Set(searchMatches), [searchMatches]);
  const currentSearchId = searchIndex >= 0 ? searchMatches[searchIndex] : null;
  const isSearchMatch = searchHasMatches && searchMatchSet.has(blueprint.id);
  const isCurrentSearchMatch = currentSearchId === blueprint.id;
  const overlayOpacity = searchHasMatches && !isSearchMatch ? 0.32 : 1;
  const searchAccent = isCurrentSearchMatch ? '#ffdd57' : 'rgba(255, 221, 87, 0.78)';
  const overlayBorderColor = isSearchMatch ? searchAccent : accent;
  const overlayBoxShadow = isSearchMatch
    ? (isCurrentSearchMatch
      ? '0 0 0 3px rgba(255, 221, 87, 0.26), 0 10px 24px rgba(255, 221, 87, 0.18), 0 0 0 1px rgba(255, 221, 87, 0.30) inset'
      : '0 0 0 2px rgba(255, 221, 87, 0.18), 0 8px 20px rgba(255, 221, 87, 0.12), 0 0 0 1px rgba(255, 221, 87, 0.22) inset')
    : undefined;

  useEffect(() => {
    ensureBlueprintOverlayAnimations();
  }, []);

  useEffect(() => () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const slotBindings = useMemo(() => {
    return buildBlueprintInputSlotBindingMap({
      blueprintNodeId: blueprint.id,
      instanceId,
      inputSlots,
      canvasNodes,
      edges,
    });
  }, [blueprint.id, canvasNodes, edges, inputSlots, instanceId]);

  const internalFunctionNodes = useMemo(() => {
    if (!instanceId) { return []; }
    return canvasNodes.filter(node =>
      node.meta?.blueprint_instance_id === instanceId &&
      node.node_type === 'function'
    );
  }, [canvasNodes, instanceId]);

  const instanceFunctionNodeIds = useMemo(
    () => new Set(internalFunctionNodes.map(node => node.id)),
    [internalFunctionNodes],
  );

  const instancePipelineState = useMemo(() => {
    if (!pipelineState || instanceFunctionNodeIds.size === 0) { return null; }
    const matches = Object.keys(pipelineState.nodeStatuses).some(nodeId => instanceFunctionNodeIds.has(nodeId));
    return matches ? pipelineState : null;
  }, [instanceFunctionNodeIds, pipelineState]);

  const missingRequiredCount = inputSlots.filter(slot => slot.required && (slotBindings.get(slot.id) ?? 0) === 0).length;
  const cancelRequested = !!instancePipelineState?.cancelRequested;
  const lastRunStatus = blueprint.meta?.blueprint_last_run_status;
  const lastIssueNodeId = blueprint.meta?.blueprint_last_issue_node_id;
  const instanceRunning = !!instancePipelineState?.isRunning;
  const instanceRunBlocked = missingRequiredCount > 0 || internalFunctionNodes.length === 0 || !!pipelineState?.isRunning;
  const resumeBlocked =
    instanceRunBlocked ||
    lastRunStatus !== 'failed' ||
    !lastIssueNodeId ||
    !instanceFunctionNodeIds.has(lastIssueNodeId);
  const runButtonTitle = missingRequiredCount > 0
    ? '请先补齐必填输入后再运行'
    : pipelineState?.isRunning
      ? '当前已有 Pipeline / 蓝图执行中'
      : internalFunctionNodes.length === 0
        ? '当前蓝图实例内没有可执行的功能节点'
        : '运行该蓝图实例内部工作流';
  const showStopButton = instanceRunning || countdown !== null;

  const triggerBlueprintRun = useCallback((mode: 'full' | 'resume') => {
    setPendingLaunchMode(mode);
    setCountdown(2);
    let remaining = 2;
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimerRef.current) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        setCountdown(null);
        setPendingLaunchMode(null);
        postMessage({
          type: 'runBlueprint',
          nodeId: blueprint.id,
          canvas: useCanvasStore.getState().canvasFile ?? undefined,
          resumeFromFailure: mode === 'resume',
        });
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }, [blueprint.id]);

  const handleCancelOrStop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
      setCountdown(null);
      setPendingLaunchMode(null);
      return;
    }
    if (instancePipelineState?.pipelineId) {
      postMessage({ type: 'pipelineCancel', pipelineId: instancePipelineState.pipelineId });
      useCanvasStore.getState().setPipelineCancelRequested(true);
    }
  }, [instancePipelineState?.pipelineId]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || !instanceId) { return; }
    e.stopPropagation();
    e.preventDefault();
    closeAllCanvasContextMenus();
    selectExclusiveNode(blueprint.id);
    startBlueprintDrag(instanceId, nodes);

    const startFlow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    let lastFlowX = startFlow.x;
    let lastFlowY = startFlow.y;

    const handleMouseMove = (ev: MouseEvent) => {
      const currentFlow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const dx = currentFlow.x - lastFlowX;
      const dy = currentFlow.y - lastFlowY;
      lastFlowX = currentFlow.x;
      lastFlowY = currentFlow.y;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
        moveBlueprintInstance(instanceId, dx, dy);
      }
    };

    const handleMouseUp = () => {
      setDragging(false);
      endBlueprintDrag();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    setDragging(true);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [blueprint.id, instanceId, moveBlueprintInstance, nodes, screenToFlowPosition, selectExclusiveNode]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    closeAllCanvasContextMenus();
    selectExclusiveNode(blueprint.id);
    const rect = rootRef.current?.getBoundingClientRect();
    setCtxMenu({
      x: rect ? e.clientX - rect.left + 8 : 12,
      y: rect ? e.clientY - rect.top + 8 : 12,
    });
  }, [blueprint.id, selectExclusiveNode]);

  return (
    <>
      <div
        ref={rootRef}
        style={{
          position: 'absolute',
          left: blueprint.position.x,
          top: blueprint.position.y,
          width: blueprint.size.width,
          height: blueprint.size.height,
          pointerEvents: 'none',
          borderRadius: NODE_RADIUS,
          border: `${NODE_BORDER_WIDTH}px solid ${overlayBorderColor}`,
          boxSizing: 'border-box',
          overflow: 'visible',
          opacity: overlayOpacity,
          boxShadow: overlayBoxShadow,
          animation: isCurrentSearchMatch ? 'rsBlueprintSearchPulse 1.8s ease-in-out infinite' : undefined,
          transition: 'opacity 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
        }}
      >
        <div
          onMouseDown={handleDragStart}
          onContextMenu={handleContextMenu}
          style={{
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '0 12px',
            borderBottom: `1px solid ${withAlpha(accent, 0.4, 'var(--vscode-panel-border)')}`,
            color: 'var(--vscode-foreground)',
            pointerEvents: 'auto',
            userSelect: 'none',
            cursor: dragging ? 'grabbing' : 'grab',
            background: isSearchMatch
              ? (isCurrentSearchMatch
                ? 'rgba(255, 221, 87, 0.12)'
                : 'rgba(255, 221, 87, 0.08)')
              : 'transparent',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: NODE_HEADER_ICON_SIZE + 1, lineHeight: 1, color: accent }}>⬚</span>
            <span style={{ ...NODE_HEADER_TITLE_STYLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {blueprint.title}
            </span>
            {isSearchMatch && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 7px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  color: isCurrentSearchMatch ? '#332400' : '#4a3900',
                  background: isCurrentSearchMatch ? '#ffdd57' : 'rgba(255, 221, 87, 0.72)',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.16)',
                }}
              >
                {isCurrentSearchMatch ? '当前命中' : '搜索命中'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
            {instanceRunning && instancePipelineState?.pipelineId ? (
              <button
                type="button"
                disabled={cancelRequested}
                title="停止当前蓝图实例运行"
                onMouseDown={e => e.stopPropagation()}
                onClick={handleCancelOrStop}
                style={headerActionButtonStyle('danger', accent, cancelRequested, true)}
              >
                {cancelRequested ? '停止中…' : '停止'}
              </button>
            ) : (
              <>
                {showStopButton ? (
                  <button
                    type="button"
                    disabled={countdown === null && !instancePipelineState?.pipelineId}
                    title={countdown !== null ? '2 秒内可取消本次蓝图运行' : '停止当前蓝图实例运行'}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={handleCancelOrStop}
                    style={headerActionButtonStyle('danger', accent, countdown === null && !instancePipelineState?.pipelineId, true)}
                  >
                    {countdown !== null
                      ? `取消 (${countdown}s)${pendingLaunchMode === 'resume' ? ' · 继续' : ''}`
                      : (cancelRequested ? '停止中…' : '停止')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={instanceRunBlocked}
                      title={runButtonTitle}
                      onMouseDown={e => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (instanceRunBlocked) { return; }
                        triggerBlueprintRun('full');
                      }}
                      style={headerActionButtonStyle('run', accent, instanceRunBlocked, false, !instanceRunBlocked)}
                    >
                      运行
                    </button>
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
                      onMouseDown={e => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (resumeBlocked) { return; }
                        triggerBlueprintRun('resume');
                      }}
                      style={headerActionButtonStyle('continue', accent, resumeBlocked, false, !resumeBlocked)}
                    >
                      继续
                    </button>
                  </>
                )}
              </>
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
      </div>

      {ctxMenu && (
        <NodeContextMenu
          nodeId={blueprint.id}
          nodeType={blueprint.node_type}
          nodeTitle={blueprint.title || ''}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          extraActions={[
            {
              label: '🧬 基于当前实例另存为新蓝图',
              onClick: () => {
                postMessage({
                  type: 'createBlueprintDraftFromInstance',
                  nodeId: blueprint.id,
                  canvas: useCanvasStore.getState().canvasFile ?? undefined,
                });
              },
            },
          ]}
        />
      )}
    </>
  );
}

export function BlueprintOverlays() {
  const canvasNodes = useCanvasStore(s => s.canvasFile?.nodes);
  const blueprints = useMemo(
    () => (canvasNodes ?? EMPTY_CANVAS_NODES).filter(node => node.node_type === 'blueprint' && !!node.meta?.blueprint_instance_id),
    [canvasNodes],
  );
  if (blueprints.length === 0) { return null; }
  return (
    <ViewportPortal>
      <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none' }}>
        {blueprints.map(blueprint => (
          <BlueprintOverlay key={blueprint.id} blueprint={blueprint} />
        ))}
      </div>
    </ViewportPortal>
  );
}

function headerActionButtonStyle(
  kind: 'run' | 'continue' | 'danger',
  accent: string,
  disabled: boolean,
  danger = false,
  emphasize = false,
): React.CSSProperties {
  const primaryBackground = 'linear-gradient(135deg, #12b5ff 0%, #0078ff 100%)';
  const primaryForeground = '#f8fcff';
  const continueBackground = 'linear-gradient(135deg, #ffd85a 0%, #ff9f1a 100%)';
  const continueForeground = '#241400';
  const background = danger
    ? 'linear-gradient(135deg, #ff7a6b 0%, #d92d20 100%)'
    : kind === 'continue'
      ? continueBackground
      : primaryBackground;
  const foreground = danger
    ? '#fff6f4'
    : kind === 'continue'
      ? continueForeground
      : primaryForeground;
  const borderColor = danger
    ? '#ffb4ab'
    : kind === 'continue'
      ? '#ffe08a'
      : '#8ad8ff';
  return {
    borderRadius: 999,
    border: `1px solid ${borderColor}`,
    background,
    color: foreground,
    padding: '5px 12px',
    minWidth: 54,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.02em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.68 : 1,
    boxShadow: disabled
      ? undefined
      : danger
        ? '0 6px 16px rgba(217,45,32,0.26), 0 0 0 1px rgba(255,255,255,0.10) inset'
        : kind === 'continue'
          ? '0 8px 18px rgba(255,159,26,0.24), 0 0 0 1px rgba(255,255,255,0.16) inset'
          : '0 8px 18px rgba(0,120,255,0.24), 0 0 0 1px rgba(255,255,255,0.16) inset',
    textShadow: disabled ? 'none' : '0 1px 1px rgba(0,0,0,0.18)',
    transition: 'transform 220ms ease, box-shadow 260ms ease, filter 220ms ease, opacity 160ms ease',
    willChange: !disabled && emphasize ? 'transform, box-shadow' : undefined,
    animation: !disabled && emphasize
      ? (kind === 'continue'
        ? 'rsBlueprintContinuePulse 2.35s cubic-bezier(0.22, 0.61, 0.36, 1) infinite'
        : 'rsBlueprintRunPulse 2.35s cubic-bezier(0.22, 0.61, 0.36, 1) infinite')
      : undefined,
  };
}
