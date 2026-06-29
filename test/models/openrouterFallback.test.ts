import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose: () => {} });
    fire = () => {};
    dispose = () => {};
  },
  extensions: { getExtension: () => undefined },
}));

const { parseOpenRouterResponse } = await import('../../src/models/openrouterFallback.js');

describe('parseOpenRouterResponse', () => {
  it('returns empty array for missing/invalid data', () => {
    expect(parseOpenRouterResponse({})).toEqual([]);
    expect(parseOpenRouterResponse({ data: undefined })).toEqual([]);
    expect(parseOpenRouterResponse({ data: [] })).toEqual([]);
  });

  it('strips vendor prefix and keeps prefixed form as fallback', () => {
    const entries = parseOpenRouterResponse({
      data: [
        {
          id: 'anthropic/claude-sonnet-4.6',
          context_length: 1_000_000,
          architecture: { input_modalities: ['text', 'image'] },
          supported_parameters: ['tools', 'reasoning'],
          top_provider: { context_length: 1_000_000, max_completion_tokens: 64_000 },
        },
      ],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: 'claude-sonnet-4.6',
      maxInputTokens: 1_000_000,
      maxOutputTokens: 64_000,
      vision: true,
      toolCalling: true,
      reasoning: true,
    });
    expect(entries[1].id).toBe('openrouter/anthropic/claude-sonnet-4.6');
  });

  it('infers tool_choice as toolCalling support', () => {
    const entries = parseOpenRouterResponse({
      data: [
        {
          id: 'openai/gpt-5.5',
          context_length: 400_000,
          supported_parameters: ['tool_choice'],
        },
      ],
    });
    expect(entries[0].toolCalling).toBe(true);
  });

  it('marks reasoning_effort and include_reasoning models as reasoning', () => {
    const entries = parseOpenRouterResponse({
      data: [
        { id: 'a/m1', supported_parameters: ['reasoning_effort'] },
        { id: 'b/m2', supported_parameters: ['include_reasoning'] },
        { id: 'c/m3', supported_parameters: ['temperature'] },
      ],
    });
    expect(entries.filter((e) => e.id === 'm1')[0].reasoning).toBe(true);
    expect(entries.filter((e) => e.id === 'm2')[0].reasoning).toBe(true);
    expect(entries.filter((e) => e.id === 'm3')[0].reasoning).toBeUndefined();
  });

  it('skips models without a usable id', () => {
    const entries = parseOpenRouterResponse({
      data: [{ id: '' }, { id: undefined as unknown as string }, { id: 'good/one' }],
    });
    expect(entries.map((e) => e.id)).toEqual(['one', 'openrouter/good/one']);
  });

  it('deduplicates ids — last occurrence wins', () => {
    const entries = parseOpenRouterResponse({
      data: [
        { id: 'a/dup', context_length: 100 },
        { id: 'b/dup', context_length: 200 },
      ],
    });
    // Both bases are "dup", so only the first occurrence is kept.
    const dups = entries.filter((e) => e.id === 'dup');
    expect(dups).toHaveLength(1);
    expect(dups[0].maxInputTokens).toBe(100);
  });

  it('prefers top_provider context_length over root context_length', () => {
    const entries = parseOpenRouterResponse({
      data: [
        {
          id: 'foo/bar',
          context_length: 200_000,
          top_provider: { context_length: 1_000_000 },
        },
      ],
    });
    expect(entries[0].maxInputTokens).toBe(1_000_000);
  });
});
