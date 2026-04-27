#!/usr/bin/env node

import {
  getApiKey,
  logHttpFailure,
  logThrown,
  parseJsonOrFail,
  readResponseText,
  requireVideoLiveOptIn,
} from './aihubmix-live-utils.mjs';

requireVideoLiveOptIn();

const apiKey = getApiKey();
const started = Date.now();
const model = process.env.AIHUBMIX_VIDEO_MODEL?.trim() || 'doubao-seedance-2-0-260128';
const pollIntervalMs = Number(process.env.AIHUBMIX_VIDEO_POLL_INTERVAL_MS || 15000);
const maxWaitMs = Number(process.env.AIHUBMIX_VIDEO_MAX_WAIT_MS || 600000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const submitResponse = await fetch('https://aihubmix.com/v1/videos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: 'A tiny blue circle slowly appears on a plain white background, minimal motion',
      size: '720p',
      seconds: '5',
    }),
    signal: AbortSignal.timeout(120000),
  });

  const submitText = await readResponseText(submitResponse);
  if (!submitResponse.ok) {
    logHttpFailure('video submit smoke', submitResponse, submitText, Date.now() - started);
    process.exit(1);
  }

  const submitPayload = parseJsonOrFail(submitText, 'video submit smoke');
  const jobId = submitPayload.id || submitPayload.task_id;
  if (!jobId) {
    console.error('[aihubmix-live] video smoke submit succeeded but no job id was returned', JSON.stringify({
      elapsedMs: Date.now() - started,
      topLevelKeys: Object.keys(submitPayload),
    }));
    process.exit(1);
  }

  while (Date.now() - started < maxWaitMs) {
    await sleep(pollIntervalMs);
    const pollResponse = await fetch(`https://aihubmix.com/v1/videos/${jobId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(120000),
    });
    const pollText = await readResponseText(pollResponse);
    if (!pollResponse.ok) {
      logHttpFailure('video poll smoke', pollResponse, pollText, Date.now() - started);
      process.exit(1);
    }

    const pollPayload = parseJsonOrFail(pollText, 'video poll smoke');
    const status = String(pollPayload.status || '').toLowerCase();
    console.log('[aihubmix-live] video poll', JSON.stringify({ jobId, status, elapsedMs: Date.now() - started }));
    if (['succeeded', 'completed', 'success', 'done', 'finished'].includes(status)) {
      break;
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
      console.error('[aihubmix-live] video task failed', JSON.stringify({
        jobId,
        status,
        message: pollPayload?.error?.message || pollPayload?.message || pollPayload?.failure_reason,
      }));
      process.exit(1);
    }
  }

  if (Date.now() - started >= maxWaitMs) {
    console.error('[aihubmix-live] video smoke timed out', JSON.stringify({ jobId, maxWaitMs }));
    process.exit(1);
  }

  const contentResponse = await fetch(`https://aihubmix.com/v1/videos/${jobId}/content`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(180000),
  });
  if (!contentResponse.ok) {
    logHttpFailure('video download smoke', contentResponse, await readResponseText(contentResponse), Date.now() - started);
    process.exit(1);
  }

  const bytes = Buffer.from(await contentResponse.arrayBuffer());
  if (bytes.length < 1000) {
    console.error('[aihubmix-live] video smoke returned too few bytes', JSON.stringify({
      jobId,
      byteLength: bytes.length,
      elapsedMs: Date.now() - started,
    }));
    process.exit(1);
  }

  console.log('[aihubmix-live] ok', JSON.stringify({
    model,
    endpoint: '/v1/videos',
    jobId,
    elapsedMs: Date.now() - started,
    byteLength: bytes.length,
  }));
}

main().catch(error => {
  logThrown('video smoke', error);
  process.exit(1);
});
