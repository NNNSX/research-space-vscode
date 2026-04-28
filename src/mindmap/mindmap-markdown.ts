import type { MindMapFile, MindMapItem } from './mindmap-model';

export interface MindMapMarkdownOptions {
  missingImagePaths?: Set<string>;
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\r?\n/g, ' ').trim();
}

function renderItem(item: MindMapItem, depth: number, lines: string[], options: MindMapMarkdownOptions): void {
  const indent = '  '.repeat(depth);
  lines.push(`${indent}- ${escapeMarkdownText(item.text) || '未命名条目'}`);
  if (item.note?.trim()) {
    lines.push(`${indent}  ${item.note.trim().replace(/\r?\n/g, `\n${indent}  `)}`);
  }
  for (const image of item.images ?? []) {
    const caption = image.caption?.trim() || image.file_path.split(/[\\/]/).pop() || '图片';
    const size = image.width || image.height
      ? ` {width=${Math.round(image.width ?? 96)} height=${Math.round(image.height ?? 72)}}`
      : '';
    lines.push(`${indent}  ![${caption}](${image.file_path})${size}`);
    if (options.missingImagePaths?.has(image.file_path)) {
      lines.push(`${indent}  > 图片文件可能缺失：${image.file_path}`);
    }
  }
  for (const child of item.children ?? []) {
    renderItem(child, depth + 1, lines, options);
  }
}

export function mindMapToMarkdown(file: MindMapFile, options: MindMapMarkdownOptions = {}): string {
  const lines = [`# ${escapeMarkdownText(file.root.text || file.title) || '思维导图'}`, ''];
  for (const child of file.root.children ?? []) {
    renderItem(child, 0, lines, options);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
