import * as vscode from 'vscode';
import { AuthStore } from './auth';
import { hasBaseUrl, openSettings, setBaseUrl } from './config';
import { Logger } from './logger';
import { AIXRouterChatProvider } from './provider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger();
  const auth = new AuthStore(context.secrets);
  const provider = new AIXRouterChatProvider(auth, logger);

  provider.registerConfigWatcher(context);

  context.subscriptions.push(
    logger,
    provider,
    vscode.commands.registerCommand('aixrouter-copilot.setBaseUrl', async () => {
      await setBaseUrl();
      provider.refreshModelPicker();
    }),
    vscode.commands.registerCommand('aixrouter-copilot.setApiKey', async () => {
      await auth.setApiKey();
      provider.refreshModelPicker();
    }),
    vscode.commands.registerCommand('aixrouter-copilot.clearApiKey', async () => {
      await auth.clearApiKey();
      provider.refreshModelPicker();
    }),
    vscode.commands.registerCommand('aixrouter-copilot.refreshModels', () => {
      provider.refreshModelPicker();
      vscode.window.showInformationMessage('Magic Router model list refreshed.');
    }),
    vscode.commands.registerCommand('aixrouter-copilot.openSettings', () => openSettings()),
    vscode.lm.registerLanguageModelChatProvider('aixrouter', provider),
  );

  await activateCopilotChat(logger);
  provider.refreshModelPicker();
  void promptForInitialConfiguration(auth, provider);
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered in activate.
}

async function activateCopilotChat(logger: Logger): Promise<void> {
  try {
    await vscode.extensions.getExtension('github.copilot-chat')?.activate();
  } catch (error) {
    logger.error('Could not activate GitHub Copilot Chat. The model picker may refresh later.', error);
  }
}

async function promptForInitialConfiguration(
  auth: AuthStore,
  provider: AIXRouterChatProvider,
): Promise<void> {
  if (hasBaseUrl() && await auth.hasApiKey()) {
    return;
  }

  const action = await vscode.window.showInformationMessage(
    'Configure Magic Router for Copilot to add models to Copilot Chat.',
    'Configure',
    'Later',
  );

  if (action !== 'Configure') {
    return;
  }

  if (!hasBaseUrl() && !await setBaseUrl()) {
    return;
  }

  if (!await auth.hasApiKey()) {
    await auth.setApiKey();
  }

  provider.refreshModelPicker();
}
