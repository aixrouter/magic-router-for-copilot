import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletionRequest, StreamHandlers } from '../../src/types.js';

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (...parts: Array<{ fsPath?: string } | string>) => ({
      fsPath: parts.map((part) => typeof part === 'string' ? part : part.fsPath ?? '').join('/'),
    }),
  },
  EventEmitter: class {
    private listeners: Array<(value: unknown) => void> = [];
    event = (listener: (value: unknown) => void) => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
    };
    fire = (value: unknown) => { for (const l of this.listeners) l(value); };
    dispose = () => { this.listeners = []; };
  },
  extensions: { getExtension: () => undefined },
}));

const { AIXRouterClient } = await import('../../src/client/aixrouterClient.js');

describe('AIXRouterClient OpenAI compatibility fallbacks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries once with stream=false when upstream explicitly rejects streaming', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'stream is unsupported' } }, 400))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'ok' } }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const events = createEvents();
    await new AIXRouterClient('https://api.example.test', 'key').streamChatCompletion(
      baseRequest(),
      'deepseek-v4-pro',
      events.handlers,
      { openAIStreamFallback: true },
    );

    expect(events.text).toEqual(['ok']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({ stream: false });
  });

  it('does not fallback to non-stream for rate limits or server errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'rate limited' } }, 429));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new AIXRouterClient('https://api.example.test', 'key').streamChatCompletion(
      baseRequest(),
      'deepseek-v4-pro',
      createEvents().handlers,
      { openAIStreamFallback: true },
    )).rejects.toThrow(/429/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry POST requests that fail before an HTTP response', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new AIXRouterClient('https://api.example.test', 'key').streamChatCompletion(
      baseRequest(),
      'deepseek-v4-pro',
      createEvents().handlers,
      { openAIStreamFallback: true },
    )).rejects.toThrow(/failed before receiving an HTTP response/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries an empty OpenAI response once', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse('data: [DONE]\n\n'))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'after retry' } }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const events = createEvents();
    await new AIXRouterClient('https://api.example.test', 'key').streamChatCompletion(
      baseRequest(),
      'deepseek-v4-pro',
      events.handlers,
      { openAIStreamFallback: true },
    );

    expect(events.text).toEqual(['after retry']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry after text has already been emitted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        'data: {"choices":[{"delta":{"content":"hello"}}]}',
        'data: [DONE]',
        '',
      ].join('\n\n')));
    vi.stubGlobal('fetch', fetchMock);

    const events = createEvents();
    await new AIXRouterClient('https://api.example.test', 'key').streamChatCompletion(
      baseRequest(),
      'deepseek-v4-pro',
      events.handlers,
      { openAIStreamFallback: true },
    );

    expect(events.text).toEqual(['hello']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('switches to stream=false when retrying an empty OpenAI response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse('data: [DONE]\n\n'))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'after retry' } }],
      }));
    vi.stubGlobal('fetch', fetchMock);

    const events = createEvents();
    await new AIXRouterClient('https://api.example.test', 'key').streamChatCompletion(
      baseRequest(),
      'deepseek-v4-pro',
      events.handlers,
      { openAIStreamFallback: true },
    );

    expect(events.text).toEqual(['after retry']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ stream: true });
    // The retry must force stream=false; otherwise it just repeats the same
    // failing request against the same affinity-routed upstream.
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({ stream: false });
  });

  it('surfaces upstream SSE error frames as AIXRouterUpstreamError without retrying', async () => {
    const errorFrame = JSON.stringify({
      error: {
        code: 'limited',
        message: 'request is limited',
        param: 'system',
        type: 'rate_limit_error',
      },
      request_id: '019f13be-e54c-7561-9090-baf00e492a7d',
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(sseResponse([
      `data: ${errorFrame}`,
      '',
    ].join('\n\n')));
    vi.stubGlobal('fetch', fetchMock);

    const { AIXRouterUpstreamError } = await import('../../src/client/errors.js');
    const promise = new AIXRouterClient('https://api.example.test', 'key').streamChatCompletion(
      baseRequest(),
      'deepseek-v4-pro',
      createEvents().handlers,
      { openAIStreamFallback: true },
    );

    await expect(promise).rejects.toBeInstanceOf(AIXRouterUpstreamError);
    await expect(promise).rejects.toMatchObject({
      rateLimited: true,
      code: 'limited',
      requestId: '019f13be-e54c-7561-9090-baf00e492a7d',
    });
    // A second fetch would be a retry — must not happen for rate limits.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes a body preview in the empty-stream error when the stream contains only keepalives', async () => {
    const buildResponse = () => sseResponse([
      ': aixrouter-keepalive',
      'data: {"keepalive":true}',
      'data: [DONE]',
      '',
    ].join('\n\n'));
    // The first attempt streams empty, triggers the empty-response retry
    // (with stream=false), and the second attempt also streams empty -> we
    // assert the preview is carried through in the final error message.
    const fetchMock = vi.fn().mockImplementation(async () => buildResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(new AIXRouterClient('https://api.example.test', 'key').streamChatCompletion(
      baseRequest(),
      'deepseek-v4-pro',
      createEvents().handlers,
      { openAIStreamFallback: false },
    )).rejects.toThrow(/Response preview: .*aixrouter-keepalive/);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});


function baseRequest(): ChatCompletionRequest {
  return {
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  };
}

function createEvents(): {
  text: string[];
  thinking: string[];
  tools: unknown[];
  handlers: StreamHandlers;
} {
  const text: string[] = [];
  const thinking: string[] = [];
  const tools: unknown[] = [];
  return {
    text,
    thinking,
    tools,
    handlers: {
      onText: (value) => text.push(value),
      onThinking: (value) => thinking.push(value),
      onToolCall: (value) => tools.push(value),
      onUsage: () => undefined,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}
