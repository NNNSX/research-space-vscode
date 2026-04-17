import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { CanvasFile, CanvasNode, CanvasEdge, RunIssueKind } from '../core/canvas-model';
import { buildFunctionExecutionPlan } from '../core/execution-plan';
import { AIContent } from './provider';
import { writeCanvas, ensureAiOutputDir, toRelPath, formatTimestamp } from '../core/storage';
import { extractContent } from '../core/content-extractor';
import { getProvider } from './provider';
import { ToolRegistry } from './tool-registry';
import { CanvasEditorProvider } from '../providers/CanvasEditorProvider';

// ── Shared registry singleton ──────────────────────────────────────────────
let _registry: ToolRegistry | null = null;

export function setToolRegistry(registry: ToolRegistry): void {
  _registry = registry;
}

function getRegistry(): ToolRegistry {
  if (!_registry) {
    _registry = new ToolRegistry();
  }
  return _registry;
}

// ── Active run registry (for cancel support) ───────────────────────────────
const activeRuns = new Map<string, AbortController>();
const nodeToRunId = new Map<string, string>();

export function cancelRun(runId: string): void {
  activeRuns.get(runId)?.abort();
  activeRuns.delete(runId);
}

export function cancelRunByNodeId(nodeId: string): void {
  const runId = nodeToRunId.get(nodeId);
  if (runId) { cancelRun(runId); nodeToRunId.delete(nodeId); }
}

// ── Options type ────────────────────────────────────────────────────────────

export interface RunFunctionOpts {
  /** Pre-built content to inject instead of extracting from disk (pipeline chaining) */
  injectedContents?: Map<string, AIContent>;
}

export interface FunctionRunResult {
  success: boolean;
  runId: string;
  outputNode?: CanvasNode;
  errorMessage?: string;
}

function inferRunIssueKind(message: string, fallback: RunIssueKind = 'run_failed'): RunIssueKind {
  const lower = message.toLowerCase();
  if (
    lower.includes('未配置') ||
    lower.includes('配置缺失') ||
    lower.includes('unknown tool') ||
    lower.includes('api key') ||
    lower.includes('apikey')
  ) {
    return 'missing_config';
  }
  if (
    lower.includes('未连接') ||
    lower.includes('输入缺失') ||
    lower.includes('找不到目标节点') ||
    lower.includes('找不到功能节点')
  ) {
    return 'missing_input';
  }
  return fallback;
}

function reportNodeIssue(
  webview: vscode.Webview,
  nodeId: string,
  runId: string,
  message: string,
  issueKind?: RunIssueKind,
): void {
  const kind = issueKind ?? inferRunIssueKind(message);
  webview.postMessage({ type: 'aiError', runId, nodeId, message, issueKind: kind });
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'error', issueKind: kind, issueMessage: message });
}

// ── Main executor ──────────────────────────────────────────────────────────

export async function runFunctionNode(
  nodeId: string,
  canvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  opts?: RunFunctionOpts
): Promise<FunctionRunResult> {
  const runId = uuid();
  nodeToRunId.set(nodeId, runId);
  const fnNode = canvas.nodes.find(n => n.id === nodeId);
  if (!fnNode || !fnNode.meta?.ai_tool) {
    webview.postMessage({
      type: 'aiError',
      runId,
      nodeId,
      message: '找不到功能节点或 ai_tool 配置',
      issueKind: 'missing_config',
    });
    return { success: false, runId, errorMessage: '找不到功能节点或 ai_tool 配置' };
  }

  const registry = getRegistry();
  const toolId = fnNode.meta.ai_tool as string;
  const toolDef = registry.get(toolId);
  if (!toolDef) {
    webview.postMessage({
      type: 'aiError',
      runId,
      nodeId,
      message: `Unknown tool: ${toolId}`,
      issueKind: 'missing_config',
    });
    return { success: false, runId, errorMessage: `Unknown tool: ${toolId}` };
  }

  // Outer safety net: ensure status is always reset even on unexpected throws
  try {
    return await _runFunctionNodeInner(nodeId, fnNode, toolId, toolDef, registry, runId, canvas, canvasUri, webview, opts);
  } catch (e: unknown) {
    activeRuns.delete(runId);
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

// ── Batch run ─────────────────────────────────────────────────────────────────
// Runs the function node once per upstream data node. Each upstream node gets
// its own isolated run, producing a separate output node.

export async function runBatchFunctionNode(
  nodeId: string,
  canvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview
): Promise<void> {
  const fnNode = canvas.nodes.find(n => n.id === nodeId);
  if (!fnNode || !fnNode.meta?.ai_tool) {
    webview.postMessage({ type: 'aiError', runId: uuid(), nodeId, message: '找不到功能节点或 ai_tool 配置', issueKind: 'missing_config' });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'error', issueKind: 'missing_config', issueMessage: '找不到功能节点或 ai_tool 配置' });
    return;
  }

  const executionPlan = buildFunctionExecutionPlan(nodeId, canvas, ['data_flow']);
  if ('error' in executionPlan) {
    webview.postMessage({ type: 'aiError', runId: uuid(), nodeId, message: executionPlan.error, issueKind: 'missing_input' });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'error', issueKind: 'missing_input', issueMessage: executionPlan.error });
    return;
  }

  const expandedInputs = executionPlan.expandedInputs;
  if (expandedInputs.length === 0) {
    webview.postMessage({ type: 'aiError', runId: uuid(), nodeId, message: '批量运行：未连接任何输入数据节点。', issueKind: 'missing_input' });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'error', issueKind: 'missing_input', issueMessage: '批量运行：未连接任何输入数据节点。' });
    return;
  }

  const total = expandedInputs.length;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: `批量运行 0/${total}…` });

  let completed = 0;
  let failed = 0;

  // Run sequentially to avoid API rate-limit issues
  for (const input of expandedInputs) {
    // Build a shallow-cloned canvas that has only this one upstream edge
    const singleCanvas: CanvasFile = {
      ...canvas,
      edges: [
        ...canvas.edges.filter(e => !(e.target === nodeId && e.edge_type === 'data_flow')),
        {
          id: uuid(),
          source: input.node.id,
          target: nodeId,
          edge_type: 'data_flow',
          role: input.role,
        },
      ],
    };

    const result = await runFunctionNode(nodeId, singleCanvas, canvasUri, webview);

    // After each run the canvas on disk was updated — refresh our local copy
    // so subsequent runs see the newly added output nodes (for collision avoidance).
    if (result.success && result.outputNode) {
      canvas.nodes.push(result.outputNode);
      canvas.edges.push({ id: uuid(), source: nodeId, target: result.outputNode.id, edge_type: 'ai_generated' });
      completed++;
    } else {
      failed++;
    }

    // Update batch progress after each item (overrides the fnStatusUpdate from the single run)
    webview.postMessage({
      type: 'fnStatusUpdate',
      nodeId,
      status: 'running',
      progressText: `批量运行 ${completed + failed}/${total}… (成功 ${completed}，失败 ${failed})`,
    });
  }

  // Final status
  if (failed === 0) {
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
  } else {
    webview.postMessage({
      type: 'fnStatusUpdate',
      nodeId,
      status: failed === total ? 'error' : 'done',
      progressText: `批量完成：成功 ${completed}，失败 ${failed}`,
    });
  }

  setTimeout(() => {
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
  }, 4000);
}

async function _runFunctionNodeInner(
  nodeId: string,
  fnNode: CanvasNode,
  toolId: string,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  registry: ToolRegistry,
  runId: string,
  canvas: CanvasFile,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  opts?: RunFunctionOpts
): Promise<FunctionRunResult> {
  const aiType = toolDef.apiType ?? 'chat';

  // F2: Run Guard — check run condition before doing anything else
  const runGuard = fnNode.meta?.run_guard ?? 'always';
  if (runGuard === 'manual-confirm') {
    // Manual-confirm is handled client-side (FunctionNode shows a confirm dialog before
    // even sending runFunction). If we reach here, the user already confirmed.
    // No additional check needed — fall through.
  }

  // 1. Running status
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '采集输入中…' });

  // 2. Build a shared execution/input plan. Single-node run, batch run, and
  // pipeline chaining all resolve upstream inputs through the same expansion
  // rules (edge filtering, hub expansion, and input_order sorting).
  const executionPlan = buildFunctionExecutionPlan(nodeId, canvas, ['data_flow', 'pipeline_flow']);
  if ('error' in executionPlan) {
    reportNodeIssue(webview, nodeId, runId, executionPlan.error, 'missing_input');
    return { success: false, runId, errorMessage: executionPlan.error };
  }
  const upstreamNodes = executionPlan.upstreamNodes;
  const nodeRoleMap = executionPlan.nodeRoleMap;

  if (upstreamNodes.length === 0 && toolId !== 'rag' && toolId !== 'chat' && aiType === 'chat') {
    reportNodeIssue(webview, nodeId, runId, '未连接任何输入数据节点（数据流边）。', 'missing_input');
    return { success: false, runId, errorMessage: '未连接任何输入节点。' };
  }

  // 3. Extract content — use injectedContents for pipeline chaining, allSettled for resilience
  const injected = opts?.injectedContents;
  const contentResults = await Promise.allSettled(
    upstreamNodes.map(n => extractContent(n, canvasUri, injected))
  );
  const contents: AIContent[] = [];

  contents.push(
    ...contentResults
      .filter((r): r is PromiseFulfilledResult<AIContent> => r.status === 'fulfilled')
      .map(r => r.value)
  );

  // 3c. If any upstream edge carries a role, regroup contents with semantic headers.
  // Nodes with a role get grouped under "## <role label>" headers.
  // Nodes without a role retain the existing concatenation behaviour.
  const hasAnyRole = upstreamNodes.some(n => nodeRoleMap.get(n.id));
  if (hasAnyRole && toolId !== 'chat' && toolId !== 'rag') {
    // Group contents by role
    const roleGroups = new Map<string, AIContent[]>();
    const noRoleContents: AIContent[] = [];

    for (let i = 0; i < upstreamNodes.length; i++) {
      const node = upstreamNodes[i];
      const role = nodeRoleMap.get(node.id);
      const content = contents[i];
      if (!content) { continue; }

      if (role) {
        if (!roleGroups.has(role)) { roleGroups.set(role, []); }
        roleGroups.get(role)!.push(content);
      } else {
        noRoleContents.push(content);
      }
    }

    // Resolve slot label from tool def (fall back to role id)
    const slotLabelMap = new Map<string, string>();
    for (const slot of (toolDef.slots ?? [])) {
      slotLabelMap.set(slot.name, slot.label);
    }

    // Rebuild contents: role groups first (in slot definition order), then generic inputs
    const groupedContents: AIContent[] = [];
    const processedRoles = new Set<string>();

    // Preserve slot definition order
    for (const slot of (toolDef.slots ?? [])) {
      const group = roleGroups.get(slot.name);
      if (group) {
        const header = slotLabelMap.get(slot.name) ?? slot.name;
        // Prepend header as a text block
        groupedContents.push({ type: 'text', title: `Role: ${header}`, text: `## ${header}` });
        groupedContents.push(...group);
        processedRoles.add(slot.name);
      }
    }
    // Any role not in slots definition
    for (const [role, group] of roleGroups) {
      if (!processedRoles.has(role)) {
        groupedContents.push({ type: 'text', title: `Role: ${role}`, text: `## ${role}` });
        groupedContents.push(...group);
      }
    }
    // Generic (no-role) inputs appended at end
    groupedContents.push(...noRoleContents);

    contents.length = 0;
    contents.push(...groupedContents);
  }
  if (toolId === 'chat') {
    const chatPrompt = (fnNode.meta.param_values?.['_chatPrompt'] as string)?.trim() ?? '';
    if (!chatPrompt) {
      const msg = 'Chat 对话需要输入 Prompt，请在 Chat 节点中输入消息。';
      reportNodeIssue(webview, nodeId, runId, msg, 'missing_input');
      return { success: false, runId, errorMessage: msg };
    }
    const atRefs = [...chatPrompt.matchAll(/@([\w.\-]+)/g)].map(m => m[1].toLowerCase());
    if (atRefs.length > 0) {
      const referenced: AIContent[] = [];
      const remaining: AIContent[] = [];
      for (const c of contents) {
        const titleLower = c.title.toLowerCase();
        const isReferenced = atRefs.some(ref =>
          titleLower === ref ||
          titleLower === ref + '.md' ||
          titleLower.startsWith(ref + '.')
        );
        if (isReferenced) { referenced.push(c); } else { remaining.push(c); }
      }
      contents.length = 0;
      contents.push(...referenced, ...remaining);
    }
    contents.push({ type: 'text', title: 'User Message', text: chatPrompt });
  }

  // 3c. For RAG: append the user query as an explicit content block
  if (toolId === 'rag') {
    const query = (fnNode.meta.param_values?.['query'] as string)?.trim() ?? '';
    if (!query) {
      const msg = '文档问答需要输入问题，请填写节点上的「问题」字段。';
      reportNodeIssue(webview, nodeId, runId, msg, 'missing_input');
      return { success: false, runId, errorMessage: msg };
    }
    if (contents.length === 0) {
      const allDataNodes = canvas.nodes.filter(
        n => ['paper', 'note', 'code', 'ai_output'].includes(n.node_type)
      );
      const autoResults = await Promise.allSettled(allDataNodes.map(n => extractContent(n, canvasUri)));
      const autoContents = autoResults
        .filter((r): r is PromiseFulfilledResult<AIContent> => r.status === 'fulfilled')
        .map(r => r.value);
      contents.push(...autoContents);
    }
    // Apply topK: keep the topK most-recently-added text contents by character overlap with query
    // (lightweight keyword heuristic — avoids embedding dependency)
    const topK = Number(fnNode.meta.param_values?.['topK'] ?? 5);
    if (contents.length > topK) {
      const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
      const scored = contents.map(c => {
        if (c.type !== 'text') { return { c, score: 0 }; }
        const words = c.text.toLowerCase().split(/\s+/);
        const overlap = words.filter(w => queryWords.has(w)).length;
        return { c, score: overlap };
      }).sort((a, b) => b.score - a.score);
      contents.length = 0;
      contents.push(...scored.slice(0, topK).map(s => s.c));
    }
    // Safety: cap total chars to avoid token overflow (~100k chars ≈ 25k tokens)
    const MAX_RAG_CHARS = 100_000;
    let totalChars = 0;
    const capped: typeof contents = [];
    for (const c of contents) {
      const len = c.type === 'text' ? c.text.length : 0;
      if (totalChars + len > MAX_RAG_CHARS) { break; }
      capped.push(c);
      totalChars += len;
    }
    contents.length = 0;
    contents.push(...capped);

    contents.push({ type: 'text', title: 'User Question', text: query });
  }

  // F2: on-change guard — compute input fingerprint and skip if unchanged
  if (runGuard === 'on-change') {
    const fingerprint = contents
      .map(c => c.type === 'text' ? c.text : c.localPath ?? '')
      .join('|');
    // Simple djb2 hash (no crypto needed — just needs to be stable within a session)
    let hash = 5381;
    for (let i = 0; i < fingerprint.length; i++) {
      hash = ((hash << 5) + hash) + fingerprint.charCodeAt(i);
      hash |= 0; // force 32-bit int
    }
    const hashStr = String(hash >>> 0);
    const prevHash = fnNode.meta?.input_hash;
    if (prevHash === hashStr) {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done', progressText: '已是最新（输入未变化）' });
      setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);
      return { success: true, runId, errorMessage: undefined };
    }
    // Store hash so next run can compare — write it back to the canvas
    canvas.nodes = canvas.nodes.map(n =>
      n.id === nodeId ? { ...n, meta: { ...n.meta, input_hash: hashStr } } : n
    );
    CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
    await writeCanvas(canvasUri, canvas);
  }

  // 4. Merge params (defaults + user values)
  const defaultParams = toolDef.params.reduce<Record<string, unknown>>(
    (acc, p) => { acc[p.name] = p.default; return acc; },
    {}
  );
  const params = { ...defaultParams, ...fnNode.meta.param_values };

  // 4b. Resolve system prompt: custom override takes priority over tool default
  const customPrompt = fnNode.meta.param_values?.['_systemPrompt'] as string | undefined;
  const systemPrompt = (customPrompt && customPrompt.trim())
    ? customPrompt.trim()
    : registry.buildSystem(toolId, params);

  // 4c. Route multimodal tools
  if (aiType !== 'chat') {
    const aiCfg = vscode.workspace.getConfiguration('researchSpace.ai');
    const aiHubMixApiKey = aiCfg.get<string>('aiHubMixApiKey', '');
    const defaultModels = {
      imageGen:   aiCfg.get<string>('aiHubMixImageGenModel', ''),
      imageEdit:  aiCfg.get<string>('aiHubMixImageEditModel', ''),
      imageFusion: aiCfg.get<string>('aiHubMixImageFusionModel', ''),
      imageGroup: aiCfg.get<string>('aiHubMixImageGroupModel', ''),
      tts:        aiCfg.get<string>('aiHubMixTtsModel', ''),
      stt:        aiCfg.get<string>('aiHubMixSttModel', ''),
      videoGen:   aiCfg.get<string>('aiHubMixVideoGenModel', ''),
    };
    switch (aiType) {
      case 'image_generation':
        return runImageGen(
          fnNode,
          toolDef,
          params,
          contents,
          canvasUri,
          webview,
          runId,
          aiHubMixApiKey,
          toolId === 'image-group-output' ? defaultModels.imageGroup : defaultModels.imageGen,
        );
      case 'image_edit':
        return runImageEdit(
          fnNode,
          toolDef,
          params,
          contents,
          canvasUri,
          webview,
          runId,
          aiHubMixApiKey,
          toolId === 'image-fusion' ? defaultModels.imageFusion : defaultModels.imageEdit,
        );
      case 'tts':
        return runTts(fnNode, toolDef, params, contents, canvasUri, webview, runId, aiHubMixApiKey, defaultModels.tts);
      case 'stt':
        return runStt(fnNode, toolDef, params, canvasUri, webview, runId, aiHubMixApiKey, defaultModels.stt);
      case 'video_generation':
        return runVideoGen(fnNode, toolDef, params, contents, canvasUri, webview, runId, aiHubMixApiKey, defaultModels.videoGen);
      default:
        break;
    }
  }

  // 5. Get provider (per-node override or global setting)
  const nodeProvider = fnNode.meta.param_values?.['_provider'] as string | undefined;
  let provider;
  try {
    provider = await getProvider(nodeProvider);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  // 6. Filter images only when the tool itself doesn't support them.
  // Each provider is responsible for handling images in its own stream() implementation.
  const filteredContents = !toolDef.supportsImages
    ? contents.filter(c => c.type !== 'image')
    : contents;

  // 7. Stream
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: 'AI 生成中…' });
  const controller = new AbortController();
  activeRuns.set(runId, controller);

  const nodeModel = fnNode.meta.param_values?.['_model'] as string | undefined;
  const effectiveModel = await provider.resolveModel(nodeModel);

  let fullText = '';
  let lastProgressUpdate = 0;
  try {
    const stream = provider.stream(systemPrompt, filteredContents, {
      signal: controller.signal,
      model: effectiveModel,
    });
    for await (const chunk of stream) {
      fullText += chunk;
      webview.postMessage({ type: 'aiChunk', runId, chunk });
      // F1: Push char-count progress every ~500ms to avoid flooding
      const now = Date.now();
      if (now - lastProgressUpdate > 500) {
        lastProgressUpdate = now;
        const charCount = fullText.length;
        const preview = fullText.slice(0, 80).replace(/\n/g, ' ');
        webview.postMessage({
          type: 'fnStatusUpdate',
          nodeId,
          status: 'running',
          progressText: `已生成 ${charCount} 字… ${preview}`,
        });
      }
    }
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
  activeRuns.delete(runId);

  // 8. Post-process
  const processed = registry.postProcess(toolId, fullText);

  // 9. Write output file
  const aiDir = await ensureAiOutputDir(canvasUri);
  const ts = formatTimestamp();
  const filename = `${toolId}_${ts}.md`;
  const fileUri = vscode.Uri.joinPath(aiDir, filename);
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(processed, 'utf-8'));
  const relPath = toRelPath(fileUri.fsPath, canvasUri);

  // 10. Create output node — place it to the right of the function node,
  //     avoiding overlap with existing nodes using a simple collision scan.
  const outSize = { width: 280, height: 160 };
  const outPos = calcPreferredBlueprintOutputPosition(nodeId, fnNode, outSize, canvas);

  const outNode: CanvasNode = {
    id: uuid(),
    node_type: 'ai_output',
    title: `${toolDef.name} ${ts}`,
    position: outPos,
    size: outSize,
    file_path: relPath,
    meta: {
      content_preview: processed.slice(0, 300),
      ai_readable_chars: processed.length,
      ai_provider: provider.name,
      ai_model: effectiveModel || undefined,
    },
  };

  // 11. Create ai_generated edge
  const outEdge: CanvasEdge = {
    id: uuid(),
    source: nodeId,
    target: outNode.id,
    edge_type: 'ai_generated',
  };

  // 12. Persist
  canvas.nodes.push(outNode);
  canvas.edges.push(outEdge);
  CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
  await writeCanvas(canvasUri, canvas);

  webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });

  const _resetTimer = setTimeout(() => {
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
  }, 3000);
  void _resetTimer;

  // 13. Done
  return { success: true, runId, outputNode: outNode };
}

// ── Multimodal execution helpers ───────────────────────────────────────────

type RunFnArgs = [
  fnNode: CanvasNode,
  toolDef: ReturnType<ToolRegistry['get']> & object,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
];

// ── Image generation — Gemini 3.1 Flash ──────────────────────────────────────

async function runImageGen(
  fnNode: CanvasNode,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '图像生成中…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const textContent = contents.filter(c => c.type === 'text').map(c => c.text).join('\n\n');
  const directPrompt = ((params['prompt'] as string) ?? '').trim();
  const styleHint = (params['style_hint'] as string)?.trim();
  const promptBase = [directPrompt, textContent].filter(Boolean).join('\n\n').trim();
  const prompt = styleHint ? `${promptBase}\n\nStyle: ${styleHint}` : promptBase;

  if (!prompt.trim()) {
    const msg = toolDef.id === 'image-group-output'
      ? '组图输出需要组图描述，请在参数中填写，或连接文本节点。'
      : '图像生成需要文字描述，请连接笔记节点或在参数中输入。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  if (toolDef.id === 'image-group-output') {
    const model = (params['model'] as string) || settingsDefaultModel || 'doubao-seedream-4-0-250828';
    const size = normalizeDoubaoSize(params['size'] as string | undefined);
    const maxImages = Math.max(1, Math.min(8, Number(params['max_images'] ?? 4) || 4));
    const watermark = Boolean(params['watermark'] ?? true);
    const controller = new AbortController();
    activeRuns.set(runId, controller);
    return runDoubaoImageGroupOutput(fnNode, prompt, model, size, maxImages, watermark, canvasUri, webview, runId, apiKey, controller);
  }

  const aspectRatio = (params['aspect_ratio'] as string) ?? '1:1';
  const size = normalizeDoubaoSize(params['size'] as string | undefined);
  const watermark = Boolean(params['watermark'] ?? true);
  const webSearch = Boolean(params['web_search'] ?? false);
  const model = (params['model'] as string) || settingsDefaultModel || 'gemini-3.1-flash-image-preview';
  const controller = new AbortController();
  activeRuns.set(runId, controller);

  if (isDoubaoSeedreamModel(model)) {
    return runImageGenDoubao(fnNode, prompt, model, size, watermark, webSearch, canvasUri, webview, runId, apiKey, controller);
  }

  return runImageGenGemini(fnNode, params, prompt, model, aspectRatio, canvasUri, webview, runId, apiKey, controller);
}

// ── Gemini image generation ────────────────────────────────────────────────

async function runImageGenGemini(
  fnNode: CanvasNode,
  _params: Record<string, unknown>,
  prompt: string,
  model: string,
  aspectRatio: string,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;

  try {
    const endpoint = `https://aihubmix.com/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio, imageSize: '1k' },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Image API error ${response.status}: ${errText}`);
    }

    const data = await response.json() as {
      candidates?: {
        content?: {
          parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[];
        };
      }[];
    };

    // Find the inlineData image part
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find(p => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      throw new Error('Gemini 图像生成未返回图像数据');
    }

    const mimeType = imagePart.inlineData.mimeType ?? 'image/png';
    const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
    const imageBytes = Buffer.from(imagePart.inlineData.data, 'base64');

    const aiDir = await ensureAiOutputDir(canvasUri);
    const ts = formatTimestamp();
    const filename = `image-gen_${ts}.${ext}`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, imageBytes);
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const activeDoc = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'image',
      title: `Image ${ts}`,
      position: calcPreferredBlueprintOutputPosition(nodeId, fnNode, { width: 240, height: 200 }, activeDoc?.data),
      size: { width: 240, height: 200 },
      file_path: relPath,
      meta: { display_mode: 'file' },
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };

    if (activeDoc) {
      activeDoc.data.nodes.push(outNode);
      activeDoc.data.edges.push(outEdge);
      CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
      await writeCanvas(canvasUri, activeDoc.data);
    }

    webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);

    const outputContent: AIContent = {
      type: 'image',
      title: outNode.title,
      localPath: fileUri.fsPath,
      base64: imageBytes.toString('base64'),
      mediaType: mimeType as 'image/png' | 'image/jpeg',
    };
    return { success: true, runId, outputContent, outputNode: outNode };

  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runImageGenDoubao(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  size: string,
  watermark: boolean,
  webSearch: boolean,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const response = await fetch(buildDoubaoPredictionsEndpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          prompt,
          size,
          sequential_image_generation: 'disabled',
          stream: false,
          response_format: 'url',
          watermark,
          ...(webSearch ? { tools: [{ type: 'web_search' }] } : {}),
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Doubao Image API error ${response.status}: ${errText}`);
    }

    const data = await response.json() as unknown;
    const { outputNodes, outputEdges, outputContents } = await persistGeneratedImages(
      nodeId,
      fnNode,
      canvasUri,
      'image-gen',
      'Image',
      extractPredictionImageCandidates(data),
      model,
    );

    activeRuns.delete(runId);
    for (let index = 0; index < outputNodes.length; index++) {
      webview.postMessage({ type: 'aiDone', runId, node: outputNodes[index], edge: outputEdges[index] });
    }
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);
    return { success: true, runId, outputContent: outputContents[0], outputNode: outputNodes[0] };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runDoubaoImageGroupOutput(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  size: string,
  maxImages: number,
  watermark: boolean,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const response = await fetch(buildDoubaoPredictionsEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          model,
          prompt,
          size,
          sequential_image_generation: 'auto',
          sequential_image_generation_options: { max_images: maxImages },
          stream: false,
          response_format: 'url',
          watermark,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Doubao Group Image API error ${response.status}: ${errText}`);
    }

    const data = await response.json() as unknown;
    const { outputNodes, outputEdges, outputContents } = await persistGeneratedImages(
      nodeId,
      fnNode,
      canvasUri,
      'image-group',
      'Group Image',
      extractPredictionImageCandidates(data),
      model,
    );

    activeRuns.delete(runId);
    for (let index = 0; index < outputNodes.length; index++) {
      webview.postMessage({ type: 'aiDone', runId, node: outputNodes[index], edge: outputEdges[index] });
    }
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);
    return { success: true, runId, outputContent: outputContents[0], outputNode: outputNodes[0] };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}



// ── Text-to-Speech — gpt-4o-mini-tts ──────────────────────────────────────

async function runTts(
  fnNode: CanvasNode,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '语音合成中…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const inputText = contents.filter(c => c.type === 'text').map(c => c.text).join('\n\n').slice(0, 4096);
  if (!inputText.trim()) {
    const msg = '文字转语音需要连接笔记或 AI 输出节点作为文本输入。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const model = (params['model'] as string) || settingsDefaultModel || 'gpt-4o-mini-tts';
  const voice = (params['voice'] as string) ?? 'coral';
  const responseFormat = (params['response_format'] as string) ?? 'mp3';
  const controller = new AbortController();
  activeRuns.set(runId, controller);

  try {
    const response = await fetch('https://aihubmix.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: inputText, voice, response_format: responseFormat }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`TTS API error ${response.status}: ${errText}`);
    }

    const audioBytes = Buffer.from(await response.arrayBuffer());
    const aiDir = await ensureAiOutputDir(canvasUri);
    const ts = formatTimestamp();
    const filename = `tts_${ts}.${responseFormat}`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, audioBytes);
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const activeDocTTS = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'audio',
      title: `Audio ${ts}`,
      position: calcPreferredBlueprintOutputPosition(nodeId, fnNode, { width: 240, height: 120 }, activeDocTTS?.data),
      size: { width: 240, height: 120 },
      file_path: relPath,
      meta: buildMultimodalNodeMeta(model),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };

    // Persist output node to Extension Host canvas
    if (activeDocTTS) {
      activeDocTTS.data.nodes.push(outNode);
      activeDocTTS.data.edges.push(outEdge);
      CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
      await writeCanvas(canvasUri, activeDocTTS.data);
    }

    activeRuns.delete(runId);
    webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);

    const outputContent: AIContent = { type: 'text', title: outNode.title, text: `[Audio: ${relPath}]` };
    return { success: true, runId, outputContent, outputNode: outNode };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

// ── Speech-to-Text ─────────────────────────────────────────────────────────

async function runStt(
  fnNode: CanvasNode,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '音频转录中…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  // Find connected audio node's file path
  // NOTE: We receive fnNode but not the full canvas here. We use CanvasEditorProvider's
  // active documents to get the current canvas state.
  const activeDoc = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
  const canvas = activeDoc?.data;
  if (!canvas) {
    const msg = '无法访问画布文档，STT 初始化失败。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const executionPlan = buildFunctionExecutionPlan(nodeId, canvas, ['data_flow']);
  if ('error' in executionPlan) {
    reportNodeIssue(webview, nodeId, runId, executionPlan.error, 'missing_input');
    return { success: false, runId, errorMessage: executionPlan.error };
  }

  const audioNode = executionPlan.expandedInputs.find(ref => ref.node.node_type === 'audio')?.node;
  if (!audioNode?.file_path) {
    const msg = '语音转文字需要连接音频节点（通过数据流边）。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const { toAbsPath } = await import('../core/storage');
  const absPath = toAbsPath(audioNode.file_path, canvasUri);
  const audioBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
  const audioBuffer = Buffer.from(audioBytes);

  const model = (params['model'] as string) || settingsDefaultModel || 'whisper-large-v3-turbo';
  const language = (params['language'] as string)?.trim() ?? '';
  const responseFormat = (params['response_format'] as string) ?? 'text';

  const controller = new AbortController();
  activeRuns.set(runId, controller);

  try {
    // Use Node.js 18+ built-in FormData
    const form = new FormData();
    form.set('file', new File([audioBuffer], path.basename(absPath)));
    form.set('model', model);
    form.set('response_format', responseFormat);
    if (language) { form.set('language', language); }

    const endpoint = 'https://aihubmix.com/v1/audio/transcriptions';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      // Do NOT set Content-Type — let fetch auto-generate multipart boundary
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`STT API error ${response.status}: ${errText}`);
    }

    let transcriptText: string;
    if (responseFormat === 'json' || responseFormat === 'verbose_json') {
      const json = await response.json() as { text?: string };
      transcriptText = json.text ?? '';
    } else {
      transcriptText = await response.text();
    }

    const aiDir = await ensureAiOutputDir(canvasUri);
    const ts = formatTimestamp();
    const filename = `stt_${ts}.md`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(transcriptText, 'utf-8'));
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'ai_output',
      title: `Transcript ${ts}`,
      position: calcPreferredBlueprintOutputPosition(nodeId, fnNode, { width: 280, height: 160 }, activeDoc?.data),
      size: { width: 280, height: 160 },
      file_path: relPath,
      meta: buildMultimodalNodeMeta(model, {
        content_preview: transcriptText.slice(0, 300),
        ai_readable_chars: transcriptText.length,
      }),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };

    // Persist output node to Extension Host canvas
    // (canvas is already available via the activeDoc workaround in this function)
    if (activeDoc) {
      activeDoc.data.nodes.push(outNode);
      activeDoc.data.edges.push(outEdge);
      CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
      await writeCanvas(canvasUri, activeDoc.data);
    }

    activeRuns.delete(runId);
    webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);

    const outputContent: AIContent = { type: 'text', title: outNode.title, text: transcriptText };
    return { success: true, runId, outputContent, outputNode: outNode };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

// ── Video generation ──────────────────────────────────────────────────────

async function runVideoGen(
  fnNode: CanvasNode,
  toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '提交视频任务…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const model = (params['model'] as string) || settingsDefaultModel || 'doubao-seedance-2-0-260128';
  const seconds = String(params['seconds'] ?? '5');
  const size = (params['size'] as string) ?? '1080p';
  const motionPrompt = ((params['motion_prompt'] as string) ?? '').trim();

  // Text prompt from connected text nodes
  const textPrompt = contents.filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 1000).trim();
  const effectivePrompt = motionPrompt || textPrompt;

  // image-to-video: check for a reference image in contents
  const imageContent = contents.find(c => c.type === 'image');
  const isImageToVideo = !!imageContent;

  if (!effectivePrompt && !isImageToVideo) {
    const msg = '视频生成需要文字描述（连接笔记节点）或参考图像（连接图像节点实现图生视频）。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const controller = new AbortController();
  activeRuns.set(runId, controller);

  try {
    let submitResp: Response;

    if (isImageToVideo && imageContent && imageContent.type === 'image') {
      // Image-to-video: multipart/form-data with input_reference file field
      const form = new FormData();
      form.set('model', model);
      form.set('size', size);
      form.set('seconds', seconds);
      if (effectivePrompt) { form.set('prompt', effectivePrompt); }

      // Reconstruct image file from base64
      const imageBytes = Buffer.from(imageContent.base64, 'base64');
      const ext = imageContent.mediaType?.includes('jpeg') ? 'jpg' : 'png';
      const imageName = imageContent.localPath
        ? path.basename(imageContent.localPath)
        : `reference.${ext}`;
      form.set('input_reference', new File([imageBytes], imageName, { type: imageContent.mediaType }));

      submitResp = await fetch('https://aihubmix.com/v1/videos', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } else {
      // Text-to-video: JSON body
      submitResp = await fetch('https://aihubmix.com/v1/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: effectivePrompt, size, seconds }),
        signal: controller.signal,
      });
    }

    if (!submitResp.ok) {
      const errText = await submitResp.text();
      throw new Error(`Video submit error ${submitResp.status}: ${errText}`);
    }

    const submitData = await submitResp.json() as { id?: string; task_id?: string };
    const jobId = submitData.id ?? submitData.task_id;
    if (!jobId) { throw new Error('Video API did not return a job ID'); }

    // Step 2: Poll for completion (15s interval, no timeout — user can cancel manually)
    const startTime = Date.now();
    const POLL_INTERVAL_MS = 15000;

    let completed = false;
    while (true) {
      if (controller.signal.aborted) {
        throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      if (controller.signal.aborted) {
        throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const ss = String(elapsed % 60).padStart(2, '0');
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: `视频生成中… ${mm}:${ss}` });

      const pollResp = await fetch(`https://aihubmix.com/v1/videos/${jobId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal,
      });

      if (!pollResp.ok) { continue; }

      const pollData = await pollResp.json() as { status?: string };
      const status = pollData.status?.toLowerCase();
      if (status === 'succeeded' || status === 'completed' || status === 'success') {
        completed = true;
        break;
      } else if (status === 'failed' || status === 'error') {
        throw new Error('视频生成任务在服务端失败');
      }
      // still pending — continue polling
    }

    // Step 3: Download video via /v1/videos/{id}/content
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '视频下载中…' });
    const videoResp = await fetch(`https://aihubmix.com/v1/videos/${jobId}/content`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!videoResp.ok) {
      const errText = await videoResp.text();
      throw new Error(`Video download error ${videoResp.status}: ${errText}`);
    }
    const videoBytes = Buffer.from(await videoResp.arrayBuffer());

    const aiDir = await ensureAiOutputDir(canvasUri);
    const ts = formatTimestamp();
    const filename = `video-gen_${ts}.mp4`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, videoBytes);
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const activeDocVG = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'video',
      title: `Video ${ts}`,
      position: calcPreferredBlueprintOutputPosition(nodeId, fnNode, { width: 280, height: 180 }, activeDocVG?.data),
      size: { width: 280, height: 180 },
      file_path: relPath,
      meta: buildMultimodalNodeMeta(model),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };

    if (activeDocVG) {
      activeDocVG.data.nodes.push(outNode);
      activeDocVG.data.edges.push(outEdge);
      CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
      await writeCanvas(canvasUri, activeDocVG.data);
    }

    activeRuns.delete(runId);
    webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);

    const outputContent: AIContent = { type: 'text', title: outNode.title, text: `[Video: ${relPath}]` };
    return { success: true, runId, outputContent, outputNode: outNode };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

// ── Output position calculator (A1) ───────────────────────────────────────────
// Places the output node to the right of the function node and scans existing
// nodes for bounding-box collisions. Steps down by (height + gap) until a free
// slot is found (max 20 iterations to avoid infinite loops on very cluttered canvases).
export function calcOutputPosition(
  fnNode: CanvasNode,
  outSize: { width: number; height: number },
  existingNodes: CanvasNode[]
): { x: number; y: number } {
  const GAP = 60;
  const baseX = fnNode.position.x + fnNode.size.width + GAP;
  const stepY = outSize.height + GAP;

  for (let i = 0; i < 20; i++) {
    const candidate = { x: baseX, y: fnNode.position.y + i * stepY };
    const overlaps = existingNodes.some(n => {
      if (!n.position || !n.size) { return false; }
      return (
        candidate.x < n.position.x + n.size.width + GAP / 2 &&
        candidate.x + outSize.width + GAP / 2 > n.position.x &&
        candidate.y < n.position.y + n.size.height + GAP / 2 &&
        candidate.y + outSize.height + GAP / 2 > n.position.y
      );
    });
    if (!overlaps) { return candidate; }
  }
  // Fallback: place below all existing nodes at baseX
  const maxY = existingNodes.reduce((m, n) => Math.max(m, (n.position?.y ?? 0) + (n.size?.height ?? 0)), 0);
  return { x: baseX, y: maxY + GAP };
}

function calcPreferredBlueprintOutputPosition(
  nodeId: string,
  fnNode: CanvasNode,
  outSize: { width: number; height: number },
  canvas: Pick<CanvasFile, 'nodes' | 'edges'> | undefined,
): { x: number; y: number } {
  if (canvas) {
    const directOutputTarget = canvas.edges
      .filter(edge => edge.source === nodeId && edge.edge_type === 'ai_generated')
      .map(edge => canvas.nodes.find(node => node.id === edge.target))
      .find(node =>
        !!node && (
          node.meta?.blueprint_placeholder_kind === 'output' ||
          node.meta?.blueprint_bound_slot_kind === 'output'
        )
      );
    if (directOutputTarget?.position) {
      return { ...directOutputTarget.position };
    }
  }
  return calcOutputPosition(fnNode, outSize, canvas?.nodes ?? []);
}

const DOUBAO_SEEDREAM_ROUTE_MODEL = 'doubao-seedream-5.0-lite';

function isDoubaoSeedreamModel(model: string): boolean {
  return /^doubao-seedream-/i.test(model);
}

function buildDoubaoPredictionsEndpoint(routeModel = DOUBAO_SEEDREAM_ROUTE_MODEL): string {
  return `https://aihubmix.com/v1/models/doubao/${encodeURIComponent(routeModel)}/predictions`;
}

function asImageDataUrl(content: AIContent): string {
  if (content.type !== 'image' || !content.base64 || !content.mediaType) {
    throw new Error('图像输入缺少可用的 base64 或 mediaType');
  }
  return `data:${content.mediaType};base64,${content.base64}`;
}

function normalizeDoubaoSize(size: string | undefined): string {
  const raw = (size ?? '').trim();
  if (!raw) { return '2k'; }
  const lower = raw.toLowerCase();
  if (lower === '2k' || lower === '3k') { return lower; }
  if (lower === '1k') { return '2k'; }
  if (/^\d+x\d+$/.test(lower)) { return lower; }
  return '2k';
}

function buildMultimodalNodeMeta(
  model: string,
  extra?: CanvasNode['meta'],
): CanvasNode['meta'] {
  return {
    ai_provider: 'AIHubMix',
    ai_model: model || undefined,
    ...(extra ?? {}),
  };
}

type PredictionImageCandidate = { url?: string; dataUrl?: string; mimeType?: string };

function normalizePredictionImageCandidate(item: unknown): PredictionImageCandidate | null {
  if (!item) { return null; }
  if (typeof item === 'string') {
    if (/^data:image\//i.test(item)) {
      return { dataUrl: item };
    }
    return { url: item };
  }
  if (typeof item !== 'object') { return null; }
  const rec = item as Record<string, unknown>;
  const stringValue = ['url', 'image', 'src'].find(key => typeof rec[key] === 'string');
  if (stringValue) {
    const value = String(rec[stringValue]);
    return /^data:image\//i.test(value) ? { dataUrl: value } : { url: value };
  }
  const base64Value = ['b64_json', 'base64', 'data'].find(key => typeof rec[key] === 'string');
  if (base64Value) {
    const value = String(rec[base64Value]);
    if (/^data:image\//i.test(value)) {
      return { dataUrl: value };
    }
    const mimeType = typeof rec['mime_type'] === 'string'
      ? String(rec['mime_type'])
      : typeof rec['mimeType'] === 'string'
        ? String(rec['mimeType'])
        : 'image/png';
    return { dataUrl: `data:${mimeType};base64,${value}`, mimeType };
  }
  return null;
}

function extractPredictionImageCandidates(payload: unknown): PredictionImageCandidate[] {
  if (!payload || typeof payload !== 'object') { return []; }
  const rec = payload as Record<string, unknown>;
  const buckets = [rec['output'], rec['data'], rec['images'], rec['image']];
  const entries: unknown[] = [];
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      entries.push(...bucket);
    } else if (bucket && typeof bucket === 'object') {
      const nested = bucket as Record<string, unknown>;
      if (Array.isArray(nested['images'])) {
        entries.push(...nested['images']);
      } else {
        entries.push(bucket);
      }
    } else if (typeof bucket === 'string') {
      entries.push(bucket);
    }
  }
  return entries
    .map(normalizePredictionImageCandidate)
    .filter((item): item is PredictionImageCandidate => !!item);
}

async function materializePredictionImage(candidate: PredictionImageCandidate): Promise<{ bytes: Buffer; mimeType: string }> {
  if (candidate.dataUrl) {
    const match = candidate.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Doubao 返回了无法识别的 data URL 图像');
    }
    return {
      bytes: Buffer.from(match[2], 'base64'),
      mimeType: match[1],
    };
  }
  if (!candidate.url) {
    throw new Error('Doubao 未返回可下载的图像地址');
  }
  const response = await fetch(candidate.url);
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`下载生成图像失败 ${response.status}: ${errText}`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') ?? candidate.mimeType ?? 'image/png',
  };
}

async function persistGeneratedImages(
  nodeId: string,
  fnNode: CanvasNode,
  canvasUri: vscode.Uri,
  filePrefix: string,
  titlePrefix: string,
  candidates: PredictionImageCandidate[],
  model: string,
): Promise<{ outputNodes: CanvasNode[]; outputEdges: CanvasEdge[]; outputContents: AIContent[] }> {
  if (candidates.length === 0) {
    throw new Error('模型未返回任何图像结果');
  }

  const activeDoc = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
  const outputNodes: CanvasNode[] = [];
  const outputEdges: CanvasEdge[] = [];
  const outputContents: AIContent[] = [];
  const ts = formatTimestamp();
  const outSize = { width: 240, height: 200 };
  const basePosition = calcPreferredBlueprintOutputPosition(nodeId, fnNode, outSize, activeDoc?.data);
  const GAP_Y = 60;

  for (let index = 0; index < candidates.length; index++) {
    const { bytes, mimeType } = await materializePredictionImage(candidates[index]);
    const aiDir = await ensureAiOutputDir(canvasUri);
    const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
    const filename = `${filePrefix}_${ts}_${index + 1}.${ext}`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, bytes);
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'image',
      title: candidates.length === 1 ? `${titlePrefix} ${ts}` : `${titlePrefix} ${index + 1} ${ts}`,
      position: {
        x: basePosition.x,
        y: basePosition.y + index * (outSize.height + GAP_Y),
      },
      size: outSize,
      file_path: relPath,
      meta: buildMultimodalNodeMeta(model, { display_mode: 'file' }),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };
    outputNodes.push(outNode);
    outputEdges.push(outEdge);
    outputContents.push({
      type: 'image',
      title: outNode.title,
      localPath: fileUri.fsPath,
      base64: bytes.toString('base64'),
      mediaType: (mimeType.includes('jpeg') ? 'image/jpeg' : mimeType.includes('webp') ? 'image/webp' : 'image/png') as 'image/png' | 'image/jpeg' | 'image/webp',
    });
  }

  if (activeDoc) {
    activeDoc.data.nodes.push(...outputNodes);
    activeDoc.data.edges.push(...outputEdges);
    CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
    await writeCanvas(canvasUri, activeDoc.data);
  }

  return { outputNodes, outputEdges, outputContents };
}

// ── Image editing ──────────────────────────────────────────────────────────

async function runImageEdit(
  fnNode: CanvasNode,
  _toolDef: NonNullable<ReturnType<ToolRegistry['get']>>,
  params: Record<string, unknown>,
  contents: AIContent[],
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  settingsDefaultModel: string
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'running', progressText: '图像编辑中…' });

  if (!apiKey) {
    const msg = '未配置 AIHubMix API Key，请前往「设置 → 多模态工具 (AIHubMix)」填写。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const imageContents = contents.filter((c): c is AIContent & { type: 'image' } => c.type === 'image');
  if (imageContents.length === 0) {
    const msg = _toolDef.id === 'image-fusion'
      ? '多图融合需要至少连接 2 个图像节点。'
      : '图像编辑需要连接图像节点作为参考图。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  if (_toolDef.id === 'image-fusion' && imageContents.length < 2) {
    const msg = '多图融合至少需要连接 2 个图像节点。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const textPrompt = contents
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('\n\n')
    .trim();
  const prompt = _toolDef.id === 'image-fusion'
    ? ((params['instruction'] as string) ?? '').trim()
    : textPrompt;

  if (!prompt) {
    const msg = _toolDef.id === 'image-fusion'
      ? '多图融合需要融合指令，请在节点下方填写。'
      : '图像编辑需要连接文本节点作为编辑提示词。';
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }

  const model = (params['model'] as string) || settingsDefaultModel || (_toolDef.id === 'image-fusion' ? 'doubao-seedream-4-0-250828' : 'gemini-3.1-flash-image-preview');
  const aspectRatio = (params['aspect_ratio'] as string) ?? '1:1';
  const size = normalizeDoubaoSize(params['size'] as string | undefined);
  const watermark = Boolean(params['watermark'] ?? false);

  const controller = new AbortController();
  activeRuns.set(runId, controller);

  if (_toolDef.id === 'image-fusion') {
    return runDoubaoImageFusion(fnNode, prompt, model, imageContents, size, watermark, canvasUri, webview, runId, apiKey, controller);
  }

  if (isDoubaoSeedreamModel(model)) {
    return runImageEditDoubao(fnNode, prompt, model, imageContents[0], size, watermark, canvasUri, webview, runId, apiKey, controller);
  }

  try {
    const endpoint = `https://aihubmix.com/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: imageContents[0].mediaType, data: imageContents[0].base64 } },
            { text: prompt },
          ],
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio, imageSize: '1k' },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Image Edit API error ${response.status}: ${errText}`);
    }

    const data = await response.json() as {
      candidates?: {
        content?: {
          parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[];
        };
      }[];
    };

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find(p => p.inlineData?.data);
    if (!imagePart?.inlineData?.data) {
      throw new Error('Gemini 图像编辑未返回图像数据');
    }

    const mimeType = imagePart.inlineData.mimeType ?? 'image/png';
    const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
    const imageBytes = Buffer.from(imagePart.inlineData.data, 'base64');

    const aiDir = await ensureAiOutputDir(canvasUri);
    const ts = formatTimestamp();
    const filename = `image-edit_${ts}.${ext}`;
    const fileUri = vscode.Uri.joinPath(aiDir, filename);
    await vscode.workspace.fs.writeFile(fileUri, imageBytes);
    const relPath = toRelPath(fileUri.fsPath, canvasUri);

    const activeDocIE = CanvasEditorProvider.activeDocuments.get(canvasUri.fsPath);
    const outNode: CanvasNode = {
      id: uuid(),
      node_type: 'image',
      title: `Edited Image ${ts}`,
      position: calcPreferredBlueprintOutputPosition(nodeId, fnNode, { width: 240, height: 200 }, activeDocIE?.data),
      size: { width: 240, height: 200 },
      file_path: relPath,
      meta: buildMultimodalNodeMeta(model, { display_mode: 'file' }),
    };
    const outEdge: CanvasEdge = { id: uuid(), source: nodeId, target: outNode.id, edge_type: 'ai_generated' };

    if (activeDocIE) {
      activeDocIE.data.nodes.push(outNode);
      activeDocIE.data.edges.push(outEdge);
      CanvasEditorProvider.suppressRevert(canvasUri.fsPath);
      await writeCanvas(canvasUri, activeDocIE.data);
    }

    activeRuns.delete(runId);
    webview.postMessage({ type: 'aiDone', runId, node: outNode, edge: outEdge });
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);

    const outputContent: AIContent = {
      type: 'image',
      title: outNode.title,
      localPath: fileUri.fsPath,
      base64: imageBytes.toString('base64'),
      mediaType: mimeType as 'image/png' | 'image/jpeg',
    };
    return { success: true, runId, outputContent, outputNode: outNode };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runImageEditDoubao(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  imageContent: AIContent & { type: 'image' },
  size: string,
  watermark: boolean,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const response = await fetch(buildDoubaoPredictionsEndpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          image: asImageDataUrl(imageContent),
          prompt,
          size,
          sequential_image_generation: 'disabled',
          stream: false,
          response_format: 'url',
          watermark,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Doubao Image Edit API error ${response.status}: ${errText}`);
    }

    const data = await response.json() as unknown;
    const { outputNodes, outputEdges, outputContents } = await persistGeneratedImages(
      nodeId,
      fnNode,
      canvasUri,
      'image-edit',
      'Edited Image',
      extractPredictionImageCandidates(data),
      model,
    );

    activeRuns.delete(runId);
    for (let index = 0; index < outputNodes.length; index++) {
      webview.postMessage({ type: 'aiDone', runId, node: outputNodes[index], edge: outputEdges[index] });
    }
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);
    return { success: true, runId, outputContent: outputContents[0], outputNode: outputNodes[0] };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}

async function runDoubaoImageFusion(
  fnNode: CanvasNode,
  prompt: string,
  model: string,
  imageContents: Array<AIContent & { type: 'image' }>,
  size: string,
  watermark: boolean,
  canvasUri: vscode.Uri,
  webview: vscode.Webview,
  runId: string,
  apiKey: string,
  controller: AbortController,
): Promise<FunctionRunResult> {
  const nodeId = fnNode.id;
  try {
    const response = await fetch(buildDoubaoPredictionsEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          model,
          prompt,
          image: imageContents.map(asImageDataUrl),
          sequential_image_generation: 'disabled',
          size,
          stream: false,
          response_format: 'url',
          watermark,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Doubao Image Fusion API error ${response.status}: ${errText}`);
    }

    const data = await response.json() as unknown;
    const { outputNodes, outputEdges, outputContents } = await persistGeneratedImages(
      nodeId,
      fnNode,
      canvasUri,
      'image-fusion',
      'Fusion Image',
      extractPredictionImageCandidates(data),
      model,
    );

    activeRuns.delete(runId);
    for (let index = 0; index < outputNodes.length; index++) {
      webview.postMessage({ type: 'aiDone', runId, node: outputNodes[index], edge: outputEdges[index] });
    }
    webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'done' });
    setTimeout(() => webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' }), 3000);
    return { success: true, runId, outputContent: outputContents[0], outputNode: outputNodes[0] };
  } catch (e: unknown) {
    activeRuns.delete(runId);
    if (e instanceof Error && e.name === 'AbortError') {
      webview.postMessage({ type: 'fnStatusUpdate', nodeId, status: 'idle' });
      return { success: false, runId, errorMessage: 'Cancelled' };
    }
    const msg = e instanceof Error ? e.message : String(e);
    reportNodeIssue(webview, nodeId, runId, msg);
    return { success: false, runId, errorMessage: msg };
  }
}
