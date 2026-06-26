import * as vscode from 'vscode';
import type { AIXRouterModelConfig, ReasoningEffort } from '../types.js';
import { toModelCostInfo } from '../models/pricing.js';
import { getReasoningEffort } from '../config.js';

const DEFAULT_REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
};
const REASONING_EFFORT_DESCRIPTIONS: Record<ReasoningEffort, string> = {
  low: 'Faster responses with less reasoning',
  medium: 'Balanced reasoning and speed',
  high: 'Greater reasoning depth but slower',
  xhigh: 'Extra reasoning depth for complex tasks',
  max: 'Absolute maximum capability with no constraints',
};

type ModelPickerInfo = vscode.LanguageModelChatInformation & {
  readonly isBYOK?: true;
  readonly isUserSelectable?: boolean;
  readonly statusIcon?: vscode.ThemeIcon;
  readonly configurationSchema?: object;
  readonly inputCost?: string;
  readonly outputCost?: string;
  readonly cacheCost?: string;
  readonly priceCategory?: 'low' | 'medium' | 'high' | 'very_high';
};

export type { ModelPickerInfo };

export function toChatInfo(model: AIXRouterModelConfig, hasKey: boolean, hasUrl: boolean): ModelPickerInfo {
  const configured = hasKey && hasUrl;
  return {
    id: model.id,
    name: model.name || model.id,
    family: 'aixrouter',
    version: model.version || 'aixrouter',
    maxInputTokens: model.maxInputTokens ?? 128000,
    maxOutputTokens: model.maxOutputTokens ?? 8192,
    detail: configured ? 'AIXRouter BYOK' : getSetupDetail(hasUrl, hasKey),
    tooltip: configured ? `${model.id} via AIXRouter` : getSetupDetail(hasUrl, hasKey),
    isBYOK: true,
    isUserSelectable: configured,
    statusIcon: configured ? undefined : new vscode.ThemeIcon('warning'),
    capabilities: {
      toolCalling: model.toolCalling !== false,
      imageInput: model.vision === true,
    },
    ...toModelCostInfo(model),
    ...toConfigurationSchema(model),
  } as ModelPickerInfo;
}

export function toSetupChatInfo(hasUrl: boolean, hasKey: boolean): ModelPickerInfo {
  return {
    id: 'setup-required',
    name: 'Configure AIXRouter',
    family: 'aixrouter',
    version: 'setup',
    maxInputTokens: 1,
    maxOutputTokens: 1,
    detail: getSetupDetail(hasUrl, hasKey),
    tooltip: getSetupDetail(hasUrl, hasKey),
    isBYOK: true,
    isUserSelectable: false,
    statusIcon: new vscode.ThemeIcon('warning'),
    capabilities: {
      toolCalling: false,
      imageInput: false,
    },
  } as ModelPickerInfo;
}

export function getSetupDetail(hasUrl: boolean, hasKey: boolean): string {
  if (!hasUrl && !hasKey) {
    return 'Run AIXRouter: Set Base URL, then AIXRouter: Set API Key';
  }
  if (!hasUrl) {
    return 'Run AIXRouter: Set Base URL';
  }
  return 'Run AIXRouter: Set API Key';
}

export function getModelRouteHint(model: AIXRouterModelConfig): string {
  return [model.id, model.name, model.family, model.sourceType]
    .filter(Boolean)
    .join(' ');
}

export function getContextWindowOptions(model: AIXRouterModelConfig): number[] {
  const configured = model.contextWindows ?? [];
  const maxInputTokens = model.maxInputTokens ?? 0;
  const inferred = configured.length > 0
    ? configured
    : [200000, 400000, 1000000].filter((value) => value <= maxInputTokens);

  return [...new Set(inferred)].sort((a, b) => a - b);
}

export function formatContextWindow(value: number): string {
  if (value >= 1000000) {
    return `${value / 1000000}M`;
  }
  return `${Math.round(value / 1000)}K`;
}

function toConfigurationSchema(model: AIXRouterModelConfig): { configurationSchema?: object } {
  const properties: Record<string, object> = {};

  if (model.thinking) {
    properties.reasoningEffort = buildReasoningEffortProperty(model);
  }

  const contextWindows = getContextWindowOptions(model);
  if (contextWindows.length > 0) {
    properties.contextWindow = buildContextWindowProperty(contextWindows);
  }

  return Object.keys(properties).length > 0
    ? { configurationSchema: { properties } }
    : {};
}

function buildReasoningEffortProperty(model: AIXRouterModelConfig): object {
  const efforts = getReasoningEffortOptions(model);
  const configuredDefault = getReasoningEffort();
  const defaultValue = efforts.includes(configuredDefault) ? configuredDefault : efforts[0] ?? 'high';

  return {
    type: 'string',
    title: '思考工作量',
    enum: efforts,
    enumItemLabels: efforts.map((effort) => REASONING_EFFORT_LABELS[effort]),
    enumDescriptions: efforts.map((effort) => REASONING_EFFORT_DESCRIPTIONS[effort]),
    default: defaultValue,
    group: 'navigation',
  };
}

export function getReasoningEffortOptions(model: AIXRouterModelConfig): readonly ReasoningEffort[] {
  const configured = model.supportsReasoningEffort?.filter(isReasoningEffort) ?? [];
  return configured.length > 0 ? [...new Set(configured)] : DEFAULT_REASONING_EFFORTS;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}

function buildContextWindowProperty(contextWindows: number[]): object {
  const enumValues = ['default', ...contextWindows.map(String)];
  return {
    type: 'string',
    title: '上下文大小',
    enum: enumValues,
    enumItemLabels: ['Default', ...contextWindows.map(formatContextWindow)],
    enumDescriptions: [
      'Use the provider default context budget',
      ...contextWindows.map((value) => `${formatContextWindow(value)} context budget`),
    ],
    default: contextWindows.at(-1)?.toString() ?? 'default',
  };
}
