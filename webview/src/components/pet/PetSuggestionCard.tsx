import React from 'react';
import { usePetStore } from '../../stores/pet-store';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import type { PetSuggestedAction } from '../../pet/pet-brain';

interface PetSuggestionCardProps {
  placement?: 'roaming' | 'canvas';
  anchor?: {
    left: number;
    top: number;
    width: number;
    height: number;
    containerWidth: number;
    containerHeight: number;
  };
}

export function PetSuggestionCard({ placement = 'roaming', anchor }: PetSuggestionCardProps) {
  const card = usePetStore(s => s.activeSuggestionCard);
  const acceptSuggestion = usePetStore(s => s.acceptSuggestion);
  const closeSuggestionCard = usePetStore(s => s.closeSuggestionCard);
  const muteSuggestionKind = usePetStore(s => s.muteSuggestionKind);
  const widgetLeft = usePetStore(s => s.widgetLeft);
  const openSettingsDetailView = useCanvasStore(s => s.openSettingsDetailView);

  if (!card) { return null; }

  const executeAction = (action: PetSuggestedAction) => {
    if (!window.confirm(action.confirmText)) { return; }
    if (action.type === 'create_mindmap') {
      postMessage({ type: 'newMindMap', title: action.payload?.title ?? '结构梳理导图' });
    } else if (action.type === 'create_note') {
      postMessage({ type: 'newNote', title: action.payload?.title ?? '结论整理' });
    } else if (action.type === 'open_ai_settings') {
      openSettingsDetailView('llm');
    } else if (action.type === 'open_pet_settings') {
      openSettingsDetailView('pet');
    }
    acceptSuggestion(card.kind);
  };

  const style = placement === 'canvas'
    ? buildCanvasCardStyle(anchor)
    : buildRoamingCardStyle(widgetLeft);

  return (
    <div
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      style={style}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>宠物建议</div>
      <div>{card.message}</div>
      <div style={{ marginTop: 6, color: 'var(--vscode-descriptionForeground)' }}>
        为什么：{card.reason}
      </div>
      {card.preferenceHint && (
        <div style={{ marginTop: 5, color: 'var(--vscode-descriptionForeground)' }}>
          偏好：{card.preferenceHint}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {card.actions.map(action => (
          <button
            key={action.id}
            onClick={() => executeAction(action)}
            title={`${action.reason}（权限：${action.permission === 'create' ? '创建节点' : '打开面板'}；风险：${action.risk === 'low' ? '低' : '中'}）`}
            style={primaryButtonStyle}
          >
            {action.label}
          </button>
        ))}
        <button onClick={() => closeSuggestionCard(card.kind)} style={secondaryButtonStyle}>稍后</button>
        <button onClick={() => muteSuggestionKind(card.kind)} style={secondaryButtonStyle}>不再提醒</button>
      </div>
      {card.actions.length > 0 && (
        <div style={{ marginTop: 6, color: 'var(--vscode-descriptionForeground)', fontSize: 10 }}>
          操作边界：只会在你确认后执行；不会自动删除、覆盖、连线或运行高成本工具。
        </div>
      )}
    </div>
  );
}

function buildRoamingCardStyle(widgetLeft: number): React.CSSProperties {
  const cardWidth = 260;
  const roamingWidth = 140;
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const preferLeft = widgetLeft + roamingWidth + cardWidth + 20 > viewportWidth;
  return {
    ...baseCardStyle,
    left: preferLeft ? undefined : 'calc(100% + 8px)',
    right: preferLeft ? 'calc(100% + 8px)' : undefined,
    top: 4,
    zIndex: 20,
  };
}

function buildCanvasCardStyle(anchor?: PetSuggestionCardProps['anchor']): React.CSSProperties {
  const cardWidth = 280;
  const cardHeight = 168;
  const preferLeft = !!anchor && anchor.left + anchor.width + cardWidth + 18 > anchor.containerWidth;
  const preferAbove = !!anchor && anchor.top + cardHeight > anchor.containerHeight - 12;

  return {
    ...baseCardStyle,
    width: cardWidth,
    maxWidth: 'min(280px, calc(100vw - 32px))',
    left: preferLeft ? undefined : 'calc(100% + 10px)',
    right: preferLeft ? 'calc(100% + 10px)' : undefined,
    top: preferAbove ? undefined : 0,
    bottom: preferAbove ? 0 : undefined,
    zIndex: 92,
  };
}

const baseCardStyle: React.CSSProperties = {
  position: 'absolute',
  width: 260,
  maxWidth: 'min(260px, calc(100vw - 180px))',
  padding: 10,
  borderRadius: 10,
  border: '1px solid var(--vscode-panel-border)',
  background: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background))',
  color: 'var(--vscode-foreground)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
  fontSize: 11,
  lineHeight: 1.5,
  pointerEvents: 'auto',
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--vscode-button-border, transparent)',
  borderRadius: 999,
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  fontSize: 11,
  padding: '3px 8px',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--vscode-foreground)',
  fontSize: 11,
  padding: '3px 8px',
  cursor: 'pointer',
};
