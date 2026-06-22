import * as vscode from 'vscode';
import { getDebugEnabled } from './config';

export class Logger {
  private readonly channel = vscode.window.createOutputChannel('AIX Router for Copilot');

  dispose(): void {
    this.channel.dispose();
  }

  info(message: string): void {
    this.channel.appendLine(`[info] ${message}`);
  }

  debug(message: string): void {
    if (getDebugEnabled()) {
      this.channel.appendLine(`[debug] ${message}`);
    }
  }

  error(message: string, error?: unknown): void {
    this.channel.appendLine(`[error] ${message}`);
    if (error) {
      this.channel.appendLine(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  }

  show(): void {
    this.channel.show();
  }
}
