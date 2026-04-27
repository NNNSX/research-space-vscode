import type { CanvasNode, NodeMeta } from '../core/canvas-model';

export interface SelectedMarkdownContent {
  nodeId: string;
  content: string;
  note?: string;
}

export interface BuildSelectedMarkdownArgs {
  canvasTitle: string;
  nodes: CanvasNode[];
  contents?: SelectedMarkdownContent[];
  exportedAt?: string;
}

const NODE_TYPE_LABELS: Record<string, string> = {
  paper: '文献',
  note: '笔记',
  code: '代码',
  image: '图片',
  ai_output: 'AI 输出',
  audio: '音频',
  video: '视频',
  experiment_log: '实验记录',
  task: '任务',
  data: '数据',
  function: '功能节点',
  group_hub: '节点组',
  blueprint: '蓝图',
};

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function headingText(value: string): string {
  return normalizeText(value).replace(/\s+/g, ' ') || '未命名节点';
}

function nodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type] ?? type;
}

function sortNodesByCanvasPosition(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
}

function formatTaskItems(meta?: NodeMeta): string {
  const items = meta?.task_items;
  if (!items?.length) { return ''; }
  return items.map(item => `- [${item.done ? 'x' : ' '}] ${item.label}`).join('\n');
}

function formatExperimentLog(meta?: NodeMeta): string {
  const lines = [
    meta?.experiment_name ? `- 实验名称：${meta.experiment_name}` : '',
    meta?.experiment_date ? `- 日期：${meta.experiment_date}` : '',
    meta?.experiment_status ? `- 状态：${meta.experiment_status}` : '',
    meta?.experiment_params ? `- 参数：${meta.experiment_params}` : '',
    meta?.experiment_result ? `- 结果：${meta.experiment_result}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function fallbackContent(node: CanvasNode): string {
  if (node.node_type === 'group_hub') {
    return '这是一个节点组容器。若导出时选中了节点组，成员节点会在导出文件中按画布位置一并展开。';
  }
  const taskText = formatTaskItems(node.meta);
  if (taskText) { return taskText; }
  const experimentText = formatExperimentLog(node.meta);
  if (experimentText) { return experimentText; }
  return normalizeText(node.meta?.content_preview);
}

function formatSourceNodes(meta?: NodeMeta): string[] {
  const refs = meta?.ai_source_nodes ?? [];
  if (refs.length === 0) { return []; }
  return [
    '### 来源节点',
    '',
    ...refs.map(ref => {
      const filePart = ref.file_path ? `，文件：${ref.file_path}` : '';
      const labelPart = ref.label ? `[${ref.label}] ` : '';
      return `- ${labelPart}${ref.title || ref.id}（${nodeTypeLabel(ref.node_type)}${filePart}）`;
    }),
    '',
  ];
}

export function buildSelectedNodesMarkdown(args: BuildSelectedMarkdownArgs): string {
  const contentMap = new Map((args.contents ?? []).map(entry => [entry.nodeId, entry]));
  const title = headingText(args.canvasTitle);
  const exportedAt = args.exportedAt ?? new Date().toISOString();
  const sections: string[] = [
    `# ${title} - 选中节点导出`,
    '',
    `- 导出时间：${exportedAt}`,
    `- 节点数量：${args.nodes.length}`,
    '',
  ];

  for (const [index, node] of sortNodesByCanvasPosition(args.nodes).entries()) {
    const contentEntry = contentMap.get(node.id);
    const content = normalizeText(contentEntry?.content) || fallbackContent(node) || '_暂无可导出的正文。_';
    const contentNote = normalizeText(contentEntry?.note);

    sections.push(`## ${index + 1}. ${headingText(node.title)}`, '');
    sections.push(`- 类型：${nodeTypeLabel(node.node_type)}`);
    if (node.file_path) {
      sections.push(`- 文件：${node.file_path}`);
    }
    if (node.meta?.ai_source_summary) {
      sections.push(`- 依据摘要：${node.meta.ai_source_summary}`);
    }
    if (contentNote) {
      sections.push(`- 读取说明：${contentNote}`);
    }
    sections.push('');
    sections.push(...formatSourceNodes(node.meta));
    sections.push('### 正文', '', content, '', '---', '');
  }

  return `${sections.join('\n').trimEnd()}\n`;
}
