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
const model = process.env.AIHUBMIX_GEMINI_IMAGE_MODEL?.trim() || 'gemini-3-pro-image-preview';

async function main() {
  const response = await fetch(`https://aihubmix.com/gemini/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'A tiny blue circle icon on a white background, simple flat style' }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
      },
    }),
    signal: AbortSignal.timeout(180000),
  });

  const text = await readResponseText(response);
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    logHttpFailure('gemini image smoke', response, text, elapsedMs);
    process.exit(1);
  }

  const payload = parseJsonOrFail(text, 'gemini image smoke');
  const candidates = collectImageCandidates(payload);
  if (candidates.length === 0) {
    console.error('[aihubmix-live] gemini image smoke succeeded but no image candidate was found', JSON.stringify({
      model,
      elapsedMs,
      topLevelKeys: Object.keys(payload),
    }));
    process.exit(1);
  }

  console.log('[aihubmix-live] ok', JSON.stringify({
    model,
    endpoint: '/gemini/v1beta/models/{model}:generateContent',
    elapsedMs,
    imageCandidateCount: candidates.length,
    firstCandidateType: candidates[0].type,
  }));
}

main().catch(error => {
  logThrown('gemini image smoke', error);
  process.exit(1);
});
