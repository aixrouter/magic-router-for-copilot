import * as vscode from 'vscode';
import { AuthStore } from './auth';
import { Logger } from './logger';
import { AIXRouterChatProvider } from './provider/provider';
import { registerCommands } from './commands/register';
import { promptForInitialConfiguration } from './commands/setup';
import { onConfigChanged } from './config';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger();
  const auth = new AuthStore(context.secrets);
  const provider = new AIXRouterChatProvider(auth, logger);

  context.subscriptions.push(logger, provider);
  context.subscriptions.push(onConfigChanged(() => provider.refreshModelPicker()));

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
