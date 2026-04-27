#!/usr/bin/env node

import {
  collectImageCandidates,
  getApiKey,
  logHttpFailure,
  logThrown,
  parseJsonOrFail,
  readResponseText,
} from './aihubmix-live-utils.mjs';

const apiKey = getApiKey();
const started = Date.now();

async function main() {
  const response = await fetch('https://aihubmix.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt: 'A simple small blue circle icon on a plain white background, clean vector style',
      size: '1024x1024',
      n: 1,
      quality: 'low',
      moderation: 'low',
      background: 'auto',
      output_format: 'png',
    }),
    signal: AbortSignal.timeout(180000),
  });

  const text = await readResponseText(response);
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    logHttpFailure('gpt-image-2 image smoke', response, text, elapsedMs);
    process.exit(1);
  }

  const payload = parseJsonOrFail(text, 'gpt-image-2 image smoke');
  const candidates = collectImageCandidates(payload);
  if (candidates.length === 0) {
    console.error('[aihubmix-live] request succeeded but no image candidate was found', JSON.stringify({
      elapsedMs,
      topLevelKeys: Object.keys(payload),
    }));
    process.exit(1);
  }

  console.log('[aihubmix-live] ok', JSON.stringify({
    model: 'gpt-image-2',
    endpoint: '/v1/images/generations',
    elapsedMs,
    topLevelKeys: Object.keys(payload),
    imageCandidateCount: candidates.length,
    firstCandidateType: candidates[0].type,
  }));
}

main().catch(error => {
  logThrown('gpt-image-2 image smoke', error);
  process.exit(1);
});
