import type { CanvasNode } from '../../../src/core/canvas-model';

export type NextStepSuggestionKind = 'create_tool' | 'open_tools';

export interface NextStepSuggestion {
  id: string;
  label: string;
  description: string;
  toolId?: string;
  kind: NextStepSuggestionKind;
}

interface SuggestionCandidate {
  id: string;
  label: string;
  description: string;
  toolId: string;
}

const TEXT_NODE_TYPES = new Set<CanvasNode['node_type']>([
  'paper',
  'note',
  'code',
  'ai_output',
  'experiment_log',
  'task',
  'data',
  'group_hub',
]);

const DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'csv',
  'tsv',
]);

function getExtension(filePath?: string): string {
  const match = filePath?.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? '';
}

function hasAvailableTool(toolId: string, availableToolIds?: Iterable<string>): boolean {
  if (!availableToolIds) { return true; }
  const set = availableToolIds instanceof Set ? availableToolIds : new Set(availableToolIds);
  return set.has(toolId);
}

function pushCandidate(
  candidates: SuggestionCandidate[],
  seen: Set<string>,
  candidate: SuggestionCandidate,
  availableToolIds?: Iterable<string>,
) {
  if (seen.has(candidate.id)) { return; }
  if (seen.has(`tool:${candidate.toolId}`)) { return; }
  if (!hasAvailableTool(candidate.toolId, availableToolIds)) { return; }
  seen.add(candidate.id);
  seen.add(`tool:${candidate.toolId}`);
  candidates.push(candidate);
}

export function buildNextStepSuggestions(
  selectedNodes: CanvasNode[],
  options: { availableToolIds?: Iterable<string>; limit?: number } = {},
): NextStepSuggestion[] {
  const nodes = selectedNodes.filter(Boolean);
  if (nodes.length === 0) { return []; }

  const availableToolIds = options.availableToolIds;
  const limit = options.limit ?? 4;
  const nodeTypes = new Set(nodes.map(node => node.node_type));
  const extensions = new Set(nodes.map(node => getExtension(node.file_path)).filter(Boolean));
  const candidates: SuggestionCandidate[] = [];
  const seen = new Set<string>();

  const hasType = (type: CanvasNode['node_type']) => nodeTypes.has(type);
  const hasAnyType = (...types: CanvasNode['node_type'][]) => types.some(type => nodeTypes.has(type));
  const allFunctionNodes = nodes.every(node => node.node_type === 'function');
  const hasTextLikeNode = nodes.some(node => TEXT_NODE_TYPES.has(node.node_type));
  const hasDocumentFile = nodes.some(node => DOCUMENT_EXTENSIONS.has(getExtension(node.file_path)));
  const hasPaperLikeNode = hasAnyType('paper') || extensions.has('pdf');
  const hasAiOutputOnly = nodes.length === 1 && hasType('ai_output');

  if (allFunctionNodes) {
    return [];
  }

  if (hasAnyType('audio')) {
    pushCandidate(candidates, seen, {
      id: 'audio-stt',
      label: '语音转文字',
      description: '创建转写节点并连接当前音频',
      toolId: 'stt',
    }, availableToolIds);
    pushCandidate(candidates, seen, {
      id: 'audio-meeting-transcribe',
      label: '会议转写',
      description: '适合访谈、讨论和会议录音',
      toolId: 'meeting-transcribe',
    }, availableToolIds);
  }

  if (hasAnyType('image')) {
    pushCandidate(candidates, seen, {
      id: 'image-edit',
      label: '图像编辑',
      description: '创建图像编辑节点并连接当前图片',
      toolId: 'image-edit',
    }, availableToolIds);
    pushCandidate(candidates, seen, {
      id: 'image-to-video',
      label: '图生视频',
      description: '基于当前图片生成视频',
      toolId: 'image-to-video',
    }, availableToolIds);
    pushCandidate(candidates, seen, {
      id: 'image-summarize',
      label: '图像说明',
      description: '用摘要工具描述图片内容',
      toolId: 'summarize',
    }, availableToolIds);
  }

  if (hasAiOutputOnly) {
    pushCandidate(candidates, seen, {
      id: 'ai-output-polish',
      label: '继续润色',
      description: '在当前输出基础上创建润色节点',
      toolId: 'polish',
    }, availableToolIds);
    pushCandidate(candidates, seen, {
      id: 'ai-output-review',
      label: '生成修改意见',
      description: '对当前输出做结构化审阅',
      toolId: 'review',
    }, availableToolIds);
  }

  if (hasTextLikeNode) {
    pushCandidate(candidates, seen, {
      id: nodes.length > 1 ? 'multi-summarize' : 'text-summarize',
      label: nodes.length > 1 ? '综合摘要' : '内容摘要',
      description: nodes.length > 1 ? '把选中材料合并为一个摘要入口' : '创建摘要节点并连接当前材料',
      toolId: 'summarize',
    }, availableToolIds);
  }

  if (hasPaperLikeNode || nodes.length > 1 && hasTextLikeNode) {
    pushCandidate(candidates, seen, {
      id: 'literature-review',
      label: '文献综述',
      description: '基于选中材料生成综述草稿',
      toolId: 'literature-review',
    }, availableToolIds);
  }

  if (hasPaperLikeNode || hasType('note') || hasType('ai_output')) {
    pushCandidate(candidates, seen, {
      id: 'review',
      label: '论文评审',
      description: '从审稿视角生成问题和建议',
      toolId: 'review',
    }, availableToolIds);
  }

  if (hasType('task') || hasType('experiment_log')) {
    pushCandidate(candidates, seen, {
      id: 'action-items',
      label: '提取行动项',
      description: '从记录中整理待办和下一步动作',
      toolId: 'action-items',
    }, availableToolIds);
  }

  if (hasDocumentFile) {
    pushCandidate(candidates, seen, {
      id: 'explode-document',
      label: '文件转换',
      description: '转换为 PNG、Markdown 或 TeX 等格式',
      toolId: 'explode-document',
    }, availableToolIds);
  }

  return candidates.slice(0, limit).map(candidate => ({
    ...candidate,
    kind: 'create_tool',
  }));
}
