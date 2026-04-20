import React, { useMemo, useRef, useState } from 'react';
import type { BlueprintDataNodeDef, BlueprintDraft, BlueprintSlotDef } from '../../../../src/blueprint/blueprint-types';
import type { BlueprintRegistryEntry } from '../../../../src/blueprint/blueprint-registry';
import { getBlueprintDraftSummary } from '../../../../src/blueprint/blueprint-types';
import { optimizeBlueprintDefinitionLayout } from '../../../../src/blueprint/blueprint-layout';

interface CreateBlueprintDialogProps {
  draft: BlueprintDraft;
  existingBlueprints: BlueprintRegistryEntry[];
  onSave: (draft: BlueprintDraft) => void;
  onClose: () => void;
}

function patchSlot(
  slots: BlueprintSlotDef[],
  slotId: string,
  patch: Partial<BlueprintSlotDef>,
): BlueprintSlotDef[] {
  return slots.map(slot => slot.id === slotId ? { ...slot, ...patch } : slot);
}

function buildBlueprintCopyTitle(title: string, existingTitles: Set<string>): string {
  const baseTitle = (title.trim() || '新蓝图').replace(/\s*-\s*副本(?:\s+\d+)?$/, '');
  const firstCandidate = `${baseTitle} - 副本`;
  if (!existingTitles.has(firstCandidate)) { return firstCandidate; }
  let index = 2;
  while (existingTitles.has(`${baseTitle} - 副本 ${index}`)) {
    index += 1;
  }
  return `${baseTitle} - 副本 ${index}`;
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--vscode-foreground)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  fontSize: 12,
  boxSizing: 'border-box',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  borderRadius: 999,
  fontSize: 10,
  border: '1px solid var(--vscode-panel-border)',
  color: 'var(--vscode-descriptionForeground)',
};

export function CreateBlueprintDialog({
  draft,
  existingBlueprints,
  onSave,
  onClose,
}: CreateBlueprintDialogProps) {
  const [workingDraft, setWorkingDraft] = useState<BlueprintDraft>(draft);
  const [optimizeLayoutOnSave, setOptimizeLayoutOnSave] = useState(true);
  const backdropMouseDownRef = useRef(false);
  const summary = useMemo(() => getBlueprintDraftSummary(workingDraft), [workingDraft]);
  const existingTitles = useMemo(
    () => new Set(existingBlueprints.map(entry => entry.title.trim())),
    [existingBlueprints],
  );
  const duplicateName = existingBlueprints.some(entry =>
    entry.title.trim() === workingDraft.title.trim() &&
    entry.file_path !== workingDraft.source_file_path
  );
  const titleError = !workingDraft.title.trim()
    ? '蓝图名称不能为空。'
    : (duplicateName ? '已存在同名蓝图，请先改名。' : '');
  const isEditingExistingBlueprint = workingDraft.source_mode === 'edit' && !!workingDraft.source_file_path;

  const setSlotField = (
    slotId: string,
    kind: 'input' | 'intermediate' | 'output',
    patch: Partial<BlueprintSlotDef>,
  ) => {
    setWorkingDraft(current => ({
      ...current,
      input_slots: kind === 'input' ? patchSlot(current.input_slots, slotId, patch) : current.input_slots,
      intermediate_slots: kind === 'intermediate' ? patchSlot(current.intermediate_slots, slotId, patch) : current.intermediate_slots,
      output_slots: kind === 'output' ? patchSlot(current.output_slots, slotId, patch) : current.output_slots,
    }));
  };

  const slotEditor = (slot: BlueprintSlotDef) => (
    <div
      key={slot.id}
      style={{
        display: 'grid',
        gridTemplateColumns: '1.1fr 0.9fr',
        gap: 8,
        padding: 10,
        borderRadius: 8,
        border: '1px solid var(--vscode-panel-border)',
        background: 'color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-button-secondaryBackground) 10%)',
      }}
    >
      <div>
        <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>名称</div>
        <input
          value={slot.title}
          onChange={event => setSlotField(slot.id, slot.kind, { title: event.target.value })}
          style={inputStyle}
        />
      </div>
      <div>
        <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>接受类型</div>
        <div style={{ ...inputStyle, minHeight: 32 }}>{slot.accepts.join(', ')}</div>
      </div>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span style={badgeStyle}>{slot.kind === 'input' ? '输入占位' : slot.kind === 'output' ? '输出占位' : '中间语义'}</span>
        <span style={badgeStyle}>{slot.placeholder_style === 'input_placeholder' ? '输入样式' : '输出样式'}</span>
        <span style={badgeStyle}>
          {slot.kind === 'input'
            ? '通过连线传递'
            : slot.replacement_mode === 'replace_with_bound_node'
              ? '运行后回填'
              : '通过连线附着'}
        </span>
      </div>
      {slot.binding_hint && (
        <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
          {slot.binding_hint}
        </div>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
        <input
          type="checkbox"
          checked={slot.required}
          onChange={event => setSlotField(slot.id, slot.kind, { required: event.target.checked })}
        />
        必填
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
        <input
          type="checkbox"
          checked={slot.allow_multiple}
          onChange={event => setSlotField(slot.id, slot.kind, { allow_multiple: event.target.checked })}
        />
        允许多输入
      </label>
    </div>
  );

  const renderDataNodeSection = (title: string, nodes: BlueprintDataNodeDef[]) => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={sectionTitleStyle}>{title}</div>
      {nodes.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>当前没有需要保留的内部数据节点。</div>
      )}
      {nodes.map(node => (
        <div
          key={node.id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--vscode-panel-border)',
            background: 'color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-button-secondaryBackground) 10%)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11 }}>
            <span style={{ fontWeight: 700 }}>{node.title}</span>
            <span style={{ color: 'var(--vscode-descriptionForeground)' }}>{node.node_type}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={badgeStyle}>保留为内部节点</span>
            {node.source_function_node_id && <span style={badgeStyle}>来源功能节点 {node.source_function_node_id}</span>}
          </div>
        </div>
      ))}
    </section>
  );

  const renderSlotSection = (title: string, slots: BlueprintSlotDef[]) => (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={sectionTitleStyle}>{title}</div>
      {slots.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>当前没有此类槽位。</div>
      )}
      {slots.map(slotEditor)}
    </section>
  );

  const handlePrimarySave = () => {
    onSave(optimizeLayoutOnSave ? optimizeBlueprintDefinitionLayout(workingDraft) : workingDraft);
  };

  const handleSaveAsNew = () => {
    const copiedDraft: BlueprintDraft = {
      ...workingDraft,
      title: buildBlueprintCopyTitle(workingDraft.title, existingTitles),
      source_file_path: undefined,
      source_mode: 'create',
    };
    onSave(optimizeLayoutOnSave ? optimizeBlueprintDefinitionLayout(copiedDraft) : copiedDraft);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.48)',
      }}
      onMouseDown={event => {
        backdropMouseDownRef.current = event.target === event.currentTarget;
      }}
      onClick={event => {
        if (backdropMouseDownRef.current && event.target === event.currentTarget) {
          onClose();
        }
        backdropMouseDownRef.current = false;
      }}
    >
      <div
        onMouseDown={() => {
          backdropMouseDownRef.current = false;
        }}
        style={{
          width: 'min(960px, calc(100vw - 40px))',
          maxHeight: 'min(820px, calc(100vh - 40px))',
          overflow: 'auto',
          padding: 18,
          borderRadius: 12,
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          boxShadow: '0 16px 44px rgba(0,0,0,0.38)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--vscode-foreground)' }}>
              {isEditingExistingBlueprint ? '编辑蓝图' : '创建蓝图'}
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}>
              {isEditingExistingBlueprint
                ? '当前正在编辑已保存蓝图。保存后会覆盖原蓝图；如果改名，会同步改成新的蓝图文件名。'
                : '当前蓝图会保存原始 pipeline 结构信息，区分输入/输出占位和保留的内部数据节点；保存后会写入工作区 `blueprints/` 目录。'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              padding: '2px 4px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--vscode-button-secondaryBackground)', fontSize: 11 }}>输入槽位 {summary.input_count}</div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--vscode-button-secondaryBackground)', fontSize: 11 }}>中间槽位 {summary.intermediate_count}</div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--vscode-button-secondaryBackground)', fontSize: 11 }}>输出槽位 {summary.output_count}</div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--vscode-button-secondaryBackground)', fontSize: 11 }}>内部数据节点 {summary.data_node_count}</div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--vscode-button-secondaryBackground)', fontSize: 11 }}>功能节点 {summary.function_count}</div>
          <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--vscode-button-secondaryBackground)', fontSize: 11 }}>边 {summary.edge_count}</div>
        </div>

        <section style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
          <div>
            <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>蓝图名称</div>
            <input
              value={workingDraft.title}
              onChange={event => setWorkingDraft(current => ({ ...current, title: event.target.value }))}
              style={inputStyle}
            />
            {titleError && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--vscode-errorForeground)' }}>{titleError}</div>}
          </div>
          <div>
            <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>颜色</div>
            <input
              value={workingDraft.color}
              onChange={event => setWorkingDraft(current => ({ ...current, color: event.target.value }))}
              style={inputStyle}
            />
          </div>
        </section>

        <section>
          <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>描述</div>
          <textarea
            value={workingDraft.description ?? ''}
            onChange={event => setWorkingDraft(current => ({ ...current, description: event.target.value }))}
            style={{ ...inputStyle, minHeight: 84, resize: 'vertical' }}
          />
        </section>

        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--vscode-panel-border)',
            background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-button-secondaryBackground) 8%)',
          }}
        >
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={optimizeLayoutOnSave}
              onChange={event => setOptimizeLayoutOnSave(event.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--vscode-foreground)' }}>
                保存时优化内部布局
              </span>
              <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.55 }}>
                默认开启。保存蓝图时会自动整理输入占位、功能节点、中间结果和输出占位的排布，
                让实例化后的 pipeline 更规整；不会改动你当前画布上的原始节点位置。
              </span>
            </span>
          </label>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {renderSlotSection('输入槽位', workingDraft.input_slots)}
            {renderSlotSection('中间槽位', workingDraft.intermediate_slots)}
            {renderDataNodeSection('保留的内部数据节点', workingDraft.data_nodes)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {renderSlotSection('输出槽位', workingDraft.output_slots)}

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={sectionTitleStyle}>功能节点</div>
              {workingDraft.function_nodes.map(node => (
                <div
                  key={node.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-button-secondaryBackground) 10%)',
                    fontSize: 11,
                  }}
                >
                  <span>{node.title}</span>
                  <span>{node.tool_id}</span>
                </div>
              ))}
            </section>

            {workingDraft.issues.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={sectionTitleStyle}>识别问题</div>
                {workingDraft.issues.map((issue, index) => (
                  <div
                    key={`${issue.code}-${index}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--vscode-inputValidation-warningBorder, #b89500)',
                      background: 'color-mix(in srgb, var(--vscode-editor-background) 88%, #b89500 12%)',
                      fontSize: 11,
                    }}
                  >
                    {issue.message}
                  </div>
                ))}
              </section>
            )}

            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={sectionTitleStyle}>实例化语义预览</div>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--vscode-panel-border)',
                  background: 'color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-button-secondaryBackground) 8%)',
                  fontSize: 11,
                  color: 'var(--vscode-descriptionForeground)',
                  lineHeight: 1.6,
                }}
              >
                实例化时会恢复原始功能节点与内部数据节点结构；输入槽位和输出槽位会先以占位框存在，输入通过连线传递，输出在运行后回填。
              </div>
            </section>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
            已有蓝图 {existingBlueprints.length} 个。保存后会立即刷新索引。
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                color: 'var(--vscode-descriptionForeground)',
                border: '1px solid var(--vscode-panel-border)',
                borderRadius: 6,
                padding: '7px 14px',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              取消
            </button>
            {isEditingExistingBlueprint && (
              <button
                onClick={handleSaveAsNew}
                style={{
                  background: 'var(--vscode-button-secondaryBackground)',
                  color: 'var(--vscode-button-secondaryForeground)',
                  border: '1px solid var(--vscode-panel-border)',
                  borderRadius: 6,
                  padding: '7px 14px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                另存为新蓝图
              </button>
            )}
            <button
              onClick={handlePrimarySave}
              disabled={!!titleError}
              style={{
                background: titleError ? 'var(--vscode-button-secondaryBackground)' : 'var(--vscode-button-background)',
                color: titleError ? 'var(--vscode-descriptionForeground)' : 'var(--vscode-button-foreground)',
                border: 'none',
                borderRadius: 6,
                padding: '7px 14px',
                cursor: titleError ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {isEditingExistingBlueprint ? '保存修改' : '保存蓝图'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
