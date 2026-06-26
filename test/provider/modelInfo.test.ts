import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  ThemeIcon: class ThemeIcon {
    constructor(public readonly id: string) {}
  },
}));

vi.mock('../../src/config.js', () => ({
  getReasoningEffort: () => 'high',
}));

const { toChatInfo } = await import('../../src/provider/modelInfo.js');

describe('toChatInfo configuration schema', () => {
  it('keeps thinking effort and context window as separate option groups', () => {
    const info = toChatInfo({
      id: 'deepseek-v4-pro',
      maxInputTokens: 1000000,
      maxOutputTokens: 8192,
      thinking: true,
      contextWindows: [200000, 400000, 1000000],
    }, true, true) as {
      configurationSchema?: {
        properties?: Record<string, Record<string, unknown>>;
      };
    };

    const properties = info.configurationSchema?.properties ?? {};

    expect(Object.keys(properties)).toEqual(['reasoningEffort', 'contextWindow']);
    expect(properties.reasoningEffort?.title).toBe('思考工作量');
    expect(properties.reasoningEffort?.group).toBe('navigation');
    expect(properties.reasoningEffort?.enum).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(properties.reasoningEffort?.enumItemLabels).toEqual(['Low', 'Medium', 'High', 'Extra High', 'Max']);
    expect(properties.contextWindow?.title).toBe('上下文大小');
    expect(properties.contextWindow?.group).toBeUndefined();
    expect(properties.contextWindow?.enumItemLabels).toEqual(['Default', '200K', '400K', '1M']);
  });

  it('limits thinking effort options when the model declares supported values', () => {
    const info = toChatInfo({
      id: 'limited-thinking-model',
      thinking: true,
      supportsReasoningEffort: ['high', 'xhigh'],
    }, true, true) as {
      configurationSchema?: {
        properties?: Record<string, Record<string, unknown>>;
      };
    };

    const reasoningEffort = info.configurationSchema?.properties?.reasoningEffort;

    expect(reasoningEffort?.enum).toEqual(['high', 'xhigh']);
    expect(reasoningEffort?.enumItemLabels).toEqual(['High', 'Extra High']);
    expect(reasoningEffort?.default).toBe('high');
  });
});
