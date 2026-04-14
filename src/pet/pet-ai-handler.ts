import * as vscode from 'vscode';
import { CanvasFile } from '../core/canvas-model';
import { extractCanvasContext, formatContextForAI } from './pet-context';
import { getProvider, type AIProvider, type AIContent } from '../ai/provider';
import { readPetSettings } from './pet-memory';

/**
 * Handle a pet AI chat request from the webview.
 * Uses the global LLM provider to generate a response,
 * then sends the full text back (non-streaming for simplicity).
 */
export async function handlePetAiChat(
  webview: vscode.Webview,
  canvas: CanvasFile,
  payload: {
    requestId: string;
    petName: string;
    personality: string;
    messages: Array<{ role: 'user' | 'assistant'; text: string }>;
    mode: 'chat' | 'suggestion';  // 'suggestion' = auto-triggered, 'chat' = user-initiated
  },
): Promise<void> {
  const { requestId, petName, personality, messages, mode } = payload;

  // Build canvas context
  const ctx = extractCanvasContext(canvas);
  const contextBlock = formatContextForAI(ctx);

  // System prompt
  const systemPrompt = mode === 'suggestion'
    ? buildSuggestionPrompt(petName, personality, contextBlock)
    : buildChatPrompt(petName, personality, contextBlock);

  // Build contents array — last user message as content, prior messages as context
  const contents: AIContent[] = [];
  // Include conversation history as context
  if (messages.length > 1) {
    const historyText = messages.slice(0, -1)
      .map(m => `${m.role === 'user' ? '用户' : petName}: ${m.text}`)
      .join('\n');
    contents.push({ type: 'text', title: '对话历史', text: historyText });
  }
  // Last message
  const lastMsg = messages[messages.length - 1];
  if (lastMsg) {
    contents.push({ type: 'text', title: '用户消息', text: lastMsg.text });
  }

  try {
    // Read pet-specific provider/model settings
    const petCfg = vscode.workspace.getConfiguration('researchSpace.pet');
    const petProviderId = petCfg.get<string>('aiProvider', 'auto');
    const petModel = petCfg.get<string>('aiModel', '');

    const provider = await getProvider(petProviderId === 'auto' ? undefined : petProviderId);
    let fullText = '';

    for await (const chunk of provider.stream(systemPrompt, contents, { maxTokens: 300, model: petModel || undefined })) {
      fullText += chunk;
    }

    // Clean up — remove markdown formatting, keep it conversational
    fullText = fullText.trim();

    webview.postMessage({
      type: 'petAiChatResponse',
      requestId,
      text: fullText,
      success: true,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    webview.postMessage({
      type: 'petAiChatResponse',
      requestId,
      text: `抱歉，AI 暂时不可用~ (${errMsg})`,
      success: false,
    });
  }
}

function buildSuggestionPrompt(petName: string, personality: string, canvasContext: string): string {
  return `你是 Research Space 画布上的宠物伴侣"${petName}"。你的性格是${personality}。
请基于以下画布状态给出简短（1-2 句话）的研究建议或鼓励。
说话风格要可爱、温暖、简洁，像一个贴心的小助手。
不要使用 Markdown 格式，不要太正式，像朋友聊天一样。

当前画布状态:
${canvasContext}`;
}

function buildChatPrompt(petName: string, personality: string, canvasContext: string): string {
  return `你是 Research Space 画布上的宠物伴侣"${petName}"。你的性格是${personality}。
用户正在和你对话。你能感知到画布上的研究内容，可以给出建议、回答问题或只是陪伴聊天。
说话风格要可爱、温暖、简洁，像一个贴心的小助手。
不要使用 Markdown 格式，不要太正式，像朋友聊天一样。
回复尽量控制在 3 句话以内。

当前画布状态:
${canvasContext}`;
}
