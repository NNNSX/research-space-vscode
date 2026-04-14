import React, { useCallback, useEffect, useRef, useState, memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { CanvasNode, FnStatus, ParamDef } from '../../../../../src/core/canvas-model';
import { postMessage } from '../../bridge';
import { useCanvasStore } from '../../stores/canvas-store';
import { NodeContextMenu } from './NodeContextMenu';

interface FunctionNodeProps {
  data: CanvasNode;
  selected: boolean;
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
  // 多模态工具
  'image-gen':     '🖼',
  'image-edit':    '✏️',
  tts:             '🔊',
  stt:             '🎵',
  'video-gen':     '🎬',
  'image-to-video':'🎬',
};

// Default prompts for each tool — shown as placeholder in the editor so users know what they're overriding
const TOOL_DEFAULT_PROMPTS: Record<string, string> = {
  summarize:          '你是一位专业学术摘要专家。请以目标语言、指定风格对所提供内容进行摘要，字数不超过指定限制。仅输出摘要，无需任何元评论。',
  polish:             '你是一位专业编辑。请以指定强度对所提供文本进行润色。输出应包括改动说明和完整修订文本两部分。',
  review:             '你是一位严格的同行评审专家。请以指定严格程度对所提供内容进行评审。输出总体评分、各维度评分，以及主要/次要问题清单。',
  translate:          '你是一位专业学术翻译。请将内容翻译为目标语言，保持学术术语准确。翻译后附上「## 关键术语」部分，列出重要术语及其翻译对照表。',
  draw:               '你是 Mermaid 图表专家。请根据所提供内容生成 Mermaid 语法图表。仅输出 Mermaid 代码块，不包含任何解释或注释。',
  rag:                '你是一位研究助手。请根据所提供的文档内容回答用户问题。引用具体信息时请注明来源文件名。',
  'literature-review':'你是一位学术文献综合分析专家。请基于所提供的论文，按指定输出格式与语言撰写文献综述。每个要点需注明来源论文。',
  'outline-gen':      '你是一位学术写作教练。请基于所提供的笔记和草稿，生成指定层级的论文大纲。每个章节标题应具体明确，并附一句话描述。',
  'action-items':     '你是一位会议行动项提取专家。请从所提供的会议记录中提取所有行动项，标注负责人、具体内容、截止日期和优先级。',
};

// Provider label map (no 'auto' — nodes always have an explicit provider)
const PROVIDER_LABELS: Record<string, string> = {
  copilot:   'GitHub Copilot',
  anthropic: 'Anthropic Claude',
  ollama:    'Ollama（本地）',
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
  `;
  document.head.appendChild(style);
}

export const FunctionNode = memo(FunctionNodeInner);

function FunctionNodeInner({ data, selected }: FunctionNodeProps) {
  const status: FnStatus = data.meta?.fn_status ?? 'idle';
  const statusColor = STATUS_COLORS[status];
  const tool = data.meta?.ai_tool;
  const icon = tool ? (TOOL_ICONS[tool] ?? '⚡') : '⚡';
  const isRunning = status === 'running';

  // Inject CSS keyframes on first render
  React.useEffect(() => { ensureFnAnimations(); }, []);

  return (
    <FullFunctionNode
      data={data}
      selected={selected}
      status={status}
      statusColor={statusColor}
      icon={icon}
      isRunning={isRunning}
    />
  );
}

function FullFunctionNode({
  data,
  selected,
  status,
  statusColor,
  icon,
  isRunning,
}: {
  data: CanvasNode;
  selected: boolean;
  status: FnStatus;
  statusColor: string;
  icon: string;
  isRunning: boolean;
}) {
  const { updateNodeParamValue, updateInputOrder, getUpstreamNodes, modelCache, settings, toolDefs } = useCanvasStore();

  const [promptOpen, setPromptOpen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
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
  const isMultimodal = !!(toolDef?.apiType && toolDef.apiType !== 'chat');

  // For multimodal tools, resolve the global default model from settings
  const MULTIMODAL_SETTINGS_KEY: Record<string, keyof typeof settings> = {
    'image-gen':      'aiHubMixImageGenModel',
    'image-edit':     'aiHubMixImageEditModel',
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
  const upstreamNodes = getUpstreamNodes(data.id);

  // When store value changes externally (e.g. undo/redo), sync drafts
  useEffect(() => {
    const stored = (data.meta?.param_values?.['_systemPrompt'] as string) ?? '';
    setPromptDraft(stored);
  }, [data.meta?.param_values?.['_systemPrompt']]);

  useEffect(() => {
    const stored = (data.meta?.param_values?.['_chatPrompt'] as string) ?? '';
    setChatDraft(stored);
  }, [data.meta?.param_values?.['_chatPrompt']]);

  // Guard: ensure input_schema is always an array
  const inputSchema = Array.isArray(data.meta?.input_schema) ? data.meta!.input_schema : [];
  const schema = parseInputParams(inputSchema);

  const width = data.size?.width ?? 280;

  // ── Provider change ────────────────────────────────────────────────────────
  const handleProviderChange = useCallback((newProvider: string) => {
    // newProvider === '' means "follow global" — store empty string to clear override
    updateNodeParamValue(data.id, '_provider', newProvider);
    updateNodeParamValue(data.id, '_model', '');
    // Prefetch models for the effective provider
    const effectiveProvider = newProvider || (settings?.globalProvider ?? 'copilot');
    if (!modelCache[effectiveProvider]?.length) {
      postMessage({ type: 'requestModels', provider: effectiveProvider });
    }
  }, [data.id, updateNodeParamValue, modelCache, settings?.globalProvider]);

  // On first render, prefetch models for current provider
  useEffect(() => {
    if (!modelCache[currentProvider]?.length) {
      postMessage({ type: 'requestModels', provider: currentProvider });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Model options ──────────────────────────────────────────────────────────
  const models = modelCache[currentProvider] ?? null;

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
  const HIGH_COST_API_TYPES = new Set(['image_generation', 'image_edit', 'video_generation']);
  const isHighCost = !!(toolDef?.apiType && HIGH_COST_API_TYPES.has(toolDef.apiType));
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
          postMessage({ type: 'runFunction', nodeId: data.id });
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    } else {
      postMessage({ type: 'runFunction', nodeId: data.id });
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

  return (
    <div
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      style={{
      width,
      background: 'var(--vscode-editor-background)',
      border: isRunning
        ? '2px solid rgba(59,130,246,0.7)'
        : `2px solid ${selected ? statusColor : 'var(--vscode-panel-border)'}`,
      borderRadius: 8,
      padding: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      boxShadow: isRunning ? '0 0 8px 2px rgba(59,130,246,0.4)' : undefined,
      animation: isRunning
        ? 'rsFnBorderFlow 3s linear infinite, rsFnGlow 2.5s ease-in-out infinite'
        : undefined,
    }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.title || '功能节点'}
        </span>
        <StatusBadge status={status} />
      </div>

      {/* Progress / Peek Preview */}
      {status === 'running' && data.meta?.fn_progress && (
        <div style={{
          fontSize: 10,
          color: statusColor,
          background: statusColor + '12',
          border: `1px solid ${statusColor}30`,
          borderRadius: 4,
          padding: '4px 7px',
          lineHeight: 1.5,
          overflow: 'hidden',
          maxHeight: 48,
          textOverflow: 'ellipsis',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {data.meta.fn_progress}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--vscode-panel-border)', margin: '0 -10px' }} />

      {/* Provider / Model — only for LLM (text) tools */}
      {isMultimodal ? (
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
            <select
              value={nodeProvider}
              onChange={e => handleProviderChange(e.target.value)}
              style={{
                ...selectStyle,
                color: nodeProvider ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)',
              }}
            >
              {/* "" = follow global setting; this is the default */}
              <option value="">{`全局 (${PROVIDER_LABELS[settings?.globalProvider ?? 'copilot'] ?? settings?.globalProvider ?? 'Copilot'})`}</option>
              {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
              {(settings?.customProviders ?? []).map(cp => (
                <option key={cp.id} value={cp.id}>{cp.name}</option>
              ))}
            </select>
          </div>

          {/* Model selector — always shown */}
          <div style={rowStyle}>
            <span style={labelStyle}>模型</span>
            <select
              value={currentModel}
              onChange={e => updateNodeParamValue(data.id, '_model', e.target.value)}
              style={selectStyle}
              disabled={models === null}
            >
              <option value="">
                {models === null ? '加载中…' : '自动（默认）'}
              </option>
              {models && models.length === 0 && (
                <option disabled value="">未找到模型</option>
              )}
              {models && models.map(m => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--vscode-panel-border)', margin: '0 -10px' }} />

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
              <div style={{ height: 1, background: 'var(--vscode-panel-border)', margin: '0 -10px' }} />
            </>
          )}

          {/* Input connection guide — universal for all non-chat tools */}
          {upstreamNodes.length === 0 && (() => {
            // Determine the hint based on tool type
            let hint = '';
            if (toolDef?.apiType === 'image_edit') {
              hint = '🖼 需连接图像节点作为参考图';
            } else if (toolDef?.id === 'image-to-video') {
              hint = '🖼 需连接图像节点实现图生视频';
            } else if (toolDef?.apiType === 'stt') {
              hint = '🎵 需连接音频节点进行转录';
            } else if (toolDef?.apiType === 'tts') {
              hint = '📝 需连接文本节点（笔记 / AI 输出）作为输入';
            } else if (toolDef?.apiType === 'image_generation') {
              hint = '📝 可连接文本节点提供描述，或直接在参数中填写';
            } else if (toolDef?.apiType === 'video_generation') {
              hint = '📝 可连接文本节点提供描述，或直接在参数中填写';
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
          {/* Specific multimodal warnings when wrong type is connected */}
          {upstreamNodes.length > 0 && toolDef?.apiType === 'image_edit' && upstreamNodes.every(n => n.node_type !== 'image') && (
            <div style={{
              fontSize: 10, padding: '5px 8px', borderRadius: 4,
              background: 'var(--vscode-inputValidation-warningBackground, #3a2e00)',
              color: 'var(--vscode-inputValidation-warningForeground, #ffcc00)',
              border: '1px solid var(--vscode-inputValidation-warningBorder, #ffcc0060)',
            }}>
              🖼 需连接图像节点作为参考图
            </div>
          )}
          {upstreamNodes.length > 0 && toolDef?.apiType === 'stt' && upstreamNodes.every(n => n.node_type !== 'audio') && (
            <div style={{
              fontSize: 10, padding: '5px 8px', borderRadius: 4,
              background: 'var(--vscode-inputValidation-warningBackground, #3a2e00)',
              color: 'var(--vscode-inputValidation-warningForeground, #ffcc00)',
              border: '1px solid var(--vscode-inputValidation-warningBorder, #ffcc0060)',
            }}>
              🎵 需连接音频节点进行转录
            </div>
          )}

          {/* System Prompt editor toggle — only for LLM tools */}
          {!isMultimodal && (
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
                    value={promptDraft}
                    onChange={e => handlePromptChange(e.target.value)}
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
                </div>
              )}
            </>
          )}

          {/* Optional tool params */}
          {schema.optional.length > 0 && (
            <>
              <div style={{ height: 1, background: 'var(--vscode-panel-border)', margin: '0 -10px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {schema.optional.map(p => (
                  <ParamControl key={p.name} param={p} nodeData={data} globalDefaultModel={globalDefaultModel} isMultimodal={isMultimodal} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Run / Stop button */}
      <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
        {status === 'running' || countdown !== null ? (
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
            {countdown !== null ? `取消 (${countdown}s)` : '⏹ 停止'}
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={status === 'running'}
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
            ▶ 运行
          </button>
        )}
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Left} id="in-main"
        style={{ background: statusColor, width: 10, height: 10 }} />
      <Handle type="source" position={Position.Right} id="out"
        style={{ background: statusColor, width: 10, height: 10 }} />

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
        ref={chatTextareaRef}
        value={chatDraft}
        onChange={e => onChatChange(e.target.value)}
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

function StatusBadge({ status }: { status: FnStatus }) {
  return (
    <span style={{
      fontSize: 10,
      background: STATUS_COLORS[status] + '30',
      color: STATUS_COLORS[status],
      padding: '1px 6px',
      borderRadius: 4,
      fontWeight: 600,
      flexShrink: 0,
    }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function ParamControl({ param, nodeData, globalDefaultModel = '', isMultimodal = false }: {
  param: ParamDef;
  nodeData: CanvasNode;
  globalDefaultModel?: string;
  isMultimodal?: boolean;
}) {
  const { updateNodeParamValue } = useCanvasStore();

  // For model params: stored value '' means "follow global default"
  // We read raw stored value; empty means "global"
  const storedValue = nodeData.meta?.param_values?.[param.name];
  const isModelParam = param.name === 'model';

  // Displayed/effective value for non-model params: use default if missing
  const currentValue = (storedValue ?? param.default) as string | number;

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

  // Sync customMode/draft when node data changes externally (undo/redo)
  useEffect(() => {
    if (!isModelParam) { return; }
    const sv = (nodeData.meta?.param_values?.[param.name] as string | undefined) ?? '';
    const isNowCustom = sv !== '' && !knownOptions.includes(sv);
    setCustomMode(isNowCustom);
    if (isNowCustom) { setCustomDraft(sv); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData.meta?.param_values?.[param.name]]);

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
              type="text"
              value={customDraft}
              onChange={e => {
                setCustomDraft(e.target.value);
                updateNodeParamValue(nodeData.id, param.name, e.target.value);
              }}
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
    const autoLabel = isModelParam && globalDefaultModel
      ? `全局默认 (${globalDefaultModel})`
      : `全局默认 (${param.default ?? param.options[0]})`;

    // For multimodal model params: if stored value is empty, use first option as effective value
    const effectiveValue = (isModelParam && isMultimodal && !modelSelectValue)
      ? (globalDefaultModel || param.options[0])
      : (isModelParam ? modelSelectValue : String(currentValue));

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={labelStyle}>{param.label}</span>
        <select
          value={effectiveValue}
          onChange={e => {
            if (isModelParam && e.target.value === '__custom__') {
              setCustomMode(true);
              setCustomDraft('');
            } else {
              updateNodeParamValue(nodeData.id, param.name, e.target.value);
            }
          }}
          style={{ ...inputBase, background: 'var(--vscode-dropdown-background)', color: 'var(--vscode-dropdown-foreground)', border: '1px solid var(--vscode-dropdown-border)', cursor: 'pointer' }}
        >
          {isModelParam && !isMultimodal && <option value="">{autoLabel}</option>}
          {param.options.map(o => <option key={o} value={o}>{o}</option>)}
          {isModelParam && !isMultimodal && <option value="__custom__">✏ 自定义模型 ID…</option>}
        </select>
      </div>
    );
  }

  if (param.type === 'text') {
    const isQuery = param.name === 'query';
    if (isQuery) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>{param.label}</span>
          <textarea
            value={String(currentValue)}
            onChange={e => updateNodeParamValue(nodeData.id, param.name, e.target.value)}
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
          type="text"
          value={String(currentValue)}
          onChange={e => updateNodeParamValue(nodeData.id, param.name, e.target.value)}
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
          type="number"
          value={Number(currentValue)}
          onChange={e => updateNodeParamValue(nodeData.id, param.name, Number(e.target.value))}
          style={{ ...inputBase, width: 70, flex: 'none' }}
        />
      </div>
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
