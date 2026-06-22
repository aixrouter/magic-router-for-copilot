export interface AIXRouterModelConfig {
  readonly id: string;
  readonly name?: string;
  readonly family?: string;
  readonly version?: string;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly toolCalling?: boolean;
  readonly vision?: boolean;
  readonly thinking?: boolean;
  readonly contextWindows?: number[];
  readonly sourceType?: string;
  readonly pricing?: AIXRouterPricing;
  readonly priceCategory?: 'low' | 'medium' | 'high' | 'very_high';
}

export interface AIXRouterPricing {
  readonly currencyCode?: string;
  readonly inputPer1M?: number;
  readonly outputPer1M?: number;
  readonly cacheHitPer1M?: number;
  readonly cacheCreationPer1M?: number;
}

export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: ChatMessage[];
  readonly stream: true;
  readonly tools?: ChatTool[];
  readonly tool_choice?: 'auto';
  readonly max_tokens?: number;
  readonly temperature?: number;
  readonly reasoning_effort?: 'low' | 'medium' | 'high' | 'max';
}

export type ChatMessage =
  | {
      role: 'user' | 'assistant' | 'system';
      content: string | OpenAIContentPart[];
      tool_calls?: ChatToolCall[];
    }
  | {
      role: 'tool';
      content: string;
      tool_call_id: string;
    };

export type OpenAIContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image_url';
      image_url: {
        url: string;
      };
    };

export interface ChatTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface StreamHandlers {
  readonly onText: (text: string) => void;
  readonly onThinking: (text: string) => void;
  readonly onToolCall: (toolCall: ChatToolCall) => void;
  readonly onUsage: (usage: TokenUsage) => void;
}

export interface TokenUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
}
