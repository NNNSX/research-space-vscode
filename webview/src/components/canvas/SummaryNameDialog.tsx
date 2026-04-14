import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '../../stores/canvas-store';

/** Preset color palette for summary group borders */
export const GROUP_COLOR_PRESETS = [
  { value: '#4fc3f7', label: '蓝' },
  { value: '#81c784', label: '绿' },
  { value: '#ffb74d', label: '橙' },
  { value: '#e57373', label: '红' },
  { value: '#ba68c8', label: '紫' },
  { value: '#fff176', label: '黄' },
  { value: '#4dd0e1', label: '青' },
  { value: '#f06292', label: '粉' },
];

export const DEFAULT_GROUP_COLOR = GROUP_COLOR_PRESETS[0].value;

/**
 * Modal dialog for creating or editing a summary group.
 *
 * Create mode: asks for name + color, then calls createSummary.
 * Edit mode: pre-fills name + color, then calls updateSummary.
 */
export function SummaryNameDialog() {
  const {
    summaryGroups, selectedNodeIds, createSummary, updateSummary,
    setShowSummaryDialog, editingSummaryId, setEditingSummaryId,
  } = useCanvasStore();
  const { getNodesBounds } = useReactFlow();

  // Determine if we're editing an existing group
  const editingGroup = editingSummaryId
    ? summaryGroups.find(g => g.id === editingSummaryId)
    : undefined;

  const [name, setName] = useState(editingGroup?.name ?? '');
  const [color, setColor] = useState(editingGroup?.color ?? DEFAULT_GROUP_COLOR);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const existingNames = new Set(
    summaryGroups.filter(g => g.id !== editingSummaryId).map(g => g.name)
  );

  const handleConfirm = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('名称不能为空');
      return;
    }
    if (existingNames.has(trimmed)) {
      setError('该名称已被使用，请换一个');
      return;
    }

    if (editingGroup) {
      // Edit mode — update name & color
      updateSummary(editingGroup.id, { name: trimmed, color });
      setEditingSummaryId(null);
      setShowSummaryDialog(false);
    } else {
      // Create mode
      const bounds = getNodesBounds(selectedNodeIds);
      createSummary(trimmed, selectedNodeIds, bounds, color);
    }
  }, [name, color, existingNames, editingGroup, selectedNodeIds, createSummary, updateSummary, getNodesBounds, setShowSummaryDialog, setEditingSummaryId]);

  const handleCancel = useCallback(() => {
    setEditingSummaryId(null);
    setShowSummaryDialog(false);
  }, [setShowSummaryDialog, setEditingSummaryId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { handleConfirm(); }
    if (e.key === 'Escape') { handleCancel(); }
  }, [handleConfirm, handleCancel]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onClick={e => { if (e.target === e.currentTarget) { handleCancel(); } }}
    >
      <div
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-widget-border)',
          borderRadius: 8,
          padding: '20px 24px',
          minWidth: 340,
          maxWidth: 440,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--vscode-foreground)' }}>
          {editingGroup ? '编辑归纳' : '归纳节点'}
        </div>
        <div style={{ marginBottom: 14, fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
          {editingGroup
            ? `编辑归纳组「${editingGroup.name}」`
            : `为选中的 ${selectedNodeIds.length} 个节点创建归纳组`}
        </div>

        {/* Name input */}
        <input
          ref={inputRef}
          value={name}
          onChange={e => { setName(e.target.value); setError(''); }}
          onKeyDown={handleKeyDown}
          placeholder="输入归纳名称…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            fontSize: 13,
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: `1px solid ${error ? 'var(--vscode-errorForeground)' : 'var(--vscode-input-border, var(--vscode-widget-border))'}`,
            borderRadius: 4,
            outline: 'none',
          }}
        />

        {error && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--vscode-errorForeground)' }}>
            {error}
          </div>
        )}

        {/* Color picker */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginBottom: 8 }}>
            边框颜色
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {GROUP_COLOR_PRESETS.map(preset => (
              <button
                key={preset.value}
                title={preset.label}
                onClick={() => setColor(preset.value)}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  border: color === preset.value
                    ? '2px solid var(--vscode-foreground)'
                    : '2px solid transparent',
                  background: preset.value,
                  cursor: 'pointer',
                  padding: 0,
                  outline: color === preset.value
                    ? `2px solid ${preset.value}`
                    : 'none',
                  outlineOffset: 1,
                }}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>预览</div>
          <div style={{
            flex: 1,
            height: 28,
            border: `2px dashed ${color}`,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 8,
          }}>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              color,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {name.trim() || '归纳名称'}
            </span>
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={handleCancel}
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              padding: '5px 12px',
            }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: 4,
              padding: '5px 16px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {editingGroup ? '保存' : '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
