/**
 * Quick smoke test for the LiteLLM fallback matcher.
 * Run: npx tsx scripts/test-litellm-match.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

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

function parseLiteLLMId(id: string): ParsedId {
  const segments = id.toLowerCase().split('/');
  const base = segments[segments.length - 1];
  return { base, segments };
}

function mergeEntries(entries: LiteLLMModelEntry[], hint?: string): LiteLLMModelEntry {
  if (entries.length === 1) return entries[0];

  let maxInputTokens: number | undefined;
  let maxOutputTokens: number | undefined;
  let vision: boolean | undefined;
  let toolCalling: boolean | undefined;
  let reasoning: boolean | undefined;
  let bestEntry: LiteLLMModelEntry = entries[0];
  let bestInput = bestEntry.maxInputTokens ?? -1;
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
    if (hint && !hintedEntry) {
      const parsed = parseLiteLLMId(entry.id);
      if (parsed.segments.some((seg) => seg.includes(hint) || hint.includes(seg))) {
        hintedEntry = entry;
      }
    }
  }

  const src = hintedEntry ?? bestEntry;
  return {
    id: src.id,
    maxInputTokens,
    maxOutputTokens,
    vision,
    toolCalling,
    reasoning,
  };
}

function isBoundarySubmatch(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (!longer.startsWith(shorter) && !longer.endsWith(shorter)) return false;

  let extra: string;
  if (longer.startsWith(shorter)) {
    extra = longer.slice(shorter.length);
  } else {
    extra = longer.slice(0, longer.length - shorter.length);
  }

  // Allow: leading dash + digits (e.g. "gpt-5-0125" extends "gpt-5")
  if (/^-[-\d]/.test(extra) && !/[a-z]{2,}/i.test(extra.replace(/^-[-\d]+/, ''))) return true;
  // Allow: "-preview", "-thinking", "-lite" suffixes
  if (/^-(preview|thinking|lite)$/i.test(extra)) return true;
  return false;
}

function findEntry(
  modelId: string,
  family: string | undefined,
  entries: LiteLLMModelEntry[],
): LiteLLMModelEntry | undefined {
  if (entries.length === 0) return undefined;

  const needle = modelId.toLowerCase();
  const needleBase = needle.split('/').pop() ?? needle;
  const hint = family?.toLowerCase();

  const baseMatches = entries.filter((entry) => {
    const parsed = parseLiteLLMId(entry.id);
    return parsed.base === needleBase;
  });

  if (baseMatches.length > 0) {
    return mergeEntries(baseMatches, hint);
  }

  const substringMatches = entries.filter((entry) => {
    const parsed = parseLiteLLMId(entry.id);
    return isBoundarySubmatch(needleBase, parsed.base);
  });

  if (substringMatches.length > 0) {
    return mergeEntries(substringMatches, hint);
  }

  return undefined;
}

// --- Test ---
const filePath = path.join(import.meta.dirname, '..', 'resources', 'model-metadata.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as LiteLLMMetadataFile;
const entries = data.models;

const testCases = [
  { id: 'deepseek-v4-pro', family: 'deepseek', expectMin: 1000000, label: 'DeepSeek V4 Pro → 1M' },
  { id: 'deepseek-v4-flash', family: 'deepseek', expectMin: 1000000, label: 'DeepSeek V4 Flash → 1M' },
  { id: 'claude-sonnet-4-5', family: 'anthropic', expectMin: 200000, label: 'Claude Sonnet 4.5' },
  { id: 'gpt-4o', family: 'openai', expectMin: 128000, label: 'GPT-4o' },
  { id: 'gemini-2.5-pro', family: 'google', expectMin: 1000000, label: 'Gemini 2.5 Pro → 1M' },
  { id: 'glm-4.6', family: 'zhipu', expectMin: 128000, label: 'GLM-4.6 (Zhipu)' },
  { id: 'qwen3-235b-a22b', family: 'qwen', expectMin: 128000, label: 'Qwen3 235B' },
  { id: 'kimi-k2.5', family: 'moonshot', expectMin: 128000, label: 'Kimi K2.5' },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const entry = findEntry(tc.id, tc.family, entries);
  const maxInput = entry?.maxInputTokens ?? 0;
  const ok = maxInput >= tc.expectMin;
  const status = ok ? '✅' : '❌';
  console.log(`${status} ${tc.label}`);
  console.log(`   model=${tc.id} family=${tc.family}`);
  console.log(`   matched=${entry?.id ?? '(none)'} maxInputTokens=${entry?.maxInputTokens ?? 'n/a'}`);
  if (!ok) {
    console.log(`   EXPECTED >= ${tc.expectMin}, GOT ${maxInput}`);
    failed++;
  } else {
    passed++;
  }
  console.log();
}

console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
