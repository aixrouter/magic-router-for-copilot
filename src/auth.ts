import * as vscode from 'vscode';

const SECRET_KEY = 'aixrouter-copilot.apiKey';

export class AuthStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  getApiKey(): Thenable<string | undefined> {
    return this.secrets.get(SECRET_KEY);
  }

  async hasApiKey(): Promise<boolean> {
    return Boolean(await this.getApiKey());
  }

  async setApiKey(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: 'AIX Router API Key',
      prompt: 'Paste your AIX Router API key. It will be stored in VS Code SecretStorage.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (input) => (input.trim() ? undefined : 'API Key is required.'),
    });

    if (value === undefined) {
      return;
    }

    await this.secrets.store(SECRET_KEY, value.trim());
    vscode.window.showInformationMessage('AIX Router API Key saved.');
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    vscode.window.showInformationMessage('AIX Router API Key cleared.');
  }
}
