import { CanvasFile } from '../core/canvas-model';
import { extractPetPerception, type PetPerceptionSnapshot } from './pet-perception';

/**
 * Compact summary of the current canvas state,
 * used as context for the pet AI's suggestions.
 */
export interface CanvasContext extends PetPerceptionSnapshot {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
}

/**
 * Extract a compact canvas context from a CanvasFile for the pet AI.
 */
export function extractCanvasContext(canvas: CanvasFile): CanvasContext {
  const perception = extractPetPerception(canvas);
  const h = new Date().getHours();
  let timeOfDay: CanvasContext['timeOfDay'] = 'morning';
  if (h >= 12 && h < 18) { timeOfDay = 'afternoon'; }
  else if (h >= 18 && h < 22) { timeOfDay = 'evening'; }
  else if (h >= 22 || h < 6) { timeOfDay = 'night'; }

  return {
    ...perception,
    timeOfDay,
  };
}

/**
 * Format the canvas context into a concise text block
 * suitable for inclusion in an AI system prompt.
 */
export function formatContextForAI(ctx: CanvasContext): string {
  const typeSummary = Object.entries(ctx.nodeStats)
    .map(([t, n]) => `${t}: ${n}`)
    .join(', ') || '暂无节点';

  const tools = ctx.functionNodeNames.length > 0
    ? `使用中的AI工具: ${ctx.functionNodeNames.join(', ')}`
    : '暂无AI工具节点';

  const outputs = ctx.recentOutputPreviews.length > 0
    ? `最近AI输出摘要:\n${ctx.recentOutputPreviews.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`
    : '暂无AI输出';

  const boards = ctx.boards.length > 0
    ? `画板: ${ctx.boards.map(board => `${board.name}(${board.nodeCount}节点)`).join(', ')}`
    : '暂无画板';

  const mindmaps = ctx.mindmaps.length > 0
    ? `思维导图: ${ctx.mindmaps.map(map => `${map.title}(${map.firstLevelCount}分支/${map.totalItems}条目)`).join(', ')}`
    : '暂无思维导图';

  const friction = ctx.frictionSignals.length > 0
    ? `可能需要关注:\n${ctx.frictionSignals.map((signal, i) => `  ${i + 1}. ${signal.message}`).join('\n')}`
    : '暂无明显阻塞信号';

  return [
    `画布: ${ctx.canvasTitle}`,
    `场景判断: ${ctx.scene}`,
    `阶段判断: ${ctx.phase}`,
    `节点总数: ${Object.values(ctx.nodeStats).reduce((sum, count) => sum + count, 0)} (${typeSummary})`,
    `连线数: ${ctx.edgeCount}，未连接节点: ${ctx.isolatedNodeCount}`,
    boards,
    mindmaps,
    `节点组: ${ctx.nodeGroupCount}，蓝图: ${ctx.blueprintCount}`,
    tools,
    outputs,
    friction,
    `时间段: ${ctx.timeOfDay}`,
  ].join('\n');
}
