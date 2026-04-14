import React, { useState } from 'react';
import { postMessage } from '../../bridge';

const STEPS = [
  { icon: '📂', title: '导入文件', desc: '点击工具栏「+ 文件」或在资源管理器右键选择「添加到画布」' },
  { icon: '🤖', title: '添加 AI 工具', desc: '点击工具栏「⚡ AI 工具」，将工具拖到画布' },
  { icon: '🔗', title: '连线并运行', desc: '将数据节点连接到功能节点，点击「▶ 运行」生成结果' },
];

export function EmptyCanvasGuide() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) { return null; }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: 12,
          padding: '28px 32px',
          maxWidth: 480,
          width: '90%',
          boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        {/* Close button */}
        <button
          onClick={() => setDismissed(true)}
          title="关闭引导"
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: '1px solid var(--vscode-button-border, transparent)',
            borderRadius: 4,
            width: 28,
            height: 28,
            fontSize: 16,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          ✕
        </button>

        {/* Title */}
        <div style={{ fontSize: 22, marginBottom: 6 }}>🗂️</div>
        <div style={{
          fontSize: 15, fontWeight: 700,
          color: 'var(--vscode-editor-foreground)',
          marginBottom: 4,
        }}>
          欢迎使用 Research Space
        </div>
        <div style={{
          fontSize: 12,
          color: 'var(--vscode-descriptionForeground)',
          marginBottom: 20,
        }}>
          在这里管理你的研究资料，用 AI 工具处理论文、笔记和代码
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20, textAlign: 'left' }}>
          {STEPS.map((step, i) => (
            <div key={i}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  fontSize: 18, width: 36, height: 36, flexShrink: 0,
                  background: 'var(--vscode-button-background)',
                  borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {step.icon}
                </div>
                <div>
                  <div style={{
                    fontSize: 12, fontWeight: 600,
                    color: 'var(--vscode-editor-foreground)',
                    marginBottom: 2,
                  }}>
                    {i + 1}. {step.title}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: 'var(--vscode-descriptionForeground)',
                    lineHeight: 1.5,
                  }}>
                    {step.desc}
                  </div>
                </div>
              </div>
              {/* Shift+Drag tip — only on step 1 */}
              {i === 0 && (
                <div style={{
                  marginTop: 8,
                  marginLeft: 48,
                  padding: '6px 12px',
                  background: 'rgba(59,130,246,0.12)',
                  border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 22, height: 22,
                    background: 'rgba(59,130,246,0.2)',
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--vscode-editor-foreground)',
                    flexShrink: 0,
                  }}>
                    ⇧
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: 'var(--vscode-editor-foreground)',
                    lineHeight: 1.4,
                  }}>
                    <strong>快捷方式：</strong>从资源管理器拖拽文件到画布上方，按住 Shift 后松手即可放入
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={() => postMessage({ type: 'addFiles' })}
            style={{
              padding: '7px 20px',
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              border: '1px solid var(--vscode-button-border, transparent)',
              borderRadius: 5,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            导入第一个文件
          </button>
          <button
            onClick={() => setDismissed(true)}
            style={{
              padding: '7px 20px',
              background: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)',
              border: '1px solid var(--vscode-button-border, transparent)',
              borderRadius: 5,
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            我知道了，关闭
          </button>
        </div>
      </div>
    </div>
  );
}
