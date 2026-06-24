import type { StreamHandlers, ChatToolCall } from '../types.js';

export interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
  argumentsFallback?: string;
}

export function processSseData(
  data: string,
  toolCalls: Map<number, ToolCallAccumulator>,
  handlers: StreamHandlers,
): void {
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    return;
  }

  if (json.usage) {
    handlers.onUsage(json.usage);
  }

  const delta = json.choices?.[0]?.delta;
  if (!delta) {
    return;
  }

  if (typeof delta.content === 'string' && delta.content.length > 0) {
    handlers.onText(delta.content);
  }

  const thinking = delta.reasoning_content ?? delta.reasoning;
  if (typeof thinking === 'string' && thinking.length > 0) {
    handlers.onThinking(thinking);
  }

  for (const rawToolCall of delta.tool_calls ?? []) {
    const index = rawToolCall.index ?? toolCalls.size;
    const current = toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
    applyToolCallDelta(current, rawToolCall);
    toolCalls.set(index, current);
  }
}

export function applyToolCallDelta(current: ToolCallAccumulator, rawToolCall: any): void {
  if (rawToolCall.id) {
    current.id = rawToolCall.id;
  }
  if (rawToolCall.function?.name) {
    current.name = rawToolCall.function.name;
  }
  const rawArguments = rawToolCall.function?.arguments;
  if (typeof rawArguments === 'string') {
    current.arguments += rawArguments;
  } else if (rawArguments !== undefined) {
    current.arguments += JSON.stringify(rawArguments);
  }
}

export function flushToolCalls(
  toolCalls: Map<number, ToolCallAccumulator>,
  handlers: StreamHandlers,
): void {
  for (const [index, toolCall] of [...toolCalls.entries()].sort(([a], [b]) => a - b)) {
    if (!toolCall.name) {
      continue;
    }
    handlers.onToolCall({
      id: toolCall.id || `call_${index}`,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments || toolCall.argumentsFallback || '{}',
      },
    });
  }
  toolCalls.clear();
}

export async function processOpenAIFullResponse(
  response: Response,
  handlers: StreamHandlers,
): Promise<void> {
  const body = await response.text();
  const toolCalls = new Map<number, ToolCallAccumulator>();
  let emitted = false;

  try {
    const json = JSON.parse(body) as any;
    if (json.usage) {
      handlers.onUsage(json.usage);
    }

    const choice = json.choices?.[0];
    const message = choice?.message ?? choice?.delta ?? json.message ?? json;
    const text = extractText(message?.content ?? message?.text ?? json.text ?? json.response);
    if (text) {
      handlers.onText(text);
      emitted = true;
    }

    const thinking = extractText(message?.reasoning_content ?? message?.reasoning ?? message?.thinking);
    if (thinking) {
      handlers.onThinking(thinking);
      emitted = true;
    }

    for (const rawToolCall of message?.tool_calls ?? []) {
      const index = rawToolCall.index ?? toolCalls.size;
      const current = toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
      applyToolCallDelta(current, rawToolCall);
      toolCalls.set(index, current);
    }
  } catch {
    // Fall through to the empty response error below with a body preview.
  }

  const emittedTools = [...toolCalls.values()].some((toolCall) => Boolean(toolCall.name));
  flushToolCalls(toolCalls, handlers);
  if (!emitted && !emittedTools) {
    throw emptyResponseError('OpenAI response', body);
  }
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.length > 0 ? value : undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (typeof part?.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('');
  return text.length > 0 ? text : undefined;
}

function emptyResponseError(source: string, preview: string): Error {
  const normalized = preview.replace(/\s+/g, ' ').trim().slice(0, 800);
  const suffix = normalized ? ` Response preview: ${normalized}` : '';
  return new Error(`AIXRouter ${source} did not contain any assistant text or tool call.${suffix}`);
}
