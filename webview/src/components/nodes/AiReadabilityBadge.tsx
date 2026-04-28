import React from 'react';
import type { CanvasNode } from '../../../../src/core/canvas-model';

// ── AI Readability Badge ──────────────────────────────────────────────────
// Shows at the bottom of every DataNode what AI can actually read from the file.
// Colors: green = fully readable, yellow = partial (has unreadable content), gray = not readable.

type ReadabilityLevel = 'full' | 'partial' | 'none';

interface BadgeInfo {
  level: ReadabilityLevel;
  mainText: string;
  warningText?: string;
}

const LEVEL_COLORS: Record<ReadabilityLevel, string> = {
  full: '#22c55e',    // green-500
  partial: '#22c55e', // main text green, warning in yellow
  none: '#9ca3af',    // gray-400
};

const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp',
  'rb', 'sh', 'bash', 'zsh', 'sql', 'css', 'scss', 'less', 'html', 'xml',
  'json', 'yaml', 'yml', 'toml', 'lua', 'r', 'swift', 'kt', 'scala', 'dart',
  'php', 'pl', 'ex', 'exs', 'zig', 'nim',
]);
const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'opus', 'aac', 'flac', 'm4a']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);

function getExtension(filePath?: string): string {
  if (!filePath) { return ''; }
  const idx = filePath.lastIndexOf('.');
  return idx >= 0 ? filePath.slice(idx + 1).toLowerCase() : '';
}

function computeBadge(data: CanvasNode): BadgeInfo | null {
  if (data.node_type === 'function') { return null; }

  const ext = getExtension(data.file_path);
  const meta = data.meta;

  // ── Paper / PDF ──
  if (data.node_type === 'paper' || ext === 'pdf') {
    const pages = meta?.ai_readable_pages ?? meta?.page_count ?? 0;
    const info: BadgeInfo = {
      level: 'full',
      mainText: `🤖 AI 可读: 纯文本 ${pages}页`,
    };
    if (meta?.has_unreadable_content) {
      info.level = 'partial';
      info.warningText = `⚠ ${meta.unreadable_hint ?? '图表/公式图片未识别'}`;
    }
    return info;
  }

  // ── Note / AI Output ──
  if (data.node_type === 'note' || data.node_type === 'ai_output') {
    const chars = meta?.ai_readable_chars;
    if (chars !== undefined) {
      return { level: 'full', mainText: `🤖 AI 可读: 全文 ${chars}字` };
    }
    if (meta?.content_preview) {
      return { level: 'partial', mainText: `🤖 AI 可读: 已载入预览 ${meta.content_preview.length}字`, warningText: '⚠ 尚未拿到全文长度元数据' };
    }
    return { level: 'partial', mainText: '🤖 AI 可读: 文本内容', warningText: '⚠ 尚未拿到全文长度元数据' };
  }

  // ── Code ──
  if (data.node_type === 'code' || CODE_EXTS.has(ext)) {
    const chars = meta?.ai_readable_chars;
    const lang = meta?.language ?? ext;
    if (chars !== undefined) {
      // Estimate line count from char count (avg ~40 chars/line)
      const preview = meta?.content_preview ?? '';
      const sampleLines = preview.split('\n').length;
      const lineEstimate = chars > 300 ? Math.round(chars / (chars / Math.max(sampleLines, 1))) : sampleLines;
      return { level: 'full', mainText: `🤖 AI 可读: 全文 ~${lineEstimate}行 (${lang})` };
    }
    return { level: 'full', mainText: `🤖 AI 可读: 全文 (${lang})` };
  }

  // ── Image ──
  if (data.node_type === 'image' || IMG_EXTS.has(ext)) {
    if (meta?.display_mode === 'mermaid') {
      return { level: 'full', mainText: '🤖 AI 可读: Mermaid 图表代码' };
    }
    return { level: 'full', mainText: '🤖 AI 可读: 图像多模态分析' };
  }

  // ── Audio ──
  if (data.node_type === 'audio' || AUDIO_EXTS.has(ext)) {
    return { level: 'none', mainText: '🤖 AI 不可直接读取，请使用「语音转文字」工具' };
  }

  // ── Video ──
  if (data.node_type === 'video' || VIDEO_EXTS.has(ext)) {
    return { level: 'none', mainText: '🤖 AI 不可直接读取，请使用「视频转文字」工具' };
  }

  // ── Data (CSV/TSV) ──
  if (data.node_type === 'data' || ext === 'csv' || ext === 'tsv') {
    const rows = meta?.csv_rows;
    const cols = meta?.csv_cols;
    if (rows !== undefined && cols !== undefined) {
      return { level: 'full', mainText: `🤖 AI 可读: ${rows}行 × ${cols}列 表格数据` };
    }
    return { level: 'full', mainText: '🤖 AI 可读: 表格数据' };
  }

  // ── Experiment log / Task ──
  if (data.node_type === 'experiment_log' || data.node_type === 'task') {
    return { level: 'full', mainText: '🤖 AI 可读: 全文' };
  }

  if (data.node_type === 'mindmap') {
    const summary = data.meta?.mindmap_summary;
    return {
      level: 'full',
      mainText: summary
        ? `🤖 AI 可读: 导图 ${summary.totalItems} 个条目`
        : '🤖 AI 可读: 思维导图大纲',
    };
  }

  return null;
}

interface Props {
  data: CanvasNode;
}

export const AiReadabilityBadge: React.FC<Props> = React.memo(({ data }) => {
  const badge = computeBadge(data);
  if (!badge) { return null; }

  return (
    <div style={{
      borderTop: '1px solid var(--vscode-panel-border)',
      padding: '3px 8px 2px',
      fontSize: 10,
      lineHeight: 1.4,
      userSelect: 'none',
      opacity: 0.85,
    }}>
      <div style={{ color: LEVEL_COLORS[badge.level] }}>
        {badge.mainText}
      </div>
      {badge.warningText && (
        <div style={{
          color: '#eab308',
          fontSize: 9,
          marginTop: 1,
        }}>
          {badge.warningText}
        </div>
      )}
    </div>
  );
});

AiReadabilityBadge.displayName = 'AiReadabilityBadge';
