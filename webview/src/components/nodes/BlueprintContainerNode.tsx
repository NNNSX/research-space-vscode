import React, { useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CanvasNode } from '../../../../src/core/canvas-model';
import type { BlueprintSlotDef } from '../../../../src/blueprint/blueprint-types';
import { useCanvasStore } from '../../stores/canvas-store';
import { buildNodePortStyle, getNodePortLabel, NODE_PORT_CLASSNAME, NODE_PORT_IDS } from '../../utils/node-port';
import { closeAllCanvasContextMenus } from '../../utils/context-menu';
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

export function BlueprintContainerNode({ id, data, selected }: NodeProps) {
  const blueprint = data as CanvasNode;
  const accent = blueprint.meta?.blueprint_color ?? '#2f7d68';
  const edges = useCanvasStore(s => s.edges);
  const selectExclusiveNode = useCanvasStore(s => s.selectExclusiveNode);
  const inputSlots = blueprint.meta?.blueprint_input_slot_defs ?? [];
  const outputSlots = blueprint.meta?.blueprint_output_slot_defs ?? [];
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    ensureNodeChromeStyles();
  }, []);

  const slotBindings = useMemo(() => {
    const bindings = new Map<string, number>();
    for (const slot of inputSlots) {
      bindings.set(slot.id, 0);
    }
    for (const edge of edges) {
      if (edge.target !== id || edge.data?.edge_type !== 'data_flow') { continue; }
      const slotId = edge.data?.role ?? edge.targetHandle;
      if (!slotId) { continue; }
      bindings.set(slotId, (bindings.get(slotId) ?? 0) + 1);
    }
    return bindings;
  }, [edges, id, inputSlots]);

  const inputPortStyle = useMemo(() => buildNodePortStyle(accent, 'in'), [accent]);
  const outputPortStyle = useMemo(() => buildNodePortStyle(accent, 'out'), [accent]);
  const requiredInputCount = inputSlots.filter(slot => slot.required).length;
  const missingRequiredCount = inputSlots.filter(slot => slot.required && (slotBindings.get(slot.id) ?? 0) === 0).length;
  const validationLabel = missingRequiredCount === 0 ? '可运行' : `缺少 ${missingRequiredCount} 个必填输入`;
  const validationColor = missingRequiredCount === 0
    ? accent
    : 'var(--vscode-inputValidation-warningBorder, #b89500)';

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAllCanvasContextMenus();
        selectExclusiveNode(id);
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setCtxMenu({ x: e.clientX - rect.left + 8, y: e.clientY - rect.top + 8 });
      }}
      style={{
        width: blueprint.size.width,
        height: blueprint.size.height,
        pointerEvents: 'auto',
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
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '0 12px',
          borderBottom: `1px solid ${withAlpha(accent, 0.4, 'var(--vscode-panel-border)')}`,
          background: 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: NODE_HEADER_ICON_SIZE + 1, lineHeight: 1, color: accent }}>⬚</span>
          <span style={{ ...NODE_HEADER_TITLE_STYLE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {blueprint.title}
          </span>
        </div>
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

      <div
        style={{
          flex: 1,
          display: 'grid',
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <Stat label="输入" value={String(blueprint.meta?.blueprint_input_slots ?? '—')} accent={accent} />
            <Stat label="中间" value={String(blueprint.meta?.blueprint_intermediate_slots ?? '—')} accent={accent} />
            <Stat label="输出" value={String(blueprint.meta?.blueprint_output_slots ?? '—')} accent={accent} />
            <Stat label="功能节点" value={String(blueprint.meta?.blueprint_function_count ?? '—')} accent={accent} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
            必填输入 {requiredInputCount}，当前已满足 {Math.max(0, requiredInputCount - missingRequiredCount)}。
          </div>
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
              accent={accent}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          padding: '0 12px 10px',
          fontSize: 10,
          color: 'var(--vscode-descriptionForeground)',
          wordBreak: 'break-all',
          lineHeight: 1.45,
        }}
      >
        {blueprint.meta?.blueprint_file_path ?? '未绑定蓝图文件'}
      </div>

      {inputSlots.map((slot, index) => {
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
      {outputSlots.map((slot, index) => {
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

function InputSlotRow({ slot, count, accent }: { slot: BlueprintSlotDef; count: number; accent: string }) {
  const boundEnough = count > 0 || !slot.required;
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
        <span style={{ fontSize: 10, color: count > 0 ? accent : 'var(--vscode-descriptionForeground)' }}>
          已绑定 {count}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4 }}>
        {slot.accepts.join(', ')}
        {slot.required ? ' · 必填' : ' · 可选'}
        {slot.allow_multiple ? ' · 多输入' : ' · 单输入'}
      </div>
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

function OutputSlotRow({ slot, accent }: { slot: BlueprintSlotDef; accent: string }) {
  return (
    <div
      style={{
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${withAlpha(accent, 0.22, 'var(--vscode-panel-border)')}`,
        background: withAlpha(accent, 0.04, 'transparent'),
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>{slot.title}</span>
        <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
          输出
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.4 }}>
        {slot.accepts.join(', ')}
      </div>
    </div>
  );
}
