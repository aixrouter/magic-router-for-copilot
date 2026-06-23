# AIXRouter

[English](README.md) | [简体中文](README.zh-cn.md)

Use AIXRouter models directly from the GitHub Copilot Chat model picker.

AIXRouter does not replace Copilot Chat or add a separate chat UI. It registers AIXRouter as a Copilot language model provider, so you can keep using Copilot Chat, Agent mode, workspace context, instructions, and tools while sending model requests through your own OpenAI-compatible router endpoint.

## Features

- Adds AIXRouter models to the Copilot Chat model picker.
- Uses your own API key, stored in VS Code SecretStorage.
- Prompts for Base URL and API key on first setup.
- Loads models from `{baseUrl}/models`.
- Sends chat requests to `{baseUrl}/chat/completions`.
- Supports OpenAI-compatible streaming, tool calls, image input, and reasoning output.
- Enriches model metadata with cost, vendor, multimodal, thinking, and context options for supported AIXRouter and AgileRouter base URLs when enabled.

## Requirements

- VS Code 1.116 or newer.
- GitHub Copilot Chat installed and signed in.
- An OpenAI-compatible AIXRouter endpoint and API key.

## Quick Start

1. Install the extension.
2. Run `AIXRouter: Set Base URL`.
3. Enter your OpenAI-compatible Base URL, for example `https://api.example.com/openai/v1`.
4. Run `AIXRouter: Set API Key`.
5. Open Copilot Chat and choose an AIXRouter model from the model picker.

Common Base URLs:

| Provider | Base URL |
| --- | --- |
| AIXRouter | `https://api.aixrouter.com/openai/v1` |
| AgileRouter | `https://api.agilerouter.com/openai/v1` |

## Commands

- `AIXRouter: Set Base URL`
- `AIXRouter: Set API Key`
- `AIXRouter: Clear API Key`
- `AIXRouter: Refresh Models`
- `AIXRouter: Open Settings`

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `aixrouter.baseUrl` | empty | OpenAI-compatible Base URL. |
| `aixrouter.models` | `[]` | Optional pinned model list. Leave empty to load from `/models`. |
| `aixrouter.maxTokens` | `0` | Maximum completion tokens. `0` means provider default. |
| `aixrouter.temperature` | `null` | Optional temperature. |
| `aixrouter.reasoningEffort` | `high` | Default reasoning effort for models that expose thinking mode. |
| `aixrouter.enrichPublicModelMetadata` | `true` | Enrich cost, multimodal, and context metadata from the public model catalog for AIXRouter and AgileRouter base URLs. |
| `aixrouter.debug` | `false` | Write request diagnostics to the output channel. Prompt text is not logged. |

## Recommended Model Metadata

`{baseUrl}/models` is the authoritative source for model availability. For the best Copilot model picker experience, each model can include capability, context, and pricing metadata:

```json
{
  "id": "claude-opus-4.6",
  "owned_by": "Anthropic",
  "type": "Multimodal",
  "contextWindow": 1000000,
  "maxOutputTokens": 32000,
  "capabilities": {
    "toolCalling": true,
    "vision": true,
    "thinking": true
  },
  "pricing": {
    "currencyCode": "USD",
    "inputPer1M": 5,
    "outputPer1M": 25,
    "cacheHitPer1M": 0.5,
    "cacheCreationPer1M": 0
  }
}
```

## Development

```bash
pnpm install
pnpm run compile
pnpm run package
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT
