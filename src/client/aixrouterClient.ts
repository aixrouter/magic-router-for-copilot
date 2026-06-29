import type {
  AIXRouterModelConfig,
  ChatCompletionRequest,
  ModelMetadataSources,
  StreamHandlers,
} from '../types.js';
import { loadPublicModelEnrichment, mergePublicModelEnrichment } from '../models/pricing.js';
import { enrichModelsWithLiteLLM } from '../models/litellmFallback.js';
import { enrichModelsWithOpenRouter } from '../models/openrouterFallback.js';
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

interface ChatCompletionOptions {
  readonly signal?: AbortSignal;
  readonly openAIStreamFallback?: boolean;
  readonly diagnostics?: readonly string[];
}

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
    // Third tier: enrich from the cached OpenRouter snapshot (refreshed every
    // few hours so newly released models pick up correct token limits and
    // capability flags without waiting for an extension update).
    const withOpenRouter = enrichModelsWithOpenRouter(merged);
    // Fourth tier: fill remaining gaps from the LiteLLM catalog. Prefers the
    // runtime-refreshed mirror, falling back to the bundled snapshot.
    const enriched = enrichModelsWithLiteLLM(withOpenRouter);
    // Fifth tier: name-based heuristics for anything still missing.
    return applyHeuristicFallbacks(enriched);
  }

  async streamChatCompletion(
    request: ChatCompletionRequest,
    routeHint: string | undefined,
    handlers: StreamHandlers,
    options: ChatCompletionOptions | AbortSignal = {},
  ): Promise<void> {
    const requestOptions = normalizeChatCompletionOptions(options);
    const signal = requestOptions.signal;
    const apiKind = getChatApiKind(routeHint ?? request.model);
    if (apiKind === 'claude') {
      await this.streamClaudeMessage(request, handlers, signal);
      return;
    }

    await this.streamOpenAIChatCompletion(request, handlers, requestOptions);
  }

  private async streamOpenAIChatCompletion(
    request: ChatCompletionRequest,
    handlers: StreamHandlers,
    options: ChatCompletionOptions,
  ): Promise<void> {
    let emptyRetryUsed = false;
    let currentRequest = request;

    while (true) {
      try {
        const response = await this.fetchChatCompletion(currentRequest, 'openai', options.signal, options.diagnostics);
        await this.processOpenAIChatResponse(response, currentRequest, handlers, options);
        return;
      } catch (error) {
        if (!emptyRetryUsed && isOpenAIEmptyResponseError(error) && !options.signal?.aborted) {
          emptyRetryUsed = true;
          this.debug?.(`OpenAI fallback reason=emptyResponse model=${request.model} messages=${request.messages.length} tools=${request.tools?.length ?? 0} stream=${currentRequest.stream}`);
          currentRequest = { ...request, stream: currentRequest.stream };
          continue;
        }

        throw error;
      }
    }
  }

  private async processOpenAIChatResponse(
    response: Response,
    request: ChatCompletionRequest,
    handlers: StreamHandlers,
    options: ChatCompletionOptions,
  ): Promise<void> {
    if (!response.ok) {
      if (
        request.stream &&
        options.openAIStreamFallback !== false &&
        !options.signal?.aborted &&
        await shouldFallbackOpenAIStream(response)
      ) {
        this.debug?.(`OpenAI fallback reason=streamUnsupported model=${request.model} messages=${request.messages.length} tools=${request.tools?.length ?? 0}`);
        await this.completeOpenAIChatCompletion({ ...request, stream: false }, handlers, options);
        return;
      }

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

    const emitted = await this.processOpenAIStreamResponse(response, handlers);
    if (!emitted) {
      throw emptyResponseError('OpenAI stream', '');
    }
  }

  private async completeOpenAIChatCompletion(
    request: ChatCompletionRequest,
    handlers: StreamHandlers,
    options: ChatCompletionOptions,
  ): Promise<void> {
    const response = await this.fetchChatCompletion(request, 'openai', options.signal, options.diagnostics);
    if (!response.ok) {
      throw await createHttpError('AIXRouter chat completion failed', response);
    }
    await processOpenAIFullResponse(response, handlers);
  }

  private async processOpenAIStreamResponse(
    response: Response,
    handlers: StreamHandlers,
  ): Promise<boolean> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('AIXRouter response body is empty.');
    }

    const decoder = new TextDecoder();
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let buffer = '';
    let emitted = false;

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
          emitted = flushToolCalls(toolCalls, handlers) || emitted;
          return emitted;
        }

        emitted = processSseData(data, toolCalls, handlers) || emitted;
      }
    }

    emitted = flushToolCalls(toolCalls, handlers) || emitted;
    return emitted;
  }

  private async fetchChatCompletion(
    request: ChatCompletionRequest,
    apiKind: AIXRouterApiKind,
    signal?: AbortSignal,
    diagnostics: readonly string[] = [],
  ): Promise<Response> {
    // Network-level POST failures are not retried: a timeout after the upstream
    // receives the request could double-charge. Higher-level compatibility
    // fallbacks are handled only after an HTTP response is received.
    const endpoint = buildEndpointUrl(this.baseUrl, apiKind, 'chat/completions');
    const body = JSON.stringify(request);
    const bodyBytes = byteLength(body);
    const diagnosticSuffix = diagnostics.length ? ` ${diagnostics.join(' ')}` : '';
    this.debug?.(`OpenAI request body bytes=${bodyBytes} stream=${request.stream} tools=${request.tools?.length ?? 0}${diagnosticSuffix}`);
    try {
      return await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/json',
        },
        body,
      }, signal);
    } catch (error) {
      throw fetchFailedError(endpoint, error, `Request body bytes=${bodyBytes}. stream=${request.stream} tools=${request.tools?.length ?? 0}${diagnosticSuffix}.`);
    }
  }

  private async streamClaudeMessage(
    request: ChatCompletionRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const endpoint = buildEndpointUrl(this.baseUrl, 'claude', 'messages');
    const claudeRequest = toClaudeMessageRequest(request, true, this.debug);
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
        const bodyBytes = byteLength(JSON.stringify(request));
        throw fetchFailedError(endpoint, retryError, `Request body bytes=${bodyBytes}.`);
      }
    }
  }

  private async fetchClaudeMessage(
    endpoint: string,
    request: ReturnType<typeof toClaudeMessageRequest>,
    signal?: AbortSignal,
  ): Promise<Response> {
    const body = JSON.stringify(request);
    this.debug?.(`Claude request body bytes=${byteLength(body)}`);
    return fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        ...this.headers(),
        Accept: request.stream ? 'text/event-stream' : 'application/json',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body,
    }, signal);
  }

  private async completeClaudeMessage(
    request: ChatCompletionRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const endpoint = buildEndpointUrl(this.baseUrl, 'claude', 'messages');
    const claudeRequest = toClaudeMessageRequest(request, false, this.debug);
    let response: Response;
    try {
      response = await this.fetchClaudeMessage(endpoint, claudeRequest, signal);
    } catch (error) {
      const bodyBytes = byteLength(JSON.stringify(claudeRequest));
      throw fetchFailedError(endpoint, error, `Request body bytes=${bodyBytes}.`);
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
    metadataSources: {
      maxInputTokens: apiContextLength !== undefined ? 'api' : undefined,
      maxOutputTokens: apiMaxOutputTokens !== undefined ? 'api' : undefined,
      toolCalling: hasCap(capabilities.tool_calling, capabilities.tools, capabilities.function_calling) ? 'api' : undefined,
      vision: hasCap(capabilities.vision, capabilities.image_input, capabilities.imageInput, capabilities.multimodal, capabilities.multi_modal) ? 'api' : undefined,
      thinking: hasCap(capabilities.reasoning, capabilities.thinking) ? 'api' : undefined,
      contextWindows: apiContextLength !== undefined ? 'api' : undefined,
    },
  };
}

function normalizeChatCompletionOptions(options: ChatCompletionOptions | AbortSignal): ChatCompletionOptions {
  if (isAbortSignal(options)) {
    return { signal: options };
  }
  return options;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return Boolean(value && typeof value === 'object' && 'aborted' in value && 'addEventListener' in value);
}

function isOpenAIEmptyResponseError(error: unknown): boolean {
  return error instanceof Error &&
    /^AIXRouter OpenAI (?:response|stream) did not contain any assistant text or tool call\./.test(error.message);
}

async function shouldFallbackOpenAIStream(response: Response): Promise<boolean> {
  if (![400, 404, 415, 422, 501].includes(response.status)) {
    return false;
  }

  const body = await response.clone().text().catch(() => '');
  const detail = `${response.statusText} ${body}`.toLowerCase();
  return /\b(stream|streaming|sse|event-stream)\b/.test(detail) &&
    /\b(unsupported|not supported|not_support|invalid|disable|disabled|not allowed|unrecognized|unknown)\b/.test(detail);
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

/** Like booleanFrom but only checks for presence, doesn't return false. */
function hasCap(...values: unknown[]): boolean {
  for (const value of values) {
    if (typeof value === 'boolean' && value) return true;
  }
  return false;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
