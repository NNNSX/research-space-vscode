import { CanvasFile, CanvasNode, DataNodeType } from '../core/canvas-model';

/**
 * Compact summary of the current canvas state,
 * used as context for the pet AI's suggestions.
 */
export interface CanvasContext {
  canvasTitle: string;
  nodeCount: number;
  nodeTypeSummary: Record<string, number>;  // e.g. { paper: 5, note: 3, ai_output: 2 }
  functionNodeNames: string[];              // names of function (AI tool) nodes
  recentOutputPreviews: string[];           // first 200 chars of the 3 most recent ai_output nodes
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
}

/**
 * Extract a compact canvas context from a CanvasFile for the pet AI.
 */
export function extractCanvasContext(canvas: CanvasFile): CanvasContext {
  const nodeTypeSummary: Record<string, number> = {};
  const functionNodeNames: string[] = [];
  const aiOutputs: CanvasNode[] = [];

  for (const node of canvas.nodes) {
    const t = node.node_type;
    nodeTypeSummary[t] = (nodeTypeSummary[t] || 0) + 1;

    if (t === 'function' && node.title) {
      functionNodeNames.push(node.title);
    }
    if (t === 'ai_output') {
      aiOutputs.push(node);
    }
  }

  // Get previews of the 3 most recent AI outputs (approximate recency by array order — last = newest)
  const recentOutputPreviews = aiOutputs
    .slice(-3)
    .map(n => {
      const preview = (n.meta?.content_preview as string) || '';
      return preview.slice(0, 200);
    })
    .filter(Boolean);

  const h = new Date().getHours();
  let timeOfDay: CanvasContext['timeOfDay'] = 'morning';
  if (h >= 12 && h < 18) { timeOfDay = 'afternoon'; }
  else if (h >= 18 && h < 22) { timeOfDay = 'evening'; }
  else if (h >= 22 || h < 6) { timeOfDay = 'night'; }

  return {
    canvasTitle: canvas.metadata?.title || 'untitled',
    nodeCount: canvas.nodes.length,
    nodeTypeSummary,
    functionNodeNames,
    recentOutputPreviews,
    timeOfDay,
  };
}

/**
 * Format the canvas context into a concise text block
 * suitable for inclusion in an AI system prompt.
 */
export function formatContextForAI(ctx: CanvasContext): string {
  const typeSummary = Object.entries(ctx.nodeTypeSummary)
    .map(([t, n]) => `${t}: ${n}`)
    .join(', ');

  const tools = ctx.functionNodeNames.length > 0
    ? `使用中的AI工具: ${ctx.functionNodeNames.join(', ')}`
    : '暂无AI工具节点';

  const outputs = ctx.recentOutputPreviews.length > 0
    ? `最近AI输出摘要:\n${ctx.recentOutputPreviews.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}`
    : '暂无AI输出';

  return [
    `画布: ${ctx.canvasTitle}`,
    `节点总数: ${ctx.nodeCount} (${typeSummary})`,
    tools,
    outputs,
    `时间段: ${ctx.timeOfDay}`,
  ].join('\n');
}
