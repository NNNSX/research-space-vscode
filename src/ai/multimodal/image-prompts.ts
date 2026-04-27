import type { AIContent } from '../provider';

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

export function collectConnectedText(contents: AIContent[]): string {
  return contents
    .filter(content => content.type === 'text')
    .map(content => content.text ?? '')
    .map(text => text.trim())
    .filter(Boolean)
    .join('\n\n');
}

export function buildImageGenerationPrompt(
  params: Record<string, unknown>,
  contents: AIContent[],
): string {
  const directPrompt = normalizeText(params['prompt']);
  const connectedText = collectConnectedText(contents);
  const promptBase = [directPrompt, connectedText].filter(Boolean).join('\n\n').trim();
  if (!promptBase) {
    return '';
  }
  const styleHint = normalizeText(params['style_hint']);
  return styleHint ? `${promptBase}\n\nStyle: ${styleHint}` : promptBase;
}

export function buildImageEditPrompt(
  params: Record<string, unknown>,
  contents: AIContent[],
): string {
  const directInstruction = normalizeText(params['instruction']);
  const connectedText = collectConnectedText(contents);
  return [directInstruction, connectedText].filter(Boolean).join('\n\n').trim();
}
