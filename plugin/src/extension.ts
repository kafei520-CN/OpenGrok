import * as vscode from 'vscode';
import { registerChatView } from './chat/chatView';
import { COMMANDS } from './core/constants';
import { GrokController } from './chat/controller';
import { logInfo } from './core/logger';
import { createVscodePlatform } from './core/platform/vscodePlatform';

export function activate(context: vscode.ExtensionContext): void {
  const controller = new GrokController(createVscodePlatform(context));
  logInfo('Grok Build extension activating');
  context.subscriptions.push(controller);
  registerChatView(context, controller);

  const register = (
    command: string,
    handler: (...args: never[]) => unknown,
  ) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  register(COMMANDS.newSession, () => controller.newSession());
  register(COMMANDS.login, () => controller.login());
  register(COMMANDS.logout, () => controller.logout());
  register(COMMANDS.setApiKey, () => controller.setApiKey());
  register(COMMANDS.addSelection, () => controller.addSelection());
  register(COMMANDS.addActiveFile, () => controller.addActiveFile());
  register(COMMANDS.addFiles, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
    const list = (uris?.length ? uris : uri ? [uri] : []).map((item) => item.fsPath);
    await controller.addFiles(list);
  });
  register(COMMANDS.restartAgent, () => controller.restart());
  register(COMMANDS.showLog, () => controller.showLog());
  register(COMMANDS.cancel, () => controller.cancelTurn());
  register(COMMANDS.compact, () => controller.compact());
  register(COMMANDS.rewind, () => controller.rewind());
  register(COMMANDS.resume, () => controller.resumePicker());
  register(COMMANDS.cycleMode, () => controller.cycleMode());
  register(COMMANDS.fork, () => controller.send('/fork'));
  register(COMMANDS.export, () => controller.exportChat());
  register(COMMANDS.usage, () => controller.send('/usage'));

  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    80,
  );
  status.text = '$(sparkle) Grok';
  status.tooltip = 'Open Grok Build';
  status.command = COMMANDS.openChat;
  status.show();
  context.subscriptions.push(status);
}

export function deactivate(): void {
  logInfo('Grok Build extension deactivated');
}
