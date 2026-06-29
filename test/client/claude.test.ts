import { describe, expect, it } from 'vitest';
import { toClaudeMessageRequest, toClaudeThinking } from '../../src/client/claude.js';
import { applyRequestCompatibility } from '../../src/provider/requestCompatibility.js';

describe('toClaudeThinking', () => {
  it('maps xhigh reasoning effort between high and max budgets', () => {
    expect(toClaudeThinking('high', 20000)).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(toClaudeThinking('xhigh', 20000)).toEqual({ type: 'enabled', budget_tokens: 12000 });
    expect(toClaudeThinking('max', 20000)).toEqual({ type: 'enabled', budget_tokens: 16000 });
  });
});

describe('toClaudeMessageRequest', () => {
  const request = {
      model: 'claude-sonnet-4.5',
      messages: [
        { role: 'system', content: 'be concise' },
        { role: 'user', content: 'hello' },
      ],
      stream: true,
      tools: [{
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Lookup a value',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        },
      }],
      tool_choice: 'auto',
      max_tokens: 12000,
      temperature: 0.7,
      context_window: 200000,
      reasoning_effort: 'high',
    } as const;

  it('maps stable chat completion fields to the Claude Messages API shape', () => {
    const result = toClaudeMessageRequest(applyRequestCompatibility(request, 'stable').request, true);

    expect(result).toEqual({
      model: 'claude-sonnet-4.5',
      system: [{ type: 'text', text: 'be concise', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      stream: true,
      tools: [{
        name: 'lookup',
        description: 'Lookup a value',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
        cache_control: { type: 'ephemeral' },
      }],
      tool_choice: { type: 'auto' },
      max_tokens: 12000,
      temperature: 0.7,
    });
    expect(result).not.toHaveProperty('context_window');
    expect(result).not.toHaveProperty('reasoning_effort');
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('thinking');
  });

  it('keeps Claude thinking in full compatibility mode', () => {
    const result = toClaudeMessageRequest(applyRequestCompatibility(request, 'full').request, true);

    expect(result.temperature).toBeUndefined();
    expect(result.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
  });

  it('keeps tool results that match the preceding assistant tool use', () => {
    const result = toClaudeMessageRequest({
      model: 'claude-sonnet-4.5',
      messages: [
        { role: 'user', content: 'look this up' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"query":"aix"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'found it' },
      ],
      stream: true,
    }, true);

    expect(result.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'look this up' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'lookup', input: { query: 'aix' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'found it' }] },
    ]);
  });

  it('omits stale tool results that are no longer paired with a tool use', () => {
    const result = toClaudeMessageRequest({
      model: 'claude-sonnet-4.5',
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'old_call',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          }],
        },
        { role: 'user', content: '你好' },
        { role: 'tool', tool_call_id: 'old_call', content: 'old file contents' },
      ],
      stream: true,
    }, true);

    expect(result.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '你好' }] },
    ]);
  });

  it('marks only the last Claude tool with cache_control', () => {
    const result = toClaudeMessageRequest({
      model: 'claude-sonnet-4.5',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      tools: [
        { type: 'function', function: { name: 'a', parameters: {} } },
        { type: 'function', function: { name: 'b', parameters: {} } },
        { type: 'function', function: { name: 'c', parameters: {} } },
      ],
      tool_choice: 'auto',
    }, true);

    expect(result.tools).toEqual([
      { name: 'a', description: undefined, input_schema: {} },
      { name: 'b', description: undefined, input_schema: {} },
      { name: 'c', description: undefined, input_schema: {}, cache_control: { type: 'ephemeral' } },
    ]);
  });
});
