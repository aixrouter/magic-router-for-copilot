import * as vscode from 'vscode';
import { AuthStore } from '../auth';
import { hasBaseUrl, setBaseUrl, openSettings } from '../config';
import { AIXRouterChatProvider } from '../provider/provider';

const INITIAL_SETUP_PROMPT_KEY = 'aixrouter.initialSetupPromptShown';

export async function promptForInitialConfiguration(
  context: vscode.ExtensionContext,
  auth: AuthStore,
  provider: AIXRouterChatProvider,
): Promise<void> {
  if (hasBaseUrl() && (await auth.hasApiKey())) {
    return;
  }
  if (context.globalState.get<boolean>(INITIAL_SETUP_PROMPT_KEY, false)) {
    return;
  }

  await context.globalState.update(INITIAL_SETUP_PROMPT_KEY, true);

  const action = await vscode.window.showInformationMessage(
    'Configure AIXRouter for Copilot to add models to Copilot Chat.',
    'Configure',
    'Open Settings',
    'Later',
  );

  if (action === 'Open Settings') {
    await openSettings();
    return;
  }

  if (action !== 'Configure') {
    return;
  }

  if (!hasBaseUrl() && !(await setBaseUrl())) {
    return;
  }

  if (!(await auth.hasApiKey())) {
    await auth.setApiKey();
  }

  provider.refreshModelPicker();
}
