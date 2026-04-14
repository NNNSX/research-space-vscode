import type { PetBehavior, PetAnimation } from './pet-types';
import { getTimeOfDay, pickRandom } from './pet-types';

// ── Behavior engine — drives the pet state machine ─────────────────────────

export interface EngineState {
  behavior: PetBehavior;
  animation: PetAnimation;
  positionX: number;        // 0–100% along the panel width
  direction: 'left' | 'right';
  bubbleText: string | null;
  bubbleExpiry: number;     // Date.now() ms when bubble should hide
}

const PANEL_MIN_X = 15;
const PANEL_MAX_X = 85;
const WALK_STEP = 3;        // % per tick

export function createInitialEngine(): EngineState {
  return {
    behavior: 'idle',
    animation: 'idle',
    positionX: 50,
    direction: 'right',
    bubbleText: null,
    bubbleExpiry: 0,
  };
}

interface TickContext {
  mood: number;
  energy: number;
  idleMinutes: number;     // how long user has been idle
  sessionMinutes: number;  // total session length
  restReminderMin: number; // setting: rest reminder interval
  lastRestRemind: number;  // Date.now() of last rest reminder
}

export interface TickResult {
  engine: EngineState;
  moodDelta: number;
  energyDelta: number;
  bubble?: string;
  shouldRemindRest: boolean;
}

/**
 * Single tick of the behavior engine (called every 3 seconds).
 * Returns new engine state + side effects.
 */
export function tick(prev: EngineState, ctx: TickContext): TickResult {
  const now = Date.now();
  let { behavior, animation, positionX, direction, bubbleText, bubbleExpiry } = prev;
  let moodDelta = 0;
  let energyDelta = 0;
  let bubble: string | undefined;
  let shouldRemindRest = false;

  // Clear expired bubble
  if (bubbleText && now > bubbleExpiry) {
    bubbleText = null;
    bubbleExpiry = 0;
  }

  // Check rest reminder
  if (
    ctx.restReminderMin > 0 &&
    ctx.sessionMinutes >= ctx.restReminderMin &&
    (now - ctx.lastRestRemind) > ctx.restReminderMin * 60_000
  ) {
    shouldRemindRest = true;
  }

  // Mood/energy decay (per tick ≈ every 3s)
  // mood: -1 per 30min without interaction => ~ -1 every 600 ticks
  // energy: -1 per 20min working => ~ -1 every 400 ticks
  if (ctx.idleMinutes > 5) {
    moodDelta -= 0.002;  // ~-1 per 25 min
  }
  energyDelta -= 0.0025; // ~-1 per 20 min

  const timeOfDay = getTimeOfDay();

  // ── State machine transition ──

  // Build weighted behavior candidates
  const weights: Record<PetBehavior, number> = {
    idle: 40,
    walking: 25,
    sitting: 10,
    sleeping: 0,
    happy: 5,
    waving: 0,
  };

  // User focused (not idle) → pet more likely to sit quietly
  if (ctx.idleMinutes < 2) {
    weights.sitting += 30;
    weights.walking -= 15;
  }

  // Low mood → less active
  if (ctx.mood < 40) {
    weights.sitting += 20;
    weights.walking -= 10;
    weights.happy = 0;
  }

  // High mood → more playful
  if (ctx.mood > 75) {
    weights.happy += 10;
  }

  // Night time / very low energy → sleep tendency
  if (timeOfDay === 'night' && ctx.energy < 30) {
    weights.sleeping += 40;
  }
  if (ctx.idleMinutes > 15) {
    weights.sleeping += 20;
  }

  // Only transition sometimes (70% chance to stay in current behavior)
  const shouldTransition = Math.random() > 0.7;

  if (shouldTransition && behavior !== 'waving') {
    behavior = weightedRandom(weights);
  }

  // ── Apply behavior ──

  switch (behavior) {
    case 'idle':
      animation = Math.random() < 0.15 ? 'idle-blink' : 'idle';
      break;

    case 'walking': {
      // Pick direction or continue
      if (positionX <= PANEL_MIN_X) { direction = 'right'; }
      else if (positionX >= PANEL_MAX_X) { direction = 'left'; }
      else if (Math.random() < 0.05) {
        direction = direction === 'left' ? 'right' : 'left';
      }
      positionX += direction === 'right' ? WALK_STEP : -WALK_STEP;
      positionX = Math.max(PANEL_MIN_X, Math.min(PANEL_MAX_X, positionX));
      animation = direction === 'right' ? 'walk-right' : 'walk-left';
      break;
    }

    case 'sitting':
      animation = 'sit';
      break;

    case 'sleeping':
      animation = 'sleep';
      break;

    case 'happy':
      animation = 'happy';
      // After 2 ticks of happy, go back to idle
      if (Math.random() < 0.4) { behavior = 'idle'; }
      break;

    case 'waving':
      animation = 'wave';
      // Wave only lasts a couple ticks
      if (Math.random() < 0.5) { behavior = 'idle'; }
      break;
  }

  return {
    engine: { behavior, animation, positionX, direction, bubbleText, bubbleExpiry },
    moodDelta,
    energyDelta,
    bubble,
    shouldRemindRest,
  };
}

/**
 * Force a specific behavior + optional bubble.
 */
export function forceState(
  prev: EngineState,
  behavior: PetBehavior,
  animation: PetAnimation,
  bubbleText?: string,
  bubbleDurationMs = 5000,
): EngineState {
  const now = Date.now();
  return {
    ...prev,
    behavior,
    animation,
    bubbleText: bubbleText ?? prev.bubbleText,
    bubbleExpiry: bubbleText ? now + bubbleDurationMs : prev.bubbleExpiry,
  };
}

// ── Utility ────────────────────────────────────────────────────────────────

function weightedRandom(weights: Record<string, number>): PetBehavior {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) { return key as PetBehavior; }
  }
  return 'idle';
}
