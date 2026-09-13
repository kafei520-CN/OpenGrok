import { randomBytes } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { COMMANDS, VIEW_ID } from '../core/constants';
import type { GrokController } from './controller';
import { dispatchUi } from './dispatch';
import { logInfo } from '../core/logger';
import type { ChatState, WebviewToHost } from '../core/types';
import { bindChatWebview } from '../core/platform/vscodePlatform';

export class GrokChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = VIEW_ID;
  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];
  private lastAlive = 0;
  private wakeAt = 0;
  private wired = false;
  private reviving = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: GrokController,
  ) {
    this.disposables.push(
      controller.onDidChange((state) => this.postState(state)),
      controller.onDidStream((tail) => {
        void this.view?.webview.postMessage(tail);
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    logInfo('webview resolved');
    this.view = webviewView;
    const webview = webviewView.webview;
    bindChatWebview(webview);
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
        vscode.Uri.file(path.join(os.homedir(), '.grok')),
      ],
    };
    if (!this.wired) {
      this.wired = true;
      const watch = setInterval(() => this.watchdog(), 15_000);
      this.disposables.push(
        webview.onDidReceiveMessage((message: WebviewToHost) => {
          void this.onMessage(message);
        }),
        webviewView.onDidChangeVisibility(() => this.onVisibility()),
        { dispose: () => clearInterval(watch) },
      );
    }
    webview.html = this.renderHtml(webview);
    this.lastAlive = Date.now();
    this.postState(this.controller.snapshot());
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    if (message.type === 'ready' || message.type === 'alive') {
      this.lastAlive = Date.now();
    }
    await dispatchUi(this.controller, message);
  }

  private onVisibility(): void {
    if (!this.view?.visible) {
      return;
    }
    this.wakeAt = Date.now();
    void this.view.webview.postMessage({ type: 'wake' });
    setTimeout(() => {
      if (this.lastAlive < this.wakeAt) {
        this.revive('no ping after show');
      }
    }, 1600);
  }

  private watchdog(): void {
    if (!this.view?.visible || this.lastAlive === 0) {
      return;
    }
    if (Date.now() - this.lastAlive < 45_000) {
      return;
    }
    this.revive('heartbeat stopped');
  }

  private revive(reason: string): void {
    const view = this.view;
    if (!view || this.reviving) {
      return;
    }
    this.reviving = true;
    logInfo(`webview revive (${reason})`);
    view.webview.html = this.renderHtml(view.webview);
    this.lastAlive = Date.now();
    this.postState(this.controller.snapshot());
    this.reviving = false;
  }

  private postState(state: ChatState): void {
    void this.view?.webview.postMessage({
      type: 'state',
      state,
      merge: Boolean(state.mergeTranscript),
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = cryptoRandom();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'chat.css'),
    );
    const surfacesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'surfaces.css'),
    );
    const katexUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'katex', 'katex.min.css'),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data: https:; media-src ${webview.cspSource}; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <link rel="stylesheet" href="${surfacesUri}" />
  <link rel="stylesheet" href="${katexUri}" />
  <title>Grok Build</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function cryptoRandom(): string {
  return randomBytes(16).toString('hex');
}

export function registerChatView(
  context: vscode.ExtensionContext,
  controller: GrokController,
): GrokChatViewProvider {
  const provider = new GrokChatViewProvider(context, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand(COMMANDS.openChat, async () => {
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
  );
  return provider;
}
