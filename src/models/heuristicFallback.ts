import type { AIXRouterModelConfig, ModelMetadataSources } from '../types.js';
import { getContextWindows, inferMaxContextWindow } from './modelUtils.js';

/**
 * Applies name-based heuristics as a last-resort fallback.
 *
 * Run this AFTER LiteLLM enrichment so it only fills fields that are
 * still `undefined` — LiteLLM data always wins over heuristics.
 */
export function applyHeuristicFallbacks(models: AIXRouterModelConfig[]): AIXRouterModelConfig[] {
  return models.map((model) => {
    const modelText = normalizeModelText(model);

    // When upstream data is missing, infer the maximum context size from the
    // model name (e.g. Claude/Gemini/GPT-5 families support 1M tokens).
    // Falling back to a flat 128K under-reports modern model capabilities and
    // causes the picker to drop valid context options.
    const inferredMaxInput = inferMaxContextWindow(modelText);
    const maxInputTokens = model.maxInputTokens ?? Math.max(inferredMaxInput, 128000);
    const maxOutputTokens = model.maxOutputTokens ?? 8192;
    const toolCalling = model.toolCalling ?? true;
    const vision =
      model.vision !== undefined
        ? model.vision
        : looksVisionCapable(modelText);
    const thinking =
      model.thinking !== undefined
        ? model.thinking
        : looksThinkingCapable(modelText);
    // `getContextWindows` already caps by the inferred family max and the API
    // value (whichever is larger). Re-filtering by `maxInputTokens` strips out
    // legitimate options when the API didn't report a value and we fall back
    // to a conservative default.
    const contextWindows =
      model.contextWindows && model.contextWindows.length > 0
        ? model.contextWindows
        : getContextWindows(modelText, maxInputTokens);

    const sources: ModelMetadataSources = {
      ...model.metadataSources,
      maxInputTokens: model.metadataSources?.maxInputTokens ?? (model.maxInputTokens === undefined ? 'heuristic' : undefined),
      maxOutputTokens: model.metadataSources?.maxOutputTokens ?? (model.maxOutputTokens === undefined ? 'heuristic' : undefined),
      toolCalling: model.metadataSources?.toolCalling ?? (model.toolCalling === undefined ? 'heuristic' : undefined),
      vision: model.metadataSources?.vision ?? (model.vision === undefined ? 'heuristic' : undefined),
      thinking: model.metadataSources?.thinking ?? (model.thinking === undefined ? 'heuristic' : undefined),
      contextWindows: model.metadataSources?.contextWindows ?? (model.contextWindows === undefined || model.contextWindows.length === 0 ? 'heuristic' : undefined),
    };

    return {
      ...model,
      maxInputTokens,
      maxOutputTokens,
      toolCalling,
      vision,
      thinking,
      contextWindows,
      metadataSources: sources,
    };
  });
}

function normalizeModelText(model: AIXRouterModelConfig): string {
  return [
    model.id,
    model.name,
    model.family,
    model.sourceType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function looksVisionCapable(modelText: string): boolean {
  if (
    modelText.includes('multimodal') ||
    modelText.includes('multi-modal') ||
    modelText.includes('vision') ||
    /\bvl\b/.test(modelText)
  ) {
    return true;
  }

  return [
    /^claude-(haiku|sonnet|opus)-/,
    /^gemini-/,
    /^gpt-4o\b/,
    /^gpt-4\.1\b/,
    /^gpt-5(\b|-)/,
    /^gpt-5\./,
    /^glm-5\.1\b/,
    /^kimi-k2\.5\b/,
  ].some((pattern) => pattern.test(modelText));
}

function looksThinkingCapable(modelText: string): boolean {
  if (modelText.includes('reason') || modelText.includes('thinking')) {
    return true;
  }

  return [
    /^claude-(haiku|sonnet|opus)-/,
    /^gpt-4o\b/,
    /^gpt-4\.1\b/,
    /^gpt-5(\b|-)/,
    /^gpt-5\./,
    /^gemini-/,
    /\bo[134]\b/,
    /\bo[134]-/,
    /\br1\b/,
    /\bqwen3\b/,
  ].some((pattern) => pattern.test(modelText));
}
