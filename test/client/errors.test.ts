import { describe, expect, it } from 'vitest';
import {
  AIXRouterHttpError,
  AIXRouterUpstreamError,
  createHttpError,
  parseUpstreamErrorPayload,
} from '../../src/client/errors.js';

describe('createHttpError', () => {
  it('returns a typed HTTP error for insufficient token balance', async () => {
    const error = await createHttpError(
      'AIXRouter chat completion failed',
      new Response(JSON.stringify({
        error: {
          message: 'Your subscription has insufficient token balance.',
          code: 'insufficient_tokens',
        },
      }), {
        status: 402,
        statusText: 'Payment Required',
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(error).toBeInstanceOf(AIXRouterHttpError);
    expect((error as AIXRouterHttpError).status).toBe(402);
    expect(error.message).toContain('The account has insufficient balance or quota.');
    expect(error.message).toContain('insufficient_tokens');
  });
});

describe('parseUpstreamErrorPayload', () => {
  it('extracts code, message, type and request_id from an AIXRouter error frame', () => {
    const payload = parseUpstreamErrorPayload({
      error: {
        code: 'limited',
        message: 'request is limited',
        param: 'system',
        type: 'rate_limit_error',
      },
      request_id: '019f13be-e54c-7561-9090-baf00e492a7d',
    });

    expect(payload).toEqual({
      code: 'limited',
      message: 'request is limited',
      type: 'rate_limit_error',
      param: 'system',
      requestId: '019f13be-e54c-7561-9090-baf00e492a7d',
    });
  });

  it('returns undefined for non-error JSON', () => {
    expect(parseUpstreamErrorPayload({ choices: [{ delta: { content: 'hi' } }] })).toBeUndefined();
    expect(parseUpstreamErrorPayload(null)).toBeUndefined();
    expect(parseUpstreamErrorPayload('text')).toBeUndefined();
  });

  it('returns undefined when the error object carries no useful fields', () => {
    expect(parseUpstreamErrorPayload({ error: {} })).toBeUndefined();
  });
});

describe('AIXRouterUpstreamError', () => {
  it('flags rate_limit_error type as rateLimited', () => {
    const error = new AIXRouterUpstreamError('AIXRouter OpenAI stream returned an error', {
      code: 'limited',
      message: 'request is limited',
      type: 'rate_limit_error',
      requestId: 'req-1',
    });

    expect(error.rateLimited).toBe(true);
    expect(error.code).toBe('limited');
    expect(error.requestId).toBe('req-1');
    expect(error.message).toContain('request is limited');
    expect(error.message).toContain('code=limited');
    expect(error.message).toContain('request_id=req-1');
  });

  it('does not flag generic provider errors as rateLimited', () => {
    const error = new AIXRouterUpstreamError('AIXRouter OpenAI stream returned an error', {
      code: 'internal_error',
      message: 'boom',
      type: 'server_error',
    });

    expect(error.rateLimited).toBe(false);
  });
});

