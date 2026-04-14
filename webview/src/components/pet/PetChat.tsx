import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePetStore } from '../../stores/pet-store';
import { getPetType, getExpForNextLevel } from '../../pet/pet-types';
import { PetCharacter } from './PetCharacter';

const CHAT_WIDTH = 320;
const CHAT_HEIGHT = 480;

interface PetChatProps {
  dragHandleProps: { onMouseDown: (e: React.MouseEvent) => void };
}

/**
 * Chat mode — expanded panel with conversation bubbles, pet character, and input.
 * No modal overlay — floats directly on the canvas.
 */
export function PetChat({ dragHandleProps }: PetChatProps) {
  const {
    pet, setMode, chatMessages, chatLoading,
    sendChatMessage, clearChat, sessionStartTime,
  } = usePetStore();
  const typeDef = getPetType(pet.petType);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMode('roaming'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setMode]);

  const sessionMin = Math.floor((Date.now() - sessionStartTime) / 60_000);
  const hours = Math.floor(sessionMin / 60);
  const mins = sessionMin % 60;
  const sessionStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const moodEmoji = pet.mood > 70 ? '\u{1F60A}' : pet.mood > 35 ? '\u{1F610}' : '\u{1F61E}';
  const expNext = getExpForNextLevel(pet.level);
  const expPercent = expNext === Infinity ? 100 : Math.min(100, (pet.exp / expNext) * 100);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || chatLoading) { return; }
    sendChatMessage(text);
    setInput('');
  }, [input, chatLoading, sendChatMessage]);

  const handleSuggest = useCallback(() => {
    if (chatLoading) { return; }
    sendChatMessage('请基于画布内容给我一些研究建议');
  }, [chatLoading, sendChatMessage]);

  const handleDailySummary = useCallback(() => {
    if (chatLoading) { return; }
    const totalH = Math.floor(pet.totalWorkMinutes / 60);
    const totalM = Math.round(pet.totalWorkMinutes % 60);
    sendChatMessage(
      `请帮我做一个今日工作总结。` +
      `本次会话已工作 ${sessionMin} 分钟，累计工作 ${totalH}h${totalM}m，` +
      `连续工作 ${pet.streakDays} 天，当前心情 ${Math.round(pet.mood)}，精力 ${Math.round(pet.energy)}。` +
      `请基于画布内容和这些数据，给出简短的每日总结和鼓励。`
    );
  }, [chatLoading, sendChatMessage, pet, sessionMin]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div style={{
      width: CHAT_WIDTH,
      height: CHAT_HEIGHT,
      maxHeight: '80vh',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--vscode-editor-background)',
      border: '1px solid var(--vscode-widget-border)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Title bar — drag handle + collapse */}
      <div
        {...dragHandleProps}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          height: 28,
          fontSize: 11,
          color: 'var(--vscode-foreground)',
          borderBottom: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-sideBar-background)',
          flexShrink: 0,
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        <span style={{ fontWeight: 600 }}>
          {typeDef.emoji} {pet.petName}
        </span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>Lv.{pet.level}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={(e) => { e.stopPropagation(); clearChat(); }}
          title="清除对话"
          style={{
            background: 'transparent',
            color: 'var(--vscode-descriptionForeground)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 10,
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          🗑
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setMode('roaming'); }}
          title="收起对话"
          style={{
            background: 'transparent',
            color: 'var(--vscode-descriptionForeground)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 10,
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Chat messages area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 0,
      }}>
        {chatMessages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            }}
          >
            <span style={{ fontSize: 14, flexShrink: 0, marginTop: 2 }}>
              {msg.role === 'user' ? '\u{1F464}' : typeDef.emoji}
            </span>
            <div style={{
              padding: '6px 10px',
              borderRadius: 8,
              fontSize: 11,
              lineHeight: 1.5,
              maxWidth: '80%',
              wordBreak: 'break-word',
              background: msg.role === 'user'
                ? 'var(--vscode-button-background)'
                : 'var(--vscode-input-background)',
              color: msg.role === 'user'
                ? 'var(--vscode-button-foreground)'
                : 'var(--vscode-foreground)',
            }}>
              {msg.text}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {chatLoading && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 14 }}>{typeDef.emoji}</span>
            <div style={{
              padding: '6px 10px',
              borderRadius: 8,
              fontSize: 11,
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-descriptionForeground)',
            }}>
              思考中...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Pet character area */}
      <div style={{
        position: 'relative',
        height: 80,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        overflow: 'hidden',
        borderTop: '1px solid var(--vscode-panel-border)',
        background: 'linear-gradient(180deg, transparent 0%, rgba(34,139,34,0.05) 100%)',
      }}>
        <PetCharacter renderHeight={64} showBubble={false} />
      </div>

      {/* Quick actions + input area */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        borderTop: '1px solid var(--vscode-panel-border)',
        flexShrink: 0,
      }}>
        {/* Work stats bar */}
        <div style={{
          display: 'flex',
          gap: 8,
          padding: '4px 10px',
          fontSize: 9,
          color: 'var(--vscode-descriptionForeground)',
          background: 'var(--vscode-sideBar-background)',
        }}>
          <span>⏱ 本次 {sessionStr}</span>
          <span>📊 累计 {Math.floor(pet.totalWorkMinutes / 60)}h{Math.round(pet.totalWorkMinutes % 60)}m</span>
          {pet.streakDays > 0 && <span>🔥 连续 {pet.streakDays} 天</span>}
        </div>

        {/* Input row */}
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '6px 10px',
          alignItems: 'center',
        }}>
        {/* Sparkle quick-suggest button */}
        <button
          onClick={handleSuggest}
          disabled={chatLoading}
          title="一键请求画布建议"
          style={{
            background: 'transparent',
            color: chatLoading ? 'var(--vscode-disabledForeground)' : 'var(--vscode-descriptionForeground)',
            border: 'none',
            cursor: chatLoading ? 'default' : 'pointer',
            fontSize: 14,
            padding: '0 2px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✨
        </button>

        {/* Daily summary button */}
        <button
          onClick={handleDailySummary}
          disabled={chatLoading}
          title="生成每日工作总结"
          style={{
            background: 'transparent',
            color: chatLoading ? 'var(--vscode-disabledForeground)' : 'var(--vscode-descriptionForeground)',
            border: 'none',
            cursor: chatLoading ? 'default' : 'pointer',
            fontSize: 14,
            padding: '0 2px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          📋
        </button>

        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={chatLoading}
          style={{
            flex: 1,
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border: '1px solid var(--vscode-input-border, var(--vscode-widget-border))',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            outline: 'none',
            minWidth: 0,
          }}
        />

        <button
          onClick={handleSend}
          disabled={chatLoading || !input.trim()}
          style={{
            padding: '6px 12px',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            cursor: chatLoading || !input.trim() ? 'default' : 'pointer',
            opacity: chatLoading || !input.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          发送
        </button>
        </div>
      </div>

      {/* Status bar — also serves as drag handle */}
      <div
        {...dragHandleProps}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          height: 22,
          fontSize: 9,
          color: 'var(--vscode-descriptionForeground)',
          borderTop: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-sideBar-background)',
          flexShrink: 0,
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        {/* Mood */}
        <span title={`心情: ${Math.round(pet.mood)}`}>{moodEmoji} {Math.round(pet.mood)}</span>

        {/* Energy */}
        <span title={`精力: ${Math.round(pet.energy)}`}>⚡ {Math.round(pet.energy)}</span>

        {/* Exp bar + level */}
        <div
          title={`经验: ${Math.floor(pet.exp)}/${expNext === Infinity ? 'MAX' : expNext}`}
          style={{
            width: 30,
            height: 3,
            borderRadius: 2,
            background: 'var(--vscode-progressBar-background, #333)',
            overflow: 'hidden',
          }}
        >
          <div style={{
            width: `${expPercent}%`,
            height: '100%',
            background: 'var(--vscode-progressBar-background, #0e70c0)',
            borderRadius: 2,
            transition: 'width 0.5s ease',
          }} />
        </div>

        <div style={{ flex: 1 }} />

        <span style={{ opacity: 0.4, cursor: 'grab' }}>⠿ 拖拽</span>
      </div>
    </div>
  );
}

export { CHAT_WIDTH, CHAT_HEIGHT };
