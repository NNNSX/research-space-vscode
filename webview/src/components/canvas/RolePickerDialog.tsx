import React from 'react';
import type { SlotDef } from '../../../../src/core/canvas-model';

interface RolePickerDialogProps {
  sourceTitle: string;
  targetToolName: string;
  slots: SlotDef[];
  onSelect: (role: string | undefined) => void;
  onCancel: () => void;
}

export function RolePickerDialog({
  sourceTitle,
  targetToolName,
  slots,
  onSelect,
  onCancel,
}: RolePickerDialogProps) {
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
      onClick={e => { if (e.target === e.currentTarget) { onCancel(); } }}
    >
      <div
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-widget-border)',
          borderRadius: 8,
          padding: '20px 24px',
          minWidth: 340,
          maxWidth: 480,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--vscode-foreground)' }}>
          为这条连线选择角色
        </div>
        <div style={{ marginBottom: 16, fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
          <span style={{ fontStyle: 'italic' }}>{sourceTitle}</span>
          {' → '}
          <span style={{ fontStyle: 'italic' }}>{targetToolName}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {slots.map(slot => (
            <button
              key={slot.name}
              onClick={() => onSelect(slot.name)}
              style={{
                textAlign: 'left',
                background: 'var(--vscode-button-secondaryBackground)',
                color: 'var(--vscode-button-secondaryForeground)',
                border: '1px solid var(--vscode-button-border, transparent)',
                borderRadius: 5,
                padding: '8px 12px',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  'var(--vscode-button-secondaryHoverBackground)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background =
                  'var(--vscode-button-secondaryBackground)';
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                {slot.label}
                {slot.required && (
                  <span style={{ color: 'var(--vscode-errorForeground)', marginLeft: 4 }}>*</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
                {slot.description}
              </div>
            </button>
          ))}

          {/* Generic / no-role option */}
          <button
            onClick={() => onSelect(undefined)}
            style={{
              textAlign: 'left',
              background: 'transparent',
              color: 'var(--vscode-foreground)',
              border: '1px solid var(--vscode-widget-border)',
              borderRadius: 5,
              padding: '8px 12px',
              cursor: 'pointer',
              opacity: 0.7,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '1';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '0.7';
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>通用输入</div>
            <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
              不指定角色，AI 将按顺序拼接所有输入（原有行为）
            </div>
          </button>
        </div>

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              color: 'var(--vscode-descriptionForeground)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              padding: '4px 8px',
            }}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
