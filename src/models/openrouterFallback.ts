import type { AIXRouterModelConfig } from '../types.js';
import { getCachedData, scheduleRefresh } from './metadataCache.js';
import { enrichModelFromEntries } from './litellmFallback.js';
import type { LiteLLMModelEntry } from './litellmMatch.js';

/**
 * Runtime fallback layer that pulls capability metadata from the public
 * OpenRouter `/api/v1/models` API. The response is normalized into the same
 * {@link LiteLLMModelEntry} shape so it can flow through the existing matcher
 * and enrichment pipeline.
 *
 * OpenRouter typically lists new models within hours of public release, so it
 * gives us a much faster freshness window than the LiteLLM mirror (which
 * commonly lags by days).
 */

export const OPENROUTER_CACHE_KEY = 'aixrouter.metadata.openrouter.v1';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/models';

interface OpenRouterModel {
  readonly id?: string;
  readonly name?: string;
  readonly context_length?: number;
  readonly architecture?: {
    readonly input_modalities?: readonly string[];
    readonly output_modalities?: readonly string[];
  };
  readonly supported_parameters?: readonly string[];
  readonly top_provider?: {
    readonly context_length?: number;
    readonly max_completion_tokens?: number;
  };
}

interface OpenRouterResponse {
  readonly data?: readonly OpenRouterModel[];
}

/**
 * Schedules a fire-and-forget background refresh of the OpenRouter catalog.
 *
 * Safe to call on every `listModels()`; the cache layer enforces TTL and
 * coalesces concurrent calls. Pass `force = true` to bypass TTL/ETag for a
 * user-initiated full refresh; returns the inflight Promise when a fetch is
 * actually performed.
 */
export function scheduleOpenRouterRefresh(ttlMs: number, force = false): Promise<void> | undefined {
  return scheduleRefresh<LiteLLMModelEntry[]>(
    {
      key: OPENROUTER_CACHE_KEY,
      url: OPENROUTER_API_URL,
      ttlMs,
      label: 'openrouter',
      parse: (body) => parseOpenRouterResponse(JSON.parse(body) as OpenRouterResponse),
    },
    { force },
  );
}

/**
 * Normalizes the OpenRouter API response into our compact entry shape.
 *
 * Each OpenRouter model id looks like `vendor/model-name`; we strip the
 * vendor prefix because AIXRouter's own model ids are already vendor-agnostic
 * (e.g. `claude-sonnet-4.6`). We also keep the original full id as a second
 * entry so id-based exact matches still work for ambiguous names.
 */
export function parseOpenRouterResponse(payload: OpenRouterResponse): LiteLLMModelEntry[] {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  const entries: LiteLLMModelEntry[] = [];
  const seen = new Set<string>();

  for (const m of models) {
    if (!m?.id || typeof m.id !== 'string') continue;
    const baseEntry = toEntry(m, stripVendor(m.id));
    if (baseEntry && !seen.has(baseEntry.id)) {
      seen.add(baseEntry.id);
      entries.push(baseEntry);
    }
    // Also expose the prefixed form (`openrouter/anthropic/claude-sonnet-4.6`)
    // so the existing LiteLLM matcher's prefix-trimming logic still works.
    const prefixed = toEntry(m, `openrouter/${m.id}`);
    if (prefixed && !seen.has(prefixed.id)) {
      seen.add(prefixed.id);
      entries.push(prefixed);
    }
  }

  return entries;
}

function stripVendor(fullId: string): string {
  const slash = fullId.lastIndexOf('/');
  return slash >= 0 ? fullId.slice(slash + 1) : fullId;
}

function toEntry(model: OpenRouterModel, id: string): LiteLLMModelEntry | undefined {
  if (!id) return undefined;
  const params = new Set(model.supported_parameters ?? []);
  const inputModalities = new Set(model.architecture?.input_modalities ?? []);
  const maxInputTokens =
    model.top_provider?.context_length ?? model.context_length ?? undefined;
  const maxOutputTokens = model.top_provider?.max_completion_tokens ?? undefined;
  return {
    id,
    maxInputTokens,
    maxOutputTokens,
    vision: inputModalities.has('image') ? true : undefined,
    toolCalling: params.has('tools') || params.has('tool_choice') ? true : undefined,
    reasoning:
      params.has('reasoning') || params.has('reasoning_effort') || params.has('include_reasoning')
        ? true
        : undefined,
  };
}

/**
 * Batch-enriches a model list with cached OpenRouter data.
 *
 * Returns the original list untouched if the cache has never been populated.
 */
export function enrichModelsWithOpenRouter(models: AIXRouterModelConfig[]): AIXRouterModelConfig[] {
  const entries = getCachedData<LiteLLMModelEntry[]>(OPENROUTER_CACHE_KEY);
  if (!entries || entries.length === 0) return models;
  return models.map((model) => enrichModelFromEntries(model, entries, 'openrouter'));
}
