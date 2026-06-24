# Magic Router for Copilot

[English](README.md) | [简体中文](README.zh-cn.md)

Use Magic Router models directly from the GitHub Copilot Chat model picker.

Magic Router for Copilot does not replace Copilot Chat or add a separate chat UI. It registers Magic Router as a Copilot language model provider, so you can keep using Copilot Chat, Agent mode, workspace context, instructions, and tools while sending model requests through your own OpenAI-compatible router endpoint.

## Features

- Adds Magic Router models to the Copilot Chat model picker.
- Uses your own API key, stored in VS Code SecretStorage.
- Uses `https://api.aixrouter.com` as the default gateway Base URL and lets you change it when needed.
- Loads models from `{baseUrl}/openai/v1/models`.
- Routes Claude requests to the Anthropic Messages endpoint at `{baseUrl}/claude/v1/messages`; other chat requests use `{baseUrl}/openai/v1/chat/completions`.
- Supports OpenAI-compatible streaming, tool calls, image input, and reasoning output.
- Enriches model metadata with cost, vendor, multimodal, thinking, and context options for supported AIXRouter and AgileRouter base URLs when enabled.

## Requirements

- VS Code 1.116 or newer.
- GitHub Copilot Chat installed and signed in.
- An OpenAI-compatible Magic Router endpoint and API key.

## Quick Start

1. Install the extension.
2. Run `Magic Router: Set API Key`.
3. Open Copilot Chat and choose a Magic Router model from the model picker.

The extension uses `https://api.aixrouter.com` as the default gateway Base URL. To use another compatible gateway, run `Magic Router: Set Base URL`.

Common Base URLs:

| Provider | Base URL |
| --- | --- |
| AIXRouter | `https://api.aixrouter.com` |
| AgileRouter | `https://api.agilerouter.com` |

## API Routing

Magic Router treats `magicrouter.baseUrl` as the gateway root. With the default `https://api.aixrouter.com`, model discovery uses `https://api.aixrouter.com/openai/v1/models`. Claude requests use `https://api.aixrouter.com/claude/v1/messages` with the Anthropic Messages payload shape. All other chat requests use `https://api.aixrouter.com/openai/v1/chat/completions`.

## Commands

- `Magic Router: Set Base URL`
- `Magic Router: Set API Key`
- `Magic Router: Clear API Key`
- `Magic Router: Refresh Models`
- `Magic Router: Open Settings`

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `magicrouter.baseUrl` | `https://api.aixrouter.com` | Magic Router gateway Base URL. Claude requests use `/claude/v1/messages`; other chat requests use `/openai/v1/chat/completions`. |
| `magicrouter.models` | `[]` | Optional pinned model list. Leave empty to load from `/openai/v1/models`. |
| `magicrouter.maxTokens` | `0` | Maximum completion tokens. `0` means provider default. |
| `magicrouter.temperature` | `null` | Optional temperature. |
| `magicrouter.reasoningEffort` | `high` | Default reasoning effort for models that expose thinking mode. |
| `magicrouter.enrichPublicModelMetadata` | `true` | Enrich cost, multimodal, and context metadata from the public model catalog for AIXRouter and AgileRouter base URLs. |
| `magicrouter.debug` | `false` | Write request diagnostics to the output channel. Prompt text is not logged. |

## Development

```bash
pnpm install
pnpm run compile
pnpm run package
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT
