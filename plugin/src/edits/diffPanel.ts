import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { FileDiff } from './diff';
import type { UiLocale } from '../core/i18n';
import type { ThemeColors } from '../core/types';

export interface DiffPayload {
  locale: UiLocale;
  files: FileDiff[];
  messageId?: string;
  theme?: ThemeColors;
}

type DiffHostMessage =
  | { type: 'openFile'; path: string }
  | { type: 'revert' }
  | { type: 'ready' };

export class GrokDiffPanel {
  static current: GrokDiffPanel | undefined;

  static show(
    context: vscode.ExtensionContext,
    payload: DiffPayload,
    handlers: {
      onOpenFile: (absPath: string) => void;
      onRevert?: () => void;
    },
  ): GrokDiffPanel {
    if (GrokDiffPanel.current) {
      GrokDiffPanel.current.handlers = handlers;
      GrokDiffPanel.current.payload = payload;
      GrokDiffPanel.current.panel.reveal(vscode.ViewColumn.One);
      GrokDiffPanel.current.post();
      return GrokDiffPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'grok.diff',
      'Grok Diff',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');
    const view = new GrokDiffPanel(context, panel, payload, handlers);
    GrokDiffPanel.current = view;
    return view;
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    readonly panel: vscode.WebviewPanel,
    private payload: DiffPayload,
    private handlers: {
      onOpenFile: (absPath: string) => void;
      onRevert?: () => void;
    },
  ) {
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((message: DiffHostMessage) => {
      if (message.type === 'ready') {
        this.post();
        return;
      }
      if (message.type === 'openFile') {
        this.handlers.onOpenFile(message.path);
        return;
      }
      if (message.type === 'revert') {
        this.handlers.onRevert?.();
      }
    });
    this.panel.onDidDispose(() => {
      if (GrokDiffPanel.current === this) {
        GrokDiffPanel.current = undefined;
      }
    });
  }

  private post(): void {
    void this.panel.webview.postMessage({ type: 'diff', payload: this.payload });
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = randomBytes(16).toString('hex');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'diff.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'diff.css'),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Grok Diff</title>
</head>
<body>
  <div id="app">Grok Diff</div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
