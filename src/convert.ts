import * as vscode from 'vscode';
import { Buffer } from 'node:buffer';
import type { ChatMessage, ChatTool, ChatToolCall, OpenAIContentPart } from './types';

export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const message of messages) {
    const role = mapRole(message.role);
    const textParts: string[] = [];
    const contentParts: OpenAIContentPart[] = [];
    const toolCalls: ChatToolCall[] = [];
    const toolResults: Array<{ callId: string; content: string }> = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        textParts.push(part.value);
        contentParts.push({ type: 'text', text: part.value });
        continue;
      }

      if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
          },
        });
        continue;
      }

      if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input ?? {}),
          },
        });
        continue;
      }

      if (part instanceof vscode.LanguageModelToolResultPart) {
        toolResults.push({
          callId: part.callId,
          content: part.content.map(partToText).join('') || JSON.stringify(part.content),
        });
      }
    }

    if (role === 'assistant') {
      if (textParts.length > 0 || toolCalls.length > 0) {
        result.push({
          role,
          content: textParts.join(''),
          tool_calls: toolCalls.length ? toolCalls : undefined,
        });
      }
    } else if (contentParts.some((part) => part.type === 'image_url')) {
      result.push({ role, content: contentParts });
    } else if (textParts.length > 0) {
      result.push({ role, content: textParts.join('') });
    }

    for (const toolResult of toolResults) {
      result.push({
        role: 'tool',
        content: toolResult.content,
        tool_call_id: toolResult.callId,
      });
    }
  }

  return result;
}

export function convertTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
): ChatTool[] | undefined {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown> | undefined,
    },
  }));
}

export function estimateTokenCount(text: string | vscode.LanguageModelChatRequestMessage): number {
  const value =
    typeof text === 'string'
      ? text
      : text.content.map(partToText).join('');
  return Math.max(1, Math.ceil(value.length / 4));
}

function partToText(part: unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) {
    return part.value;
  }
  if (part instanceof vscode.LanguageModelDataPart) {
    return `[${part.mimeType}; ${part.data.byteLength} bytes]`;
  }
  return '';
}

function mapRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' {
  if (role === vscode.LanguageModelChatMessageRole.Assistant) {
    return 'assistant';
  }
  return 'user';
}
