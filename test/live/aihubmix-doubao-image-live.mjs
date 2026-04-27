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
const model = process.env.AIHUBMIX_DOUBAO_IMAGE_MODEL?.trim() || 'doubao-seedream-5.0-lite';

async function main() {
  const response = await fetch(`https://aihubmix.com/v1/models/doubao/${encodeURIComponent(model)}/predictions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: {
        prompt: 'A tiny blue circle icon on a white background, simple flat style',
        size: '2k',
        sequential_image_generation: 'disabled',
        stream: false,
        response_format: 'url',
        watermark: false,
      },
    }),
    signal: AbortSignal.timeout(180000),
  });

  const text = await readResponseText(response);
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    logHttpFailure('doubao image smoke', response, text, elapsedMs);
    process.exit(1);
  }

  const payload = parseJsonOrFail(text, 'doubao image smoke');
  const candidates = collectImageCandidates(payload);
  if (candidates.length === 0) {
    console.error('[aihubmix-live] doubao image smoke succeeded but no image candidate was found', JSON.stringify({
      model,
      elapsedMs,
      topLevelKeys: Object.keys(payload),
    }));
    process.exit(1);
  }

  console.log('[aihubmix-live] ok', JSON.stringify({
    model,
    endpoint: '/v1/models/doubao/{model}/predictions',
    elapsedMs,
    imageCandidateCount: candidates.length,
    firstCandidateType: candidates[0].type,
  }));
}

main().catch(error => {
  logThrown('doubao image smoke', error);
  process.exit(1);
});
