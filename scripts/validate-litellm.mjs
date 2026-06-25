#!/usr/bin/env node
/**
 * Validation script: fetches models from the AIXRouter API and compares
 * their context_length / max_output_tokens against what the LiteLLM
 * fallback would produce.
 *
 * Usage:
 *   export AIXROUTER_API_KEY="sk-xxx"
 *   node scripts/validate-litellm.mjs
 *
 * Optionally set AIXROUTER_BASE_URL (default: https://api.aixrouter.com)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.AIXROUTER_API_KEY;
const BASE_URL = process.env.AIXROUTER_BASE_URL || 'https://api.aixrouter.com';

if (!API_KEY) {
  console.error('❌ AIXROUTER_API_KEY environment variable is not set.');
  console.error('   export AIXROUTER_API_KEY="sk-xxx"');
  process.exit(1);
}

// ── Load bundled LiteLLM metadata ──────────────────────────────────────
const metadataPath = path.join(__dirname, '..', 'resources', 'model-metadata.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const litellmEntries = metadata.models;
console.log(`📦 Loaded ${litellmEntries.length} LiteLLM entries (synced ${metadata.syncedAt})`);

// ── LiteLLM matcher (mirror of src/models/litellmFallback.ts) ──────────
function parseLiteLLMId(id) {
  const segments = id.toLowerCase().split('/');
  return { base: segments[segments.length - 1], segments };
}

function mergeEntries(entries, hint) {
  if (entries.length === 1) return entries[0];

  let maxInputTokens, maxOutputTokens, vision, toolCalling, reasoning;
  let bestEntry = entries[0];
  let bestInput = bestEntry.maxInputTokens ?? -1;
  let hintedEntry;

  for (const e of entries) {
    if (e.maxInputTokens !== undefined) {
      maxInputTokens = maxInputTokens === undefined ? e.maxInputTokens : Math.max(maxInputTokens, e.maxInputTokens);
      if (e.maxInputTokens > bestInput) { bestInput = e.maxInputTokens; bestEntry = e; }
    }
    if (e.maxOutputTokens !== undefined) {
      maxOutputTokens = maxOutputTokens === undefined ? e.maxOutputTokens : Math.max(maxOutputTokens, e.maxOutputTokens);
    }
    if (e.vision) vision = true;
    if (e.toolCalling) toolCalling = true;
    if (e.reasoning) reasoning = true;
    if (hint && !hintedEntry) {
      const p = parseLiteLLMId(e.id);
      if (p.segments.some(s => s.includes(hint) || hint.includes(s))) {
        hintedEntry = e;
      }
    }
  }
  const src = hintedEntry ?? bestEntry;
  return { id: src.id, maxInputTokens, maxOutputTokens, vision, toolCalling, reasoning };
}

function isBoundarySubmatch(a, b) {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (!longer.startsWith(shorter) && !longer.endsWith(shorter)) return false;

  let extra;
  if (longer.startsWith(shorter)) {
    extra = longer.slice(shorter.length);
  } else {
    extra = longer.slice(0, longer.length - shorter.length);
  }

  // Allow: leading dash + digits (e.g. "gpt-5-0125" extends "gpt-5")
  if (/^-[-\d]/.test(extra) && !/[a-z]{2,}/i.test(extra.replace(/^-[-\d]+/, ''))) return true;
  // Allow: "-preview", "-thinking", "-lite" suffixes
  if (/^-(preview|thinking|lite)$/i.test(extra)) return true;

  // Reject: anything else — "gpt-5" must NOT match "gpt-5-chat", "gpt-5.1",
  // "glm-5-turbo" etc. which are entirely different model variants.
  return false;
}

function findEntry(modelId, family) {
  const needle = modelId.toLowerCase();
  const needleBase = needle.split('/').pop() ?? needle;
  const hint = family?.toLowerCase();

  const baseMatches = litellmEntries.filter(e => parseLiteLLMId(e.id).base === needleBase);
  if (baseMatches.length > 0) {
    return mergeEntries(baseMatches, hint);
  }

  const sub = litellmEntries.filter(e => {
    const p = parseLiteLLMId(e.id);
    return isBoundarySubmatch(needleBase, p.base);
  });
  if (sub.length > 0) {
    return mergeEntries(sub, hint);
  }
  return undefined;
}

// ── Fetch models from AIXRouter API ────────────────────────────────────
async function fetchModels() {
  const url = `${BASE_URL}/openai/v1/models`;
  console.log(`🌐 Fetching ${url} ...`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  return json.data ?? [];
}

// ── Infer family from model id (mirror of aixrouterClient.ts) ──────────
function inferFamily(id) {
  const [family] = id.split(/[/:.-]/);
  return family || 'aixrouter';
}

// ── Main ───────────────────────────────────────────────────────────────
const models = await fetchModels();
console.log(`✅ Fetched ${models.length} models from AIXRouter API\n`);

const results = [];
let matched = 0, unmatched = 0, exact = 0, close = 0, mismatch = 0;

for (const model of models) {
  const id = model.id;
  if (!id) continue;

  // API-provided values
  const apiContext = model.context_length ?? model.max_context_length;
  const apiMaxOutput = model.max_output_tokens;
  const family = model.owned_by && !['unknown', ''].includes(model.owned_by)
    ? model.owned_by
    : inferFamily(id);

  // LiteLLM fallback values
  const entry = findEntry(id, family);
  const litellmInput = entry?.maxInputTokens;
  const litellmOutput = entry?.maxOutputTokens;

  if (!entry) {
    unmatched++;
    results.push({ id, family, apiContext, apiMaxOutput, litellmInput: null, litellmOutput: null,
      matched: false, status: 'no-match' });
    continue;
  }

  matched++;

  // Compare context length
  let inputStatus = 'unknown';
  if (apiContext !== undefined && litellmInput !== undefined) {
    if (apiContext === litellmInput) { inputStatus = 'exact'; exact++; }
    else if (Math.abs(apiContext - litellmInput) / Math.max(apiContext, litellmInput) < 0.1) { inputStatus = 'close'; close++; }
    else { inputStatus = 'mismatch'; mismatch++; }
  } else if (apiContext === undefined && litellmInput !== undefined) {
    inputStatus = 'litellm-only';
  } else if (apiContext !== undefined && litellmInput === undefined) {
    inputStatus = 'api-only';
  }

  results.push({ id, family, apiContext, apiMaxOutput, litellmInput, litellmOutput,
    litellmVision: entry.vision, litellmToolCalling: entry.toolCalling, litellmReasoning: entry.reasoning,
    matched: true, status: inputStatus, matchedId: entry.id });
}

// ── Report ─────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════');
console.log('  VALIDATION SUMMARY');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Total models from API:     ${models.length}`);
console.log(`  Matched by LiteLLM:        ${matched}`);
console.log(`  No match in LiteLLM:       ${unmatched}`);
console.log();

if (unmatched > 0) {
  console.log(`  ⚠️  API returned ${unmatched} models with NO LiteLLM match.`);
  console.log(`     These models will fall back to hardcoded defaults (128k/8192).`);
  console.log();
}

console.log('  Per-model LiteLLM match details:');
console.log('  ─────────────────────────────────────────────────────────────');
for (const r of results) {
  const idStr = r.id.padEnd(38);
  if (!r.matched) {
    console.log(`  ❌ ${idStr} NO MATCH (defaults: 128000/8192)`);
  } else {
    const inT = r.litellmInput?.toLocaleString() ?? '?';
    const outT = r.litellmOutput?.toLocaleString() ?? '?';
    const tags = [
      r.litellmVision ? 'vision' : '',
      r.litellmToolCalling ? 'tools' : '',
      r.litellmReasoning ? 'reasoning' : '',
    ].filter(Boolean).join(',');
    console.log(`  ✅ ${idStr} in=${inT.padStart(10)}  out=${outT.padStart(8)}  [${tags || '-'}]`);
    console.log(`     ↳ matched: ${r.matchedId}`);
  }
}
console.log();

console.log('  Context window comparison (API vs LiteLLM):');
console.log(`    Exact match (±0%):        ${exact}`);
console.log(`    Close match (±10%):       ${close}`);
console.log(`    Mismatch (>10% diff):     ${mismatch}`);
console.log(`    API-only (no LiteLLM):    ${results.filter(r => r.status === 'api-only').length}`);
console.log(`    LiteLLM-only (no API):    ${results.filter(r => r.status === 'litellm-only').length}`);
console.log();

// Show mismatches
const mismatches = results.filter(r => r.status === 'mismatch');
if (mismatches.length > 0) {
  console.log('── MISMATCHES (>10% difference) ────────────────────────────────');
  for (const r of mismatches) {
    const diff = r.apiContext && r.litellmInput
      ? `${r.apiContext > r.litellmInput ? 'API>Litellm' : 'API<Litellm'} (${Math.round(Math.abs(r.apiContext - r.litellmInput) / Math.max(r.apiContext, r.litellmInput) * 100)}%)`
      : '?';
    console.log(`  ⚠️  ${r.id}`);
    console.log(`     family=${r.family}  ${diff}`);
    console.log(`     API:     context=${r.apiContext}  maxOutput=${r.apiMaxOutput ?? 'n/a'}`);
    console.log(`     LiteLLM: input=${r.litellmInput}  output=${r.litellmOutput ?? 'n/a'}  (matched: ${r.matchedId})`);
    console.log();
  }
}

// Show unmatched models (in API but not in LiteLLM)
const unmatchedResults = results.filter(r => !r.matched);
if (unmatchedResults.length > 0) {
  console.log(`── UNMATCHED (${unmatchedResults.length} models in API but not in LiteLLM) ──────────`);
  // Group by family for readability
  const byFamily = {};
  for (const r of unmatchedResults) {
    (byFamily[r.family] ??= []).push(r);
  }
  for (const [family, items] of Object.entries(byFamily).sort()) {
    console.log(`  [${family}] (${items.length})`);
    for (const r of items.slice(0, 10)) {
      console.log(`    ${r.id}  (API context=${r.apiContext ?? 'n/a'}, maxOutput=${r.apiMaxOutput ?? 'n/a'})`);
    }
    if (items.length > 10) console.log(`    ... and ${items.length - 10} more`);
  }
  console.log();
}

// Show output token comparison for matched models
const outputMismatches = results.filter(r =>
  r.matched && r.apiMaxOutput !== undefined && r.litellmOutput !== undefined &&
  r.apiMaxOutput !== r.litellmOutput &&
  Math.abs(r.apiMaxOutput - r.litellmOutput) / Math.max(r.apiMaxOutput, r.litellmOutput) > 0.1
);
if (outputMismatches.length > 0) {
  console.log('── OUTPUT TOKEN MISMATCHES (>10%) ──────────────────────────────');
  for (const r of outputMismatches) {
    console.log(`  ⚠️  ${r.id}`);
    console.log(`     API maxOutput=${r.apiMaxOutput}  vs  LiteLLM=${r.litellmOutput}  (matched: ${r.matchedId})`);
  }
  console.log();
}

console.log('═══════════════════════════════════════════════════════════════');
const totalCompared = exact + close + mismatch;
if (totalCompared > 0) {
  const accuracy = ((exact + close) / totalCompared * 100).toFixed(1);
  console.log(`  Accuracy (exact+close / total compared): ${accuracy}%  (${exact + close}/${totalCompared})`);
}
console.log('═══════════════════════════════════════════════════════════════');
