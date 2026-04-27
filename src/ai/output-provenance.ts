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

export interface AiCitationCoverage {
  expectedLabels: string[];
  citedLabels: string[];
  missingLabels: string[];
  unknownLabels: string[];
  citationCount: number;
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
        '如果同时综合多个来源，请把对应标签都放在同一句或同一段末尾，例如 [资料1][资料3]。',
        '如果某个来源没有被实际使用，不要为了覆盖来源而硬塞引用；但请尽量让每个有贡献的来源都能在正文中被看见。',
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

export function analyzeInlineCitationCoverage(
  text: string,
  sourceNodes: AiSourceNodeRef[],
): AiCitationCoverage {
  const expectedLabels = sourceNodes.map(source => source.label);
  const expectedSet = new Set(expectedLabels);
  const matches = [...text.matchAll(/\[资料(\d+)\]/g)].map(match => `资料${match[1]}`);
  const citedLabels = [...new Set(matches.filter(label => expectedSet.has(label)))]
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));
  const citedSet = new Set(citedLabels);
  const missingLabels = expectedLabels.filter(label => !citedSet.has(label));
  const unknownLabels = [...new Set(matches.filter(label => !expectedSet.has(label)))]
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)));

  return {
    expectedLabels,
    citedLabels,
    missingLabels,
    unknownLabels,
    citationCount: matches.length,
  };
}

export function buildCitationWarning(coverage: AiCitationCoverage): string | undefined {
  if (coverage.expectedLabels.length === 0) {
    return undefined;
  }
  if (coverage.citationCount === 0) {
    return '本次输出未检测到 [资料1] 这类文内引用；请检查结果，必要时重新运行或在提示词中强调逐句引用。';
  }
  const parts: string[] = [];
  if (coverage.missingLabels.length > 0) {
    parts.push(`未看到 ${coverage.missingLabels.map(label => `[${label}]`).join('、')} 的正文引用`);
  }
  if (coverage.unknownLabels.length > 0) {
    parts.push(`检测到未连接来源标签 ${coverage.unknownLabels.map(label => `[${label}]`).join('、')}`);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return `${parts.join('；')}；请检查引用是否完整、准确。`;
}

export function hasInlineCitationLabels(text: string): boolean {
  return analyzeInlineCitationCoverage(text, []).citationCount > 0;
}
