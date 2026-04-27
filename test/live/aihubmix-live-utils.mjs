import { Buffer } from 'node:buffer';

export function getApiKey() {
  const apiKey = process.env.AIHUBMIX_API_KEY?.trim();
  if (!apiKey) {
    console.error('[aihubmix-live] AIHUBMIX_API_KEY is not set. Refusing to run live paid API test.');
    process.exit(2);
  }
  return apiKey;
}

export function collectImageCandidates(payload) {
  const found = [];
  const walk = value => {
    if (!value || found.length >= 20) { return; }
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value)) {
        found.push({ type: 'url' });
      } else if (/^data:image\//i.test(value)) {
        found.push({ type: 'data_url' });
      } else if (value.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(value)) {
        found.push({ type: 'base64_like' });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(payload);
  return found;
}

export async function readResponseText(response) {
  try {
    return await response.text();
  } catch (error) {
    return `[failed to read response text: ${error?.message ?? String(error)}]`;
  }
}

export function parseJsonOrFail(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`[aihubmix-live] ${label} returned non-json response`, JSON.stringify({
      message: error?.message,
      bodyPreview: text.slice(0, 600),
    }));
    process.exit(1);
  }
}

export function logHttpFailure(label, response, text, elapsedMs) {
  console.error(`[aihubmix-live] ${label} failed`, JSON.stringify({
    status: response.status,
    elapsedMs,
    bodyPreview: text.slice(0, 600),
  }));
}

export function logThrown(label, error) {
  console.error(`[aihubmix-live] ${label} threw`, JSON.stringify({
    name: error?.name,
    message: error?.message,
    causeCode: error?.cause?.code,
    causeMessage: error?.cause?.message,
  }));
}

export function createSilentWav(durationSeconds = 0.5, sampleRate = 16000) {
  const channelCount = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const dataSize = sampleCount * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

export function requireVideoLiveOptIn() {
  if (process.env.AIHUBMIX_RUN_VIDEO_LIVE !== '1') {
    console.log('[aihubmix-live] video live smoke skipped. Set AIHUBMIX_RUN_VIDEO_LIVE=1 to run this paid high-cost test.');
    process.exit(0);
  }
}
