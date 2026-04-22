import { AiTool, ParamDef } from '../../core/canvas-model';

export interface AIToolDef {
  id: AiTool;
  name: string;
  description: string;
  icon: string;                           // codicon name
  params: ParamDef[];
  supportsImages: boolean;
  outputNodeType: 'ai_output' | 'image';
  buildSystem(params: Record<string, unknown>): string;
  postProcess?(raw: string): string;
}

import { summarizeTool } from './summarize';
import { polishTool } from './polish';
import { reviewTool } from './review';
import { translateTool } from './translate';
import { drawTool } from './draw';
import { ragTool } from './rag';

export const AI_TOOLS: Record<Exclude<AiTool, 'chat'>, AIToolDef> = {
  summarize: summarizeTool,
  polish:    polishTool,
  review:    reviewTool,
  translate: translateTool,
  draw:      drawTool,
  rag:       ragTool,
};

export const ALL_TOOLS: AIToolDef[] = Object.values(AI_TOOLS);
