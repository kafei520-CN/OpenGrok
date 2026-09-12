import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FileDiff } from '../../edits/diff';
import {
  FILE_SEARCH_LIMIT,
  FILE_SEARCH_MAX_VISIT,
  FILE_SEARCH_SKIP,
  shouldSearchFiles,
} from '../runtime/fileSearch';
import { spawnProcessTerminal } from '../../agent/acpTerminal';
import type { FileInfo, Platform, SelectionInfo } from './index';
import { DEFAULT_SETTINGS, type GrokSettings } from '../types';

export type HostRequest = (method: string, params?: unknown) => Promise<unknown>;
export type HostNotify = (payload: unknown) => void;

export class NodePlatform implements Platform {
  selection?: SelectionInfo;
  file?: FileInfo;
  private readonly settingsFile: string;
  private readonly stateFile: string;
  private chrome = { background: '#1e1e1e', foreground: '#e8e8e8' };

  constructor(
    private readonly opts: {
      cwd: string;
      version: string;
      language: string;
      request: HostRequest;
      notify: HostNotify;
    },
  ) {
    const dir = path.join(os.homedir(), '.grok');
    fs.mkdirSync(dir, { recursive: true });
    this.settingsFile =
      process.env['GROK_SETTINGS_FILE']?.trim() || path.join(dir, 'idea-settings.json');
    this.stateFile = process.env['GROK_STATE_FILE']?.trim() || path.join(dir, 'idea-ui.json');
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    void this.refreshChrome();
  }

  setContext(next: { selection?: SelectionInfo; file?: FileInfo }): void {
    if ('selection' in next) {
      this.selection = next.selection;
    }
    if ('file' in next) {
      this.file = next.file;
    }
  }

  cwd(): string {
    return this.opts.cwd;
  }

  workspaceFolders(): string[] {
    return [this.opts.cwd];
  }

  homeDir(): string {
    return os.homedir();
  }

  isTrusted(): boolean {
    return true;
  }

  extensionVersion(): string {
    return this.opts.version;
  }

  pathEnv(): string {
    return process.env['PATH'] ?? '';
  }

  os(): NodeJS.Platform {
    return process.platform;
  }

  language(): string {
    return this.opts.language;
  }

  getConfig<T>(key: keyof GrokSettings, fallback: T): T {
    const all = readJson<Partial<GrokSettings>>(this.settingsFile, {});
    const value = all[key];
    return (value === undefined ? fallback : value) as T;
  }

  async setConfig(key: keyof GrokSettings, value: unknown): Promise<void> {
    const all = readJson<Record<string, unknown>>(this.settingsFile, { ...DEFAULT_SETTINGS });
    all[key] = value;
    writeJson(this.settingsFile, all);
  }

  getState<T>(key: string, fallback: T): T {
    const all = readJson<Record<string, unknown>>(this.stateFile, {});
    return (all[key] as T | undefined) ?? fallback;
  }

  async setState(key: string, value: unknown): Promise<void> {
    const all = readJson<Record<string, unknown>>(this.stateFile, {});
    all[key] = value;
    writeJson(this.stateFile, all);
  }

  log(level: 'info' | 'warn' | 'error', message: string, error?: unknown): void {
    const detail =
      error instanceof Error ? error.stack ?? error.message : error ? String(error) : '';
    this.opts.notify({ type: 'log', level, message, detail });
  }

  showLog(): void {
    void this.opts.request('showLog');
  }

  info(message: string): void {
    void this.opts.request('info', { message });
  }

  warn(message: string): void {
    void this.opts.request('warn', { message });
  }

  async input(title: string, opts?: { prompt?: string; password?: boolean }): Promise<string | undefined> {
    const value = await this.opts.request('input', { title, ...opts });
    return typeof value === 'string' ? value : undefined;
  }

  async confirm(message: string, action: string): Promise<boolean> {
    return Boolean(await this.opts.request('confirm', { message, action }));
  }

  async pick<T>(title: string, items: Array<{ label: string; description?: string; value: T }>): Promise<T | undefined> {
    const value = await this.opts.request('pick', { title, items });
    return value as T | undefined;
  }

  async saveFile(defaultPath: string): Promise<string | undefined> {
    const value = await this.opts.request('saveFile', { defaultPath });
    return typeof value === 'string' ? value : undefined;
  }

  async openFiles(opts?: { filters?: Record<string, string[]>; title?: string }): Promise<string[] | undefined> {
    const value = await this.opts.request('openFiles', opts ?? {});
    return Array.isArray(value) ? (value as string[]) : undefined;
  }

  async openFolders(opts?: { title?: string }): Promise<string[] | undefined> {
    const value = await this.opts.request('openFolder', opts ?? {});
    return Array.isArray(value) ? (value as string[]) : undefined;
  }

  async readDir(dir: string): Promise<string[]> {
    try {
      return await fs.promises.readdir(dir);
    } catch {
      return [];
    }
  }

  async openExternal(url: string): Promise<void> {
    await this.opts.request('openExternal', { url });
  }

  async openFile(filePath: string, preview = true): Promise<void> {
    await this.opts.request('openFile', { path: filePath, preview });
  }

  async clipboardWrite(text: string): Promise<void> {
    await this.opts.request('clipboardWrite', { text });
  }

  hostChrome(): { background: string; foreground: string } {
    return this.chrome;
  }

  private async refreshChrome(): Promise<void> {
    try {
      const row = await this.opts.request('hostChrome');
      if (!row || typeof row !== 'object') {
        return;
      }
      const background = (row as { background?: unknown }).background;
      const foreground = (row as { foreground?: unknown }).foreground;
      if (typeof background === 'string' && typeof foreground === 'string' && background && foreground) {
        this.chrome = { background, foreground };
      }
    } catch {
      /* keep the dark fallback until IDEA answers */
    }
  }

  async findFiles(query: string): Promise<Array<{ path: string; label: string }>> {
    if (!shouldSearchFiles(query)) {
      return [];
    }
    const hits: Array<{ path: string; label: string }> = [];
    const needle = query.trim().toLowerCase();
    let visited = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (hits.length >= FILE_SEARCH_LIMIT || depth > 8 || visited >= FILE_SEARCH_MAX_VISIT) {
        return;
      }
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (hits.length >= FILE_SEARCH_LIMIT || visited >= FILE_SEARCH_MAX_VISIT) {
          return;
        }
        if (entry.name.startsWith('.') && entry.name !== '.grok') {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (FILE_SEARCH_SKIP.has(entry.name)) {
            continue;
          }
          await walk(full, depth + 1);
          continue;
        }
        visited += 1;
        if (entry.name.toLowerCase().includes(needle)) {
          hits.push({ path: full, label: path.relative(this.opts.cwd, full) });
        }
      }
    };
    await walk(this.opts.cwd, 0);
    return hits;
  }

  relativePath(filePath: string): string {
    const rel = path.relative(this.opts.cwd, filePath);
    return rel && !rel.startsWith('..') ? rel : filePath;
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    return await fs.promises.readFile(filePath);
  }

  async writeFile(filePath: string, data: Uint8Array): Promise<void> {
    const text = Buffer.from(data).toString('utf8');
    const binary = data.includes(0);
    if (!binary) {
      const applied = await this.opts.request('applyText', { path: filePath, text });
      if (applied) {
        return;
      }
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, data);
    await this.opts.request('refresh', { path: filePath });
  }

  async deleteFile(filePath: string, _useTrash = true): Promise<void> {
    const handled = await this.opts.request('deleteFile', { path: filePath });
    if (handled) {
      return;
    }
    await fs.promises.rm(filePath, { force: true });
    await this.opts.request('refresh', { path: filePath });
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  openText(filePath: string): string | undefined {
    if (this.file?.path === filePath) {
      return this.file.text;
    }
    return undefined;
  }

  async readOpenText(filePath: string): Promise<string | undefined> {
    const value = await this.opts.request('openText', { path: filePath });
    return typeof value === 'string' ? value : undefined;
  }

  async applyText(filePath: string, text: string): Promise<boolean> {
    return Boolean(await this.opts.request('applyText', { path: filePath, text }));
  }

  createTerminal(name: string, command: string): void {
    void this.opts.request('createTerminal', { name, command });
  }

  spawnAgentTerminal(opts: import('./index').AgentTerminalSpawn) {
    return spawnProcessTerminal(opts);
  }

  async closeSidebar(): Promise<void> {
    await this.opts.request('closeSidebar');
  }

  focusChat(): void {
    void this.opts.request('focusChat');
  }

  getActiveSelection(): SelectionInfo | undefined {
    return this.selection;
  }

  getActiveFile(): FileInfo | undefined {
    return this.file;
  }

  showDiff(opts: {
    locale: string;
    files: FileDiff[];
    messageId?: string;
    theme?: import('../types').ThemeColors;
    onRevert?: () => void;
  }): void {
    void this.opts.request('showDiff', {
      locale: opts.locale,
      files: opts.files,
      messageId: opts.messageId,
      theme: opts.theme,
    });
  }

  onTrustChange(): { dispose(): void } {
    return { dispose() {} };
  }

  onConfigChange(): { dispose(): void } {
    return { dispose() {} };
  }

  mediaFile(name: string): string | undefined {
    const candidates = [
      path.join(__dirname, name),
      path.join(__dirname, '..', 'media', name),
      path.join(__dirname, '..', '..', 'media', name),
    ];
    return candidates.find((file) => fs.existsSync(file));
  }

  toResourceUrl(filePath: string): string | undefined {
    return pathToFileURL(filePath).href;
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}
