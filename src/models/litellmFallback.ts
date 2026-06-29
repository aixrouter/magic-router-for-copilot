import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AIXRouterModelConfig, ModelMetadataSource, ModelMetadataSources } from '../types.js';
import { getContextWindows } from './modelUtils.js';
import { getCachedData, scheduleRefresh } from './metadataCache.js';
import {
  type LiteLLMModelEntry,
  parseLiteLLMId,
  comparableBase,
  isBoundarySubmatch,
  mergeLiteLLMEntries,
  findLiteLLMEntry,
} from './litellmMatch.js';

// Re-export the pure functions so scripts can import from a single module.
export {
  type LiteLLMModelEntry,
  parseLiteLLMId,
  comparableBase,
  isBoundarySubmatch,
  mergeLiteLLMEntries,
  findLiteLLMEntry,
  getModelAliases,
  resolveAlias,
} from './litellmMatch.js';

interface LiteLLMMetadataFile {
  readonly source: string;
  readonly sourceUrl: string;
  readonly syncedAt: string;
  readonly modelCount: number;
  readonly models: LiteLLMModelEntry[];
}

/** globalState key for the runtime LiteLLM mirror cache. */
export const LITELLM_REMOTE_CACHE_KEY = 'aixrouter.metadata.litellm.v1';

/** Default URL we mirror at runtime (our own synced compact snapshot). */
export const LITELLM_REMOTE_URL =
  'https://raw.githubusercontent.com/huangonce/aixrouter-for-copilot/main/resources/model-metadata.json';

let cachedBundledEntries: LiteLLMModelEntry[] | undefined;
let bundledCacheLoadFailed = false;

/**
 * Schedules a fire-and-forget runtime refresh of our hosted LiteLLM mirror.
 *
 * Safe to call on every `listModels()`; the cache layer enforces TTL and
 * coalesces concurrent calls. Pass `force = true` to bypass TTL/ETag for a
 * user-initiated full refresh; returns the inflight Promise when a fetch is
 * actually performed.
 */
export function scheduleLiteLLMRefresh(ttlMs: number, force = false): Promise<void> | undefined {
  return scheduleRefresh<LiteLLMModelEntry[]>(
    {
      key: LITELLM_REMOTE_CACHE_KEY,
      url: LITELLM_REMOTE_URL,
      ttlMs,
      label: 'litellm-remote',
      parse: (body) => {
        const data = JSON.parse(body) as LiteLLMMetadataFile;
        return Array.isArray(data?.models) ? data.models : [];
      },
    },
    { force },
  );
}

/**
 * Returns the best LiteLLM catalog currently available.
 *
 * Preference order: runtime cache (freshest) → bundled snapshot (offline-safe).
 * Both layers are union-merged so a partial remote refresh never reduces
 * coverage below the bundled fallback.
 */
function getEntries(): { entries: LiteLLMModelEntry[]; remoteSource: boolean } {
  const remote = getCachedData<LiteLLMModelEntry[]>(LITELLM_REMOTE_CACHE_KEY) ?? [];
  const bundled = getBundledEntries();
  if (remote.length === 0) {
    return { entries: bundled, remoteSource: false };
  }
  if (bundled.length === 0) {
    return { entries: remote, remoteSource: true };
  }
  // Remote first so duplicates (matched by id) prefer the fresher record.
  const seen = new Set<string>();
  const merged: LiteLLMModelEntry[] = [];
  for (const entry of remote) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  for (const entry of bundled) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return { entries: merged, remoteSource: true };
}

/**
 * Loads and caches the bundled LiteLLM metadata. The file is read once per
 * extension session; on failure it is never retried so we don't spam the FS.
 *
 * Tries multiple lookup strategies because `vscode.extensions.getExtension`
 * may transiently return `undefined` (e.g. during early activation or in
 * non-standard hosts), which would silently leave the catalog empty and
 * downgrade every model to the heuristic fallback.
 */
function getBundledEntries(): LiteLLMModelEntry[] {
  if (cachedBundledEntries || bundledCacheLoadFailed) {
    return cachedBundledEntries ?? [];
  }

  const candidates = resolveMetadataPaths();
  for (const filePath of candidates) {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(text) as LiteLLMMetadataFile;
      cachedBundledEntries = data.models ?? [];
      return cachedBundledEntries;
    } catch {
      // Try the next candidate.
    }
  }

  bundledCacheLoadFailed = true;
  return [];
}

/**
 * Builds the ordered list of locations where the bundled LiteLLM catalog may
 * live. The first hit wins.
 */
function resolveMetadataPaths(): string[] {
  const paths: string[] = [];

  try {
    const extension = vscode.extensions.getExtension('aixrouter.aixrouter-for-copilot');
    if (extension) {
      paths.push(path.join(extension.extensionPath, 'resources', 'model-metadata.json'));
    }
  } catch {
    // `vscode.extensions` may not be available in all hosts.
  }

  // Fallback: resolve relative to this compiled file (out/models/...).
  // Output is CommonJS, so `__dirname` is available.
  try {
    if (typeof __dirname === 'string') {
      paths.push(path.join(__dirname, '..', '..', 'resources', 'model-metadata.json'));
    }
  } catch {
    // `__dirname` may not exist under exotic loaders.
  }

  return paths;
}

/**
 * Enriches a model config with LiteLLM fallback data for any missing fields.
 *
 * Fills gaps and expands token/context limits when the bundled LiteLLM catalog
 * knows a larger model capability. It never lowers platform-provided values.
 */
export function enrichWithLiteLLM(model: AIXRouterModelConfig): AIXRouterModelConfig {
  const { entries, remoteSource } = getEntries();
  return enrichModelFromEntries(model, entries, remoteSource ? 'litellmRemote' : 'litellm');
}

/**
 * Generic enrichment helper used by both LiteLLM and OpenRouter fallbacks.
 *
 * Both sources export the same {@link LiteLLMModelEntry} shape, so the merge
 * logic is identical aside from the {@link ModelMetadataSource} tag we record
 * for diagnostics.
 */
export function enrichModelFromEntries(
  model: AIXRouterModelConfig,
  entries: LiteLLMModelEntry[],
  tier: ModelMetadataSource,
): AIXRouterModelConfig {
  if (entries.length === 0) return model;
  const entry = findLiteLLMEntry(model.id, model.family, entries);
  if (!entry) return model;

  const maxInputTokens = maxNumber(model.maxInputTokens, entry.maxInputTokens);
  const maxOutputTokens = maxNumber(model.maxOutputTokens, entry.maxOutputTokens);
  const vision = model.vision === true || entry.vision === true ? true : model.vision ?? entry.vision;
  const toolCalling = model.toolCalling === true || entry.toolCalling === true ? true : model.toolCalling ?? entry.toolCalling;
  const thinking = model.thinking === true || entry.reasoning === true ? true : model.thinking ?? entry.reasoning;

  const sources: ModelMetadataSources = {
    ...model.metadataSources,
    maxInputTokens: pickSource(model.metadataSources?.maxInputTokens, tier, model.maxInputTokens !== maxInputTokens),
    maxOutputTokens: pickSource(model.metadataSources?.maxOutputTokens, tier, model.maxOutputTokens !== maxOutputTokens),
    toolCalling: pickSource(model.metadataSources?.toolCalling, tier, model.toolCalling !== true && entry.toolCalling === true),
    vision: pickSource(model.metadataSources?.vision, tier, model.vision !== true && entry.vision === true),
    thinking: pickSource(model.metadataSources?.thinking, tier, model.thinking !== true && entry.reasoning === true),
  };

  // Recompute context windows if the source expanded the known max input.
  let contextWindows = model.contextWindows;
  let contextWindowsSource = model.metadataSources?.contextWindows;
  if (maxInputTokens !== undefined) {
    const modelText = [model.id, model.name, model.family].filter(Boolean).join(' ').toLowerCase();
    const windows = getContextWindows(modelText, maxInputTokens);
    const mergedWindows = [...new Set([...(contextWindows ?? []), ...windows])]
      .filter((value) => value <= maxInputTokens)
      .sort((a, b) => a - b);
    if (mergedWindows.length > 0) {
      contextWindows = mergedWindows as number[];
      const hadAll = windows.every((w) => (model.contextWindows ?? []).includes(w));
      if (!hadAll) {
        contextWindowsSource = pickSource(model.metadataSources?.contextWindows, tier, true);
      }
    } else {
      contextWindows = undefined;
    }
  }

  // Pricing is intentionally NOT filled from external sources — different
  // providers price the same model very differently, and the AIXRouter
  // public catalog is the authoritative source for platform pricing.

  return {
    ...model,
    maxInputTokens,
    maxOutputTokens,
    vision,
    toolCalling,
    thinking,
    contextWindows,
    metadataSources: {
      ...sources,
      contextWindows: contextWindowsSource,
    },
  };
}

/**
 * Batch-enriches a model list. See {@link enrichWithLiteLLM}.
 */
export function enrichModelsWithLiteLLM(models: AIXRouterModelConfig[]): AIXRouterModelConfig[] {
  const { entries, remoteSource } = getEntries();
  if (entries.length === 0) return models;
  const tier: ModelMetadataSource = remoteSource ? 'litellmRemote' : 'litellm';
  return models.map((model) => enrichModelFromEntries(model, entries, tier));
}

function maxNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/**
 * Returns the new source tier if a field changed, otherwise keeps the existing one.
 */
function pickSource(
  existing: ModelMetadataSource | undefined,
  tier: ModelMetadataSource,
  changed: boolean,
): ModelMetadataSource | undefined {
  if (changed) return tier;
  return existing;
}
