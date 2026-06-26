import { describe, expect, it } from 'vitest';
import { toClaudeThinking } from '../../src/client/claude.js';

describe('toClaudeThinking', () => {
  it('maps xhigh reasoning effort between high and max budgets', () => {
    expect(toClaudeThinking('high', 20000)).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(toClaudeThinking('xhigh', 20000)).toEqual({ type: 'enabled', budget_tokens: 12000 });
    expect(toClaudeThinking('max', 20000)).toEqual({ type: 'enabled', budget_tokens: 16000 });
  });
});
