# 魔法路由（Magic Router for Copilot）

在 GitHub Copilot Chat 模型选择器中直接使用魔法路由支持的模型，无需离开 Copilot Agent 模式。

喜欢魔法路由的统一中转能力，但不想放弃 GitHub Copilot 的 Agent 模式、工具调用、Instructions、MCP 和成熟的交互体验？本扩展将 OpenAI 兼容模型接入 Copilot Chat 模型选择器，支持视觉输入、思考模式和自带 API Key。

## 为什么选这个扩展？

- 不是替换 Copilot，而是增强 Copilot。没有新的侧边栏，没有新的聊天界面，只是在模型选择器中多出魔法路由模型。
- Agent 模式、工具调用、Instructions、MCP、Skills 仍然由 Copilot Chat 驱动，模型请求转发到你的 OpenAI 兼容路由接口。
- API Key 存在 VS Code SecretStorage 中，不写入 `settings.json`。
- 魔法路由模型列表默认从 `/models` 动态读取，也可以用设置固定展示指定模型。
- 成本信息会从公开模型页补齐，并显示在 Copilot 的成本列中。
- 多模态模型会接收 Copilot Chat 中的图片附件，并按 OpenAI `image_url` 内容格式发送给路由接口。
- 支持 OpenAI 兼容流式输出、工具调用和 `reasoning_content` 思考内容；Claude、GPT、Gemini 等主流模型会按 Copilot 风格显示思考工作量选项。

## 前置条件

- VS Code 1.116 及以上版本。
- 已安装并登录 GitHub Copilot / Copilot Chat。
- OpenAI 兼容路由 API Key。

## 快速开始

1. 在 VS Code 中安装并启用扩展。
2. 运行命令 `Magic Router: Set Base URL`，输入你的 OpenAI 兼容 Base URL。
3. 运行命令 `Magic Router: Set API Key`，粘贴你的 API Key。
4. 打开 Copilot Chat，点击模型选择器。
5. 选择 Magic Router 提供的模型，开始使用 Agent 模式。

## 设置项

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `aixrouter-copilot.baseUrl` | 空 | OpenAI 兼容 API Base URL，首次安装后由用户输入 |
| `aixrouter-copilot.models` | `[]` | 固定模型列表。留空时从 `/models` 动态读取 |
| `aixrouter-copilot.maxTokens` | `0` | 最大输出 Token，`0` 表示不限制 |
| `aixrouter-copilot.temperature` | `null` | 可选温度参数 |
| `aixrouter-copilot.reasoningEffort` | `high` | 支持思考模型的默认思考强度 |
| `aixrouter-copilot.debug` | `false` | 输出调试日志，不记录完整提示词 |

固定模型示例：

```json
{
  "aixrouter-copilot.models": [
    {
      "id": "gpt-4o",
      "name": "GPT-4o via Magic Router",
      "family": "openai",
      "maxInputTokens": 128000,
      "maxOutputTokens": 8192,
      "toolCalling": true,
      "vision": true,
      "thinking": false
    },
    {
      "id": "deepseek-r1",
      "name": "DeepSeek R1 via Magic Router",
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
npm install
npm run compile
```

然后在 VS Code 中按 `F5` 启动 Extension Development Host。

## 说明

认证方式为 `Authorization: Bearer <your-api-key>`。本扩展按 OpenAI 兼容协议调用 `{baseUrl}/models` 和 `{baseUrl}/chat/completions`。
