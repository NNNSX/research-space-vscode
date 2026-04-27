#!/usr/bin/env node

import {
  getApiKey,
  logHttpFailure,
  logThrown,
  readResponseText,
} from './aihubmix-live-utils.mjs';

const apiKey = getApiKey();
const started = Date.now();
const model = process.env.AIHUBMIX_TTS_MODEL?.trim() || 'gpt-4o-mini-tts';

async function main() {
  const response = await fetch('https://aihubmix.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: 'Research Space live smoke test.',
      voice: 'coral',
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(120000),
  });

  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    logHttpFailure('tts smoke', response, await readResponseText(response), elapsedMs);
    process.exit(1);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100) {
    console.error('[aihubmix-live] tts smoke returned too few bytes', JSON.stringify({
      model,
      elapsedMs,
      byteLength: bytes.length,
    }));
    process.exit(1);
  }

  console.log('[aihubmix-live] ok', JSON.stringify({
    model,
    endpoint: '/v1/audio/speech',
    elapsedMs,
    byteLength: bytes.length,
  }));
}

main().catch(error => {
  logThrown('tts smoke', error);
  process.exit(1);
});
