import type { CanvasNode, CanvasEdge } from '../core/canvas-model';
import type { PipelinePlan } from './pipeline-engine';

// ── Pipeline Validator (v2.0) ──────────────────────────────────────────────
// Pre-run validation: checks that every function node in the pipeline
// has at least one input (either data_flow from a data node or
// pipeline_flow from an upstream function node).

export interface ValidationError {
  nodeId: string;
  nodeTitle: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate a pipeline plan before execution.
 * Checks:
 * 1. Each function node (except the trigger) has at least one input edge
 * 2. Chat-mode tools have a non-empty user prompt
 */
export function validatePipeline(
  plan: PipelinePlan,
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[],
): ValidationResult {
  const errors: ValidationError[] = [];
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  for (const nodeId of plan.pipelineNodeIds) {
    const node = nodeMap.get(nodeId);
    if (!node) { continue; }

    const nodePlan = plan.nodeExecutionPlans[nodeId];
    const incomingEdges = nodePlan?.inputEdges ?? [];
    const dataInputs = nodePlan?.directDataSourceIds ?? [];
    const pipelineInputs = plan.dependencyNodeIdsByNode[nodeId] ?? [];

    if (incomingEdges.length === 0) {
      // The trigger node (first in pipeline) is allowed to have no pipeline inputs
      // but should still have data inputs
      const isHead = plan.layers[0]?.nodeIds.includes(nodeId);
      if (isHead) {
        if (dataInputs.length === 0) {
          errors.push({
            nodeId,
            nodeTitle: node.title,
            message: `「${node.title}」没有连接任何输入数据`,
            severity: 'warning',
          });
        }
      } else {
        // Non-head nodes must have at least pipeline input
        errors.push({
          nodeId,
          nodeTitle: node.title,
          message: `「${node.title}」没有输入（需要数据连线或管道连线）`,
          severity: 'error',
        });
      }
    }

    // Check chat-mode tools have a prompt
    const tool = node.meta?.ai_tool;
    if (tool === 'chat' || tool === 'rag') {
      const chatPrompt = (node.meta?.param_values?.['_chatPrompt'] as string) ?? '';
      if (!chatPrompt.trim()) {
        errors.push({
          nodeId,
          nodeTitle: node.title,
          message: `「${node.title}」的用户提示词为空`,
          severity: 'warning',
        });
      }
    } else if (tool === 'rag') {
      const query = (node.meta?.param_values?.['query'] as string) ?? '';
      if (!query.trim()) {
        errors.push({
          nodeId,
          nodeTitle: node.title,
          message: `「${node.title}」的问题为空`,
          severity: 'warning',
        });
      }
    }

    if (!(plan.layers[0]?.nodeIds.includes(nodeId)) && incomingEdges.length > 0 && pipelineInputs.length === 0) {
      errors.push({
        nodeId,
        nodeTitle: node.title,
        message: `「${node.title}」缺少上游 Pipeline 依赖`,
        severity: 'error',
      });
    }
  }

  const hasBlockingError = errors.some(e => e.severity === 'error');
  return { valid: !hasBlockingError, errors };
}
