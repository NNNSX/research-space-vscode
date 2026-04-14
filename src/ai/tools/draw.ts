import { AIToolDef } from './index';

export const drawTool: AIToolDef = {
  id: 'draw',
  name: 'Draw Diagram',
  description: 'Generate Mermaid diagrams from descriptions',
  icon: 'graph',
  supportsImages: false,
  outputNodeType: 'image',
  params: [
    {
      name: 'diagramType',
      type: 'select',
      label: 'Diagram type',
      options: ['flowchart', 'sequence', 'mindmap', 'class', 'er', 'gantt'],
      default: 'flowchart',
    },
  ],
  buildSystem(params) {
    const type = params['diagramType'] ?? 'flowchart';
    return (
      `You are an expert at creating Mermaid diagrams. ` +
      `Based on the provided content, generate a ${type} diagram using Mermaid syntax. ` +
      `Output ONLY the Mermaid code block — no explanations, no commentary. ` +
      `Format: \`\`\`mermaid\n...\n\`\`\``
    );
  },
  postProcess(raw: string): string {
    const match = raw.match(/```mermaid\s*([\s\S]*?)```/);
    if (match) {
      return match[1].trim();
    }
    return raw.trim();
  },
};
