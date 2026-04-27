import type { CanvasNode } from '../core/canvas-model';

export interface AiSourceNodeRef {
  id: string;
  label: string;
  title: string;
  node_type: CanvasNode['node_type'];
  file_path?: string;
}

export interface AiOutputProvenance {
  sourceNodes: AiSourceNodeRef[];
  sourceSummary: string;
  citationInstruction: string;
}

function sourceNodeLabel(node: AiSourceNodeRef): string {
  const filePart = node.file_path ? `，文件：${node.file_path}` : '';
  return `[${node.label}] ${node.title || node.id}（${node.node_type}${filePart}）`;
}

function buildCitationLabel(index: number): string {
  return `资料${index + 1}`;
}

export function buildAiOutputProvenance(args: {
  sourceNodes: CanvasNode[];
  toolName: string;
}): AiOutputProvenance {
  const sourceNodes = args.sourceNodes.map((node, index) => ({
    id: node.id,
    label: buildCitationLabel(index),
    title: node.title || node.id,
    node_type: node.node_type,
    ...(node.file_path ? { file_path: node.file_path } : {}),
  }));
  const sourceSummary = sourceNodes.length > 0
    ? sourceNodes.map(sourceNodeLabel).join('；')
    : '未连接外部输入节点，仅使用用户在功能节点中填写的指令或问题。';
  const citationInstruction = sourceNodes.length > 0
    ? [
        '',
        '【文内引用要求】',
        `本次工具：${args.toolName}`,
        `可引用来源：${sourceSummary}`,
        '回答正文中，凡是基于某个来源材料的事实、观点、数据、结论、归纳或改写，都应在对应句子或段落末尾标注来源，例如 [资料1] 或 [资料1][资料2]。',
        '如果某句话只是结构性承接、写作组织或模型推断，不能伪造来源；必要时明确写“推断：”。',
        '不要在输出末尾额外添加“依据说明”“来源说明”“参考资料列表”等总结性来源章节；依据应尽量嵌入正文。',
      ].join('\n')
    : '';

  return {
    sourceNodes,
    sourceSummary,
    citationInstruction,
  };
}

export function withInlineCitationInstruction(
  systemPrompt: string,
  provenance: AiOutputProvenance,
): string {
  if (!provenance.citationInstruction) {
    return systemPrompt;
  }
  return `${systemPrompt.trimEnd()}\n${provenance.citationInstruction}`;
}

export function labelAiContentsForInlineCitations(
  contents: Array<{ title: string }>,
  sourceNodes: CanvasNode[],
): void {
  const count = Math.min(contents.length, sourceNodes.length);
  for (let index = 0; index < count; index++) {
    const label = buildCitationLabel(index);
    const title = contents[index].title || sourceNodes[index].title || sourceNodes[index].id;
    if (title.startsWith(`${label} · `)) { continue; }
    contents[index].title = `${label} · ${title}`;
  }
}

export function hasInlineCitationLabels(text: string): boolean {
  return /\[资料\d+\]/.test(text);
}
