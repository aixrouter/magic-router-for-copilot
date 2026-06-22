# Smoke Test

Use this checklist before publishing a VSIX or Marketplace release.

## Setup

- Install the packaged VSIX in a clean VS Code profile.
- Confirm GitHub Copilot Chat is installed, enabled, and signed in.
- Confirm the first-run prompt appears once when Base URL or API Key is missing.
- Run `Magic Router: Set Base URL`.
- Run `Magic Router: Set API Key`.
- Run `Magic Router: Refresh Models`.

## Model Picker

- Open Copilot Chat and confirm Magic Router models appear in the model picker.
- Confirm models are loaded from `{baseUrl}/models`.
- Confirm vision-capable models show image support.
- Confirm thinking-capable models show reasoning effort options.
- Confirm large-context models show context window options when available.
- Confirm model cost columns are populated for AIXRouter or AgileRouter when `magicrouter.enrichPublicModelMetadata` is enabled.
- Set `magicrouter.enrichPublicModelMetadata` to `false`, refresh models, and confirm models still load without public catalog enrichment.

## Chat

- Send a simple text prompt and confirm streaming output works.
- Use Agent mode with a tool call and confirm Copilot receives the tool request.
- Send an image attachment to a vision-capable model and confirm the request succeeds.
- Select a thinking-capable model and confirm reasoning output appears when the provider returns it.

## Errors

- Use an invalid API key and confirm the 401 message suggests `Magic Router: Set API Key`.
- Use an invalid Base URL and confirm the error suggests checking `Magic Router: Set Base URL`.
- Use an account with insufficient quota, when available, and confirm the 402 message is readable.
- Enable `magicrouter.debug` and confirm diagnostics do not include prompt text or authorization headers.

## Package

- Run `pnpm run compile`.
- Run `pnpm run package`.
- Confirm the generated VSIX has the expected version and includes `out/extension.js`.
- Confirm the extension icon does not trigger a large-file warning during packaging.
