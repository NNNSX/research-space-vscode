import React, { useCallback, useRef } from 'react';
import { usePetStore } from '../../stores/pet-store';
import { getPetType, animationToGifAction, getGifFilename } from '../../pet/pet-types';
import { PetBubble } from './PetBubble';

interface PetCharacterProps {
  /** Render height in px (48 for roaming, 64 for chat) */
  renderHeight?: number;
  /** Whether to show the bubble above the pet */
  showBubble?: boolean;
  /** Max bubble width — smaller in roaming (120), larger in chat (240) */
  bubbleMaxWidth?: number;
  /** Called when the bubble is clicked (e.g. to expand into chat) */
  onBubbleClick?: () => void;
}

/**
 * Renders the pet using vscode-pets GIF assets.
 * Falls back to emoji when GIF assets are not available.
 */
export function PetCharacter({
  renderHeight = 48,
  showBubble = true,
  bubbleMaxWidth = 120,
  onBubbleClick,
}: PetCharacterProps) {
  const {
    engine,
    pet,
    bubbleText,
    bubbleSuggestionKind,
    handleClick,
    handleDoubleClick,
    handleSwipe,
    acceptSuggestion,
    dismissSuggestion,
    muteSuggestionKind,
    assetsBaseUri,
  } = usePetStore();
  const typeDef = getPetType(pet.petType);
  const swipeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flip = engine.direction === 'left';
  const gifAction = animationToGifAction(engine.animation, typeDef.hasLie);
  const gifFile = getGifFilename(typeDef.gifPrefix, gifAction);
  const gifSrc = assetsBaseUri
    ? `${assetsBaseUri}/${typeDef.gifFolder}/${gifFile}`
    : '';

  const onMouseEnter = useCallback(() => {
    if (swipeTimerRef.current) { return; }
    handleSwipe();
    swipeTimerRef.current = setTimeout(() => {
      swipeTimerRef.current = null;
    }, 3000);
  }, [handleSwipe]);

  return (
    <div
      onClick={(e) => { e.stopPropagation(); handleClick(); }}
      onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClick(); }}
      onMouseEnter={onMouseEnter}
      style={{
        position: 'absolute',
        left: `${engine.positionX}%`,
        bottom: 4,
        transform: 'translateX(-50%)',
        cursor: 'pointer',
        userSelect: 'none',
        zIndex: 3,
        transition: 'left 0.8s ease',
      }}
    >
      {/* Bubble */}
      {showBubble && bubbleText && (
        <PetBubble
          text={bubbleText}
          maxWidth={bubbleMaxWidth}
          onClick={onBubbleClick}
          onAccept={bubbleSuggestionKind ? () => acceptSuggestion(bubbleSuggestionKind) : undefined}
          onLater={bubbleSuggestionKind ? () => dismissSuggestion(bubbleSuggestionKind) : undefined}
          onMute={bubbleSuggestionKind ? () => muteSuggestionKind(bubbleSuggestionKind) : undefined}
        />
      )}

      {/* Pet image (GIF or fallback emoji) */}
      {gifSrc ? (
        <img
          src={gifSrc}
          alt={typeDef.name}
          draggable={false}
          style={{
            height: renderHeight,
            width: renderHeight * 1.6,   // fixed bounding width — widest pet ratio ≈ 1.6:1
            objectFit: 'contain',        // maintain aspect ratio within the box
            objectPosition: 'center bottom',
            imageRendering: 'pixelated',
            transform: flip ? 'scaleX(-1)' : undefined,
            filter: engine.animation === 'sleep' ? 'grayscale(0.3) brightness(0.8)' : undefined,
          }}
        />
      ) : (
        <div
          className="pet-anim-breathe"
          style={{
            fontSize: Math.round(renderHeight * 0.7),
            lineHeight: 1,
            transform: flip ? 'scaleX(-1)' : undefined,
          }}
        >
          {typeDef.emoji}
        </div>
      )}

      {/* Sleep zzZ indicator */}
      {engine.animation === 'sleep' && (
        <div
          className="pet-anim-zzz"
          style={{
            position: 'absolute',
            top: -8,
            right: -8,
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          zzZ
        </div>
      )}
    </div>
  );
}
