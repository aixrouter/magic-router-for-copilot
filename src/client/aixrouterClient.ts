import type {
  AIXRouterModelConfig,
  ChatCompletionRequest,
  StreamHandlers,
} from '../types.js';
import { loadPublicModelEnrichment, mergePublicModelEnrichment } from '../models/pricing.js';
import { enrichModelsWithLiteLLM } from '../models/litellmFallback.js';
import { applyHeuristicFallbacks } from '../models/heuristicFallback.js';
import { fetchJsonWithRetry, fetchWithTimeout } from './http.js';
import { createHttpError, fetchFailedError, emptyResponseError } from './errors.js';
import { getContextWindows, numberFrom } from '../models/modelUtils.js';
import { processSseData, flushToolCalls, processOpenAIFullResponse } from './openai.js';
import {
  processClaudeData,
  processClaudeFullResponse,
  toClaudeMessageRequest,
  summarizeClaudeRequest,
  appendPreview,
  type StreamState,
} from './claude.js';

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
  argumentsFallback?: string;
}

export type { ToolCallAccumulator };

interface RawModel {
  readonly id?: string;
  readonly name?: string;
  readonly owned_by?: string;
  readonly context_length?: number;
  readonly max_context_length?: number;
  readonly max_output_tokens?: number;
  readonly inputPer1M?: number;
  readonly outputPer1M?: number;
  readonly cacheHitPer1M?: number;
  readonly cacheCreationPer1M?: number;
  readonly currencyCode?: string;
  readonly capabilities?: Record<string, unknown>;
  readonly type?: string;
  readonly vendor?: string;
}

type AIXRouterApiKind = 'openai' | 'claude';

export class AIXRouterClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly enrichPublicModelMetadata = true,
    private readonly debug?: (message: string) => void,
  ) {}

  async listModels(signal?: AbortSignal): Promise<AIXRouterModelConfig[]> {
    const json = await fetchJsonWithRetry<{ data?: RawModel[] }>(
      buildEndpointUrl(this.baseUrl, 'openai', 'models'),
      {
        method: 'GET',
        headers: this.headers(),
      },
      signal,
    );

    const models = (json.data ?? [])
      .map(toModelConfig)
      .filter((model): model is AIXRouterModelConfig => Boolean(model?.id));

    const enrichment = this.enrichPublicModelMetadata
      ? await loadPublicModelEnrichment(this.baseUrl, signal).catch(() => new Map())
      : new Map();
    const merged = mergePublicModelEnrichment(models, enrichment);
    // Third-tier fallback: fill remaining gaps from the bundled LiteLLM catalog.
    const enriched = enrichModelsWithLiteLLM(merged);
    // Fourth-tier fallback: name-based heuristics for anything still missing.
    return applyHeuristicFallbacks(enriched);
  }

  async streamChatCompletion(
    request: ChatCompletionRequest,
    routeHint: string | undefined,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const apiKind = getChatApiKind(routeHint ?? request.model);
    if (apiKind === 'claude') {
      await this.streamClaudeMessage(request, handlers, signal);
      return;
    }

    const response = await this.fetchChatCompletion(request, 'openai', signal);

    if (!response.ok) {
      throw await createHttpError('AIXRouter chat completion failed', response);
    }

    if (!response.body) {
      throw new Error('AIXRouter response body is empty.');
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      await processOpenAIFullResponse(response, handlers);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) {
          continue;
        }

        const data = trimmed.slice('data:'.length).trim();
        if (data === '[DONE]') {
          flushToolCalls(toolCalls, handlers);
          return;
        }

        processSseData(data, toolCalls, handlers);
      }
    }

    flushToolCalls(toolCalls, handlers);
  }

  private async fetchChatCompletion(
    request: ChatCompletionRequest,
    apiKind: AIXRouterApiKind,
    signal?: AbortSignal,
  ): Promise<Response> {
    // POST chat/completions is not retried: a timeout after the upstream
    // receives the request could double-charge on retry. Only GET endpoints
    // (model list, metadata) use fetchWithRetry.
    const endpoint = buildEndpointUrl(this.baseUrl, apiKind, 'chat/completions');
    try {
      return await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      }, signal);
    } catch (error) {
      throw fetchFailedError(endpoint, error);
    }
  }

  private async streamClaudeMessage(
    request: ChatCompletionRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const endpoint = buildEndpointUrl(this.baseUrl, 'claude', 'messages');
    const claudeRequest = toClaudeMessageRequest(request, true);
    this.debug?.(`Claude request ${summarizeClaudeRequest(endpoint, claudeRequest)}`);

    const response = await this.fetchClaudeMessageWithRetry(endpoint, claudeRequest, signal);

    this.debug?.(`Claude response stream=true status=${response.status} contentType=${response.headers.get('content-type') ?? 'unknown'}`);

    if (!response.ok) {
      throw await createHttpError('AIXRouter Claude message failed', response);
    }

    if (!response.body) {
      throw new Error('AIXRouter Claude response body is empty.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let buffer = '';
    let preview = '';
    const state: StreamState = { emitted: false };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) {
          continue;
        }

        const data = trimmed.slice('data:'.length).trim();
        if (data === '[DONE]') {
          flushToolCalls(toolCalls, handlers);
          if (!state.emitted) {
            this.debug?.('Claude stream was empty; retrying once with stream=false.');
            await this.completeClaudeMessage(request, handlers, signal);
          }
          return;
        }

        preview = appendPreview(preview, data);
        processClaudeData(data, toolCalls, handlers, state);
      }
    }

    flushToolCalls(toolCalls, handlers);
    if (!state.emitted) {
      this.debug?.('Claude stream ended without content; retrying once with stream=false.');
      await this.completeClaudeMessage(request, handlers, signal);
    }
  }

  private async fetchClaudeMessageWithRetry(
    endpoint: string,
    request: ReturnType<typeof toClaudeMessageRequest>,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.fetchClaudeMessage(endpoint, request, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      this.debug?.(`Claude request failed before HTTP response; retrying once. ${error instanceof Error ? error.message : String(error)}`);
      try {
        return await this.fetchClaudeMessage(endpoint, request, signal);
      } catch (retryError) {
        throw fetchFailedError(endpoint, retryError);
      }
    }
  }

  private async fetchClaudeMessage(
    endpoint: string,
    request: ReturnType<typeof toClaudeMessageRequest>,
    signal?: AbortSignal,
  ): Promise<Response> {
    return fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        ...this.headers(),
        Accept: request.stream ? 'text/event-stream' : 'application/json',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    }, signal);
  }

  private async completeClaudeMessage(
    request: ChatCompletionRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const endpoint = buildEndpointUrl(this.baseUrl, 'claude', 'messages');
    let response: Response;
    try {
      response = await this.fetchClaudeMessage(endpoint, toClaudeMessageRequest(request, false), signal);
    } catch (error) {
      throw fetchFailedError(endpoint, error);
    }

    if (!response.ok) {
      throw await createHttpError('AIXRouter Claude message failed', response);
    }

    await processClaudeFullResponse(response, handlers);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}

function toModelConfig(model: RawModel): AIXRouterModelConfig | undefined {
  if (!model.id) {
    return undefined;
  }

  const capabilities = model.capabilities ?? {};

  // Only extract data the API actually returned — no local defaults.
  // Defaults are applied later by applyHeuristicFallbacks() after
  // LiteLLM enrichment has had a chance to fill in real capabilities.
  const apiContextLength = numberFrom(model.context_length, model.max_context_length);
  const apiMaxOutputTokens = numberFrom(model.max_output_tokens);

  return {
    id: model.id,
    name: model.name || model.id,
    family: isPlaceholderOwner(model.owned_by) ? model.vendor || inferFamily(model.id) : model.owned_by,
    version: 'aixrouter',
    maxInputTokens: apiContextLength,
    maxOutputTokens: apiMaxOutputTokens,
    toolCalling: booleanFrom(capabilities.tool_calling, capabilities.tools, capabilities.function_calling),
    vision: booleanFrom(
      capabilities.vision,
      capabilities.image_input,
      capabilities.imageInput,
      capabilities.multimodal,
      capabilities.multi_modal,
    ),
    thinking: booleanFrom(capabilities.reasoning, capabilities.thinking),
    contextWindows: apiContextLength !== undefined
      ? getContextWindows(normalizeModelText(model), apiContextLength)
      : undefined,
    sourceType: model.type,
    pricing: toApiPricing(model),
  };
}

function toApiPricing(model: RawModel): AIXRouterModelConfig['pricing'] {
  const inputPer1M = numberFrom(model.inputPer1M);
  const outputPer1M = numberFrom(model.outputPer1M);
  const cacheHitPer1M = numberFrom(model.cacheHitPer1M);
  const cacheCreationPer1M = numberFrom(model.cacheCreationPer1M);

  if (
    inputPer1M === undefined &&
    outputPer1M === undefined &&
    cacheHitPer1M === undefined &&
    cacheCreationPer1M === undefined
  ) {
    return undefined;
  }

  return {
    currencyCode: model.currencyCode || 'USD',
    inputPer1M,
    outputPer1M,
    cacheHitPer1M,
    cacheCreationPer1M,
  };
}

function inferFamily(id: string): string {
  const [family] = id.split(/[/:.-]/);
  return family || 'aixrouter';
}

function getChatApiKind(modelText: string): AIXRouterApiKind {
  const normalized = modelText.toLowerCase();
  if (normalized.startsWith('claude-') || normalized.includes('/claude-') || normalized.includes('anthropic')) {
    return 'claude';
  }
  return 'openai';
}

function buildEndpointUrl(baseUrl: string, kind: AIXRouterApiKind, resourcePath: string): string {
  return `${getGatewayRoot(baseUrl)}/${getApiPath(kind)}/${resourcePath}`;
}

function getGatewayRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+((openai|claude)\/v1)$/i, '');
}

function getApiPath(kind: AIXRouterApiKind): string {
  switch (kind) {
    case 'claude':
      return 'claude/v1';
    case 'openai':
      return 'openai/v1';
  }
}

function isPlaceholderOwner(value: string | undefined): boolean {
  return !value || value === 'kredo' || value === 'aixrouter';
}

function normalizeModelText(model: RawModel): string {
  return [
    model.id,
    model.name,
    model.owned_by,
    model.vendor,
    model.type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function booleanFrom(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}
