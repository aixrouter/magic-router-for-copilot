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
  readonly supportsReasoningEffort?: readonly ReasoningEffort[];
  readonly contextWindows?: number[];
  readonly sourceType?: string;
  readonly pricing?: AIXRouterPricing;
  readonly priceCategory?: 'low' | 'medium' | 'high' | 'very_high';
  /** Records which tier provided each capability field. For debugging only. */
  readonly metadataSources?: ModelMetadataSources;
}

/**
 * Tracks where each model capability value came from.
 *
 * Tiers (in priority order):
 *   api           — returned directly by the AIXRouter /openai/v1/models endpoint
 *   publicCatalog — from the AIXRouter public model catalog (pricing/family)
 *   litellm       — from the bundled LiteLLM community metadata
 *   heuristic     — name-based fallback defaults
 */
export interface ModelMetadataSources {
  readonly maxInputTokens?: 'api' | 'publicCatalog' | 'litellm' | 'heuristic';
  readonly maxOutputTokens?: 'api' | 'publicCatalog' | 'litellm' | 'heuristic';
  readonly toolCalling?: 'api' | 'publicCatalog' | 'litellm' | 'heuristic';
  readonly vision?: 'api' | 'publicCatalog' | 'litellm' | 'heuristic';
  readonly thinking?: 'api' | 'publicCatalog' | 'litellm' | 'heuristic';
  readonly contextWindows?: 'api' | 'publicCatalog' | 'litellm' | 'heuristic';
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
  readonly stream: boolean;
  readonly tools?: ChatTool[];
  readonly tool_choice?: 'auto';
  readonly max_tokens?: number;
  readonly context_window?: number;
  readonly temperature?: number;
  readonly reasoning_effort?: ReasoningEffort;
}

export type RequestCompatibilityMode = 'stable' | 'full';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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
