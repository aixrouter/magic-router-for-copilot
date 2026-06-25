import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AIXRouterModelConfig } from '../types.js';
import { getContextWindows } from './modelUtils.js';

/**
 * Compact model metadata entry from the LiteLLM community catalog.
 * Only fields useful as a fallback are kept.  Pricing is deliberately
 * excluded — it comes from the AIXRouter platform catalog instead.
 */
interface LiteLLMModelEntry {
  readonly id: string;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly vision?: boolean;
  readonly toolCalling?: boolean;
  readonly reasoning?: boolean;
}

interface LiteLLMMetadataFile {
  readonly source: string;
  readonly sourceUrl: string;
  readonly syncedAt: string;
  readonly modelCount: number;
  readonly models: LiteLLMModelEntry[];
}

interface ParsedId {
  readonly base: string;
  readonly segments: string[];
}

let cachedEntries: LiteLLMModelEntry[] | undefined;
let cacheLoadFailed = false;

/**
 * Loads and caches the bundled LiteLLM metadata. The file is read once per
 * extension session; on failure it is never retried so we don't spam the FS.
 */
function getEntries(): LiteLLMModelEntry[] {
  if (cachedEntries || cacheLoadFailed) {
    return cachedEntries ?? [];
  }

  try {
    const extension = vscode.extensions.getExtension('aixrouter.aixrouter-for-copilot');
    if (!extension) {
      cacheLoadFailed = true;
      return [];
    }
    const filePath = path.join(extension.extensionPath, 'resources', 'model-metadata.json');
    const text = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(text) as LiteLLMMetadataFile;
    cachedEntries = data.models ?? [];
  } catch {
    cacheLoadFailed = true;
    return [];
  }

  return cachedEntries;
}

/**
 * Parses a LiteLLM model id like "fireworks_ai/deepseek-v4-pro" or
 * "azure_ai/deepseek-v3-0324" into a comparable form.
 */
function parseLiteLLMId(id: string): ParsedId {
  const segments = id.toLowerCase().split('/');
  const base = segments[segments.length - 1];
  return { base, segments };
}

/**
 * Checks if two model base names match under substring containment,
 * but only when the extra characters are a numeric or date/build suffix
 * (e.g. "gpt-5-0125" extending "gpt-5", "gemini-3-flash-preview" extending
 * "gemini-3-flash").
 *
 * ".NN" version suffixes (e.g. "gpt-5.1" vs "gpt-5") are deliberately
 * rejected — they are different model generations with unrelated
 * capabilities.  The same goes for "-chat", "-mini", "-nano", "-turbo"
 * etc., which denote distinct model variants.
 */
function isBoundarySubmatch(a: string, b: string): boolean {
  if (a === b) return true;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (!longer.startsWith(shorter) && !longer.endsWith(shorter)) return false;

  // The extra part must be a suffix like "-0125" or "-preview".
  let extra: string;
  if (longer.startsWith(shorter)) {
    extra = longer.slice(shorter.length);
  } else {
    extra = longer.slice(0, longer.length - shorter.length);
  }

  // Allow: leading dash + digits (e.g. "gpt-5-0125" extends "gpt-5")
  if (/^-[-\d]/.test(extra) && !/[a-z]{2,}/i.test(extra.replace(/^-[-\d]+/, ''))) return true;

  // NOTE: we deliberately do NOT allow ".NN" version suffixes like
  // "gpt-5.1" extending "gpt-5" — those are different model generations.

  // Allow: "-preview", "-thinking", "-lite" suffixes
  if (/^-(preview|thinking|lite)$/i.test(extra)) return true;

  // Reject: anything else — "gpt-5" must NOT match "gpt-5-chat", "gpt-5.1",
  // "glm-5-turbo" etc. which are entirely different model variants.

  // Reject: anything else (e.g. "gpt-5" vs "gpt-5-chat" or "gpt-5.1")
  return false;
}

/**
 * Merges multiple LiteLLM entries for the same base model into a single
 * "best capability" entry.
 *
 * For token limits we take the **maximum** across all entries, because
 * different providers impose different artificial caps and we want the
 * model's true capability.  Boolean capability flags are OR-ed.  The
 * `hint` (model family) is used to pick which entry's id to report.
 */
function mergeEntries(entries: LiteLLMModelEntry[], hint?: string): LiteLLMModelEntry {
  if (entries.length === 1) return entries[0];

  let maxInputTokens: number | undefined;
  let maxOutputTokens: number | undefined;
  let vision: boolean | undefined;
  let toolCalling: boolean | undefined;
  let reasoning: boolean | undefined;

  // Track the entry with the highest maxInputTokens as fallback for id.
  let bestEntry: LiteLLMModelEntry = entries[0];
  let bestInput = bestEntry.maxInputTokens ?? -1;

  // Track the entry that matches the provider hint for id.
  let hintedEntry: LiteLLMModelEntry | undefined;

  for (const entry of entries) {
    if (entry.maxInputTokens !== undefined) {
      maxInputTokens = maxInputTokens === undefined
        ? entry.maxInputTokens
        : Math.max(maxInputTokens, entry.maxInputTokens);
      if (entry.maxInputTokens > bestInput) {
        bestInput = entry.maxInputTokens;
        bestEntry = entry;
      }
    }
    if (entry.maxOutputTokens !== undefined) {
      maxOutputTokens = maxOutputTokens === undefined
        ? entry.maxOutputTokens
        : Math.max(maxOutputTokens, entry.maxOutputTokens);
    }
    if (entry.vision) vision = true;
    if (entry.toolCalling) toolCalling = true;
    if (entry.reasoning) reasoning = true;

    // Check if this entry's provider matches the hint.
    if (hint && !hintedEntry) {
      const parsed = parseLiteLLMId(entry.id);
      if (parsed.segments.some((seg) => seg.includes(hint) || hint.includes(seg))) {
        hintedEntry = entry;
      }
    }
  }

  // Prefer hint-matched entry for id, fall back to highest-token entry.
  const idSource = hintedEntry ?? bestEntry;

  return {
    id: idSource.id,
    maxInputTokens,
    maxOutputTokens,
    vision,
    toolCalling,
    reasoning,
  };
}

/**
 * Matches an AIXRouter model id against LiteLLM entries.
 *
 * Strategy (in priority order):
 *  1. Exact base-name match (last path segment, e.g. "deepseek-v4-pro").
 *     When multiple entries share the base name, they are **merged** by
 *     taking the maximum token limits across all providers, so we report
 *     the model's true capability rather than a single provider's cap.
 *     The hint is only used to pick which entry's id/pricing to report.
 *  2. Substring containment as a last resort.
 */
function findEntry(modelId: string, family?: string): LiteLLMModelEntry | undefined {
  const entries = getEntries();
  if (entries.length === 0) return undefined;

  const needle = modelId.toLowerCase();
  const needleBase = needle.split('/').pop() ?? needle;
  const hint = family?.toLowerCase();

  // 1. Exact base-name matches.
  const baseMatches = entries.filter((entry) => {
    const parsed = parseLiteLLMId(entry.id);
    return parsed.base === needleBase;
  });

  if (baseMatches.length > 0) {
    // Always merge ALL base matches to get the true maximum token limits.
    // Model capability is inherent — different providers may cap it
    // differently, but the model itself supports the max.
    return mergeEntries(baseMatches, hint);
  }

  // 2. Substring containment with boundary check.
  // Only allow matches where extra characters are a date/build suffix
  // (dash + digit or "-preview"), so that "gpt-5" won't match "gpt-5-chat"
  // or "gpt-5.1" which are completely different model families.
  const substringMatches = entries.filter((entry) => {
    const parsed = parseLiteLLMId(entry.id);
    return isBoundarySubmatch(needleBase, parsed.base);
  });

  if (substringMatches.length > 0) {
    return mergeEntries(substringMatches, hint);
  }

  return undefined;
}

/**
 * Enriches a model config with LiteLLM fallback data for any missing fields.
 *
 * Fills gaps and expands token/context limits when the bundled LiteLLM catalog
 * knows a larger model capability. It never lowers platform-provided values.
 */
export function enrichWithLiteLLM(model: AIXRouterModelConfig): AIXRouterModelConfig {
  const entry = findEntry(model.id, model.family);
  if (!entry) return model;

  const maxInputTokens = maxNumber(model.maxInputTokens, entry.maxInputTokens);
  const maxOutputTokens = maxNumber(model.maxOutputTokens, entry.maxOutputTokens);
  const vision = model.vision === true || entry.vision === true ? true : model.vision ?? entry.vision;
  const toolCalling = model.toolCalling === true || entry.toolCalling === true ? true : model.toolCalling ?? entry.toolCalling;
  const thinking = model.thinking === true || entry.reasoning === true ? true : model.thinking ?? entry.reasoning;

  // Recompute context windows if LiteLLM expanded the known max input.
  let contextWindows = model.contextWindows;
  if (maxInputTokens !== undefined) {
    const modelText = [model.id, model.name, model.family].filter(Boolean).join(' ').toLowerCase();
    const windows = getContextWindows(modelText, maxInputTokens);
    const mergedWindows = [...new Set([...(contextWindows ?? []), ...windows])]
      .filter((value) => value <= maxInputTokens)
      .sort((a, b) => a - b);
    contextWindows = mergedWindows.length > 0 ? mergedWindows : undefined;
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
