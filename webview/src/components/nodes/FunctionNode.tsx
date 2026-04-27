import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { CanvasNode, FnStatus, ParamDef, RunIssueKind } from '../../../../src/core/canvas-model';
import {
  getExplosionSourceTypeFromPath,
  isMinerUSupportedFilePath,
  MINERU_SUPPORTED_FILE_HINT,
  requiresMinerUTokenForSourceType,
} from '../../../../src/core/explosion-file-types';
import { getVisibleAihubmixImageParamNames } from '../../../../src/core/aihubmix-image-models';
import { postMessage } from '../../bridge';
import { useCanvasStore } from '../../stores/canvas-store';
import { formatModelLabel, getAutoModelLabel, getConcreteProviderModelLabel, getFavoriteModelsForProvider, getProviderDisplayName, orderModelsByIds } from '../../utils/model-labels';
import { buildNodePortStyle, getNodePortLabel, NODE_PORT_CLASSNAME, NODE_PORT_IDS } from '../../utils/node-port';
import { closeAllCanvasContextMenus } from '../../utils/context-menu';
import { getAiToolCostNotice, getCancelButtonLabel, getRunButtonLabel, isHighCostAiTool } from '../../utils/ai-tool-experience';
import {
  ensureNodeChromeStyles,
  NODE_BORDER_WIDTH,
  NODE_CONTENT_GUTTER,
  NODE_HEADER_ICON_SIZE,
  NODE_HEADER_TITLE_STYLE,
  NODE_RADIUS,
  NODE_SELECTED_BORDER_WIDTH,
  withAlpha,
} from '../../utils/node-chrome';
import { NodeContextMenu } from './NodeContextMenu';

interface FunctionNodeProps {
  id: string;
  data: CanvasNode;
  selected: boolean;
}

interface NodeSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const STATUS_COLORS: Record<FnStatus, string> = {
  idle:    'var(--vscode-terminal-ansiMagenta)',
  running: 'var(--vscode-terminal-ansiBlue)',
  done:    'var(--vscode-terminal-ansiGreen)',
  error:   'var(--vscode-terminal-ansiRed)',
};

const STATUS_LABELS: Record<FnStatus, string> = {
  idle: '待机', running: '运行中…', done: '完成', error: '错误',
};

const TOOL_ICONS: Record<string, string> = {
  // 文本工具
  summarize:       '📚',
  polish:          '✏️',
  review:          '💬',
  translate:       '🌐',
  draw:            '📊',
  rag:             '🔎',
  chat:            '💬',
  'explode-document': '🔁',
  // 多模态工具
  'image-gen':     '🖼',
  'image-edit':    '✏️',
  'image-fusion':  '🧩',
  'image-group-output': '🖼️',
  tts:             '🔊',
  stt:             '🎵',
  'video-gen':     '🎬',
  'image-to-video':'🎬',
};

// Default prompts for each tool — shown as placeholder in the editor so users know what they're overriding
const TOOL_DEFAULT_PROMPTS: Record<string, string> = {
  summarize:          '你是一位专业学术摘要专家。请以目标语言、指定风格对所提供内容进行摘要，字数不超过指定限制。涉及来源材料的事实、观点或归纳时，在句子或段落末尾保留 [资料1] 这类文内引用。仅输出摘要，无需任何元评论。',
  polish:             '你是一位专业编辑。请以指定强度对所提供文本进行润色。输出应包括改动说明和完整修订文本两部分，并尽量保留或补充 [资料1] 这类文内引用。',
  review:             '你是一位严格的同行评审专家。请以指定严格程度对所提供内容进行评审。输出总体评分、各维度评分，以及主要/次要问题清单；基于来源材料的评价应在句末标注 [资料1] 这类文内引用。',
  translate:          '你是一位专业学术翻译。请将内容翻译为目标语言，保持学术术语准确，并保留原文中的 [资料1] 这类文内引用。翻译后附上「## 关键术语」部分，列出重要术语及其翻译对照表。',
  draw:               '你是 Mermaid 图表专家。请根据所提供内容生成 Mermaid 语法图表。仅输出 Mermaid 代码块，不包含任何解释或注释。',
  rag:                '你是一位研究助手。请根据所提供的文档内容回答用户问题。引用具体信息时在句末标注 [资料1] 这类文内引用。',
  'literature-review':'你是一位学术文献综合分析专家。请基于所提供的论文，按指定输出格式与语言撰写文献综述。每个要点需在句末标注 [资料1]、[资料2] 这类来源标签。',
  'outline-gen':      '你是一位学术写作教练。请基于所提供的笔记和草稿，生成指定层级的论文大纲。每个章节标题应具体明确，并附一句话描述；基于材料的描述应带文内引用。',
  'action-items':     '你是一位会议行动项提取专家。请从所提供的会议记录中提取所有行动项，标注负责人、具体内容、截止日期和优先级；行动项依据应保留文内引用。',
  'explode-document': '这是一个系统级文件转换工具，不走文本生成模型。连接一个受支持文件后，可把表格转为 Markdown / TeX，或把 PDF / Word / PPT 转 PNG / 拆解为文字 + 图片。',
};

// Provider label map (no 'auto' — nodes always have an explicit provider)
const PROVIDER_LABELS: Record<string, string> = {
  copilot:   'GitHub Copilot',
  anthropic: 'Anthropic Claude',
  ollama:    'Ollama（本地）',
  omlx:      'oMLX',
};

// Node type icons for displaying upstream nodes in the inputs list
const NODE_TYPE_ICONS: Record<string, string> = {
  paper:          '📄',
  note:           '📝',
  code:           '💻',
  image:          '🖼',
  ai_output:      '🤖',
  audio:          '🎵',
  video:          '🎬',
  experiment_log: '🧪',
  task:           '✅',
};

const RUN_ISSUE_LABELS: Record<RunIssueKind, string> = {
  missing_input: '输入缺失',
  missing_config: '配置缺失',
  run_failed: '运行失败',
  skipped: '已跳过',
};

const MIN_FUNCTION_NODE_HEIGHT = 168;
const FUNCTION_NODE_PADDING = NODE_CONTENT_GUTTER;
const FUNCTION_NODE_AUTO_HEIGHT_PADDING = Math.ceil(NODE_SELECTED_BORDER_WIDTH * 2) + 2;

function stopEditableFieldMouseDown(event: React.MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

// ── Inject keyframe animations once ───────────────────────────────────────
const FN_STYLE_ID = 'rs-fn-running-animations';
function ensureFnAnimations() {
  if (document.getElementById(FN_STYLE_ID)) { return; }
  const style = document.createElement('style');
  style.id = FN_STYLE_ID;
  style.textContent = `
    @keyframes rsFnBorderFlow {
      0%   { border-color: rgba(59,130,246,0.7); }
      33%  { border-color: rgba(139,92,246,0.7); }
      66%  { border-color: rgba(236,72,153,0.7); }
      100% { border-color: rgba(59,130,246,0.7); }
    }
    @keyframes rsFnGlow {
      0%   { box-shadow: 0 0 8px 2px rgba(59,130,246,0.4); }
      50%  { box-shadow: 0 0 16px 4px rgba(99,102,241,0.55); }
      100% { box-shadow: 0 0 8px 2px rgba(59,130,246,0.4); }
    }
    @keyframes rsFnShake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
      20%, 40%, 60%, 80% { transform: translateX(4px); }
    }
  `;
  document.head.appendChild(style);
}

export const FunctionNode = memo(FunctionNodeInner);

function FunctionNodeInner({ id, data, selected }: FunctionNodeProps) {
  const status: FnStatus = data.meta?.fn_status ?? 'idle';
  const tool = data.meta?.ai_tool;
  const icon = tool ? (TOOL_ICONS[tool] ?? '⚡') : '⚡';

  // Inject CSS keyframes on first render
  React.useEffect(() => {
    ensureFnAnimations();
    ensureNodeChromeStyles();
  }, []);

  return (
    <FullFunctionNode
      id={id}
      data={data}
      selected={selected}
      status={status}
      icon={icon}
    />
  );
}

function resolveVisibleOptionalParams(
  toolId: string,
  params: ParamDef[],
  effectiveModel: string,
): ParamDef[] {
  if (toolId === 'explode-document') {
    return params.filter(param => !['document_conversion_mode', 'spreadsheet_format'].includes(param.name));
  }

  if (toolId === 'image-gen') {
    const visibleNames = getVisibleAihubmixImageParamNames('image-gen', effectiveModel);
    return params.filter(param => visibleNames.has(param.name));
  }

  if (toolId === 'image-edit') {
    const visibleNames = getVisibleAihubmixImageParamNames('image-edit', effectiveModel);
    return params.filter(param => visibleNames.has(param.name));
  }

  return params;
}

function buildToolWarnings(args: {
  toolId: string;
  toolDef: NonNullable<ReturnType<typeof useCanvasStore.getState>['toolDefs'][number]> | undefined;
  upstreamNodes: CanvasNode[];
  promptParamValue: string;
  instructionParamValue: string;
  chatDraft: string;
  queryValue: string;
  styleHintValue: string;
  motionPromptValue: string;
}): string[] {
  const {
    toolId,
    toolDef,
    upstreamNodes,
    promptParamValue,
    instructionParamValue,
    chatDraft,
    queryValue,
    motionPromptValue,
  } = args;

  const warnings: string[] = [];
  const imageCount = upstreamNodes.filter(node => node.node_type === 'image').length;
  const audioCount = upstreamNodes.filter(node => node.node_type === 'audio').length;
  const textCount = upstreamNodes.filter(node =>
    node.node_type === 'paper'
    || node.node_type === 'note'
    || node.node_type === 'code'
    || node.node_type === 'ai_output'
    || node.node_type === 'data'
  ).length;

  if (toolId === 'chat') {
    if (!chatDraft.trim()) {
      warnings.push('💬 需先输入对话 Prompt');
    }
    return warnings;
  }

  if (toolId === 'rag') {
    if (!queryValue) {
      warnings.push('❓ 需先填写问题');
    }
    return warnings;
  }

  if (toolId === 'image-gen') {
    if (textCount === 0 && !promptParamValue) {
      warnings.push('📝 需填写图像描述，或连接文本节点');
    }
    return warnings;
  }

  if (toolId === 'image-edit') {
    if (imageCount === 0) {
      warnings.push('🖼 需连接图像节点作为参考图');
    }
    if (textCount === 0 && !instructionParamValue) {
      warnings.push('📝 需填写编辑指令，或连接文本节点');
    }
    return warnings;
  }

  if (toolId === 'image-fusion') {
    if (imageCount < 2) {
      warnings.push('🧩 需至少连接 2 个图像节点');
    }
    if (!promptParamValue) {
      warnings.push('✏️ 需填写融合指令');
    }
    return warnings;
  }

  if (toolId === 'image-group-output') {
    if (textCount === 0 && !promptParamValue) {
      warnings.push('📝 需提供组图描述：请连接文本节点，或在参数里填写');
    }
    return warnings;
  }

  if (toolId === 'image-to-video') {
    if (imageCount === 0) {
      warnings.push('🖼 需连接图像节点');
    }
    if (!motionPromptValue && textCount === 0) {
      warnings.push('🎬 建议提供运动描述：可连接文本节点，或填写运动描述');
    }
    return warnings;
  }

  if (toolId === 'video-gen') {
    if (!motionPromptValue && textCount === 0) {
      warnings.push('🎬 需提供文本描述：请连接文本节点，或填写运动描述');
    }
    return warnings;
  }

  if (toolId === 'explode-document') {
    if (upstreamNodes.length === 0) {
      warnings.push(`📄 需连接 1 个受支持的文件节点（${MINERU_SUPPORTED_FILE_HINT}）`);
      return warnings;
    }
    if (upstreamNodes.length > 1) {
      warnings.push(`📄 当前转换工具一次只支持 1 个受支持的文件（${MINERU_SUPPORTED_FILE_HINT}）`);
      return warnings;
    }
    const source = upstreamNodes[0];
    if (!isMinerUSupportedFilePath(source.file_path)) {
      warnings.push(`📄 当前转换工具仅支持 ${MINERU_SUPPORTED_FILE_HINT} 文件节点`);
    }
    return warnings;
  }

  if (toolDef?.apiType === 'tts') {
    if (textCount === 0) {
      warnings.push('📝 需连接文本节点（笔记 / AI 输出）');
    }
    return warnings;
  }

  if (toolDef?.apiType === 'stt') {
    if (audioCount === 0) {
      warnings.push('🎵 需连接音频节点');
    }
    return warnings;
  }

  const requiredSlots = toolDef?.slots?.filter(slot => slot.required) ?? [];
  if (requiredSlots.length > 0 && upstreamNodes.length === 0) {
    warnings.push(`📎 需连接：${requiredSlots.map(slot => slot.label).join('、')}`);
    return warnings;
  }

  if (toolDef?.apiType !== 'chat' && upstreamNodes.length === 0) {
    warnings.push('📎 需连接输入数据节点');
  }

  return warnings;
}

function FullFunctionNode({
  id,
  data,
  selected,
  status,
  icon,
}: {
  id: string;
  data: CanvasNode;
  selected: boolean;
  status: FnStatus;
  icon: string;
}) {
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNodeParamValue = useCanvasStore(s => s.updateNodeParamValue);
  const requestModelCache = useCanvasStore(s => s.requestModelCache);
  const updateNodeSize = useCanvasStore(s => s.updateNodeSize);
  const updateInputOrder = useCanvasStore(s => s.updateInputOrder);
  const getUpstreamNodes = useCanvasStore(s => s.getUpstreamNodes);
  const selectExclusiveNode = useCanvasStore(s => s.selectExclusiveNode);
  const openSettingsDetailView = useCanvasStore(s => s.openSettingsDetailView);
  const modelCache = useCanvasStore(s => s.modelCache);
  const settings = useCanvasStore(s => s.settings);
  const toolDefs = useCanvasStore(s => s.toolDefs);
  const canvasFile = useCanvasStore(s => s.canvasFile);
  const canvasDetailLevel = useCanvasStore(s => s.canvasDetailLevel);
  const shouldRenderFunctionDetails = canvasDetailLevel === 'full';

  const [promptOpen, setPromptOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const heightSyncOuterRafRef = useRef<number | null>(null);
  const heightSyncInnerRafRef = useRef<number | null>(null);
  const lastAutoHeightRef = useRef<number>(data.size?.height ?? MIN_FUNCTION_NODE_HEIGHT);

  // v2.0: Cycle error shake animation
  const cycleErrorNodeId = useCanvasStore(s => (s as any)._cycleErrorNodeId) as string | null;
  const isCycleError = cycleErrorNodeId === data.id;

  // v2.0: Pipeline node status (overlay on top of normal fn_status)
  const pipelineNodeStatus = useCanvasStore(s => {
    const ps = s.pipelineState;
    if (!ps) { return null; }
    return ps.nodeStatuses[data.id] ?? null;
  }) as import('../../stores/canvas-store').PipelineNodeStatus | null;
  const pipelineNodeIssue = useCanvasStore(s => {
    const ps = s.pipelineState;
    if (!ps) { return null; }
    return ps.nodeIssues[data.id] ?? null;
  });

  // Local draft for the system prompt textarea
  const [promptDraft, setPromptDraft] = useState<string>(
    (data.meta?.param_values?.['_systemPrompt'] as string) ?? ''
  );
  // Local draft for the chat prompt textarea
  const [chatDraft, setChatDraft] = useState<string>(
    (data.meta?.param_values?.['_chatPrompt'] as string) ?? ''
  );
  const promptSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const chatSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

  // If _provider is not explicitly set on this node, we use the global default
  const nodeProvider    = (data.meta?.param_values?.['_provider'] as string) || '';
  const currentProvider = nodeProvider || (settings?.globalProvider ?? 'copilot');
  const currentModel    = (data.meta?.param_values?.['_model']    as string) ?? '';
  const customPrompt    = (data.meta?.param_values?.['_systemPrompt'] as string) ?? '';
  const tool            = data.meta?.ai_tool ?? 'summarize';

  // Resolve tool definition to check uiMode and apiType
  const toolDef = toolDefs.find(t => t.id === tool);
  const isChatMode = toolDef?.uiMode === 'chat';
  const isMultimodal = !!(toolDef?.apiType && ['image_generation', 'image_edit', 'tts', 'stt', 'video_generation'].includes(toolDef.apiType));
  const isExplosionTool = toolDef?.apiType === 'explosion';
  const isSystemTool = isExplosionTool;
  const hasMinerUToken = !!settings?.mineruApiToken?.trim();
  // For multimodal tools, resolve the global default model from settings
  const MULTIMODAL_SETTINGS_KEY: Record<string, keyof typeof settings> = {
    'image-gen':      'aiHubMixImageGenModel',
    'image-edit':     'aiHubMixImageEditModel',
    'image-fusion':   'aiHubMixImageFusionModel',
    'image-group-output': 'aiHubMixImageGroupModel',
    'tts':            'aiHubMixTtsModel',
    'stt':            'aiHubMixSttModel',
    'video-gen':      'aiHubMixVideoGenModel',
    'image-to-video': 'aiHubMixVideoGenModel',
  };
  const multimodalSettingsKey = MULTIMODAL_SETTINGS_KEY[tool];
  const globalDefaultModel = (settings && multimodalSettingsKey)
    ? (settings[multimodalSettingsKey] as string | undefined) ?? ''
    : '';

  // Upstream nodes (ordered)
  const upstreamNodes = canvasDetailLevel === 'minimal' ? [] : getUpstreamNodes(data.id);
  const supportedExplosionInputs = upstreamNodes.filter(node => isMinerUSupportedFilePath(node.file_path));
  const supportedExplosionInputCount = supportedExplosionInputs.length;
  const hasSingleSupportedExplosionInput = upstreamNodes.length === 1 && supportedExplosionInputCount === 1;
  const singleExplosionSourceType = getExplosionSourceTypeFromPath(supportedExplosionInputs[0]?.file_path);
  const singleExplosionInputType = (() => {
    if (singleExplosionSourceType === 'pdf') { return 'PDF'; }
    if (singleExplosionSourceType === 'docx') { return 'Word'; }
    if (singleExplosionSourceType === 'pptx') { return 'PPT'; }
    if (singleExplosionSourceType === 'xlsx') { return 'XLS / XLSX'; }
    if (singleExplosionSourceType === 'image') { return '图片'; }
    return null;
  })();
  const documentConversionMode = String(data.meta?.param_values?.['document_conversion_mode'] ?? 'text_images');
  const spreadsheetFormat = String(data.meta?.param_values?.['spreadsheet_format'] ?? 'md');
  const isSpreadsheetConversionInput = singleExplosionSourceType === 'xlsx';
  const isPngConvertibleInput = singleExplosionSourceType === 'pdf' || singleExplosionSourceType === 'docx' || singleExplosionSourceType === 'pptx';
  const activeConversionLabel = isSpreadsheetConversionInput
    ? (spreadsheetFormat === 'tex' ? '表格 → TeX tabular' : '表格 → Markdown')
    : isPngConvertibleInput && documentConversionMode === 'png'
      ? `${singleExplosionInputType ?? '文档'} → PNG`
      : '文字 + 图片拆解';
  const conversionUsesMinerU = !isSpreadsheetConversionInput && !(isPngConvertibleInput && documentConversionMode === 'png');
  const explosionNeedsToken = conversionUsesMinerU && requiresMinerUTokenForSourceType(singleExplosionSourceType);
  const explosionReady = isExplosionTool && hasSingleSupportedExplosionInput && (!explosionNeedsToken || hasMinerUToken);
  const explosionStatusColors = explosionReady
    ? {
        fg: 'var(--vscode-inputValidation-infoForeground, #75beff)',
        border: 'var(--vscode-inputValidation-infoBorder, #75beff60)',
        chipBg: 'rgba(117,190,255,0.12)',
      }
    : {
        fg: 'var(--vscode-inputValidation-warningForeground, #ffcc00)',
        border: 'var(--vscode-inputValidation-warningBorder, #ffcc0060)',
        chipBg: 'rgba(255,204,0,0.12)',
      };

  // When store value changes externally (e.g. undo/redo), sync drafts
  useEffect(() => {
    const stored = (data.meta?.param_values?.['_systemPrompt'] as string) ?? '';
    setPromptDraft(stored);
  }, [data.meta?.param_values?.['_systemPrompt']]);

  useEffect(() => {
    const stored = (data.meta?.param_values?.['_chatPrompt'] as string) ?? '';
    setChatDraft(stored);
  }, [data.meta?.param_values?.['_chatPrompt']]);

  // 优先使用当前工具定义，避免旧画布里历史 function 节点继续吃旧 schema。
  const inputSchema = Array.isArray(toolDef?.params)
    ? toolDef.params
    : (Array.isArray(data.meta?.input_schema) ? data.meta!.input_schema : []);
  const schema = parseInputParams(inputSchema);
  const toolModelParam = toolDef?.params.find(param => param.name === 'model');
  const effectiveMultimodalModel = isMultimodal
    ? String(
        (data.meta?.param_values?.['model'] as string | undefined)
        || globalDefaultModel
        || toolModelParam?.default
        || toolModelParam?.options?.[0]
        || ''
      )
    : '';
  const visibleOptionalParams = resolveVisibleOptionalParams(tool, schema.optional, effectiveMultimodalModel);
  const promptParamValue = String((data.meta?.param_values?.['prompt'] as string | undefined) ?? '').trim();
  const instructionParamValue = String((data.meta?.param_values?.['instruction'] as string | undefined) ?? '').trim();
  const queryValue = String((data.meta?.param_values?.['query'] as string | undefined) ?? '').trim();
  const styleHintValue = String((data.meta?.param_values?.['style_hint'] as string | undefined) ?? '').trim();
  const motionPromptValue = String((data.meta?.param_values?.['motion_prompt'] as string | undefined) ?? '').trim();
  const toolWarnings = buildToolWarnings({
    toolId: tool,
    toolDef,
    upstreamNodes,
    promptParamValue,
    instructionParamValue,
    chatDraft,
    queryValue,
    styleHintValue,
    motionPromptValue,
  });

  // ── Provider change ────────────────────────────────────────────────────────
  const handleProviderChange = useCallback((newProvider: string) => {
    // newProvider === '' means "follow global" — store empty string to clear override
    updateNodeParamValue(data.id, '_provider', newProvider);
    updateNodeParamValue(data.id, '_model', '');
    // Prefetch models for the effective provider
    const effectiveProvider = newProvider || (settings?.globalProvider ?? 'copilot');
    requestModelCache(effectiveProvider);
  }, [data.id, updateNodeParamValue, requestModelCache, settings?.globalProvider]);

  // On first render, prefetch models for current provider
  useEffect(() => {
    requestModelCache(currentProvider);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Model options ──────────────────────────────────────────────────────────
  const models = modelCache[currentProvider] ?? null;
  const favoriteModelIds = getFavoriteModelsForProvider(currentProvider, settings ?? null, models ?? undefined);
  const visibleModels = (() => {
    if (!models) { return models; }
    if (favoriteModelIds.length === 0) { return models; }
    const favoriteSet = new Set(favoriteModelIds);
    const matchedFavorites = orderModelsByIds(
      models.filter(model => favoriteSet.has(model.id)),
      favoriteModelIds,
    );
    if (currentModel && !favoriteSet.has(currentModel)) {
      const selectedModel = models.find(model => model.id === currentModel);
      if (selectedModel) {
        matchedFavorites.push(selectedModel);
      }
    }
    return matchedFavorites;
  })();
  const effectiveGlobalModelLabel = getConcreteProviderModelLabel(settings?.globalProvider ?? 'copilot', settings ?? null, modelCache);
  const providerFollowLabel = `全局 (${getProviderDisplayName(
    settings?.globalProvider ?? 'copilot',
    settings ?? null
  )}${effectiveGlobalModelLabel ? ` · ${effectiveGlobalModelLabel}` : ''})`;
  const currentProviderAutoModelLabel = getAutoModelLabel(currentProvider, settings ?? null, modelCache, {
    emptyStateText: currentProvider === 'copilot'
      ? '自动（正在加载 Copilot 具体模型…）'
      : '自动（当前未配置具体模型）',
  });
  const providerOptions: NodeSelectOption[] = [
    { value: '', label: providerFollowLabel },
    ...Object.entries(PROVIDER_LABELS).map(([id, label]) => ({
      value: id,
      label,
    })),
    ...((settings?.customProviders ?? []).map(cp => ({
      value: cp.id,
      label: cp.name,
    }))),
  ];
  const modelOptions: NodeSelectOption[] = [
    {
      value: '',
      label: visibleModels === null
        ? '加载中…'
        : currentProvider === 'copilot'
          ? `跟随全局（${effectiveGlobalModelLabel || 'gpt-4.1'}）`
          : currentProviderAutoModelLabel,
      disabled: visibleModels === null,
    },
    ...((visibleModels ?? []).map(model => ({
      value: model.id,
      label: formatModelLabel(model.id, visibleModels ?? undefined),
    }))),
    ...((visibleModels && visibleModels.length === 0) ? [{ value: '__none__', label: '未找到常用模型', disabled: true }] : []),
  ];

  // ── System prompt handlers ────────────────────────────────────────────────
  const handlePromptChange = (value: string) => {
    setPromptDraft(value);
    if (promptSaveTimer.current) { clearTimeout(promptSaveTimer.current); }
    promptSaveTimer.current = setTimeout(() => {
      updateNodeParamValue(data.id, '_systemPrompt', value);
    }, 500);
  };

  const handlePromptReset = () => {
    setPromptDraft('');
    updateNodeParamValue(data.id, '_systemPrompt', '');
  };

  // ── Chat prompt handlers ──────────────────────────────────────────────────
  const handleChatChange = (value: string) => {
    setChatDraft(value);
    if (chatSaveTimer.current) { clearTimeout(chatSaveTimer.current); }
    chatSaveTimer.current = setTimeout(() => {
      updateNodeParamValue(data.id, '_chatPrompt', value);
    }, 300);
  };

  // Insert @filename reference at cursor position in the chat textarea
  const insertRef = (nodeTitle: string) => {
    const textarea = chatTextareaRef.current;
    // Derive ref name: use title without extension, replace spaces with underscores
    const refName = nodeTitle.replace(/\.[^/.]+$/, '').replace(/\s+/g, '_');
    const atRef = `@${refName}`;

    if (textarea) {
      const start = textarea.selectionStart ?? chatDraft.length;
      const end = textarea.selectionEnd ?? chatDraft.length;
      const before = chatDraft.slice(0, start);
      const after = chatDraft.slice(end);
      const newVal = before + atRef + ' ' + after;
      handleChatChange(newVal);
      // Restore focus and cursor after state update
      requestAnimationFrame(() => {
        textarea.focus();
        const pos = start + atRef.length + 1;
        textarea.setSelectionRange(pos, pos);
      });
    } else {
      handleChatChange(chatDraft + (chatDraft ? ' ' : '') + atRef + ' ');
    }
  };

  // ── Drag-to-reorder inputs ────────────────────────────────────────────────
  const dragSourceId = useRef<string | null>(null);

  const handleDragStart = (e: React.DragEvent, nodeId: string) => {
    e.stopPropagation();
    dragSourceId.current = nodeId;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const srcId = dragSourceId.current;
    if (!srcId || srcId === targetId) { return; }
    const currentOrder = upstreamNodes.map(n => n.id);
    const srcIdx = currentOrder.indexOf(srcId);
    const tgtIdx = currentOrder.indexOf(targetId);
    if (srcIdx < 0 || tgtIdx < 0) { return; }
    const newOrder = [...currentOrder];
    newOrder.splice(srcIdx, 1);
    newOrder.splice(tgtIdx, 0, srcId);
    updateInputOrder(data.id, newOrder);
    dragSourceId.current = null;
  };

  // High-cost tools get a 2s delay before API call
  const isHighCost = isHighCostAiTool(toolDef?.apiType);
  const costNotice = getAiToolCostNotice(tool, toolDef?.apiType);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRun = () => {
    if (isHighCost) {
      // Start 2s countdown before actually calling API
      setCountdown(2);
      let remaining = 2;
      countdownTimer.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (countdownTimer.current) { clearInterval(countdownTimer.current); countdownTimer.current = null; }
          setCountdown(null);
          postMessage({ type: 'runFunction', nodeId: data.id, canvas: canvasFile ?? undefined });
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    } else {
      postMessage({ type: 'runFunction', nodeId: data.id, canvas: canvasFile ?? undefined });
    }
  };

  const handleCancel = () => {
    // Cancel countdown if still waiting
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
      setCountdown(null);
      return;
    }
    // Cancel running task
    postMessage({ type: 'cancelFunction', nodeId: data.id });
  };

  // Cleanup timer on unmount
  useEffect(() => () => { if (countdownTimer.current) clearInterval(countdownTimer.current); }, []);

  const selectStyle: React.CSSProperties = {
    flex: 1,
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--vscode-dropdown-background)',
    color: 'var(--vscode-dropdown-foreground)',
    border: '1px solid var(--vscode-dropdown-border)',
    borderRadius: 3,
    fontSize: 11,
    padding: '2px 4px',
    cursor: 'pointer',
    minWidth: 0,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--vscode-descriptionForeground)',
    flexShrink: 0,
    width: 58,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };

  // Pipeline state should own the node's visible execution state whenever present.
  const effectiveStatus: FnStatus = pipelineNodeStatus === 'running'
    ? 'running'
    : pipelineNodeStatus === 'done'
      ? 'done'
      : pipelineNodeStatus === 'failed'
        ? 'error'
        : status;
  const effectiveStatusColor = STATUS_COLORS[effectiveStatus];
  const effectiveProgressText = pipelineNodeStatus === 'waiting' || pipelineNodeStatus === 'skipped'
    ? ''
    : (data.meta?.fn_progress ?? '');
  const isVisuallyRunning = effectiveStatus === 'running';
  const pipelineDone = pipelineNodeStatus === 'done';
  const pipelineFailed = pipelineNodeStatus === 'failed';
  const pipelineRunning = pipelineNodeStatus === 'running';
  const pipelineSkipped = pipelineNodeStatus === 'skipped';
  const pipelineWaiting = pipelineNodeStatus === 'waiting';
  const nodeIssue = pipelineNodeIssue ?? (
    data.meta?.fn_issue_kind && data.meta?.fn_issue_message
      ? { kind: data.meta.fn_issue_kind, message: data.meta.fn_issue_message }
      : null
  );
  const showIssueBanner = !settings?.testMode && !!nodeIssue && (effectiveStatus === 'error' || pipelineFailed || pipelineSkipped);
  const showStopButton = isVisuallyRunning || countdown !== null;
  const calmBorder = `${selected ? NODE_SELECTED_BORDER_WIDTH : NODE_BORDER_WIDTH}px solid ${selected ? effectiveStatusColor : 'var(--vscode-panel-border)'}`;
  const calmBoxShadow = selected
    ? `0 0 0 1px ${withAlpha(effectiveStatusColor, 0.18, 'transparent')}, 0 10px 24px ${withAlpha(effectiveStatusColor, 0.12, 'rgba(0,0,0,0.18)')}`
    : '0 3px 10px rgba(0,0,0,0.18)';

  const badgeConfig = (() => {
    switch (pipelineNodeStatus) {
      case 'running':
        return { color: STATUS_COLORS.running, label: '流程运行中' };
      case 'waiting':
        return { color: 'var(--vscode-descriptionForeground)', label: '排队中' };
      case 'done':
        return { color: STATUS_COLORS.done, label: '流程完成' };
      case 'failed':
        return { color: STATUS_COLORS.error, label: '流程失败' };
      case 'skipped':
        return { color: 'var(--vscode-disabledForeground)', label: '已跳过' };
      default:
        return { color: effectiveStatusColor, label: STATUS_LABELS[effectiveStatus] };
    }
  })();

  useEffect(() => {
    lastAutoHeightRef.current = data.size?.height ?? MIN_FUNCTION_NODE_HEIGHT;
  }, [data.size?.height]);

  const scheduleNodeHeightSync = useCallback(() => {
    if (!shouldRenderFunctionDetails) {
      updateNodeInternals(id);
      return;
    }
    const el = contentRef.current;
    if (!el) { return; }
    if (heightSyncOuterRafRef.current !== null) {
      window.cancelAnimationFrame(heightSyncOuterRafRef.current);
      heightSyncOuterRafRef.current = null;
    }
    if (heightSyncInnerRafRef.current !== null) {
      window.cancelAnimationFrame(heightSyncInnerRafRef.current);
      heightSyncInnerRafRef.current = null;
    }
    heightSyncOuterRafRef.current = window.requestAnimationFrame(() => {
      heightSyncOuterRafRef.current = null;
      heightSyncInnerRafRef.current = window.requestAnimationFrame(() => {
      heightSyncInnerRafRef.current = null;
      if (!el.isConnected || contentRef.current !== el) { return; }
      const currentWidth = data.size?.width ?? 280;
      const currentHeight = data.size?.height ?? MIN_FUNCTION_NODE_HEIGHT;
      // Do not use getBoundingClientRect() here:
      // React Flow scales nodes with CSS transforms, and DOMRect height would then
      // include viewport zoom, causing auto-height to drift larger/smaller after
      // reloads, zoom changes, or seemingly harmless re-renders.
      const contentHeight = Math.max(
        Math.ceil(el.scrollHeight),
        Math.ceil(el.clientHeight),
        Math.ceil(el.offsetHeight),
      );
      const requiredHeight = Math.max(
        MIN_FUNCTION_NODE_HEIGHT,
        Math.ceil(contentHeight + FUNCTION_NODE_AUTO_HEIGHT_PADDING),
      );
      if (Math.abs(requiredHeight - currentHeight) > 2) {
        if (Math.abs(requiredHeight - lastAutoHeightRef.current) <= 2) {
          return;
        }
        lastAutoHeightRef.current = requiredHeight;
        updateNodeSize(id, currentWidth, requiredHeight);
      } else {
        updateNodeInternals(id);
      }
      });
    });
  }, [data.size?.height, data.size?.width, id, shouldRenderFunctionDetails, updateNodeInternals, updateNodeSize]);

  useEffect(() => {
    updateNodeInternals(id);
    const raf = window.requestAnimationFrame(() => updateNodeInternals(id));
    return () => window.cancelAnimationFrame(raf);
  }, [id, updateNodeInternals, promptOpen, inputsOpen, upstreamNodes.length, showIssueBanner, effectiveProgressText, pipelineNodeStatus, countdown]);

  useEffect(() => {
    scheduleNodeHeightSync();
  }, [
    countdown,
    data.size?.height,
    data.size?.width,
    effectiveProgressText,
    id,
    inputsOpen,
    pipelineNodeStatus,
    promptOpen,
    showIssueBanner,
    tool,
    toolWarnings.length,
    upstreamNodes.length,
    currentProvider,
    currentModel,
    modelOptions.length,
    favoriteModelIds.join('|'),
    scheduleNodeHeightSync,
  ]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') { return; }
    const observer = new ResizeObserver(() => {
      scheduleNodeHeightSync();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (heightSyncOuterRafRef.current !== null) {
        window.cancelAnimationFrame(heightSyncOuterRafRef.current);
        heightSyncOuterRafRef.current = null;
      }
      if (heightSyncInnerRafRef.current !== null) {
        window.cancelAnimationFrame(heightSyncInnerRafRef.current);
        heightSyncInnerRafRef.current = null;
      }
    };
  }, [scheduleNodeHeightSync]);

  return (
    <div
      ref={rootRef}
      onContextMenu={e => {
        e.preventDefault();
        e.stopPropagation();
        closeAllCanvasContextMenus();
        selectExclusiveNode(data.id);
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setCtxMenu({ x: e.clientX - rect.left + 8, y: e.clientY - rect.top + 8 });
      }}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <div
        className={`rs-node-surface rs-node-surface--interactive${selected ? ' rs-node-surface--selected' : ''}`}
        style={{
          width: '100%',
          height: '100%',
          background: 'var(--vscode-editor-background)',
          border: isVisuallyRunning
            ? '2px solid rgba(59,130,246,0.7)'
            : isCycleError
              ? '2px solid var(--vscode-terminal-ansiRed)'
              : pipelineDone
                ? '2px solid var(--vscode-terminal-ansiGreen)'
                : pipelineFailed
                  ? '2px solid var(--vscode-terminal-ansiRed)'
                    : pipelineSkipped
                    ? `${NODE_BORDER_WIDTH}px dashed var(--vscode-disabledForeground)`
                    : pipelineWaiting
                      ? `${NODE_BORDER_WIDTH}px dashed var(--vscode-descriptionForeground)`
                      : calmBorder,
          borderRadius: NODE_RADIUS,
          position: 'relative',
          boxSizing: 'border-box',
          minHeight: 0,
          overflow: 'hidden',
          opacity: pipelineSkipped ? 0.45 : 1,
          boxShadow: isVisuallyRunning
            ? '0 0 8px 2px rgba(59,130,246,0.4)'
            : isCycleError
              ? '0 0 8px 2px rgba(239,68,68,0.5)'
              : pipelineDone
                ? '0 0 6px 1px rgba(34,197,94,0.3)'
                : pipelineFailed
                ? '0 0 6px 1px rgba(239,68,68,0.3)'
                  : calmBoxShadow,
          animation: isVisuallyRunning
            ? 'rsFnBorderFlow 3s linear infinite, rsFnGlow 2.5s ease-in-out infinite'
            : isCycleError
              ? 'rsFnShake 0.5s ease-in-out'
              : undefined,
          transition: 'border-color 0.3s, box-shadow 0.3s, opacity 0.3s',
        }}
      >
      <div
        ref={contentRef}
        style={{
          padding: FUNCTION_NODE_PADDING,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          boxSizing: 'border-box',
        }}
      >

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: shouldRenderFunctionDetails
            ? NODE_HEADER_ICON_SIZE + 1
            : canvasDetailLevel === 'minimal' ? 40 : 26,
          lineHeight: 1,
        }}>{icon}</span>
        <span style={{
          ...NODE_HEADER_TITLE_STYLE,
          fontSize: shouldRenderFunctionDetails
            ? NODE_HEADER_TITLE_STYLE.fontSize
            : canvasDetailLevel === 'minimal' ? 42 : 26,
          lineHeight: shouldRenderFunctionDetails ? NODE_HEADER_TITLE_STYLE.lineHeight : 1.12,
          flex: 1,
          whiteSpace: shouldRenderFunctionDetails ? NODE_HEADER_TITLE_STYLE.whiteSpace : 'normal',
          display: shouldRenderFunctionDetails ? undefined : '-webkit-box',
          WebkitLineClamp: canvasDetailLevel === 'minimal' ? 2 : 1,
          WebkitBoxOrient: shouldRenderFunctionDetails ? undefined : 'vertical',
        }}>
          {data.title || '功能节点'}
        </span>
        <StatusBadge color={badgeConfig.color} label={badgeConfig.label} />
        {/* Pipeline status overlay */}
        {pipelineRunning && <span style={{ fontSize: 14, flexShrink: 0 }} title="Pipeline 运行中">▶</span>}
        {pipelineDone && <span style={{ fontSize: 14, flexShrink: 0 }} title="Pipeline 完成">✅</span>}
        {pipelineFailed && <span style={{ fontSize: 14, flexShrink: 0 }} title="Pipeline 失败">❌</span>}
        {pipelineSkipped && <span style={{ fontSize: 12, flexShrink: 0, color: 'var(--vscode-disabledForeground)' }} title="已跳过（上游错误）">⊘</span>}
        {pipelineWaiting && <span style={{ fontSize: 12, flexShrink: 0, color: 'var(--vscode-descriptionForeground)' }} title="等待执行">⏳</span>}
      </div>

      {/* Progress / Peek Preview */}
      {isVisuallyRunning && effectiveProgressText && (
        <div style={{
          fontSize: 10,
          color: effectiveStatusColor,
          background: effectiveStatusColor + '12',
          border: `1px solid ${effectiveStatusColor}30`,
          borderRadius: 4,
          padding: '4px 7px',
          lineHeight: 1.5,
          overflow: 'hidden',
          maxHeight: 48,
          textOverflow: 'ellipsis',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {effectiveProgressText}
        </div>
      )}

      {showIssueBanner && nodeIssue && (
        <div style={{
          fontSize: 10,
          color: pipelineSkipped
            ? 'var(--vscode-descriptionForeground)'
            : 'var(--vscode-inputValidation-errorForeground, #f48771)',
          background: pipelineSkipped
            ? 'var(--vscode-input-background)'
            : 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
          border: `1px solid ${pipelineSkipped
            ? 'var(--vscode-panel-border)'
            : 'var(--vscode-inputValidation-errorBorder, #be1100)'}`,
          borderRadius: 4,
          padding: '5px 7px',
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          <strong>{RUN_ISSUE_LABELS[nodeIssue.kind] ?? '执行问题'}</strong>
          {' · '}
          {nodeIssue.message}
        </div>
      )}

      {!shouldRenderFunctionDetails && (
        <CompactFunctionPreview
          accentColor={effectiveStatusColor}
          toolName={toolDef?.name ?? tool}
          toolId={tool}
          statusLabel={badgeConfig.label}
          inputSummary={canvasDetailLevel === 'minimal'
            ? '输入详情已折叠'
            : upstreamNodes.length > 0
              ? `${upstreamNodes.length} 个输入`
              : '未连接输入'}
          level={canvasDetailLevel}
        />
      )}

      {shouldRenderFunctionDetails && (
      <>
      {/* Divider */}
      <div style={{ height: 1, background: 'var(--vscode-panel-border)', margin: `0 -${FUNCTION_NODE_PADDING}px` }} />

      {/* Provider / Model — only for LLM (text) tools */}
      {isSystemTool ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            fontSize: 10,
            color: 'var(--vscode-descriptionForeground)',
            padding: '4px 6px',
            background: 'var(--vscode-input-background)',
            borderRadius: 4,
            border: '1px solid var(--vscode-panel-border)',
          }}>
            🔁 系统工具 · 连接 1 个受支持文件后执行格式转换
          </div>
          {isExplosionTool && (
            <div style={{
              fontSize: 10,
              color: 'var(--vscode-foreground)',
              background: 'var(--vscode-editor-background)',
              border: '1px solid var(--vscode-panel-border)',
              borderRadius: 4,
              padding: '6px 8px',
              lineHeight: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '4px 6px',
                borderRadius: 4,
                background: explosionStatusColors.chipBg,
                border: `1px solid ${explosionStatusColors.border}`,
              }}>
                <div style={{
                  fontWeight: 700,
                  color: explosionStatusColors.fg,
                }}>
                  {explosionReady
                    ? '✅ 已就绪，可直接运行'
                    : explosionNeedsToken && !hasMinerUToken
                      ? '⚠ 还不能运行：缺少 MinerU Token'
                      : !hasSingleSupportedExplosionInput
                        ? '⚠ 还不能运行：需要 1 个受支持文件输入'
                        : '⚠ 当前输入状态仍需检查'}
                </div>
                <span style={{
                  flexShrink: 0,
                  fontSize: 9,
                  padding: '2px 6px',
                  borderRadius: 999,
                  background: explosionStatusColors.chipBg,
                  color: explosionStatusColors.fg,
                  border: `1px solid ${explosionStatusColors.border}`,
                }}>
                  {explosionReady ? activeConversionLabel : 'Setup Required'}
                </span>
              </div>
              {hasSingleSupportedExplosionInput && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}>
                  {isSpreadsheetConversionInput ? (
                    <div style={rowStyle}>
                      <span style={labelStyle}>表格格式</span>
                      <NodeSelect
                        value={spreadsheetFormat === 'tex' ? 'tex' : 'md'}
                        onChange={value => updateNodeParamValue(data.id, 'spreadsheet_format', value)}
                        options={[
                          { value: 'md', label: 'Markdown 表格' },
                          { value: 'tex', label: 'TeX tabular 片段' },
                        ]}
                        style={selectStyle}
                      />
                    </div>
                  ) : isPngConvertibleInput ? (
                    <div style={rowStyle}>
                      <span style={labelStyle}>转换模式</span>
                      <NodeSelect
                        value={documentConversionMode === 'png' ? 'png' : 'text_images'}
                        onChange={value => updateNodeParamValue(data.id, 'document_conversion_mode', value)}
                        options={[
                          { value: 'text_images', label: '拆解为文字 + 图片' },
                          { value: 'png', label: `${singleExplosionInputType ?? '文档'} → PNG` },
                        ]}
                        style={selectStyle}
                      />
                    </div>
                  ) : null}
                </div>
              )}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                color: 'var(--vscode-descriptionForeground)',
              }}>
                <div>
                  {isSpreadsheetConversionInput
                    ? '表格会转换成单个 Markdown / TeX 文件节点，不调用 MinerU。'
                    : documentConversionMode === 'png' && isPngConvertibleInput
                      ? '文档会先转成 PDF，再逐页生成 PNG 图片节点组。'
                      : '输出文本 / 图片节点组，供后续 AI 继续读取。'}
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span>{!explosionNeedsToken || hasMinerUToken ? '✅' : '◻'}</span>
                    <span>{explosionNeedsToken ? '已配置 MinerU Token' : '当前输入类型无需 MinerU Token'}</span>
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span>{hasSingleSupportedExplosionInput ? '✅' : '◻'}</span>
                    <span>
                      已连接 1 个受支持文件
                      {upstreamNodes.length > 0
                        ? `（当前类型：${singleExplosionInputType ?? '未识别'}）`
                        : ''}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}>
                <div style={{
                  fontSize: 9,
                  color: 'var(--vscode-descriptionForeground)',
                }}>
                  {singleExplosionSourceType === 'pptx' && documentConversionMode === 'png'
                    ? 'PPT 会先导出 PDF，再逐页转换为 PNG；如系统弹出授权，请先处理。'
                    : singleExplosionSourceType === 'docx' && documentConversionMode === 'png'
                      ? 'Word 转 PNG 需要本机可用的 LibreOffice / soffice。'
                      : singleExplosionSourceType === 'pptx'
                        ? 'PPT 拆解会先请求整页预览授权，再继续 MinerU 拆解。'
                    : explosionNeedsToken
                      ? (hasMinerUToken ? '已配置，可直接运行。' : '首次使用请先完成密钥配置。')
                      : '当前输入类型无需额外密钥。'}
                </div>
                <button
                  onClick={() => openSettingsDetailView('explosion')}
                  style={{
                    background: 'none',
                    border: '1px solid var(--vscode-panel-border)',
                    borderRadius: 4,
                    color: 'var(--vscode-foreground)',
                    fontSize: 10,
                    padding: '3px 8px',
                    cursor: 'pointer',
                  }}
                >
                  打开文档转换设置
                </button>
              </div>
            </div>
          )}
        </div>
      ) : isMultimodal ? (
        <div style={{
          fontSize: 10,
          color: 'var(--vscode-descriptionForeground)',
          padding: '4px 6px',
          background: 'var(--vscode-input-background)',
          borderRadius: 4,
          border: '1px solid var(--vscode-panel-border)',
        }}>
          🖼 多模态工具 · 使用 AIHubMix API Key
        </div>
      ) : (
        <>
          {/* Provider selector */}
          <div style={rowStyle}>
            <span style={labelStyle}>服务商</span>
            <NodeSelect
              value={nodeProvider}
              onChange={handleProviderChange}
              options={providerOptions}
              style={{
                ...selectStyle,
                color: nodeProvider ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)',
              }}
            />
          </div>

          {/* Model selector — always shown */}
          <div style={rowStyle}>
            <span style={labelStyle}>模型</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <NodeSelect
                value={currentModel}
                onChange={v => updateNodeParamValue(data.id, '_model', v)}
                options={modelOptions}
                style={selectStyle}
                disabled={models === null}
              />
              <div
                style={{
                  marginTop: 4,
                  minHeight: 14,
                  fontSize: 10,
                  color: 'var(--vscode-descriptionForeground)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  visibility: favoriteModelIds.length > 0 ? 'visible' : 'hidden',
                }}
              >
                仅显示常用模型；可在设置 → 文本服务商 → 常用模型 中调整
              </div>
            </div>
          </div>
        </>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--vscode-panel-border)', margin: `0 -${FUNCTION_NODE_PADDING}px` }} />

      {/* ── Chat UI ── */}
      {isChatMode ? (
        <ChatPromptEditor
          upstreamNodes={upstreamNodes}
          chatDraft={chatDraft}
          chatTextareaRef={chatTextareaRef}
          onChatChange={handleChatChange}
          onInsertRef={insertRef}
        />
      ) : (
        <>
          {/* Inputs reorder section (non-chat tools) */}
          {upstreamNodes.length > 0 && (
            <>
              <button
                onClick={() => setInputsOpen(o => !o)}
                style={{
                  background: 'none',
                  border: '1px solid var(--vscode-panel-border)',
                  borderRadius: 4,
                  color: 'var(--vscode-descriptionForeground)',
                  fontSize: 11,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{inputsOpen ? '▾' : '▸'}</span>
                <span>输入 ({upstreamNodes.length})</span>
              </button>

              {inputsOpen && (
                <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {upstreamNodes.map((n, idx) => (
                    <div
                      key={n.id}
                      draggable
                      onDragStart={e => handleDragStart(e, n.id)}
                      onDragOver={handleDragOver}
                      onDrop={e => handleDrop(e, n.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 6px',
                        borderRadius: 4,
                        background: 'var(--vscode-input-background)',
                        cursor: 'grab',
                        fontSize: 11,
                        userSelect: 'none',
                      }}
                    >
                      <span style={{ fontSize: 13, color: 'var(--vscode-descriptionForeground)', cursor: 'grab' }}>⠿</span>
                      <span style={{ fontSize: 12 }}>{NODE_TYPE_ICONS[n.node_type] ?? '📁'}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.title || n.node_type}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', flexShrink: 0 }}>
                        #{idx + 1}
                      </span>
                    </div>
                  ))}
                  <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', paddingTop: 2 }}>
                    拖拽可排序 — AI 将按此顺序处理输入
                  </div>
                </div>
              )}
              <div style={{ height: 1, background: 'var(--vscode-panel-border)', margin: `0 -${FUNCTION_NODE_PADDING}px` }} />
            </>
          )}

          {/* Input connection guide — universal for all non-chat tools */}
          {upstreamNodes.length === 0 && toolWarnings.length === 0 && (() => {
            // Determine the hint based on tool type
            let hint = '';
            if (toolDef?.id === 'image-fusion') {
              hint = '🧩 需至少连接 2 个图像节点；融合指令请在下方参数中填写';
            } else if (toolDef?.apiType === 'image_edit') {
              hint = '🖼 需连接图像节点作为参考图；编辑指令可直接填写，也可连接文本节点';
            } else if (toolDef?.id === 'image-group-output') {
              hint = '📝 可连接文本节点提供组图描述，或直接在下方参数中填写';
            } else if (toolDef?.id === 'image-gen') {
              hint = '📝 可直接填写图像描述，也可连接文本节点提供描述';
            } else if (toolDef?.id === 'image-to-video') {
              hint = '🖼 需连接图像节点实现图生视频';
            } else if (toolDef?.apiType === 'stt') {
              hint = '🎵 需连接音频节点进行转录';
            } else if (toolDef?.apiType === 'tts') {
              hint = '📝 需连接文本节点（笔记 / AI 输出）作为输入';
            } else if (toolDef?.apiType === 'video_generation') {
              hint = '📝 可连接文本节点提供描述，或直接在参数中填写';
            } else if (toolDef?.apiType === 'explosion') {
              hint = `🔁 需连接 1 个受支持的文件节点（${MINERU_SUPPORTED_FILE_HINT}）；运行后会在原文件右侧生成转换结果组`;
            } else if (toolDef?.slots && toolDef.slots.length > 0) {
              const required = toolDef.slots.filter(s => s.required);
              if (required.length > 0) {
                hint = '📎 需连接：' + required.map(s => s.label).join('、');
              } else {
                hint = '📎 可连接数据节点作为输入';
              }
            } else {
              hint = '📎 需连接数据节点（PDF / 笔记 / 代码等）作为输入';
            }
            return (
              <div style={{
                fontSize: 10, padding: '5px 8px', borderRadius: 4,
                background: 'var(--vscode-inputValidation-infoBackground, #0e3a5e)',
                color: 'var(--vscode-inputValidation-infoForeground, #75beff)',
                border: '1px solid var(--vscode-inputValidation-infoBorder, #75beff60)',
              }}>
                {hint}
              </div>
            );
          })()}
          {toolWarnings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {toolWarnings.map((warning, index) => (
                <div
                  key={`${tool}-warning-${index}`}
                  style={{
                    fontSize: 10,
                    padding: '5px 8px',
                    borderRadius: 4,
                    background: 'var(--vscode-inputValidation-warningBackground, #3a2e00)',
                    color: 'var(--vscode-inputValidation-warningForeground, #ffcc00)',
                    border: '1px solid var(--vscode-inputValidation-warningBorder, #ffcc0060)',
                  }}
                >
                  {warning}
                </div>
              ))}
            </div>
          )}

          {costNotice && (
            <div style={{
              fontSize: 10,
              padding: '5px 8px',
              borderRadius: 4,
              lineHeight: 1.45,
              background: costNotice.tone === 'warning'
                ? 'var(--vscode-inputValidation-warningBackground, #3a2e00)'
                : 'var(--vscode-inputValidation-infoBackground, #0e3a5e)',
              color: costNotice.tone === 'warning'
                ? 'var(--vscode-inputValidation-warningForeground, #ffcc00)'
                : 'var(--vscode-inputValidation-infoForeground, #75beff)',
              border: `1px solid ${costNotice.tone === 'warning'
                ? 'var(--vscode-inputValidation-warningBorder, #ffcc0060)'
                : 'var(--vscode-inputValidation-infoBorder, #75beff60)'}`,
            }}>
              {costNotice.text}
            </div>
          )}

          {/* System Prompt editor toggle — only for LLM tools */}
          {!isMultimodal && !isSystemTool && (
            <>
              <button
                onClick={() => setPromptOpen(o => !o)}
                style={{
                  background: 'none',
                  border: '1px solid var(--vscode-panel-border)',
                  borderRadius: 4,
                  color: customPrompt
                    ? 'var(--vscode-terminal-ansiYellow)'
                    : 'var(--vscode-descriptionForeground)',
                  fontSize: 11,
                  padding: '3px 8px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{promptOpen ? '▾' : '▸'}</span>
                <span>
                  {customPrompt ? '✏ 自定义 Prompt（已启用）' : '✏ 编辑系统 Prompt'}
                </span>
              </button>

              {/* Prompt editor panel */}
              {promptOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <textarea
                    className="nodrag"
                    value={promptDraft}
                    onChange={e => handlePromptChange(e.target.value)}
                    onMouseDown={stopEditableFieldMouseDown}
                    placeholder={TOOL_DEFAULT_PROMPTS[tool] ?? '输入自定义系统 Prompt…'}
                    rows={6}
                    style={{
                      width: '100%',
                      background: 'var(--vscode-input-background)',
                      color: 'var(--vscode-input-foreground)',
                      border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
                      borderRadius: 4,
                      fontSize: 11,
                      padding: '6px 8px',
                      resize: 'vertical',
                      fontFamily: 'var(--vscode-editor-font-family, monospace)',
                      lineHeight: 1.5,
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
                      {promptDraft ? '自定义 Prompt 已启用' : '使用工具默认 Prompt'}
                    </span>
                    {promptDraft && (
                      <button
                        onClick={handlePromptReset}
                        style={{
                          background: 'none',
                          border: '1px solid var(--vscode-panel-border)',
                          borderRadius: 3,
                          color: 'var(--vscode-descriptionForeground)',
                          fontSize: 10,
                          padding: '2px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        恢复默认
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.45 }}>
                    运行时会自动追加正文内引用规则：连接输入会标记为 [资料1]、[资料2]，AI 应在相关句子或段落末尾嵌入这些来源标签；请避免在自定义 Prompt 中要求删除引用或仅在末尾列来源。
                  </div>
                </div>
              )}
            </>
          )}

          {/* Optional tool params */}
          {visibleOptionalParams.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--vscode-panel-border)', margin: `0 -${FUNCTION_NODE_PADDING}px` }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {visibleOptionalParams.map(p => (
                  <ParamControl
                    key={p.name}
                    param={p}
                    nodeData={data}
                    globalDefaultModel={globalDefaultModel}
                    isMultimodal={isMultimodal}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Run / Stop button */}
      <div style={{ display: 'flex', gap: 4 }}>
        {showStopButton ? (
          <button
            onClick={handleCancel}
            style={{
              flex: 1,
              background: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
              color: 'var(--vscode-inputValidation-errorForeground, #f48771)',
              border: '1px solid var(--vscode-inputValidation-errorBorder, #be1100)',
              borderRadius: 4,
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {getCancelButtonLabel(countdown)}
          </button>
        ) : (
          <>
            <button
              onClick={handleRun}
              disabled={isVisuallyRunning}
              style={{
                flex: 1,
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
                border: 'none',
                borderRadius: 4,
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {getRunButtonLabel({ isHighCost, countdown, isRunning: isVisuallyRunning })}
            </button>
          </>
        )}
      </div>
      </>
      )}
      </div>
      </div>

      {/* Handles */}
      <Handle
        className={NODE_PORT_CLASSNAME}
        type="target"
        position={Position.Left}
        id={NODE_PORT_IDS.in}
        title={getNodePortLabel('in')}
        aria-label={getNodePortLabel('in')}
        data-rs-port-label={getNodePortLabel('in')}
        isConnectable
        isConnectableStart={false}
        isConnectableEnd
        style={buildNodePortStyle(effectiveStatusColor, 'in')}
      />
      <Handle
        className={NODE_PORT_CLASSNAME}
        type="source"
        position={Position.Right}
        id={NODE_PORT_IDS.out}
        title={getNodePortLabel('out')}
        aria-label={getNodePortLabel('out')}
        data-rs-port-label={getNodePortLabel('out')}
        isConnectable
        isConnectableStart
        isConnectableEnd={false}
        style={buildNodePortStyle(effectiveStatusColor, 'out')}
      />

      {/* Context menu */}
      {ctxMenu && (
        <NodeContextMenu
          nodeId={data.id}
          nodeType={data.node_type}
          nodeTitle={data.title || ''}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          canDuplicate={true}
        />
      )}
    </div>
  );
}

// ── Chat prompt editor component ──────────────────────────────────────────────
function ChatPromptEditor({
  upstreamNodes,
  chatDraft,
  chatTextareaRef,
  onChatChange,
  onInsertRef,
}: {
  upstreamNodes: CanvasNode[];
  chatDraft: string;
  chatTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onChatChange: (value: string) => void;
  onInsertRef: (title: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Connected file tags */}
      {upstreamNodes.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', marginBottom: 4 }}>
            已连接文件 — 点击插入引用：
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {upstreamNodes.map(n => (
              <button
                key={n.id}
                onClick={() => onInsertRef(n.title || n.node_type)}
                title={`Insert @${(n.title || n.node_type).replace(/\.[^/.]+$/, '').replace(/\s+/g, '_')}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'var(--vscode-badge-background)',
                  color: 'var(--vscode-badge-foreground)',
                  border: 'none',
                  borderRadius: 10,
                  padding: '2px 8px',
                  fontSize: 11,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                <span>{NODE_TYPE_ICONS[n.node_type] ?? '📁'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {n.title || n.node_type}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat textarea */}
      <textarea
        className="nodrag"
        ref={chatTextareaRef}
        value={chatDraft}
        onChange={e => onChatChange(e.target.value)}
        onMouseDown={stopEditableFieldMouseDown}
        placeholder={upstreamNodes.length > 0
          ? '输入 Prompt… 点击上方文件标签可插入 @引用'
          : '输入 Prompt… 连接文件后可通过 @文件名 引用'
        }
        rows={5}
        style={{
          width: '100%',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
          borderRadius: 4,
          fontSize: 11,
          padding: '6px 8px',
          resize: 'vertical',
          fontFamily: 'var(--vscode-font-family, sans-serif)',
          lineHeight: 1.5,
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      fontSize: 10,
      background: color + '30',
      color,
      padding: '1px 6px',
      borderRadius: 4,
      fontWeight: 600,
      flexShrink: 0,
    }}>
      {label}
    </span>
  );
}

function CompactFunctionPreview({
  accentColor,
  toolName,
  toolId,
  statusLabel,
  inputSummary,
  level,
}: {
  accentColor: string;
  toolName: string;
  toolId: string;
  statusLabel: string;
  inputSummary: string;
  level: 'compact' | 'minimal' | 'full';
}) {
  const typography = level === 'minimal'
    ? {
        gap: 7,
        toolSize: 20,
        metaSize: 16,
        summarySize: 20,
        barHeight: 8,
      }
    : {
        gap: 8,
        toolSize: 16,
        metaSize: 13,
        summarySize: 16,
        barHeight: 7,
      };
  const viewLabel = level === 'minimal' ? '地图视图' : '阅读视图';
  const bar = (width: string, opacity: number) => (
    <div
      style={{
        height: typography.barHeight,
        width,
        borderRadius: 999,
        background: withAlpha(accentColor, opacity, 'var(--vscode-panel-border)'),
      }}
    />
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: typography.gap,
      minHeight: 0,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: typography.toolSize,
          fontWeight: 700,
          color: accentColor,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {toolName}
        </span>
        <span style={{
          fontSize: typography.metaSize,
          color: 'var(--vscode-descriptionForeground)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}>
          {statusLabel} · {inputSummary}
        </span>
      </div>
      <div style={{
        fontSize: typography.summarySize,
        lineHeight: level === 'minimal' ? 1.2 : 1.35,
        fontWeight: level === 'minimal' ? 650 : 500,
        color: 'var(--vscode-descriptionForeground)',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: level === 'minimal' ? 2 : 1,
        WebkitBoxOrient: 'vertical',
      }}>
        {viewLabel} · {toolId}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {bar('88%', 0.2)}
        {level !== 'minimal' && bar('58%', 0.12)}
      </div>
    </div>
  );
}

function NodeSelect({
  value,
  options,
  onChange,
  disabled = false,
  style,
}: {
  value: string;
  options: NodeSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <select
      className="nodrag"
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      onMouseDown={stopEditableFieldMouseDown}
      style={{
        width: '100%',
        display: 'block',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {options.map(option => (
        <option key={`${option.value || '__empty__'}-${option.label}`} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ParamControl({ param, nodeData, globalDefaultModel = '', isMultimodal = false }: {
  param: ParamDef;
  nodeData: CanvasNode;
  globalDefaultModel?: string;
  isMultimodal?: boolean;
}) {
  const updateNodeParamValue = useCanvasStore(s => s.updateNodeParamValue);
  const settings = useCanvasStore(s => s.settings);
  const modelCache = useCanvasStore(s => s.modelCache);

  // For model params: stored value '' means "follow global default"
  // We read raw stored value; empty means "global"
  const storedValue = nodeData.meta?.param_values?.[param.name];
  const isModelParam = param.name === 'model';
  const isDraftTextareaParam =
    param.type === 'text'
    && isMultimodal
    && (param.name === 'instruction' || param.name === 'prompt');

  // Displayed/effective value for non-model params: use default if missing
  const currentValue = (storedValue ?? param.default) as string | number | boolean;

  // For model params: if stored is empty/undefined, treat as global (show '' in select)
  const modelSelectValue = isModelParam
    ? ((storedValue as string | undefined) ?? '')
    : String(currentValue);

  // Custom mode: stored value is set, not in knownOptions, and not empty
  const knownOptions = Array.isArray(param.options) ? param.options : [];
  const isCustomValue = isModelParam
    && modelSelectValue !== ''
    && !knownOptions.includes(modelSelectValue);
  const [customMode, setCustomMode] = useState(isCustomValue);
  const [customDraft, setCustomDraft] = useState(isCustomValue ? modelSelectValue : '');
  const [draftTextareaValue, setDraftTextareaValue] = useState(
    isDraftTextareaParam ? String(currentValue ?? '') : ''
  );
  const draftTextareaSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const draftTextareaComposingRef = useRef(false);

  // Sync customMode/draft when node data changes externally (undo/redo)
  useEffect(() => {
    if (!isModelParam) { return; }
    const sv = (nodeData.meta?.param_values?.[param.name] as string | undefined) ?? '';
    const isNowCustom = sv !== '' && !knownOptions.includes(sv);
    setCustomMode(isNowCustom);
    if (isNowCustom) { setCustomDraft(sv); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData.meta?.param_values?.[param.name]]);

  useEffect(() => {
    if (!isDraftTextareaParam) { return; }
    const nextValue = String((nodeData.meta?.param_values?.[param.name] ?? param.default ?? ''));
    setDraftTextareaValue(prev => (prev === nextValue ? prev : nextValue));
  }, [isDraftTextareaParam, nodeData.meta?.param_values?.[param.name], param.default, param.name]);

  useEffect(() => () => {
    if (draftTextareaSaveTimer.current) {
      clearTimeout(draftTextareaSaveTimer.current);
    }
  }, []);

  const persistDraftTextarea = useCallback((value: string, immediate = false) => {
    if (!isDraftTextareaParam) { return; }
    if (draftTextareaSaveTimer.current) {
      clearTimeout(draftTextareaSaveTimer.current);
    }
    if (immediate) {
      updateNodeParamValue(nodeData.id, param.name, value);
      return;
    }
    draftTextareaSaveTimer.current = setTimeout(() => {
      updateNodeParamValue(nodeData.id, param.name, value);
    }, 400);
  }, [isDraftTextareaParam, nodeData.id, param.name, updateNodeParamValue]);

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--vscode-descriptionForeground)',
    width: 58,
    flexShrink: 0,
  };
  const inputBase: React.CSSProperties = {
    flex: 1,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
    borderRadius: 3,
    fontSize: 11,
    padding: '2px 6px',
    minWidth: 0,
  };

  if (param.type === 'select' && Array.isArray(param.options)) {
    if (isModelParam && customMode) {
      // Custom input mode
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={labelStyle}>{param.label}</span>
            <input
              className="nodrag"
              type="text"
              value={customDraft}
              onChange={e => {
                setCustomDraft(e.target.value);
                updateNodeParamValue(nodeData.id, param.name, e.target.value);
              }}
              onMouseDown={stopEditableFieldMouseDown}
              placeholder="输入模型 ID（如 black-forest-labs/FLUX.1-kontext-pro）"
              style={{ ...inputBase }}
            />
            <button
              onClick={() => {
                setCustomMode(false);
                setCustomDraft('');
                // Reset to "follow global" (empty string)
                updateNodeParamValue(nodeData.id, param.name, '');
              }}
              title="返回预设列表"
              style={{
                background: 'none',
                border: '1px solid var(--vscode-panel-border)',
                borderRadius: 3,
                color: 'var(--vscode-descriptionForeground)',
                fontSize: 10,
                padding: '2px 5px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >✕</button>
          </div>
          <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', paddingLeft: 64 }}>
            可从 aihubmix.com/models 获取模型 ID
          </span>
        </div>
      );
    }

    // Compute the auto-label for the empty option (LLM tools only)
    const currentProvider = ((nodeData.meta?.param_values?.['_provider'] as string) || settings?.globalProvider || 'copilot');
    const autoLabel = isModelParam
      ? getAutoModelLabel(currentProvider, settings ?? null, modelCache, {
          emptyStateText: globalDefaultModel
            ? `自动（当前使用 ${globalDefaultModel}）`
            : `自动（当前使用 ${param.default ?? param.options[0]})`,
        })
      : '';

    // For multimodal model params: if stored value is empty, use first option as effective value
    const effectiveValue = (isModelParam && isMultimodal && !modelSelectValue)
      ? (globalDefaultModel || param.options[0])
      : (isModelParam ? modelSelectValue : String(currentValue));

    const options: NodeSelectOption[] = [
      ...(isModelParam && !isMultimodal ? [{ value: '', label: autoLabel }] : []),
      ...param.options.map(option => ({
        value: option,
        label: option,
      })),
      ...(isModelParam && !isMultimodal ? [{ value: '__custom__', label: '✏ 自定义模型 ID…' }] : []),
    ];

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={labelStyle}>{param.label}</span>
        <NodeSelect
          value={effectiveValue}
          options={options}
          onChange={nextValue => {
            if (isModelParam && nextValue === '__custom__') {
              setCustomMode(true);
              setCustomDraft('');
            } else {
              updateNodeParamValue(nodeData.id, param.name, nextValue);
            }
          }}
          style={{ ...inputBase, background: 'var(--vscode-dropdown-background)', color: 'var(--vscode-dropdown-foreground)', border: '1px solid var(--vscode-dropdown-border)', cursor: 'pointer' }}
        />
      </div>
    );
  }

  if (param.type === 'text') {
    if (isDraftTextareaParam) {
      const helperText = nodeData.meta?.ai_tool === 'image-edit'
        ? '这里只填写编辑指令；左侧输入端仅用于连接参考图像。'
        : nodeData.meta?.ai_tool === 'image-fusion'
          ? '连接至少 2 张图像；这里填写融合目标与保留约束。'
          : '这里填写组图主题与连贯性要求；也可连接文本节点补充描述。';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>{param.label}</span>
          <textarea
            className="nodrag"
            value={draftTextareaValue}
            onChange={e => {
              const nextValue = e.target.value;
              setDraftTextareaValue(nextValue);
              if (!draftTextareaComposingRef.current) {
                persistDraftTextarea(nextValue);
              }
            }}
            onCompositionStart={() => {
              draftTextareaComposingRef.current = true;
            }}
            onCompositionEnd={e => {
              draftTextareaComposingRef.current = false;
              const nextValue = e.currentTarget.value;
              setDraftTextareaValue(nextValue);
              persistDraftTextarea(nextValue, true);
            }}
            onBlur={() => persistDraftTextarea(draftTextareaValue, true)}
            onKeyDown={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            placeholder={param.name === 'instruction'
              ? '例如：保留主体构图，把背景改成夜景霓虹街道，并增强电影感光影'
              : '例如：生成一组共 4 张连贯插画，表现同一庭院角落的四季变迁'}
            rows={4}
            style={{
              ...inputBase,
              width: '100%',
              resize: 'vertical',
              lineHeight: 1.5,
              fontFamily: 'var(--vscode-font-family, sans-serif)',
              boxSizing: 'border-box',
            }}
          />
          <span style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)' }}>
            {helperText}
          </span>
        </div>
      );
    }

    const isQuery = param.name === 'query';
    if (isQuery) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>{param.label}</span>
          <textarea
            className="nodrag"
            value={String(currentValue)}
            onChange={e => updateNodeParamValue(nodeData.id, param.name, e.target.value)}
            onMouseDown={stopEditableFieldMouseDown}
            placeholder="输入问题…"
            rows={3}
            style={{
              ...inputBase,
              width: '100%',
              resize: 'vertical',
              lineHeight: 1.5,
              fontFamily: 'var(--vscode-font-family, sans-serif)',
              boxSizing: 'border-box',
            }}
          />
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={labelStyle}>{param.label}</span>
        <input
          className="nodrag"
          type="text"
          value={String(currentValue)}
          onChange={e => updateNodeParamValue(nodeData.id, param.name, e.target.value)}
          onMouseDown={stopEditableFieldMouseDown}
          style={{ ...inputBase }}
        />
      </div>
    );
  }

  if (param.type === 'number') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={labelStyle}>{param.label}</span>
        <input
          className="nodrag"
          type="number"
          value={Number(currentValue)}
          onChange={e => updateNodeParamValue(nodeData.id, param.name, Number(e.target.value))}
          onMouseDown={stopEditableFieldMouseDown}
          style={{ ...inputBase, width: 70, flex: 'none' }}
        />
      </div>
    );
  }

  if (param.type === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          className="nodrag"
          type="checkbox"
          checked={Boolean(currentValue)}
          onChange={e => updateNodeParamValue(nodeData.id, param.name, e.target.checked)}
          onMouseDown={stopEditableFieldMouseDown}
          style={{ cursor: 'pointer' }}
        />
        <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>{param.label}</span>
      </label>
    );
  }

  return null;
}

export function parseInputParams(schema: ParamDef[]): {
  required: ParamDef[];
  optional: ParamDef[];
} {
  const safe = Array.isArray(schema) ? schema : [];
  return {
    required: safe.filter(p => p.required),
    optional: safe.filter(p => !p.required),
  };
}
