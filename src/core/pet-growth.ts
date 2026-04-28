import type { PetState, PetTypeId } from './canvas-model';
import { PET_UNLOCK_LEVELS, getPetLevelProgress } from './pet-state';

export type PetGrowthMilestoneKind = 'companion' | 'awareness' | 'memory' | 'suggestion' | 'pet';

export interface PetGrowthMilestone {
  id: string;
  level: number;
  kind: PetGrowthMilestoneKind;
  title: string;
  description: string;
  unlocked: boolean;
}

export interface PetWorkRhythmSummary {
  totalWorkMinutes: number;
  totalWorkHours: number;
  currentSessionMinutes: number;
  rhythmLabel: string;
  rhythmHint: string;
}

export interface PetGrowthSummary {
  stageLabel: string;
  progressPercent: number;
  currentLevelExp: number;
  neededExpInLevel: number;
  remainingToNextLevel: number;
  isMaxLevel: boolean;
  unlockedMilestones: PetGrowthMilestone[];
  upcomingMilestones: PetGrowthMilestone[];
  nextMilestone: PetGrowthMilestone | null;
  workRhythm: PetWorkRhythmSummary;
}

const PET_TYPE_NAMES: Record<PetTypeId, string> = {
  dog: '像素狗',
  fox: '像素狐狸',
  'rubber-duck': '橡皮鸭',
  turtle: '像素龟',
  crab: '像素蟹',
  clippy: '曲别针',
  cockatiel: '鹦鹉',
};

const COMPANION_MILESTONES: Array<Omit<PetGrowthMilestone, 'unlocked'>> = [
  {
    id: 'companion-basic',
    level: 1,
    kind: 'companion',
    title: '基础陪伴',
    description: '可在画布旁陪伴、互动、聊天，并记录基础心情与工作状态。',
  },
  {
    id: 'canvas-awareness',
    level: 2,
    kind: 'awareness',
    title: '画布感知',
    description: '能感知节点新增、AI 运行、错误和连接等轻量事件。',
  },
  {
    id: 'quiet-suggestions',
    level: 4,
    kind: 'suggestion',
    title: '低打扰建议',
    description: '开始根据画布事件给出整理、导图和错误恢复建议。',
  },
  {
    id: 'canvas-follow',
    level: 5,
    kind: 'companion',
    title: '全画布跟随',
    description: '可作为画布内轻量伙伴，跟随选中节点或停靠视口边缘。',
  },
  {
    id: 'local-memory',
    level: 6,
    kind: 'memory',
    title: '本地记忆',
    description: '能在本地保存轻量偏好摘要，帮助后续建议更贴近你的习惯。',
  },
  {
    id: 'explainable-card',
    level: 8,
    kind: 'suggestion',
    title: '可解释建议卡片',
    description: '建议会说明原因、候选动作和操作边界，仍然只在确认后执行。',
  },
  {
    id: 'mature-companion',
    level: 10,
    kind: 'companion',
    title: '成熟研究伙伴',
    description: '能更稳定地陪伴长周期论文、项目书和专利写作流程。',
  },
];

function getStageLabel(level: number): string {
  if (level >= 10) { return '成熟研究伙伴'; }
  if (level >= 8) { return '可解释建议伙伴'; }
  if (level >= 6) { return '本地记忆伙伴'; }
  if (level >= 4) { return '画布整理伙伴'; }
  if (level >= 2) { return '画布感知伙伴'; }
  return '基础陪伴伙伴';
}

function getRhythmLabel(sessionMinutes: number): string {
  if (sessionMinutes >= 120) { return '长时段深度工作'; }
  if (sessionMinutes >= 60) { return '稳定专注'; }
  if (sessionMinutes >= 25) { return '短时段推进'; }
  return '刚开始进入状态';
}

function getRhythmHint(sessionMinutes: number): string {
  if (sessionMinutes >= 120) { return '建议适当休息，把当前结论先落到笔记或导图里。'; }
  if (sessionMinutes >= 60) { return '已经形成连续工作段，可以考虑做一次阶段性整理。'; }
  if (sessionMinutes >= 25) { return '适合继续围绕当前节点推进，不需要急着切换任务。'; }
  return '先把材料或问题放上画布，宠物会保持低打扰陪伴。';
}

export function buildPetGrowthMilestones(level: number): PetGrowthMilestone[] {
  const petMilestones: Array<Omit<PetGrowthMilestone, 'unlocked'>> = Object.entries(PET_UNLOCK_LEVELS).map(([petType, unlockLevel]) => ({
    id: `pet-${petType}`,
    level: unlockLevel,
    kind: 'pet' as const,
    title: `解锁${PET_TYPE_NAMES[petType as PetTypeId]}`,
    description: `可选择${PET_TYPE_NAMES[petType as PetTypeId]}作为画布陪伴角色。`,
  }));

  return [...COMPANION_MILESTONES, ...petMilestones]
    .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
    .map(milestone => ({
      ...milestone,
      unlocked: level >= milestone.level,
    }));
}

export function getPetWorkRhythmSummary(pet: Pick<PetState, 'totalWorkMinutes' | 'currentSessionStart'>, nowMs = Date.now()): PetWorkRhythmSummary {
  const totalWorkMinutes = Math.max(0, Math.floor(pet.totalWorkMinutes || 0));
  const sessionStartMs = Date.parse(pet.currentSessionStart);
  const currentSessionMinutes = Number.isFinite(sessionStartMs)
    ? Math.max(0, Math.floor((nowMs - sessionStartMs) / 60_000))
    : 0;

  return {
    totalWorkMinutes,
    totalWorkHours: Math.floor(totalWorkMinutes / 60),
    currentSessionMinutes,
    rhythmLabel: getRhythmLabel(currentSessionMinutes),
    rhythmHint: getRhythmHint(currentSessionMinutes),
  };
}

export function getPetGrowthSummary(pet: Pick<PetState, 'level' | 'exp' | 'totalWorkMinutes' | 'currentSessionStart'>, nowMs = Date.now()): PetGrowthSummary {
  const progress = getPetLevelProgress(pet.exp, pet.level);
  const milestones = buildPetGrowthMilestones(progress.level);
  const unlockedMilestones = milestones.filter(milestone => milestone.unlocked);
  const upcomingMilestones = milestones.filter(milestone => !milestone.unlocked).slice(0, 4);

  return {
    stageLabel: getStageLabel(progress.level),
    progressPercent: progress.percent,
    currentLevelExp: progress.currentLevelExp,
    neededExpInLevel: progress.neededExpInLevel,
    remainingToNextLevel: progress.remainingToNextLevel,
    isMaxLevel: progress.isMaxLevel,
    unlockedMilestones,
    upcomingMilestones,
    nextMilestone: upcomingMilestones[0] ?? null,
    workRhythm: getPetWorkRhythmSummary(pet, nowMs),
  };
}
