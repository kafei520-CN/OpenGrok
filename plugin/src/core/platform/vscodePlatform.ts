import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { COMMANDS } from '../constants';
import { GrokDiffPanel } from '../../edits/diffPanel';
import { OUTPUT_CHANNEL } from '../constants';
import {
  FILE_SEARCH_EXCLUDE,
  FILE_SEARCH_LIMIT,
  fileSearchGlob,
  shouldSearchFiles,
} from '../runtime/fileSearch';
import { sameFsPath } from '../grokDirs';
import type { GrokSettings } from '../types';
import { spawnProcessTerminal } from '../../agent/acpTerminal';
import type { Platform } from './index';

let findFilesCts: vscode.CancellationTokenSource | undefined;
let chatWebview: vscode.Webview | undefined;

let channel: vscode.OutputChannel | undefined;

export function bindChatWebview(webview: vscode.Webview): void {
  chatWebview = webview;
}

function logChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  }
  return channel;
}

export function createVscodePlatform(context: vscode.ExtensionContext): Platform {
  return {
    cwd() {
      return (
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        vscode.workspace.workspaceFile?.fsPath ??
        os.homedir()
      );
    },
    workspaceFolders() {
      return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    },
    homeDir() {
      return os.homedir();
    },
    isTrusted() {
      return vscode.workspace.isTrusted;
    },
    extensionVersion() {
      return String(context.extension.packageJSON.version ?? '0.0.0');
    },
    pathEnv() {
      return process.env['PATH'] ?? '';
    },
    os() {
      return process.platform;
    },
    language() {
      return vscode.env.language;
    },
    getConfig<T>(key: keyof GrokSettings, fallback: T): T {
      return vscode.workspace.getConfiguration('grok').get(key, fallback) as T;
    },
    async setConfig(key, value) {
      await vscode.workspace
        .getConfiguration('grok')
        .update(key, value, vscode.ConfigurationTarget.Global);
    },
    getState<T>(key: string, fallback: T): T {
      return (context.globalState.get(key) as T | undefined) ?? fallback;
    },
    async setState(key, value) {
      await context.globalState.update(key, value);
    },
    log(level, message, error) {
      const detail =
        error instanceof Error ? error.stack ?? error.message : error ? String(error) : '';
      logChannel().appendLine(`[${level}] ${message}${detail ? `\n${detail}` : ''}`);
    },
    showLog() {
      logChannel().show(true);
    },
    info(message) {
      void vscode.window.showInformationMessage(message);
    },
    warn(message) {
      void vscode.window.showWarningMessage(message);
    },
    async input(title, opts) {
      return vscode.window.showInputBox({
        title,
        prompt: opts?.prompt,
        password: opts?.password,
        ignoreFocusOut: true,
      });
    },
    async confirm(message, action) {
      const pick = await vscode.window.showWarningMessage(message, { modal: true }, action);
      return pick === action;
    },
    async pick(title, items) {
      const picked = await vscode.window.showQuickPick(
        items.map((item) => ({ ...item, picked: undefined })),
        { title },
      );
      return picked?.value;
    },
    async saveFile(defaultPath) {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultPath),
        filters: { Markdown: ['md'] },
      });
      return uri?.fsPath;
    },
    async openFiles(opts) {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: opts?.title ?? 'Add to Grok',
        filters: opts?.filters,
      });
      return picked?.map((uri) => uri.fsPath);
    },
    async openFolders(opts) {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: false,
        canSelectFolders: true,
        openLabel: opts?.title ?? 'Add to Grok',
      });
      return picked?.map((uri) => uri.fsPath);
    },
    async readDir(dir) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
        return entries.map(([name]) => name);
      } catch {
        return [];
      }
    },
    async openExternal(url) {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },
    async openFile(filePath, preview = true) {
      await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview });
    },
    async revealFile(filePath) {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
    },
    async clipboardWrite(text) {
      await vscode.env.clipboard.writeText(text);
    },
    hostChrome() {
      const kind = vscode.window.activeColorTheme.kind;
      const light =
        kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
      return light
        ? { background: '#f3f3f3', foreground: '#1c1c1c' }
        : { background: '#1e1e1e', foreground: '#cccccc' };
    },
    async findFiles(query) {
      findFilesCts?.cancel();
      findFilesCts = new vscode.CancellationTokenSource();
      const token = findFilesCts.token;
      if (!shouldSearchFiles(query)) {
        return [];
      }
      try {
        const hits = await vscode.workspace.findFiles(
          fileSearchGlob(query),
          FILE_SEARCH_EXCLUDE,
          FILE_SEARCH_LIMIT,
          token,
        );
        if (token.isCancellationRequested) {
          return [];
        }
        return hits.map((uri) => ({
          path: uri.fsPath,
          label: vscode.workspace.asRelativePath(uri),
        }));
      } catch {
        return [];
      }
    },
    relativePath(filePath) {
      try {
        return vscode.workspace.asRelativePath(filePath, false);
      } catch {
        return filePath;
      }
    },
    async readFile(filePath) {
      return vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    },
    async writeFile(filePath, data) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(filePath)));
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), data);
    },
    async deleteFile(filePath, useTrash = true) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { useTrash });
      } catch {
        await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
      }
    },
    async fileExists(filePath) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return true;
      } catch {
        return false;
      }
    },
    openText(filePath) {
      return openDocument(filePath)?.getText();
    },
    async applyText(filePath, text) {
      const open = openDocument(filePath);
      if (!open || open.isClosed) {
        return false;
      }
      const range = new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(open.uri, range, text);
      return vscode.workspace.applyEdit(edit);
    },
    createTerminal(name, command) {
      const terminal = vscode.window.createTerminal(name);
      terminal.show();
      terminal.sendText(command);
    },
    spawnAgentTerminal(opts) {
      return spawnProcessTerminal(opts);
    },
    async closeSidebar() {
      await vscode.commands.executeCommand('workbench.action.closeSidebar');
    },
    focusChat() {
      void vscode.commands.executeCommand(COMMANDS.openChat);
    },
    getActiveSelection() {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        return undefined;
      }
      return {
        path: editor.document.uri.fsPath,
        text: editor.document.getText(editor.selection),
        startLine: editor.selection.start.line + 1,
        endLine: editor.selection.end.line + 1,
      };
    },
    getActiveFile() {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return undefined;
      }
      return { path: editor.document.uri.fsPath, text: editor.document.getText() };
    },
    showDiff(opts) {
      GrokDiffPanel.show(
        context,
        {
          locale: opts.locale === 'zh-CN' ? 'zh-CN' : 'en',
          files: opts.files,
          messageId: opts.messageId,
          theme: opts.theme,
        },
        {
          onOpenFile: (absPath) => {
            void vscode.window.showTextDocument(vscode.Uri.file(absPath), { preview: true });
          },
          onRevert: opts.onRevert,
        },
      );
    },
    mediaFile(name) {
      const direct = path.join(context.extensionPath, 'media', name);
      if (fs.existsSync(direct)) {
        return direct;
      }
      if (name === 'grok-symbol.png') {
        const fallback = path.join(context.extensionPath, 'resources', 'icon.png');
        if (fs.existsSync(fallback)) {
          return fallback;
        }
      }
      return undefined;
    },
    toResourceUrl(filePath) {
      const uri = vscode.Uri.file(filePath);
      return (chatWebview ?? undefined)?.asWebviewUri(uri).toString() ?? uri.toString();
    },
    onTrustChange(cb) {
      return vscode.workspace.onDidGrantWorkspaceTrust(cb);
    },
    onConfigChange(cb) {
      return vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('grok')) {
          cb();
        }
      });
    },
  };
}

function openDocument(filePath: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find(
    (doc) => !doc.isClosed && sameFsPath(doc.uri.fsPath, filePath, process.platform),
  );
}
