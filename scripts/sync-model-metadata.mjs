/**
 * Syncs model metadata from LiteLLM's community-maintained JSON catalog.
 *
 * Source: https://github.com/BerriAI/litellm
 * File:   model_prices_and_context_window.json
 *
 * This script fetches the JSON, extracts chat models, and writes a compact
 * subset to resources/model-metadata.json. At runtime the extension reads
 * this file as a third-tier fallback (after the AIXRouter API and the public
 * catalog) to fill in context windows, max output tokens, and capabilities.
 *
 * Run:  node scripts/sync-model-metadata.mjs
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'resources', 'model-metadata.json');

/**
 * Fields kept per model. Pricing is intentionally excluded — the AIXRouter
 * platform catalog is the authoritative source for pricing.
 * @typedef {Object} CompactModel
 * @property {string} id
 * @property {number} [maxInputTokens]
 * @property {number} [maxOutputTokens]
 * @property {boolean} [vision]
 * @property {boolean} [toolCalling]
 * @property {boolean} [reasoning]
 */

/**
 * @param {Record<string, unknown>} entry
 * @returns {CompactModel | null}
 */
function toCompact(id, entry) {
  if (!entry || typeof entry !== 'object') return null;

  // Only keep chat / completion models. Skip embeddings, image_generation, etc.
  const mode = entry.mode;
  if (mode !== 'chat' && mode !== 'completion') return null;

  // Skip the sample spec entry and obvious non-model keys.
  if (id === 'sample_spec') return null;

  const maxInputTokens = numOr(entry.max_input_tokens, entry.max_tokens);
  const maxOutputTokens = numOr(entry.max_output_tokens, entry.max_tokens);

  // Drop entries with no useful token info.
  if (maxInputTokens === undefined && maxOutputTokens === undefined) return null;

  const compact = { id };

  if (maxInputTokens !== undefined) compact.maxInputTokens = maxInputTokens;
  if (maxOutputTokens !== undefined) compact.maxOutputTokens = maxOutputTokens;

  if (typeof entry.supports_vision === 'boolean') compact.vision = entry.supports_vision;
  if (typeof entry.supports_function_calling === 'boolean') compact.toolCalling = entry.supports_function_calling;
  if (typeof entry.supports_reasoning === 'boolean') compact.reasoning = entry.supports_reasoning;

  return compact;
}

function numOr(...values) {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return undefined;
}

async function main() {
  console.log(`Fetching ${LITELLM_URL} ...`);
  const response = await fetch(LITELLM_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const raw = await response.json();

  const models = [];
  for (const [id, entry] of Object.entries(raw)) {
    const compact = toCompact(id, entry);
    if (compact) models.push(compact);
  }

  models.sort((a, b) => a.id.localeCompare(b.id));

  const output = {
    source: 'litellm',
    sourceUrl: LITELLM_URL,
    syncedAt: new Date().toISOString(),
    modelCount: models.length,
    models,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${models.length} models to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
