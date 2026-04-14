import * as vscode from 'vscode';
import * as path from 'path';
import { AIToolDef } from './index';
import { CanvasFile, CanvasNode } from '../../core/canvas-model';
import { toAbsPath } from '../../core/storage';
import { getProvider } from '../provider';

export const ragTool: AIToolDef = {
  id: 'rag',
  name: 'RAG Chat',
  description: 'Answer questions grounded in workspace documents',
  icon: 'search',
  supportsImages: true,
  outputNodeType: 'ai_output',
  params: [
    {
      name: 'query',
      type: 'text',
      label: 'Question',
      default: '',
    },
    {
      name: 'topK',
      type: 'number',
      label: 'Top K docs',
      default: 5,
    },
  ],
  buildSystem(_params) {
    return (
      `You are a knowledgeable research assistant. ` +
      `Answer questions based strictly on the provided document context. ` +
      `Cite the source file name when referencing specific information. ` +
      `If the answer is not found in the context, say so clearly.`
    );
  },
};

// ── Simple keyword-based retrieval ─────────────────────────────────────────

export async function runRag(
  query: string,
  canvas: CanvasFile,
  canvasUri: vscode.Uri,
  topK = 5
): Promise<AsyncIterable<string>> {
  // Collect all data nodes with file_path
  const dataNodes = canvas.nodes.filter(
    n => ['paper', 'note', 'code', 'ai_output'].includes(n.node_type) && n.file_path
  );

  // Score each node by keyword overlap
  const queryTokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 2);

  interface ScoredNode { node: CanvasNode; score: number; content: string }
  const scored: ScoredNode[] = [];

  for (const node of dataNodes) {
    let content = '';
    try {
      const absPath = toAbsPath(node.file_path!, canvasUri);
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
      const ext = path.extname(absPath).slice(1).toLowerCase();
      if (ext === 'pdf') {
        content = node.meta?.content_preview ?? '';
      } else {
        content = Buffer.from(bytes).toString('utf-8').slice(0, 10_000);
      }
    } catch {
      content = node.meta?.content_preview ?? '';
    }

    const lower = content.toLowerCase();
    const score = queryTokens.reduce(
      (sum, token) => sum + (lower.includes(token) ? 1 : 0),
      0
    );
    if (score > 0) {
      scored.push({ node, score, content });
    }
  }

  const topDocs = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  const context = topDocs
    .map(s => `--- ${s.node.title} (${s.node.file_path}) ---\n${s.content}`)
    .join('\n\n');

  const fullContent = [
    { type: 'text' as const, title: 'Context Documents', text: context },
    { type: 'text' as const, title: 'User Question', text: query },
  ];

  const provider = await getProvider();
  return provider.stream(ragTool.buildSystem({}), fullContent);
}
