import { describe, expect, it } from 'vitest';
import { applyHeuristicFallbacks } from '../../src/models/heuristicFallback.js';

describe('applyHeuristicFallbacks contextWindows', () => {
  it('exposes 200K/400K/1M for Claude families when upstream provides no context info', () => {
    const [model] = applyHeuristicFallbacks([
      {
        id: 'claude-sonnet-4.6',
        name: 'claude-sonnet-4.6',
        family: 'anthropic',
        version: 'aixrouter',
      },
    ]);

    expect(model.contextWindows).toEqual([200000, 400000, 1000000]);
    expect(model.maxInputTokens).toBe(1000000);
  });

  it('exposes 200K/400K/1M for Gemini families when upstream provides no context info', () => {
    const [model] = applyHeuristicFallbacks([
      {
        id: 'gemini-3-pro',
        name: 'gemini-3-pro',
        family: 'google',
        version: 'aixrouter',
      },
    ]);

    expect(model.contextWindows).toEqual([200000, 400000, 1000000]);
  });

  it('keeps upstream contextWindows when already provided', () => {
    const [model] = applyHeuristicFallbacks([
      {
        id: 'claude-sonnet-4.6',
        name: 'claude-sonnet-4.6',
        family: 'anthropic',
        version: 'aixrouter',
        maxInputTokens: 200000,
        contextWindows: [200000],
        metadataSources: { maxInputTokens: 'api', contextWindows: 'api' },
      },
    ]);

    expect(model.contextWindows).toEqual([200000]);
  });

  it('caps non-frontier families to 200K only', () => {
    const [model] = applyHeuristicFallbacks([
      {
        id: 'mistral-large-2',
        name: 'mistral-large-2',
        family: 'mistral',
        version: 'aixrouter',
      },
    ]);

    expect(model.contextWindows).toEqual([200000]);
  });
});
