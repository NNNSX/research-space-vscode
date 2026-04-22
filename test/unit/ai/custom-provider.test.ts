import { describe, expect, it } from 'vitest';
import { buildCustomProviderRequestBody, formatCustomProviderHttpError } from '../../../src/ai/custom';

describe('CustomProvider helpers', () => {
  it('uses max_completion_tokens for AIHubMix GPT-5 family models', () => {
    const body = buildCustomProviderRequestBody({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 8192,
      isAihubmixProvider: true,
    });

    expect(body.max_completion_tokens).toBe(8192);
    expect(body.max_tokens).toBeUndefined();
  });

  it('keeps max_tokens for non-AIHubMix custom providers', () => {
    const body = buildCustomProviderRequestBody({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hello' }],
      maxTokens: 4096,
      isAihubmixProvider: false,
    });

    expect(body.max_tokens).toBe(4096);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('formats AIHubMix quota exhaustion into a concise Chinese error', () => {
    const message = formatCustomProviderHttpError({
      providerName: 'AIHubMix',
      status: 403,
      statusText: 'Forbidden',
      responseText: JSON.stringify({
        error: {
          code: 'insufficient_user_quota',
          message: 'Your API token quota has been exhausted',
        },
      }),
      isAihubmixProvider: true,
    });

    expect(message).toContain('AIHubMix 额度不足');
    expect(message).toContain('token quota');
  });
});
