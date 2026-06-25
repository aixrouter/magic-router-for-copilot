import * as vscode from 'vscode';
import { AuthStore } from '../auth.js';
import {
  getBaseUrl,
  hasBaseUrl,
  getMaxTokens,
  getPinnedModels,
  getPublicModelMetadataEnabled,
  getReasoningEffort,
  getTemperature,
} from '../config.js';
import { AIXRouterClient } from '../client/aixrouterClient.js';
import { convertMessages, convertTools, estimateTokenCount, summarizeMessageParts } from '../convert.js';
import { Logger } from '../logger.js';
import type { AIXRouterModelConfig, ChatCompletionRequest, ChatToolCall } from '../types.js';
import {
  toChatInfo,
  toSetupChatInfo,
  getModelRouteHint,
  getContextWindowOptions,
  type ModelPickerInfo,
} from './modelInfo.js';

type ModelOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  readonly modelConfiguration?: Record<string, unknown>;
  readonly configuration?: Record<string, unknown>;
};

export class AIXRouterChatProvider implements vscode.LanguageModelChatProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  private cachedModels: AIXRouterModelConfig[] = [];
  private modelLoadPromise?: Promise<AIXRouterModelConfig[]>;
  private modelLoadGeneration = 0;
  private lastModelLoadError?: string;

  constructor(
    private readonly auth: AuthStore,
    private readonly logger: Logger,
  ) {}

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }

  refreshModelPicker(): void {
    this.cachedModels = [];
    this.modelLoadPromise = undefined;
    this.modelLoadGeneration += 1;
    this.onDidChangeEmitter.fire();
  }

  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const hasKey = await this.auth.hasApiKey();
    const hasUrl = hasBaseUrl();
    const pinned = getPinnedModels();

    if (pinned.length > 0) {
      return pinned.map((model) => toChatInfo(model, hasKey, hasUrl));
    }

    if (!hasUrl || !hasKey) {
      return [toSetupChatInfo(hasUrl, hasKey)];
    }

    if (this.cachedModels.length === 0) {
      const generation = this.modelLoadGeneration;
      this.modelLoadPromise ??= this.loadModels(token);
      const loaded = await this.modelLoadPromise;
      // Discard stale results if refreshModelPicker() was called while loading.
      if (generation === this.modelLoadGeneration) {
        this.cachedModels = loaded;
      }
      this.modelLoadPromise = undefined;
    }

    return this.cachedModels.map((model) => toChatInfo(model, hasKey, hasUrl));
  }

  async provideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = await this.auth.getApiKey();
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
      throw new Error('AIXRouter Base URL is not configured. Run "AIXRouter: Set Base URL" first.');
    }
    if (!apiKey) {
      throw new Error('AIXRouter API Key is not configured. Run "AIXRouter: Set API Key" first.');
    }

    const model = this.resolveModel(modelInfo.id);
    const abort = new AbortController();
    const disposable = token.onCancellationRequested(() => abort.abort());

    try {
      const request = this.createRequest(model, messages, options as ModelOptions);
      const selectedContext = getConfiguredContextWindow(model, options as ModelOptions);
      this.logger.debug(`Model capabilities id=${model.id} vision=${model.vision === true} thinking=${model.thinking === true} toolCalling=${model.toolCalling !== false}`);
      this.logger.debug(`VS Code modelInfo capabilities imageInput=${modelInfo.capabilities.imageInput === true} toolCalling=${modelInfo.capabilities.toolCalling ?? false}`);
      this.logger.debug(`POST model=${request.model} messages=${request.messages.length} images=${countImageParts(request)} tools=${request.tools?.length ?? 0} context=${selectedContext ?? 'default'}`);
      this.logger.debug(`Input parts ${summarizeMessageParts(messages)}`);

      await new AIXRouterClient(baseUrl, apiKey, true, (message) => this.logger.debug(message)).streamChatCompletion(
        request,
        getModelRouteHint(model),
        {
          onText: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
          onThinking: (text) => reportThinking(progress, text),
          onToolCall: (toolCall) => reportToolCall(progress, toolCall),
          onUsage: (usage) => reportUsage(progress, usage),
        },
        abort.signal,
      );
    } catch (error) {
      this.logger.error('Chat completion failed', error);
      throw error;
    } finally {
      disposable.dispose();
    }
  }

  async provideTokenCount(
    _modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return estimateTokenCount(text);
  }

  private async loadModels(token: vscode.CancellationToken): Promise<AIXRouterModelConfig[]> {
    const apiKey = await this.auth.getApiKey();
    const baseUrl = getBaseUrl();
    if (!apiKey || !baseUrl) {
      return [];
    }

    const abort = new AbortController();
    const disposable = token.onCancellationRequested(() => abort.abort());

    try {
      const models = await new AIXRouterClient(baseUrl, apiKey, getPublicModelMetadataEnabled()).listModels(abort.signal);
      this.logger.info(`Loaded ${models.length} AIXRouter model(s).`);
      this.lastModelLoadError = undefined;
      return models;
    } catch (error) {
      this.logger.error('Failed to load models from AIXRouter', error);
      this.notifyModelLoadError(error);
      return [];
    } finally {
      disposable.dispose();
    }
  }

  private notifyModelLoadError(error: unknown): void {
    const message = getErrorMessage(error);
    if (this.lastModelLoadError === message) {
      return;
    }

    this.lastModelLoadError = message;
    void vscode.window.showWarningMessage(
      `Could not load AIXRouter models. ${message}`,
      'Set API Key',
      'Set Base URL',
      'Open Settings',
    ).then(async (action) => {
      if (action === 'Set API Key') {
        await vscode.commands.executeCommand('aixrouter.setApiKey');
      } else if (action === 'Set Base URL') {
        await vscode.commands.executeCommand('aixrouter.setBaseUrl');
      } else if (action === 'Open Settings') {
        await vscode.commands.executeCommand('aixrouter.openSettings');
      }
    });
  }

  private resolveModel(modelId: string): AIXRouterModelConfig {
    return [...getPinnedModels(), ...this.cachedModels].find((model) => model.id === modelId) ?? {
      id: modelId,
      name: modelId,
      toolCalling: true,
      vision: false,
      thinking: false,
    };
  }

  private createRequest(
    model: AIXRouterModelConfig,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: ModelOptions,
  ): ChatCompletionRequest {
    const tools = model.toolCalling === false ? undefined : convertTools(options.tools);
    // Only send max_tokens when the user explicitly sets aixrouter.maxTokens > 0,
    // so that 0 means "provider default" as documented.
    const maxTokens = getMaxTokens();
    const contextWindow = getConfiguredContextWindow(model, options);
    const temperature = getTemperature();
    const reasoningEffort = getConfiguredReasoningEffort(model, options);

    return {
      model: model.id,
      messages: convertMessages(messages),
      stream: true,
      tools,
      tool_choice: tools?.length ? 'auto' : undefined,
      max_tokens: maxTokens,
      context_window: contextWindow,
      temperature,
      reasoning_effort: reasoningEffort,
    };
  }
}

function countImageParts(request: ChatCompletionRequest): number {
  return request.messages.reduce((count, message) => {
    if (!Array.isArray(message.content)) {
      return count;
    }
    return count + message.content.filter((part) => part.type === 'image_url').length;
  }, 0);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getConfiguredReasoningEffort(
  model: AIXRouterModelConfig,
  options: ModelOptions,
): 'low' | 'medium' | 'high' | 'max' | undefined {
  if (!model.thinking) {
    return undefined;
  }

  const configured =
    options.modelConfiguration?.reasoningEffort ??
    options.configuration?.reasoningEffort ??
    getReasoningEffort();

  if (configured === 'none') {
    return undefined;
  }
  if (
    configured === 'low' ||
    configured === 'medium' ||
    configured === 'high' ||
    configured === 'max'
  ) {
    return configured;
  }
  return 'medium';
}

function getConfiguredContextWindow(
  model: AIXRouterModelConfig,
  options: ModelOptions,
): number | undefined {
  const configured =
    options.modelConfiguration?.contextWindow ??
    options.configuration?.contextWindow;

  if (typeof configured !== 'string' || configured === 'default') {
    return undefined;
  }

  const value = Number(configured);
  return getContextWindowOptions(model).includes(value) ? value : undefined;
}

function reportThinking(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  text: string,
): void {
  const ThinkingPart = (vscode as any).LanguageModelThinkingPart;
  if (typeof ThinkingPart === 'function') {
    progress.report(new ThinkingPart(text) as vscode.LanguageModelResponsePart);
  }
}

function reportToolCall(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  toolCall: ChatToolCall,
): void {
  let input: object = {};
  try {
    const parsed = JSON.parse(toolCall.function.arguments || '{}');
    input = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    input = {};
  }

  progress.report(
    new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, input),
  );
}

function reportUsage(
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
): void {
  const DataPart = (vscode as any).LanguageModelDataPart;
  if (typeof DataPart !== 'function') {
    return;
  }

  progress.report(
    new DataPart(
      new TextEncoder().encode(JSON.stringify(usage)),
      'usage',
    ) as vscode.LanguageModelResponsePart,
  );
}
