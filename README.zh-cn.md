# 魔法路由（AIXRouter for Copilot）

[English](README.md) | [简体中文](README.zh-cn.md)

在 GitHub Copilot Chat 模型选择器中直接使用魔法路由支持的模型，无需离开 Copilot Agent 模式。

喜欢魔法路由的统一中转能力，但不想放弃 GitHub Copilot 的 Agent 模式、工具调用、Instructions、MCP 和成熟的交互体验？本扩展将 OpenAI 兼容模型接入 Copilot Chat 模型选择器，支持视觉输入、思考模式和自带 API Key。

## 为什么选这个扩展？

- 不是替换 Copilot，而是增强 Copilot。没有新的侧边栏，没有新的聊天界面，只是在模型选择器中多出魔法路由模型。
- Agent 模式、工具调用、Instructions、MCP、Skills 仍然由 Copilot Chat 驱动，模型请求转发到你的 OpenAI 兼容路由接口。
- API Key 存在 VS Code SecretStorage 中，不写入 `settings.json`。
- 默认使用 `https://api.aixrouter.com` 作为网关 Base URL，也可以通过命令改成其他兼容网关。
- 魔法路由模型列表默认从 `/openai/v1/models` 动态读取，也可以用设置固定展示指定模型。
- 对 AIXRouter / AgileRouter Base URL，成本、多模态和上下文信息会从公开模型页补齐，并显示在 Copilot 的模型选择器中；也可以关闭该增强。
- 多模态模型会接收 Copilot Chat 中的图片附件，并按 OpenAI `image_url` 内容格式发送给路由接口。
- 支持 OpenAI 兼容流式输出、工具调用和 `reasoning_content` 思考内容；Claude、GPT、Gemini 等主流模型会按 Copilot 风格显示思考工作量选项。

## 前置条件

- VS Code 1.116 及以上版本。
- 已安装并登录 GitHub Copilot / Copilot Chat。
- OpenAI 兼容路由 API Key。

## 快速开始

1. 在 VS Code 中安装并启用扩展。
2. 运行命令 `AIXRouter: Set API Key`，粘贴你的 API Key。
3. 打开 Copilot Chat，点击模型选择器。
4. 选择 AIXRouter 提供的模型，开始使用 Agent 模式。

扩展默认使用 `https://api.aixrouter.com` 作为网关 Base URL。如需使用其他兼容网关，运行 `AIXRouter: Set Base URL` 修改。

常用 Base URL：

| 服务 | Base URL |
| --- | --- |
| AIXRouter | `https://api.aixrouter.com` |
| AgileRouter | `https://api.agilerouter.com` |

## API 路由

AIXRouter 会把 `aixrouter.baseUrl` 视为网关根地址。默认 `https://api.aixrouter.com` 下，模型列表从 `https://api.aixrouter.com/openai/v1/models` 加载。Claude 请求使用 Anthropic Messages 格式发送到 `https://api.aixrouter.com/claude/v1/messages`，其他对话请求发送到 `https://api.aixrouter.com/openai/v1/chat/completions`。

## 设置项

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `aixrouter.baseUrl` | `https://api.aixrouter.com` | AIXRouter 网关 Base URL。Claude 请求使用 `/claude/v1/messages`，其他对话请求使用 `/openai/v1/chat/completions` |
| `aixrouter.models` | `[]` | 固定模型列表。留空时从 `/openai/v1/models` 动态读取 |
| `aixrouter.maxTokens` | `0` | 最大输出 Token，`0` 表示不限制 |
| `aixrouter.temperature` | `null` | 可选温度参数 |
| `aixrouter.reasoningEffort` | `high` | 支持思考模型的默认思考强度 |
| `aixrouter.enrichPublicModelMetadata` | `true` | 对 AIXRouter / AgileRouter Base URL，从公开模型页补齐成本、多模态和上下文信息 |
| `aixrouter.debug` | `false` | 输出调试日志，不记录完整提示词 |

固定模型示例：

```json
{
  "aixrouter.models": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o via AIXRouter",
      "family": "openai",
      "maxInputTokens": 128000,
      "maxOutputTokens": 8192,
      "toolCalling": true,
      "vision": true,
      "thinking": false
    },
    {
      "id": "deepseek-r1",
      "name": "DeepSeek R1 via AIXRouter",
      "family": "deepseek",
      "maxInputTokens": 128000,
      "maxOutputTokens": 8192,
      "toolCalling": true,
      "vision": false,
      "thinking": true
    }
  ]
}
```

## 开发

```bash
pnpm install
pnpm run compile
```

然后在 VS Code 中按 `F5` 启动 Extension Development Host。

## 说明

认证方式为 `Authorization: Bearer <your-api-key>`。本扩展从 `{baseUrl}/openai/v1/models` 加载模型；Claude 请求使用 Anthropic Messages 格式发送到 `{baseUrl}/claude/v1/messages`，其他对话请求发送到 `{baseUrl}/openai/v1/chat/completions`。公开模型页只用于补充元数据：当 Base URL 属于 `aixrouter.com` 时访问 `https://www.aixrouter.com/models`，属于 `agilerouter.com` 时访问 `https://www.agilerouter.com/models`；其他域名不会访问这两个页面。
