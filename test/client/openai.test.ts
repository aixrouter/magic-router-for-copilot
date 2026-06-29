import { describe, expect, it } from 'vitest';
import type { StreamHandlers } from '../../src/types.js';
import {
  processSseData,
  processOpenAIFullResponse,
  type ToolCallAccumulator,
} from '../../src/client/openai.js';
import { AIXRouterUpstreamError } from '../../src/client/errors.js';

describe('processSseData', () => {
  it('throws AIXRouterUpstreamError when the SSE frame is an upstream error payload', () => {
    const toolCalls = new Map<number, ToolCallAccumulator>();
    const handlers = createHandlers();
    const errorFrame = JSON.stringify({
      error: {
        code: 'limited',
        message: 'request is limited',
        param: 'system',
        type: 'rate_limit_error',
      },
      request_id: '019f13be-e54c-7561-9090-baf00e492a7d',
    });

    let captured: unknown;
    try {
      processSseData(errorFrame, toolCalls, handlers);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(AIXRouterUpstreamError);
    const upstream = captured as AIXRouterUpstreamError;
    expect(upstream.rateLimited).toBe(true);
    expect(upstream.code).toBe('limited');
    expect(upstream.requestId).toBe('019f13be-e54c-7561-9090-baf00e492a7d');
  });

  it('silently ignores frames that are neither deltas nor error payloads', () => {
    const toolCalls = new Map<number, ToolCallAccumulator>();
    const handlers = createHandlers();

    expect(processSseData(JSON.stringify({ keepalive: true }), toolCalls, handlers)).toBe(false);
    expect(handlers.calls.text).toHaveLength(0);
  });

  it('emits text deltas', () => {
    const toolCalls = new Map<number, ToolCallAccumulator>();
    const handlers = createHandlers();
    const frame = JSON.stringify({ choices: [{ delta: { content: 'hello' } }] });

    expect(processSseData(frame, toolCalls, handlers)).toBe(true);
    expect(handlers.calls.text).toEqual(['hello']);
  });
});

describe('processOpenAIFullResponse', () => {
  it('throws AIXRouterUpstreamError when the JSON body carries an error payload', async () => {
    const handlers = createHandlers();
    const response = new Response(JSON.stringify({
      error: {
        code: 'limited',
        message: 'request is limited',
        type: 'rate_limit_error',
      },
      request_id: 'req-2',
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    await expect(processOpenAIFullResponse(response, handlers)).rejects.toBeInstanceOf(AIXRouterUpstreamError);
  });

  it('throws the generic empty-response error when the body has neither content nor an error', async () => {
    const handlers = createHandlers();
    const response = new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(processOpenAIFullResponse(response, handlers)).rejects.toThrow(
      /did not contain any assistant text or tool call/,
    );
  });
});

function createHandlers(): StreamHandlers & { calls: { text: string[]; thinking: string[]; tools: unknown[] } } {
  const calls = { text: [] as string[], thinking: [] as string[], tools: [] as unknown[] };
  return {
    calls,
    onText: (value) => calls.text.push(value),
    onThinking: (value) => calls.thinking.push(value),
    onToolCall: (value) => calls.tools.push(value),
    onUsage: () => undefined,
  };
}
