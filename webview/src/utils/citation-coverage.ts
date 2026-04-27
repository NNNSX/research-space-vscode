import type { NodeMeta } from '../../../src/core/canvas-model';

export interface CitationCoverageDisplay {
  badgeText: string;
  tooltip: string;
  hasWarning: boolean;
}

function formatLabel(label: string): string {
  return `[${label}]`;
}

function sourceTitleByLabel(meta: NodeMeta | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of meta?.ai_source_nodes ?? []) {
    if (!source.label) { continue; }
    const filePart = source.file_path ? ` · ${source.file_path}` : '';
    map.set(source.label, `${formatLabel(source.label)} ${source.title || source.id}${filePart}`);
  }
  return map;
}

function describeLabels(labels: string[], sourceMap: Map<string, string>, fallback: string): string[] {
  if (labels.length === 0) { return [`- ${fallback}`]; }
  return labels.map(label => `- ${sourceMap.get(label) ?? formatLabel(label)}`);
}

export function buildCitationCoverageDisplay(meta: NodeMeta | undefined): CitationCoverageDisplay | null {
  const coverage = meta?.ai_citation_coverage;
  if (!coverage || coverage.expectedLabels.length === 0) { return null; }

  const sourceMap = sourceTitleByLabel(meta);
  const hasWarning = !!meta?.ai_citation_warning || coverage.missingLabels.length > 0 || coverage.unknownLabels.length > 0;
  const tooltipLines = [
    `文内引用覆盖：${coverage.citedLabels.length}/${coverage.expectedLabels.length} 个来源`,
    `检测到 ${coverage.citationCount} 处来源标签`,
    '',
    '已引用：',
    ...describeLabels(coverage.citedLabels, sourceMap, '暂无来源在正文中出现'),
    '',
    '未引用：',
    ...describeLabels(coverage.missingLabels, sourceMap, '无'),
  ];

  if (coverage.unknownLabels.length > 0) {
    tooltipLines.push('', '未连接标签：', ...coverage.unknownLabels.map(formatLabel).map(label => `- ${label}`));
  }
  if (meta?.ai_citation_warning) {
    tooltipLines.push('', `提醒：${meta.ai_citation_warning}`);
  }

  return {
    badgeText: `${coverage.citedLabels.length}/${coverage.expectedLabels.length} 来源`,
    tooltip: tooltipLines.join('\n'),
    hasWarning,
  };
}
