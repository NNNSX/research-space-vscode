#!/usr/bin/env node

import {
  createSilentWav,
  getApiKey,
  logHttpFailure,
  logThrown,
  parseJsonOrFail,
  readResponseText,
} from './aihubmix-live-utils.mjs';

const apiKey = getApiKey();
const started = Date.now();
const model = process.env.AIHUBMIX_STT_MODEL?.trim() || 'whisper-large-v3-turbo';

async function main() {
  const form = new FormData();
  form.set('file', new File([createSilentWav()], 'silent-smoke.wav', { type: 'audio/wav' }));
  form.set('model', model);
  form.set('response_format', 'json');
  form.set('language', 'en');

  const response = await fetch('https://aihubmix.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });

  const text = await readResponseText(response);
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    logHttpFailure('stt smoke', response, text, elapsedMs);
    process.exit(1);
  }

  const payload = parseJsonOrFail(text, 'stt smoke');
  if (typeof payload.text !== 'string') {
    console.error('[aihubmix-live] stt smoke succeeded but response.text is not a string', JSON.stringify({
      model,
      elapsedMs,
      topLevelKeys: Object.keys(payload),
    }));
    process.exit(1);
  }

  console.log('[aihubmix-live] ok', JSON.stringify({
    model,
    endpoint: '/v1/audio/transcriptions',
    elapsedMs,
    textLength: payload.text.length,
  }));
}

main().catch(error => {
  logThrown('stt smoke', error);
  process.exit(1);
});
