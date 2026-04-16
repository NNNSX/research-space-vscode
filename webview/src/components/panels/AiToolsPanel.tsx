import React, { useMemo, useState, useCallback } from 'react';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import type { RuntimeToolDef } from '../../../../src/ai/tool-registry';

export const DRAG_TOOL_KEY = 'application/rs-tool';

// ── Category definitions ──────────────────────────────────────────────────────

type ToolCategory = 'text' | 'research' | 'multimodal' | 'project' | 'general';

const CATEGORY_ORDER: ToolCategory[] = ['general', 'text', 'research', 'multimodal', 'project'];

const CATEGORY_META: Record<ToolCategory, { icon: string; label: string }> = {
  text:        { icon: '✏️', label: '文本处理' },
  research:    { icon: '📚', label: '研究辅助' },
  multimodal:  { icon: '🎨', label: '多模态创作' },
  project:     { icon: '📋', label: '项目管理' },
  general:     { icon: '💬', label: '通用' },
};

// Codicon → emoji fallback
function iconDisplay(codicon: string): string {
  const map: Record<string, string> = {
    book:                 '📚',
    edit:                 '✏️',
    'comment-discussion': '💬',
    globe:                '🌐',
    graph:                '📊',
    search:               '🔎',
    image:                '🖼',
    mic:                  '🎵',
    unmute:               '🔊',
    'play-circle':        '🎬',
    'list-tree':          '🌲',
    record:               '⏺',
    tasklist:             '📋',
  };
  return map[codicon] ?? '⚡';
}

const actionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--vscode-panel-border)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--vscode-descriptionForeground)',
  fontSize: 11,
  padding: '1px 5px',
  lineHeight: 1.4,
};

// ── ToolRow ───────────────────────────────────────────────────────────────────

function ToolRow({ tool }: { tool: RuntimeToolDef }) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_TOOL_KEY, tool.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    postMessage({ type: 'exportTool', toolId: tool.id });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    postMessage({ type: 'deleteTool', toolId: tool.id });
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      title={`${tool.description}\n(拖出到画布以添加)`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        background: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: 6,
        cursor: 'grab',
        userSelect: 'none',
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>{iconDisplay(tool.icon)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tool.name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tool.description}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <button title="导出工具定义" onClick={handleExport} style={actionBtnStyle}>↓</button>
        {tool._isCustom && (
          <button
            title="删除自定义工具"
            onClick={handleDelete}
            style={{ ...actionBtnStyle, color: 'var(--vscode-errorForeground, #f48771)' }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ── CategorySection ───────────────────────────────────────────────────────────

function CategorySection({
  category,
  tools,
  collapsed,
  onToggle,
}: {
  category: ToolCategory;
  tools: RuntimeToolDef[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const meta = CATEGORY_META[category];
  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '5px 4px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--vscode-sideBarSectionHeader-foreground)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.03em',
          borderRadius: 4,
        }}
      >
        <span style={{ fontSize: 10, width: 12, textAlign: 'center', flexShrink: 0,
          transition: 'transform 0.15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
          ▾
        </span>
        <span style={{ fontSize: 13 }}>{meta.icon}</span>
        <span>{meta.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--vscode-descriptionForeground)', fontWeight: 400 }}>
          {tools.length}
        </span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 4, paddingTop: 2 }}>
          {tools.map(t => <ToolRow key={t.id} tool={t} />)}
        </div>
      )}
    </div>
  );
}

// ── AI Orchestration Prompt ───────────────────────────────────────────────────

const AI_ORCHESTRATION_PROMPT = `你是一位 Research Space VSCode 插件的工具定义生成专家。用户会描述他们想要的 AI 功能节点，请根据描述生成符合规范的 JSON 工具定义文件。

## 工具定义 JSON 规范（JsonToolDef）

每个工具是一个 JSON 文件，包含以下字段：

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| \`id\` | string | 唯一标识符，不能包含空格，需适合用作文件名。例如 \`"my-tool"\`、\`"code-review"\` |
| \`name\` | string | 工具显示名称，简短明了。例如 \`"代码审查"\`、\`"论文改写"\` |
| \`description\` | string | 工具功能描述，会显示在工具列表和鼠标悬停提示中 |
| \`icon\` | string | 图标，使用 VSCode Codicon 名称。可选值：\`book\`(📚) \`edit\`(✏️) \`comment-discussion\`(💬) \`globe\`(🌐) \`graph\`(📊) \`search\`(🔎) \`image\`(🖼) \`mic\`(🎵) \`unmute\`(🔊) \`play-circle\`(🎬) \`list-tree\`(🌲) \`record\`(⏺) \`tasklist\`(📋) 或任意其他 Codicon 名 |
| \`supportsImages\` | boolean | 是否支持图片输入。\`true\` 时允许连接图片节点，AI 会收到图片内容（需要多模态模型） |
| \`outputNodeType\` | string | 输出节点类型。可选值：\`"ai_output"\`（Markdown 文本，最常用）、\`"image"\`（图像文件）、\`"audio"\`（音频文件）、\`"video"\`（视频文件） |
| \`params\` | ParamDef[] | 参数定义数组（可为空 \`[]\`），定义工具节点上显示的可调参数控件 |
| \`systemPromptTemplate\` | string | 系统提示词模板。LLM 工具（apiType 为 \`"chat"\` 或未设置）必须非空；多模态工具可为空字符串 \`""\` |
| \`postProcessType\` | string \\| null | 后处理器。当前可用：\`"extract_mermaid"\`（提取 Mermaid 代码块）。大多数情况用 \`null\` |

### 可选字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| \`category\` | string | \`"general"\` | 工具分类，决定在面板中的分组。可选值：\`"text"\`（文本处理）、\`"research"\`（研究辅助）、\`"multimodal"\`（多模态创作）、\`"project"\`（项目管理）、\`"general"\`（通用） |
| \`uiMode\` | string | \`"default"\` | UI 渲染模式。\`"default"\` 显示标准参数控件；\`"chat"\` 启用自由对话输入框，支持 \`@文件名\` 引用 |
| \`apiType\` | string | \`"chat"\` | API 调用类型。\`"chat"\` 走 LLM 流式文本生成；\`"image_generation"\` 图像生成；\`"image_edit"\` 图像编辑；\`"tts"\` 文字转语音；\`"stt"\` 语音转文字；\`"video_generation"\` 视频生成 |
| \`slots\` | SlotDef[] | 无 | 输入槽定义。定义后，连接数据节点时会弹出角色选择对话框，用于区分不同输入的语义角色 |
| \`paramMaps\` | object | \`{}\` | 参数值映射表。格式：\`{ "参数名": { "选项值": "映射文本" } }\`。在 systemPromptTemplate 中通过 \`{{参数名:map}}\` 引用 |

### ParamDef 参数定义

每个参数对象包含：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| \`name\` | string | 是 | 参数唯一名称（英文），如 \`"language"\`、\`"max_words"\` |
| \`type\` | string | 是 | 控件类型：\`"select"\`（下拉选择）、\`"text"\`（文本输入）、\`"number"\`（数字输入）、\`"boolean"\`（开关） |
| \`label\` | string | 是 | 参数显示标签，如 \`"输出语言"\`、\`"最大字数"\` |
| \`options\` | string[] | select 必填 | 下拉选项列表。仅 type 为 \`"select"\` 时使用 |
| \`default\` | any | 否 | 默认值。select 类型建议设定默认选项 |
| \`required\` | boolean | 否 | 是否必填（默认 false） |

### SlotDef 输入槽定义

每个输入槽定义连接数据节点时的语义角色：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| \`name\` | string | 是 | 槽唯一名称（英文），如 \`"primary"\`、\`"reference"\` |
| \`label\` | string | 是 | 显示标签，如 \`"原文"\`、\`"参考文献"\` |
| \`description\` | string | 是 | 说明文字，显示在角色选择对话框中 |
| \`required\` | boolean | 否 | 是否至少需要连接一个节点到此槽 |
| \`multiple\` | boolean | 否 | 是否允许多个节点连接到此槽（默认 false） |

### systemPromptTemplate 模板语法

- \`{{参数名}}\`：直接替换为参数值。例如 \`{{language}}\` 会替换为用户选择的语言值
- \`{{参数名:map}}\`：通过 paramMaps 映射后替换。例如 \`{{language:map}}\` 会根据 paramMaps.language 查找对应的完整描述文本

## 校验规则

1. \`id\` 不能包含空格，需适合用作文件名
2. \`id\`、\`name\`、\`description\` 必须为非空字符串
3. LLM 工具（apiType 为 \`"chat"\` 或未设置）的 \`systemPromptTemplate\` 必须非空
4. 多模态工具（apiType 为非 \`"chat"\` 值）的 \`systemPromptTemplate\` 可以为空
5. \`outputNodeType\` 必须为 \`"ai_output"\`、\`"image"\`、\`"audio"\`、\`"video"\` 之一
6. \`supportsImages\` 必须为布尔值
7. \`params\` 必须为数组，每个元素必须包含 \`name\`、\`type\`、\`label\`
8. type 为 \`"select"\` 时 \`options\` 必须为数组

## 完整示例

### 示例 1：LLM 文本工具（带参数映射和输入槽）

\`\`\`json
{
  "id": "polish",
  "name": "文本润色",
  "description": "提升文章写作质量与表达清晰度",
  "category": "text",
  "icon": "edit",
  "supportsImages": false,
  "outputNodeType": "ai_output",
  "params": [
    {
      "name": "intensity",
      "type": "select",
      "label": "润色力度",
      "options": ["light", "medium", "heavy"],
      "default": "medium"
    },
    {
      "name": "language",
      "type": "select",
      "label": "输出语言",
      "options": ["auto", "zh", "en"],
      "default": "auto"
    }
  ],
  "paramMaps": {
    "intensity": {
      "light": "minimal changes — fix grammar and typos only",
      "medium": "moderate — improve clarity, flow, and word choice while preserving the author's voice",
      "heavy": "comprehensive rewrite — improve structure, clarity, and style significantly"
    },
    "language": {
      "auto": " Match the output language to the input text language.",
      "zh": " Output your response in Chinese.",
      "en": " Output your response in English."
    }
  },
  "systemPromptTemplate": "You are an expert writing editor. Polish the provided text with {{intensity:map}}.{{language:map}} Structure your response as:\\n## Changes Made\\n[Brief explanation of main changes]\\n\\n## Polished Text\\n[The full polished content]",
  "postProcessType": null,
  "slots": [
    {
      "name": "primary",
      "label": "原文",
      "description": "需要润色的主体文本，AI 将直接对其进行修改",
      "required": true,
      "multiple": false
    },
    {
      "name": "reference",
      "label": "参考建议",
      "description": "审稿意见、风格示例或改写要求，AI 会参考但不直接修改",
      "required": false,
      "multiple": true
    }
  ]
}
\`\`\`

### 示例 2：最简 LLM 工具（无参数，无输入槽）

\`\`\`json
{
  "id": "explain-code",
  "name": "代码解释",
  "description": "逐行解释代码逻辑与设计意图",
  "category": "text",
  "icon": "comment-discussion",
  "supportsImages": false,
  "outputNodeType": "ai_output",
  "params": [],
  "paramMaps": {},
  "systemPromptTemplate": "你是一位资深软件工程师。请对所提供的代码进行逐段解释，说明每个关键部分的作用、设计意图和可能的改进点。使用中文回答，代码术语保留英文。",
  "postProcessType": null
}
\`\`\`

### 示例 3：支持图片多模态输入的 LLM 工具

\`\`\`json
{
  "id": "image-describe",
  "name": "图像描述",
  "description": "详细描述图片内容并生成 alt 文本",
  "category": "research",
  "icon": "image",
  "supportsImages": true,
  "outputNodeType": "ai_output",
  "params": [
    {
      "name": "detail_level",
      "type": "select",
      "label": "详细程度",
      "options": ["brief", "detailed", "comprehensive"],
      "default": "detailed"
    }
  ],
  "paramMaps": {},
  "systemPromptTemplate": "你是一位图像分析专家。请仔细观察所提供的图片，以 {{detail_level}} 的详细程度描述图片内容。包括：主要元素、布局、色彩、情感基调。最后提供一段适合 alt 属性的无障碍文本。",
  "postProcessType": null
}
\`\`\`

### 示例 4：Chat 模式工具（自由对话 + @引用）

\`\`\`json
{
  "id": "chat",
  "name": "自由对话",
  "description": "自定义 Prompt 与 AI 对话",
  "category": "general",
  "icon": "comment-discussion",
  "supportsImages": true,
  "outputNodeType": "ai_output",
  "uiMode": "chat",
  "params": [],
  "paramMaps": {},
  "systemPromptTemplate": "You are a helpful research assistant. Answer the user's question based on the provided context. If files are referenced with @, focus your answer on those specific files.",
  "postProcessType": null
}
\`\`\`

## 生成要求

1. 直接输出合法 JSON，不要包含注释
2. 确保 JSON 可被 \`JSON.parse()\` 直接解析
3. \`id\` 使用 kebab-case（小写 + 连字符），如 \`"my-custom-tool"\`
4. \`systemPromptTemplate\` 要具体、专业、有结构化的输出指引
5. 如果工具需要区分不同输入文件的角色，请定义 \`slots\`
6. 如果参数选项需要映射为更详细的提示词指令，请使用 \`paramMaps\` + \`{{参数:map}}\` 语法
7. 大多数自定义工具 \`apiType\` 应该为 \`"chat"\`（默认值，可省略），\`outputNodeType\` 为 \`"ai_output"\`

现在请根据用户的描述生成工具定义 JSON。`;

// ── AI Prompt Modal ──────────────────────────────────────────────────────────

function AiPromptModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(AI_ORCHESTRATION_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 10,
          width: '90vw',
          maxWidth: 640,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>AI 编排提示词</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--vscode-descriptionForeground)',
              fontSize: 16,
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Description */}
        <div style={{
          padding: '10px 16px',
          fontSize: 11,
          color: 'var(--vscode-descriptionForeground)',
          lineHeight: 1.6,
          borderBottom: '1px solid var(--vscode-panel-border)',
        }}>
          复制下方提示词，粘贴到任意 AI 助手（ChatGPT、Claude 等）中，描述你想要的功能即可生成自定义工具 JSON。生成后保存为 <code>.json</code> 文件，通过「导入工具」按钮导入。
        </div>

        {/* Prompt content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
        }}>
          <pre style={{
            margin: 0,
            padding: 12,
            background: 'var(--vscode-input-background)',
            border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
            borderRadius: 6,
            fontSize: 11,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--vscode-input-foreground)',
            fontFamily: 'var(--vscode-editor-font-family, monospace)',
            maxHeight: 'none',
          }}>
            {AI_ORCHESTRATION_PROMPT}
          </pre>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--vscode-panel-border)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
        }}>
          <button
            onClick={handleCopy}
            style={{
              background: copied
                ? 'var(--vscode-terminal-ansiGreen)'
                : 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: 4,
              padding: '6px 16px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {copied ? '✓ 已复制' : '复制提示词'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AiToolsPanel ─────────────────────────────────────────────────────────────

export function AiToolsPanel() {
  const aiToolsPanelOpen = useCanvasStore(s => s.aiToolsPanelOpen);
  const toolDefs = useCanvasStore(s => s.toolDefs) as RuntimeToolDef[];

  const [search, setSearch] = useState('');
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [promptModalOpen, setPromptModalOpen] = useState(false);

  const toggleCat = (cat: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
  };

  // Separate built-in and custom
  const builtins = useMemo(() => toolDefs.filter(t => !t._isCustom), [toolDefs]);
  const customs = useMemo(() => toolDefs.filter(t => t._isCustom), [toolDefs]);

  // Apply search filter
  const query = search.trim().toLowerCase();
  const filteredBuiltins = useMemo(() => {
    if (!query) { return builtins; }
    return builtins.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query) ||
      t.id.toLowerCase().includes(query)
    );
  }, [builtins, query]);

  const filteredCustoms = useMemo(() => {
    if (!query) { return customs; }
    return customs.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query) ||
      t.id.toLowerCase().includes(query)
    );
  }, [customs, query]);

  // Group builtins by category
  const grouped = useMemo(() => {
    const map = new Map<ToolCategory, RuntimeToolDef[]>();
    for (const cat of CATEGORY_ORDER) { map.set(cat, []); }
    for (const t of filteredBuiltins) {
      const cat: ToolCategory = (t as any).category ?? 'general';
      const list = map.get(cat);
      if (list) { list.push(t); } else { map.get('general')!.push(t); }
    }
    return map;
  }, [filteredBuiltins]);

  if (!aiToolsPanelOpen) { return null; }

  const isSearching = query.length > 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        top: 12,
        bottom: 12,
        width: 230,
        background: 'var(--vscode-sideBar-background)',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 10px 6px',
        fontWeight: 700,
        fontSize: 12,
        color: 'var(--vscode-sideBarSectionHeader-foreground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}>
        AI 工具
      </div>

      {/* Search */}
      <div style={{ padding: '6px 8px 2px' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索工具..."
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '5px 8px',
            fontSize: 11,
            border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
            borderRadius: 5,
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            outline: 'none',
          }}
        />
      </div>

      {/* Tool list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {toolDefs.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: 'var(--vscode-descriptionForeground)', textAlign: 'center' }}>
            加载工具中…
          </div>
        ) : isSearching ? (
          /* Flat search results — no grouping */
          <>
            {filteredBuiltins.length === 0 && filteredCustoms.length === 0 ? (
              <div style={{ padding: 16, fontSize: 11, color: 'var(--vscode-descriptionForeground)', textAlign: 'center' }}>
                未找到匹配的工具
              </div>
            ) : (
              <>
                {filteredBuiltins.map(t => <ToolRow key={t.id} tool={t} />)}
                {filteredCustoms.map(t => <ToolRow key={t.id} tool={t} />)}
              </>
            )}
          </>
        ) : (
          /* Grouped view */
          <>
            {CATEGORY_ORDER.map(cat => {
              const tools = grouped.get(cat)!;
              if (tools.length === 0) { return null; }
              return (
                <CategorySection
                  key={cat}
                  category={cat}
                  tools={tools}
                  collapsed={collapsedCats.has(cat)}
                  onToggle={() => toggleCat(cat)}
                />
              );
            })}
            {customs.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <button
                  onClick={() => toggleCat('_custom')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    width: '100%',
                    padding: '5px 4px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--vscode-sideBarSectionHeader-foreground)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                    borderRadius: 4,
                  }}
                >
                  <span style={{ fontSize: 10, width: 12, textAlign: 'center', flexShrink: 0,
                    transition: 'transform 0.15s', transform: collapsedCats.has('_custom') ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                    ▾
                  </span>
                  <span style={{ fontSize: 13 }}>🔧</span>
                  <span>自定义工具</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--vscode-descriptionForeground)', fontWeight: 400 }}>
                    {customs.length}
                  </span>
                </button>
                {!collapsedCats.has('_custom') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 4, paddingTop: 2 }}>
                    {customs.map(t => <ToolRow key={t.id} tool={t} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer actions */}
      <div style={{
        padding: '5px 8px',
        borderTop: '1px solid var(--vscode-panel-border)',
        display: 'flex',
        gap: 4,
        justifyContent: 'flex-end',
      }}>
        <button
          title="复制 AI 编排提示词，用于生成自定义工具 JSON"
          onClick={() => setPromptModalOpen(true)}
          style={actionBtnStyle}
        >
          ✨ AI 编排提示词
        </button>
        <button
          title="导入工具定义 (.json)"
          onClick={() => postMessage({ type: 'importTool' })}
          style={actionBtnStyle}
        >
          ↑ 导入工具
        </button>
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '4px 12px',
        fontSize: 10,
        color: 'var(--vscode-descriptionForeground)',
        borderTop: '1px solid var(--vscode-panel-border)',
        textAlign: 'center',
      }}>
        拖出到画布以添加
      </div>

      {/* AI prompt modal */}
      {promptModalOpen && <AiPromptModal onClose={() => setPromptModalOpen(false)} />}
    </div>
  );
}
