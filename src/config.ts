import * as vscode from 'vscode';
import type { AIXRouterModelConfig } from './types';

const SECTION = 'aixrouter';
const DEFAULT_BASE_URL = 'https://api.aixrouter.com';

export function getBaseUrl(): string {
  return trimTrailingSlash(getConfig().get('baseUrl', DEFAULT_BASE_URL));
}

export function hasBaseUrl(): boolean {
  return getBaseUrl().length > 0;
}

export async function setBaseUrl(): Promise<boolean> {
  const value = await vscode.window.showInputBox({
    title: 'AIXRouter Base URL',
    prompt: 'Enter your AIXRouter gateway base URL, for example https://api.aixrouter.com.',
    value: getBaseUrl(),
    ignoreFocusOut: true,
    validateInput: (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        return 'Base URL is required.';
      }
      try {
        const url = new URL(trimmed);
        return url.protocol === 'https:' || url.protocol === 'http:'
          ? undefined
          : 'Base URL must start with http:// or https://.';
      } catch {
        return 'Enter a valid URL.';
      }
    },
  });

  if (value === undefined) {
    return false;
  }

  await getConfig().update('baseUrl', trimTrailingSlash(value.trim()), vscode.ConfigurationTarget.Global);
  return true;
}

export function getPinnedModels(): AIXRouterModelConfig[] {
  const models = getConfig().get<AIXRouterModelConfig[]>('models', []);
  return models.filter((model) => model.id);
}

export function getMaxTokens(): number | undefined {
  const value = getConfig().get('maxTokens', 0);
  return value > 0 ? value : undefined;
}

export function getTemperature(): number | undefined {
  const value = getConfig().get<number | null>('temperature', null);
  return typeof value === 'number' ? value : undefined;
}

export function getReasoningEffort(): 'low' | 'medium' | 'high' | 'max' {
  return getConfig().get<'low' | 'medium' | 'high' | 'max'>('reasoningEffort', 'high');
}

export function getDebugEnabled(): boolean {
  return getConfig().get('debug', false);
}

export function getPublicModelMetadataEnabled(): boolean {
  return getConfig().get('enrichPublicModelMetadata', true);
}

export function onConfigChanged(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SECTION)) {
      listener();
    }
  });
}

export function openSettings(): Thenable<unknown> {
  return vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${vscode.extensions.getExtension('aixrouter.aixrouter-for-copilot')?.id ?? SECTION}`);
}

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
