import React, { useMemo, useState } from 'react';
import { useCanvasStore } from '../../stores/canvas-store';
import { postMessage } from '../../bridge';
import { BoardDropdown } from './BoardDropdown';

type ToolbarButtonVariant = 'default' | 'save-pending' | 'save-saving' | 'save-error';

const TOOLBAR_ANIMATIONS = `
  @keyframes rs-save-pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.34);
      transform: translateY(0);
    }
    50% {
      box-shadow: 0 0 0 7px rgba(234, 179, 8, 0);
      transform: translateY(-1px);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(234, 179, 8, 0);
      transform: translateY(0);
    }
  }

  @keyframes rs-save-breathe {
    0% {
      box-shadow: 0 0 0 0 rgba(0, 122, 204, 0.34);
      transform: translateY(0);
    }
    50% {
      box-shadow: 0 0 0 8px rgba(0, 122, 204, 0);
      transform: translateY(-1px);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(0, 122, 204, 0);
      transform: translateY(0);
    }
  }
`;

export function Toolbar() {
  const setAiToolsPanelOpen = useCanvasStore(s => s.setAiToolsPanelOpen);
  const aiToolsPanelOpen = useCanvasStore(s => s.aiToolsPanelOpen);
  const settingsPanelOpen = useCanvasStore(s => s.settingsPanelOpen);
  const setSettingsPanelOpen = useCanvasStore(s => s.setSettingsPanelOpen);
  const selectionMode = useCanvasStore(s => s.selectionMode);
  const setSelectionMode = useCanvasStore(s => s.setSelectionMode);
  const undo = useCanvasStore(s => s.undo);
  const redo = useCanvasStore(s => s.redo);
  const undoStack = useCanvasStore(s => s.undoStack);
  const redoStack = useCanvasStore(s => s.redoStack);
  const saveState = useCanvasStore(s => s.saveState);
  const saveDueAt = useCanvasStore(s => s.saveDueAt);
  const lastSavedAt = useCanvasStore(s => s.lastSavedAt);
  const saveError = useCanvasStore(s => s.saveError);
  const saveNow = useCanvasStore(s => s.saveNow);
  const canvasFile = useCanvasStore(s => s.canvasFile);
  const [helpOpen, setHelpOpen] = useState(false);

  const handleAddFiles = () => {
    postMessage({ type: 'addFiles' });
  };

  const handleNewNote = () => {
    postMessage({ type: 'newNote', title: '' });
  };

  const saveLabel = useMemo(() => {
    if (!canvasFile) { return '未打开画布'; }
    if (saveState === 'saving') { return '保存中'; }
    if (saveState === 'error') { return '保存失败'; }
    if (saveState === 'pending' && saveDueAt) {
      return `自动保存将于 ${new Date(saveDueAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })} 执行`;
    }
    if (saveState === 'pending') { return '未保存'; }
    return '已保存';
  }, [canvasFile, saveDueAt, saveState]);

  const saveTitle = useMemo(() => {
    if (!canvasFile) { return '当前未打开画布'; }
    if (saveState === 'error') {
      return saveError ? `保存失败：${saveError}` : '保存失败';
    }
    if (saveState === 'pending' && saveDueAt) {
      return `自动保存将于 ${new Date(saveDueAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })} 执行`;
    }
    if (lastSavedAt) {
      return `上次保存时间：${new Date(lastSavedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}`;
    }
    return saveLabel;
  }, [canvasFile, lastSavedAt, saveDueAt, saveError, saveLabel, saveState]);

  const saveButtonVariant = useMemo<ToolbarButtonVariant>(() => {
    if (saveState === 'pending') { return 'save-pending'; }
    if (saveState === 'saving') { return 'save-saving'; }
    if (saveState === 'error') { return 'save-error'; }
    return 'default';
  }, [saveState]);

  const saveButtonLabel = useMemo(() => {
    if (saveState === 'saving') { return '⏳ 保存中'; }
    if (saveState === 'error') { return '⚠ 保存'; }
    if (saveState === 'pending') { return '● 保存'; }
    return '↓ 保存';
  }, [saveState]);

  return (
    <>
      <style>{TOOLBAR_ANIMATIONS}</style>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'var(--vscode-titleBar-activeBackground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
        minHeight: 40,
        flexShrink: 0,
        flexWrap: 'nowrap',
        overflow: 'hidden',
      }}>
        <span
          title="Research Space"
          style={{
            fontWeight: 800,
            fontSize: 13,
            color: 'var(--vscode-titleBar-activeForeground)',
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          RS
        </span>

        <div style={{ width: 1, height: 18, background: 'var(--vscode-panel-border)', margin: '0 2px', flexShrink: 0 }} />

        <ToolbarButton onClick={undo} title="撤销 (Ctrl+Z)" disabled={undoStack.length === 0}>
          ↩
        </ToolbarButton>
        <ToolbarButton onClick={redo} title="重做 (Ctrl+Shift+Z)" disabled={redoStack.length === 0}>
          ↪
        </ToolbarButton>

        <div
          title={saveTitle}
          style={{
            marginLeft: 4,
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            fontWeight: 600,
            color: saveState === 'error'
              ? 'var(--vscode-errorForeground, var(--vscode-titleBar-activeForeground))'
              : 'var(--vscode-titleBar-activeForeground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {saveLabel}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', marginLeft: 8, flexShrink: 0 }}>
        <ToolbarButton
          onClick={saveNow}
          title={saveState === 'pending'
            ? '当前画布有未保存改动，点击立即保存 (Ctrl/Cmd+S)'
            : saveState === 'saving'
              ? '当前画布正在保存中'
              : saveState === 'error'
                ? '上次保存失败，点击重试保存'
                : '立即保存当前画布 (Ctrl/Cmd+S)'}
          disabled={!canvasFile}
          variant={saveButtonVariant}
        >
          {saveButtonLabel}
        </ToolbarButton>
        <ToolbarButton onClick={handleAddFiles} title="从工作区添加文件">
          + 📄 文件
        </ToolbarButton>

        <ToolbarButton onClick={handleNewNote} title="新建 Markdown 笔记">
          + 📝 笔记
        </ToolbarButton>

        <ToolbarButton onClick={() => {
          postMessage({ type: 'newExperimentLog', title: '' });
        }} title="新建实验记录节点">
          + 🧪 实验
        </ToolbarButton>

        <ToolbarButton onClick={() => {
          postMessage({ type: 'newTask', title: '' });
        }} title="新建任务清单节点">
          + ✅ 任务
        </ToolbarButton>

        <ToolbarButton
          onClick={() => setSelectionMode(!selectionMode)}
          title="框选模式"
          active={selectionMode}
        >
          ⬚ 选区
        </ToolbarButton>

        <BoardDropdown />

        <ToolbarButton
          onClick={() => setAiToolsPanelOpen(!aiToolsPanelOpen)}
          title="AI 工具"
          active={aiToolsPanelOpen}
        >
          ⚡ AI 工具
        </ToolbarButton>

        <ToolbarButton
          onClick={() => setSettingsPanelOpen(!settingsPanelOpen)}
          title="设置"
          active={settingsPanelOpen}
        >
          ⚙ 设置
        </ToolbarButton>

        <ToolbarButton
          onClick={() => setHelpOpen(true)}
          title="使用指南"
        >
          ? 帮助
        </ToolbarButton>
        </div>
      </div>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </>
  );
}

function ToolbarButton({
  children, onClick, title, active, disabled, variant = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  variant?: ToolbarButtonVariant;
}) {
  const variantStyle: React.CSSProperties = variant === 'save-pending'
    ? {
      background: 'rgba(234, 179, 8, 0.16)',
      color: 'var(--vscode-editorWarning-foreground, #d29922)',
      border: '1px solid var(--vscode-editorWarning-foreground, #d29922)',
      animation: 'rs-save-pulse 1.7s ease-in-out infinite',
    }
    : variant === 'save-saving'
      ? {
        background: 'var(--vscode-button-background)',
        color: 'var(--vscode-button-foreground)',
        border: '1px solid var(--vscode-button-border, transparent)',
        animation: 'rs-save-breathe 1.2s ease-in-out infinite',
      }
      : variant === 'save-error'
        ? {
          background: 'rgba(244, 71, 71, 0.16)',
          color: 'var(--vscode-errorForeground, #f14c4c)',
          border: '1px solid var(--vscode-errorForeground, #f14c4c)',
          boxShadow: '0 0 0 1px rgba(244, 71, 71, 0.12)',
        }
        : {};

  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        background: active
          ? 'var(--vscode-button-background)'
          : 'var(--vscode-button-secondaryBackground)',
        color: active
          ? 'var(--vscode-button-foreground)'
          : 'var(--vscode-button-secondaryForeground)',
        border: `1px solid var(--vscode-button-border, transparent)`,
        borderRadius: 4,
        padding: '3px 10px',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 12,
        fontWeight: 500,
        opacity: disabled ? 0.4 : 1,
        transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease',
        ...variantStyle,
      }}
    >
      {children}
    </button>
  );
}

// ── Help Modal ────────────────────────────────────────────────────────────────

const STEPS: { icon: string; title: string; desc: string }[] = [
  {
    icon: '📂',
    title: '1. 打开文件夹',
    desc: '通过「文件 > 打开文件夹」将任意文件夹作为研究工作区打开，文件夹结构保持不变。',
  },
  {
    icon: '🖼',
    title: '2. 创建画布',
    desc: '点击活动栏中的 Research Space 图标，再点击「+ 画布」。工作区根目录会自动创建一个 .rsws 文件。',
  },
  {
    icon: '➕',
    title: '3. 添加素材到画布',
    desc: '在资源管理器中右键任意文件，选择「添加到画布」。文件将出现在暂存架中，拖到画布即可放置。支持 PDF、Markdown、代码、图片、音频、视频、CSV/TSV 等格式。也可通过工具栏「+ 文件」「+ 笔记」「🧪 实验」「✅ 任务」按钮快速添加。也可从资源管理器拖拽文件到画布上方，按住 Shift 后松手直接放入。',
  },
  {
    icon: '⚡',
    title: '4. 添加 AI 工具节点',
    desc: '点击工具栏「⚡ AI 工具」打开左侧工具箱，将工具拖到画布。工具按「文本处理 / 研究辅助 / 多模态创作 / 项目管理 / 通用」分组，支持搜索过滤。还可通过「↑ 导入工具」导入自定义工具 JSON。',
  },
  {
    icon: '🔗',
    title: '5. 连线并运行',
    desc: '从数据节点右侧连接点拖到功能节点左侧连接点。若工具定义了输入槽（slots），连线时会弹出角色选择。点击功能节点的「▶ 运行」，AI 生成的输出将作为新节点出现在画布上；多选功能节点后可从外部工具栏运行 Pipeline。',
  },
  {
    icon: '◫',
    title: '6. 节点组',
    desc: '选中 2 个及以上数据节点后，会在外部浮动工具栏出现「创建节点组」。节点组现在是一个真实的 hub 节点：左右双通道与普通节点一致，对外通常只保留一条显式连线，内部成员关系由隐藏汇聚边维护；组框支持重命名、折叠、删除和整组拖拽。',
  },
  {
    icon: '🤖',
    title: '7. AI 服务商',
    desc: '支持 GitHub Copilot（零配置推荐）、Anthropic Claude、Ollama（本地离线）、oMLX（本地 OpenAI 兼容）及自定义 OpenAI 兼容服务商（如 AIHubMix，支持图像分析）。可在「⚙ 设置」面板全局配置，也可在每个功能节点上单独覆盖。',
  },
  {
    icon: '🎨',
    title: '8. 多模态工具',
    desc: '图像生成 / 图像编辑 / 文字转语音 / 语音转文字 / 视频生成 / 图生视频 — 通过 AIHubMix API 调用，需在设置中配置 AIHubMix API Key。功能节点上会显示蓝色输入提示。',
  },
  {
    icon: '✏️',
    title: '9. 系统 Prompt 自定义',
    desc: '每个 LLM 功能节点可展开「编辑系统 Prompt」面板查看并覆盖默认提示词。修改后标签变黄提示已启用，可随时「恢复默认」。Chat 工具支持自由 Prompt 和 @文件 引用。',
  },
  {
    icon: '📋',
    title: '10. 画板/工作区',
    desc: '点击工具栏「📋 画板」打开画板管理下拉。新建画板：输入名称、选择颜色，确认后进入暂存架，拖到画布放置。画板是半透明的彩色矩形区域，节点放在上面，移动画板时内部节点跟随移动。8 个控制点可调整画板大小。右键画板可编辑名称/颜色或删除。画板列表点击可快速跳转到对应区域。',
  },
  {
    icon: '↩',
    title: '11. 撤销与重做',
    desc: 'Ctrl+Z（Mac: Cmd+Z）撤销，Ctrl+Shift+Z 重做。覆盖节点增删、边操作、拖拽移动、连线、归纳等操作，最多保留 50 步。',
  },
  {
    icon: '🖱',
    title: '12. 右键菜单与快捷键',
    desc: '右键任意节点：删除、复制；笔记节点可重命名（同步文件）。选中节点后 Delete / Backspace 可快速发起删除，但现在会先弹二次确认，避免误删。数据节点标题栏「预览」按钮在 VSCode 原生查看器中打开文件。',
  },
  {
    icon: '⏳',
    title: '13. 大型画布加载',
    desc: '当画布节点较多时，初次打开会先恢复媒体预览、文件全文和节点内容，这段时间顶部会出现“正在加载画布内容”的提醒。期间可能短暂卡顿，提示消失后说明首轮恢复基本完成。',
  },
  {
    icon: '🔧',
    title: '14. 自定义工具',
    desc: '在 AI 工具面板底部点击「✨ AI 编排提示词」获取工具定义 JSON 规范。将其粘贴到 AI 助手，描述功能即可生成自定义工具 JSON，通过「↑ 导入工具」使用。',
  },
  {
    icon: '🐾',
    title: '15. 宠物伴侣',
    desc: '在设置中开启宠物伴侣，画布中会出现可拖拽的浮动宠物窗口。7 种像素宠物按等级解锁，支持成长、心情、对话（AI 驱动）、休息提醒和每日总结。宠物可感知画布操作并即时反应。',
  },
  {
    icon: '📤',
    title: '16. 导出',
    desc: '通过命令面板（Ctrl+Shift+P）执行「Export as Markdown」或「Export as JSON」，将画布内容导出为文件。',
  },
];

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 10,
          width: 560,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '14px 18px',
          borderBottom: '1px solid var(--vscode-panel-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>
            Research Space — 快速入门
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--vscode-descriptionForeground)',
              fontSize: 18,
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Steps */}
        <div style={{ overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {STEPS.map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{
                fontSize: 22,
                width: 36,
                height: 36,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--vscode-badge-background)',
                borderRadius: 8,
              }}>
                {step.icon}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{step.title}</div>
                <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.6 }}>
                  {step.desc}
                </div>
              </div>
            </div>
          ))}

          {/* Tip box */}
          <div style={{
            marginTop: 4,
            padding: '10px 14px',
            background: 'var(--vscode-textBlockQuote-background, var(--vscode-input-background))',
            borderLeft: '3px solid var(--vscode-terminal-ansiBlue)',
            borderRadius: '0 6px 6px 0',
            fontSize: 12,
            color: 'var(--vscode-descriptionForeground)',
            lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--vscode-foreground)' }}>提示：</strong>{' '}
            右下角 MiniMap 支持拖拽导航。暂存架悬浮在右下角，新增节点先汇聚于此，拖出即可精确放置。
            侧边栏 Research Space 面板以树形展示所有画布及节点，右键可操作。
            CSV/TSV 文件以表格样式展示。顶栏会优先保持单行，保存状态文案会在空间不足时自动收窄显示。
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid var(--vscode-panel-border)',
          display: 'flex',
          justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: 'none',
              borderRadius: 4,
              padding: '5px 16px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Got it — 知道了
          </button>
        </div>
      </div>
    </div>
  );
}
