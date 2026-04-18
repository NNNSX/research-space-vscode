import React from 'react';
import { usePetStore } from '../../stores/pet-store';
import { getPetType } from '../../pet/pet-types';
import { getPetLevelProgress } from '../../../../src/core/pet-state';

/**
 * Minimized state — 32×32 circle showing the pet emoji.
 * Click to restore to roaming mode.
 */
export function PetMinimized() {
  const { pet, setMode } = usePetStore();
  const typeDef = getPetType(pet.petType);
  const expProgress = getPetLevelProgress(pet.exp, pet.level);

  return (
    <div
      onClick={() => setMode('roaming')}
      title={`${pet.petName} Lv.${pet.level} · ${expProgress.isMaxLevel ? '经验已满' : `本级经验 ${Math.floor(expProgress.currentLevelExp)}/${expProgress.neededExpInLevel}`} — 点击展开`}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'var(--vscode-sideBar-background)',
        border: '1px solid var(--vscode-panel-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: 16,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        userSelect: 'none',
        transition: 'transform 0.15s ease',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.15)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)'; }}
    >
      {typeDef.emoji}
    </div>
  );
}
