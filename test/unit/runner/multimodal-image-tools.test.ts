import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function loadTool(id: string): any {
  const filePath = path.resolve(__dirname, '../../../resources/tools', `${id}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('multimodal image tool schemas', () => {
  it('exposes gpt-image-2 in image generation with GPT Image specific params', () => {
    const tool = loadTool('image-gen');
    const params = new Map(tool.params.map((param: any) => [param.name, param]));

    expect(params.get('model').options).toContain('gpt-image-2');
    expect(params.get('prompt').label).toBe('图像描述');
    expect(params.get('size').options).toEqual(expect.arrayContaining(['1024x1024', '1024x1536', '1536x1024', 'auto']));
    expect(params.get('quality').options).toEqual(['high', 'medium', 'low', 'auto']);
    expect(params.get('moderation').options).toEqual(['low', 'auto']);
    expect(params.get('background').options).toEqual(['auto', 'transparent', 'opaque']);
    expect(params.get('output_format').options).toEqual(['png', 'jpeg', 'webp']);
    expect(params.get('n').default).toBe(1);
  });

  it('exposes gpt-image-2 in image editing without changing fusion/group tools', () => {
    const imageEdit = loadTool('image-edit');
    const imageFusion = loadTool('image-fusion');
    const imageGroup = loadTool('image-group-output');

    expect(imageEdit.params.find((param: any) => param.name === 'model').options).toContain('gpt-image-2');
    expect(imageEdit.params.find((param: any) => param.name === 'instruction').label).toBe('编辑指令');
    expect(imageFusion.params.find((param: any) => param.name === 'model').options).not.toContain('gpt-image-2');
    expect(imageGroup.params.find((param: any) => param.name === 'model').options).not.toContain('gpt-image-2');
  });
});
