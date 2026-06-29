import * as vscode from 'vscode';
import { AuthStore } from './auth';
import { Logger } from './logger';
import { AIXRouterChatProvider } from './provider/provider';
import { registerCommands } from './commands/register';
import { promptForInitialConfiguration } from './commands/setup';
import { onConfigChanged } from './config';
import { initMetadataCache, onMetadataChanged } from './models/metadataCache';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger();
  const auth = new AuthStore(context.secrets);
  // Wire up the shared metadata cache before constructing the provider so the
  // very first `listModels()` already sees any prior cached snapshot.
  initMetadataCache(context, (message) => logger.debug(message));
  const provider = new AIXRouterChatProvider(auth, logger);

  context.subscriptions.push(logger, provider);
  context.subscriptions.push(onConfigChanged(() => provider.refreshModelPicker()));
  // When a background metadata refresh delivers fresh data, ask VS Code to
  // re-query the model picker so newly known capabilities/context windows
  // appear without a manual reload.
  context.subscriptions.push(onMetadataChanged(() => provider.refreshModelPicker()));

  registerCommands(context, auth, provider);

  await activateCopilotChat(logger);
  void promptForInitialConfiguration(context, auth, provider);
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
