import * as vscode from 'vscode';
import { AuthStore } from '../auth.js';
import { AIXRouterChatProvider } from '../provider/provider.js';

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
    vscode.commands.registerCommand('aixrouter.openSettings', async () => {
      const { openSettings } = await import('../config.js');
      await openSettings();
    }),
    vscode.lm.registerLanguageModelChatProvider('aixrouter', provider),
  );
}
