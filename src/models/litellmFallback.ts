import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AIXRouterModelConfig, ModelMetadataSources } from '../types.js';
import { getContextWindows } from './modelUtils.js';
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

let cachedEntries: LiteLLMModelEntry[] | undefined;
let cacheLoadFailed = false;

/**
 * Loads and caches the bundled LiteLLM metadata. The file is read once per
 * extension session; on failure it is never retried so we don't spam the FS.
 *
 * Tries multiple lookup strategies because `vscode.extensions.getExtension`
 * may transiently return `undefined` (e.g. during early activation or in
 * non-standard hosts), which would silently leave the catalog empty and
 * downgrade every model to the heuristic fallback.
 */
function getEntries(): LiteLLMModelEntry[] {
  if (cachedEntries || cacheLoadFailed) {
    return cachedEntries ?? [];
  }

  const candidates = resolveMetadataPaths();
  for (const filePath of candidates) {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(text) as LiteLLMMetadataFile;
      cachedEntries = data.models ?? [];
      return cachedEntries;
    } catch {
      // Try the next candidate.
    }
  }

  cacheLoadFailed = true;
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
  const entry = findLiteLLMEntry(model.id, model.family, getEntries());
  if (!entry) return model;

  const maxInputTokens = maxNumber(model.maxInputTokens, entry.maxInputTokens);
  const maxOutputTokens = maxNumber(model.maxOutputTokens, entry.maxOutputTokens);
  const vision = model.vision === true || entry.vision === true ? true : model.vision ?? entry.vision;
  const toolCalling = model.toolCalling === true || entry.toolCalling === true ? true : model.toolCalling ?? entry.toolCalling;
  const thinking = model.thinking === true || entry.reasoning === true ? true : model.thinking ?? entry.reasoning;

  const sources: ModelMetadataSources = {
    ...model.metadataSources,
    maxInputTokens: pickSource(model.metadataSources?.maxInputTokens, 'litellm', model.maxInputTokens !== maxInputTokens),
    maxOutputTokens: pickSource(model.metadataSources?.maxOutputTokens, 'litellm', model.maxOutputTokens !== maxOutputTokens),
    toolCalling: pickSource(model.metadataSources?.toolCalling, 'litellm', model.toolCalling !== true && entry.toolCalling === true),
    vision: pickSource(model.metadataSources?.vision, 'litellm', model.vision !== true && entry.vision === true),
    thinking: pickSource(model.metadataSources?.thinking, 'litellm', model.thinking !== true && entry.reasoning === true),
  };

  // Recompute context windows if LiteLLM expanded the known max input.
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
      // If LiteLLM added new window options that weren't there before
      const hadAll = windows.every(w => (model.contextWindows ?? []).includes(w));
      if (!hadAll) {
        contextWindowsSource = pickSource(model.metadataSources?.contextWindows, 'litellm', true);
      }
    } else {
      contextWindows = undefined;
    }
  }

  // Pricing is intentionally NOT filled from LiteLLM — different providers
  // have very different prices, and the AIXRouter public catalog is the
  // authoritative source for platform pricing.

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
  return models.map(enrichWithLiteLLM);
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
  existing: ModelMetadataSources[keyof ModelMetadataSources],
  tier: NonNullable<ModelMetadataSources[keyof ModelMetadataSources]>,
  changed: boolean,
): ModelMetadataSources[keyof ModelMetadataSources] {
  if (changed) return tier;
  return existing;
}
