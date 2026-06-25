import type { AIXRouterModelConfig } from '../types.js';
import { getContextWindows } from './modelUtils.js';

/**
 * Applies name-based heuristics as a last-resort fallback.
 *
 * Run this AFTER LiteLLM enrichment so it only fills fields that are
 * still `undefined` — LiteLLM data always wins over heuristics.
 */
export function applyHeuristicFallbacks(models: AIXRouterModelConfig[]): AIXRouterModelConfig[] {
  return models.map((model) => {
    const modelText = normalizeModelText(model);

    const maxInputTokens = model.maxInputTokens ?? 128000;
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
    const contextWindows =
      model.contextWindows && model.contextWindows.length > 0
        ? model.contextWindows
        : getContextWindows(modelText, maxInputTokens).filter((w) => w <= maxInputTokens);

    return {
      ...model,
      maxInputTokens,
      maxOutputTokens,
      toolCalling,
      vision,
      thinking,
      contextWindows,
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
