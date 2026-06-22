# AIX Router for Copilot

Use AIX Router models directly from the GitHub Copilot Chat model picker.

AIX Router for Copilot does not replace Copilot Chat or add a separate chat UI. It registers AIX Router as a Copilot language model provider, so you can keep using Copilot Chat, Agent mode, workspace context, instructions, and tools while sending model requests through your own OpenAI-compatible router endpoint.

## Features

- Adds AIX Router models to the Copilot Chat model picker.
- Uses your own API key, stored in VS Code SecretStorage.
- Prompts for Base URL and API key on first setup.
- Loads models from `{baseUrl}/models`.
- Sends chat requests to `{baseUrl}/chat/completions`.
- Supports OpenAI-compatible streaming, tool calls, image input, and reasoning output.
- Enriches model metadata with cost, vendor, multimodal, thinking, and context options when available.

## Requirements

- VS Code 1.116 or newer.
- GitHub Copilot Chat installed and signed in.
- An OpenAI-compatible AIX Router endpoint and API key.

## Quick Start

1. Install the extension.
2. Run `AIX Router: Set Base URL`.
3. Enter your OpenAI-compatible Base URL, for example `https://api.example.com/openai/v1`.
4. Run `AIX Router: Set API Key`.
5. Open Copilot Chat and choose an AIX Router model from the model picker.

## Commands

- `AIX Router: Set Base URL`
- `AIX Router: Set API Key`
- `AIX Router: Clear API Key`
- `AIX Router: Refresh Models`
- `AIX Router: Open Settings`

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `aixrouter-copilot.baseUrl` | empty | OpenAI-compatible Base URL. |
| `aixrouter-copilot.models` | `[]` | Optional pinned model list. Leave empty to load from `/models`. |
| `aixrouter-copilot.maxTokens` | `0` | Maximum completion tokens. `0` means provider default. |
| `aixrouter-copilot.temperature` | `null` | Optional temperature. |
| `aixrouter-copilot.reasoningEffort` | `high` | Default reasoning effort for models that expose thinking mode. |
| `aixrouter-copilot.debug` | `false` | Write request diagnostics to the output channel. Prompt text is not logged. |

## Development

```bash
npm install
npm run compile
npm run package
```

Press `F5` in VS Code to launch an Extension Development Host.

## License

MIT
