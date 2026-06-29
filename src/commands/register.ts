import * as vscode from 'vscode';
import { AuthStore } from '../auth.js';
import { AIXRouterChatProvider } from '../provider/provider.js';
import { scheduleOpenRouterRefresh } from '../models/openrouterFallback.js';
import { scheduleLiteLLMRefresh } from '../models/litellmFallback.js';
import {
  getMetadataLiteLLMRefreshHours,
  getMetadataOpenRouterRefreshHours,
} from '../config.js';

export function registerCommands(
  context: vscode.ExtensionContext,
  auth: AuthStore,
  provider: AIXRouterChatProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('aixrouter.setBaseUrl', async () => {
      const { setBaseUrl } = await import('../config.js');
      await setBaseUrl();
      provider.refreshModelPicker();
    }),
    vscode.commands.registerCommand('aixrouter.setApiKey', async () => {
      await auth.setApiKey();
      provider.refreshModelPicker();
    }),
    vscode.commands.registerCommand('aixrouter.clearApiKey', async () => {
      await auth.clearApiKey();
      provider.refreshModelPicker();
    }),
    vscode.commands.registerCommand('aixrouter.refreshModels', () => {
      provider.refreshModelPicker();
      vscode.window.showInformationMessage('AIXRouter model list refreshed.');
    }),
    vscode.commands.registerCommand('aixrouter.forceRefreshMetadata', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'AIXRouter: Refreshing model metadata…',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Fetching OpenRouter + LiteLLM…' });
          // Force-bypass TTL/ETag on both remote sources in parallel.
          const openrouter =
            scheduleOpenRouterRefresh(getMetadataOpenRouterRefreshHours() * 3_600_000, true) ?? Promise.resolve();
          const litellm =
            scheduleLiteLLMRefresh(getMetadataLiteLLMRefreshHours() * 3_600_000, true) ?? Promise.resolve();
          await Promise.allSettled([openrouter, litellm]);

          // Reload the AIXRouter model list so the freshly-fetched metadata
          // flows through the enrichment pipeline on the next picker open.
          progress.report({ message: 'Reloading AIXRouter models…' });
          provider.refreshModelPicker();
        },
      );
      vscode.window.showInformationMessage('AIXRouter: Model metadata refreshed.');
    }),
    vscode.commands.registerCommand('aixrouter.openSettings', async () => {
      const { openSettings } = await import('../config.js');
      await openSettings();
    }),
    vscode.lm.registerLanguageModelChatProvider('aixrouter', provider),
  );
}
