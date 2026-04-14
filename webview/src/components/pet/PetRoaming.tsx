import React from 'react';
import { usePetStore } from '../../stores/pet-store';
import { getPetType, getGroundTheme } from '../../pet/pet-types';
import { PetCharacter } from './PetCharacter';

const ROAMING_WIDTH = 140;
const ROAMING_HEIGHT = 140;
const GROUND_HEIGHT = ROAMING_HEIGHT - 20; // 120px for pet area, 20px for status bar

interface PetRoamingProps {
  dragHandleProps: { onMouseDown: (e: React.MouseEvent) => void };
}

/**
 * Roaming mode — compact floating window where the pet walks around.
 * 140×140px with theme backgrounds, pet character, and a micro status bar.
 */
export function PetRoaming({ dragHandleProps }: PetRoamingProps) {
  const { pet, setMode, groundTheme, assetsBaseUri } = usePetStore();
  const typeDef = getPetType(pet.petType);
  const theme = getGroundTheme(groundTheme);
  const hasBackground = theme.bgFile && assetsBaseUri;
  const bgUrl = hasBackground ? `${assetsBaseUri}/backgrounds/${theme.bgFile}` : '';
  const fgUrl = hasBackground && theme.fgFile ? `${assetsBaseUri}/backgrounds/${theme.fgFile}` : '';

  const moodEmoji = pet.mood > 70 ? '\u{1F60A}' : pet.mood > 35 ? '\u{1F610}' : '\u{1F61E}';

  const handleBubbleClick = () => {
    setMode('chat');
  };

  return (
    <div style={{
      width: ROAMING_WIDTH,
      height: ROAMING_HEIGHT,
      borderRadius: 12,
      overflow: 'visible',  // Allow bubble to overflow widget bounds
      background: 'var(--vscode-sideBar-background)',
      border: '1px solid var(--vscode-panel-border)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Pet ground area — draggable + clip backgrounds but allow bubble overflow */}
      <div
        {...dragHandleProps}
        style={{
        position: 'relative',
        height: GROUND_HEIGHT,
        overflow: 'visible',  // Let bubble overflow upward
        borderRadius: '12px 12px 0 0',
        cursor: 'grab',
        background: hasBackground
          ? 'transparent'
          : 'linear-gradient(180deg, transparent 0%, rgba(34,139,34,0.08) 60%, rgba(34,139,34,0.15) 100%)',
      }}>
        {/* Background layer — clipped to ground area */}
        {bgUrl && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            backgroundImage: `url(${bgUrl})`,
            backgroundRepeat: 'repeat-x',
            backgroundPosition: 'bottom left',
            backgroundSize: 'auto 100%',
            imageRendering: 'pixelated' as any,
            borderRadius: '12px 12px 0 0',
            overflow: 'hidden',
          }} />
        )}

        {/* Fallback ground (no theme) */}
        {!hasBackground && <RoamingFallbackGround />}

        {/* Pet character — bubble overflows upward, click opens chat */}
        <PetCharacter
          renderHeight={48}
          showBubble={true}
          bubbleMaxWidth={120}
          onBubbleClick={handleBubbleClick}
        />

        {/* Foreground layer (depth) — clipped, below bubble */}
        {fgUrl && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            backgroundImage: `url(${fgUrl})`,
            backgroundRepeat: 'repeat-x',
            backgroundPosition: 'bottom left',
            backgroundSize: 'auto 100%',
            imageRendering: 'pixelated' as any,
            pointerEvents: 'none',
            borderRadius: '12px 12px 0 0',
            overflow: 'hidden',
          }} />
        )}
      </div>

      {/* Micro status bar — also serves as drag handle */}
      <div
        {...dragHandleProps}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 6px',
          height: 20,
          fontSize: 9,
          color: 'var(--vscode-descriptionForeground)',
          borderTop: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-sideBar-background)',
          borderRadius: '0 0 12px 12px',
          flexShrink: 0,
          userSelect: 'none',
          cursor: 'grab',
        }}
      >
        {/* Pet name + level */}
        <span style={{ fontWeight: 600, color: 'var(--vscode-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 50 }}>
          {typeDef.emoji}{pet.petName}
        </span>
        <span style={{ opacity: 0.6 }}>Lv.{pet.level}</span>

        {/* Mood */}
        <span title={`心情: ${Math.round(pet.mood)}`}>{moodEmoji}</span>

        <div style={{ flex: 1 }} />

        {/* Chat button */}
        <button
          onClick={(e) => { e.stopPropagation(); setMode('chat'); }}
          title="与宠物对话"
          style={{
            background: 'transparent',
            color: 'var(--vscode-descriptionForeground)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 9,
            padding: '0 2px',
            lineHeight: 1,
          }}
        >
          💬
        </button>

        {/* Minimize button */}
        <button
          onClick={(e) => { e.stopPropagation(); setMode('minimized'); }}
          title="最小化"
          style={{
            background: 'transparent',
            color: 'var(--vscode-descriptionForeground)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 9,
            padding: '0 2px',
            lineHeight: 1,
          }}
        >
          ━
        </button>
      </div>
    </div>
  );
}

/** Fallback ground decoration when no theme is selected */
function RoamingFallbackGround() {
  return (
    <>
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 4,
        background: 'linear-gradient(180deg, rgba(76,175,80,0.25), rgba(76,175,80,0.1))',
        zIndex: 1,
      }} />
      {[10, 35, 60, 85].map((x, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            bottom: 1,
            left: `${x}%`,
            fontSize: 6,
            opacity: 0.3,
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 2,
          }}
        >
          {i % 2 === 0 ? '\u{1F33F}' : '\u{1F331}'}
        </span>
      ))}
    </>
  );
}

export { ROAMING_WIDTH, ROAMING_HEIGHT };
