import type { FileDiff } from '../../edits/diff';
import type { GrokSettings, ThemeColors } from '../types';

export interface Disposable {
  dispose(): void;
}

export interface QuickItem<T = string> {
  label: string;
  description?: string;
  value: T;
}

export interface SelectionInfo {
  path: string;
  text: string;
  startLine: number;
  endLine: number;
}

export interface FileInfo {
  path: string;
  text: string;
}

export interface AgentTerminalExit {
  exitCode?: number;
  signal?: string;
}

export interface AgentTerminalSpawn {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  outputByteLimit?: number;
}

export interface AgentTerminal {
  id: string;
  snapshot(): { output: string; truncated: boolean; exitStatus?: AgentTerminalExit };
  wait(): Promise<AgentTerminalExit>;
  kill(): 'killed' | 'alreadyExited';
  release(): void;
}

export interface Platform {
  cwd(): string;
  workspaceFolders(): string[];
  homeDir(): string;
  isTrusted(): boolean;
  extensionVersion(): string;
  pathEnv(): string;
  os(): NodeJS.Platform;
  language(): string;

  getConfig<T>(key: keyof GrokSettings, fallback: T): T;
  setConfig(key: keyof GrokSettings, value: unknown): Promise<void>;
  getState<T>(key: string, fallback: T): T;
  setState(key: string, value: unknown): Promise<void>;

  log(level: 'info' | 'warn' | 'error', message: string, error?: unknown): void;
  showLog(): void;
  info(message: string): void;
  warn(message: string): void;
  input(title: string, opts?: { prompt?: string; password?: boolean }): Promise<string | undefined>;
  confirm(message: string, action: string): Promise<boolean>;
  pick<T>(title: string, items: Array<QuickItem<T>>): Promise<T | undefined>;
  saveFile(defaultPath: string): Promise<string | undefined>;
  openFiles(opts?: { filters?: Record<string, string[]>; title?: string }): Promise<string[] | undefined>;
  openFolders(opts?: { title?: string }): Promise<string[] | undefined>;
  readDir(dir: string): Promise<string[]>;
  openExternal(url: string): Promise<void>;
  openFile(path: string, preview?: boolean): Promise<void>;
  revealFile?(path: string): Promise<void>;
  clipboardWrite(text: string): Promise<void>;
  findFiles(query: string): Promise<Array<{ path: string; label: string }>>;
  relativePath(filePath: string): string;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string, useTrash?: boolean): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  openText?(path: string): string | undefined;
  readOpenText?(path: string): Promise<string | undefined>;
  applyText?(path: string, text: string): Promise<boolean>;
  createTerminal(name: string, command: string): void;
  spawnAgentTerminal?(opts: AgentTerminalSpawn): AgentTerminal;
  closeSidebar(): Promise<void>;
  focusChat(): void;
  getActiveSelection(): SelectionInfo | undefined;
  getActiveFile(): FileInfo | undefined;
  /** Workbench chrome colors when Ice/default has no custom background. */
  hostChrome?(): { background: string; foreground: string };
  showDiff?(opts: {
    locale: string;
    files: FileDiff[];
    messageId?: string;
    theme?: ThemeColors;
    onRevert?: () => void;
  }): void;
  onTrustChange(cb: () => void): Disposable;
  onConfigChange(cb: () => void): Disposable;
  /** Bundled media file such as grok-symbol.png. */
  mediaFile?(name: string): string | undefined;
  /** Webview or file URL the chat page can load. */
  toResourceUrl?(filePath: string): string | undefined;
}

let current: Platform | undefined;

export function bindPlatform(platform: Platform): void {
  current = platform;
}

export function plat(): Platform {
  if (!current) {
    throw new Error('platform not bound');
  }
  return current;
}
