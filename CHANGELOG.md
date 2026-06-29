# Changelog

## 0.1.22

- Fix: Restore the context-window picker (200K / 400K / 1M) for Claude/Gemini/GPT-5 family models when the AIXRouter API reports no `context_length` and LiteLLM enrichment is unavailable — the heuristic fallback no longer collapses the option list with a stale 128K default.
- Improve: Make the bundled LiteLLM metadata loader resilient — if `vscode.extensions.getExtension(...)` returns `undefined` (early activation / non-standard hosts), fall back to resolving `resources/model-metadata.json` relative to the compiled module so capability data is still available.
- Test: Add regression coverage for `claude-sonnet-4.6` / `gemini-3-pro` context-window inference in the heuristic fallback path.

## 0.1.21

- Improve: Add a third Claude cache breakpoint on the latest user message so prompt caching is owned by the extension rather than implicit upstream behavior.
- Improve: Map VS Code's `LanguageModelChatToolMode.Required` to Claude's `tool_choice: { type: 'any' }` (previously dropped, leaving the model free to skip tools).
- Improve: Log tool argument JSON parse failures so malformed `tool_calls` from the agent are easier to diagnose.
- Improve: Surface `cacheBreakpoints` in the Claude request debug summary.
- Refactor: Split Claude stream event handling from non-stream full-response parsing for clearer, slightly cheaper per-event work.

## 0.1.20

- Improve: Apply Anthropic prompt caching breakpoints on Claude `system` block and the last `tools` entry to cut repeated per-request cost for large tool sets.

## 0.1.19

- Improve: Prefix output-channel log lines with ISO timestamps for easier request tracing.

## 0.1.18

- Fix: Drop stale Claude tool-use/tool-result history when a new user message interrupts the tool call chain.

## 0.1.17

- Fix: Let Claude requests honor stable compatibility mode so default requests omit extended thinking fields that can trigger upstream provider errors.

## 0.1.16

- Fix: Map Claude tool choice to the official Messages API payload shape and keep OpenAI-only request fields out of Claude requests.

## 0.1.15

- Fix: Keep Claude requests on the standard Anthropic Messages payload shape without prompt cache markers for upstream compatibility.

## 0.1.13

- Fix: Present upstream HTTP failures such as insufficient balance as compact VS Code language model errors without leaking internal stack traces.

## 0.1.12

- Improve: Sanitize forwarded tool schemas and add conservative OpenAI-compatible fallback handling for unsupported streaming and empty responses.

## 0.1.11

- Improve: Add `aixrouter.compatibilityMode` with a stable default that omits optional routing/thinking hints from chat requests for better upstream compatibility.

## 0.1.10

- Fix: Match Anthropic model IDs that use dot minor versions, such as `claude-opus-4.8`, to LiteLLM's hyphenated catalog IDs.

## 0.1.9

- Fix: Allow bundled LiteLLM metadata to expand model token and context-window capabilities above incomplete API/public catalog limits.

## 0.1.8

- Fix: Honor `aixrouter.maxTokens = 0` by omitting `max_tokens` and using the provider default.
- Fix: Apply timeout coverage to model-list and metadata body reads.
- Improve: Enrich missing model metadata from a bundled LiteLLM fallback catalog before applying heuristics.
- Improve: Keep packaged VSIX contents clean by excluding local `.env` and helper scripts.

## 0.1.5

- Fix: Map Copilot reasoning effort to Claude extended thinking budgets.
- Fix: Omit Claude temperature when extended thinking is enabled to satisfy Claude API constraints.
- Fix: Preserve tool calls from non-stream Claude fallback responses.
- Fix: Keep Claude non-stream thinking content separate from assistant text.
- Fix: Avoid duplicated OpenAI-compatible tool call IDs and names in repeated stream chunks.
- Fix: Use conservative fallback vision capabilities when a selected model is not cached.
- Fix: Avoid advertising context windows above the inferred or API-provided model limit.
- Improve: Deduplicate concurrent model list loads.
- Improve: Clamp Claude temperature to the supported range and improve token estimates for CJK text.
- Improve: Preserve system-role messages when VS Code provides them.
- Improve: Share model context-window and number parsing helpers across client and pricing code.
- Improve: Add initial-response timeouts and one retry for OpenAI-compatible chat and model list requests.

## 0.1.4

- Fix: Claude empty SSE stream now retries once with `stream=false` instead of failing.
- Fix: OpenAI-compatible non-SSE JSON responses are now parsed and reported.
- Fix: Claude tool call arguments no longer corrupt when `input_json_delta` follows `content_block_start`.
- Fix: Model vision capabilities are not overridden by API-returned `false` for known vision models.
- Enhance: Image data parts in nested or non-standard object shapes are now recognized.

## 0.1.0

- Initial public preview.
- Add AIXRouter as a GitHub Copilot Chat language model provider.
- Add BYOK setup with Base URL and API Key commands.
- Store API keys in VS Code SecretStorage.
- Load models dynamically from `{baseUrl}/openai/v1/models`.
- Route Claude requests to `{baseUrl}/claude/v1/messages` with the Anthropic Messages payload shape; route other chat completions to `{baseUrl}/openai/v1/chat/completions`.
- Support Copilot Agent mode tool calls, image input, and reasoning output.
- Add model picker metadata for vision, thinking, context windows, and model costs.
- Add optional public metadata enrichment for AIXRouter and AgileRouter model catalogs.
- Add first-run setup guidance and clearer HTTP error messages.
