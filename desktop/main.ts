import * as ElectronNS from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

const electron = resolveElectron();
const { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } = electron;

function resolveElectron(): typeof import('electron') {
  const mod = ElectronNS as typeof import('electron') & { default?: typeof import('electron') };
  if (mod.app) {
    return mod;
  }
  if (mod.default?.app) {
    return mod.default;
  }
  throw new Error(
    `electron module is ${typeof ElectronNS}: ${String(ElectronNS).slice(0, 200)} runAsNode=${process.env['ELECTRON_RUN_AS_NODE'] ?? ''} versions=${JSON.stringify(process.versions)}`,
  );
}

const APP_NAME = 'OpenGrok';
const VERSION = app.getVersion();

type AppState = {
  cwd?: string;
  bounds?: { x: number; y: number; width: number; height: number };
};

type HostRequest = {
  type: 'host';
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

let mainWindow: BrowserWindow | undefined;
let sidecar: ChildProcessWithoutNullStreams | undefined;
let promptWindow: BrowserWindow | undefined;
let promptConfig: unknown;
let promptResolve: ((value: unknown) => void) | undefined;

function rootDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function dataDir(): string {
  const dir = path.join(os.homedir(), '.opengrok');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function statePath(): string {
  return path.join(dataDir(), 'app.json');
}

function readState(): AppState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8')) as AppState;
  } catch {
    return {};
  }
}

function writeState(patch: Partial<AppState>): void {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(statePath(), `${JSON.stringify(next, null, 2)}\n`);
}

function defaultCwd(): string {
  const saved = readState().cwd;
  if (saved && fs.existsSync(saved)) {
    return saved;
  }
  return os.homedir();
}

function grokBin(): string {
  return path.join(os.homedir(), '.grok', 'bin');
}

const TITLEBAR_H = 36;

function applyTitleBarOverlay(win: BrowserWindow, chrome = readThemeChrome()): void {
  win.setAlwaysOnTop(false);
  try {
    win.setTitleBarOverlay({
      color: chrome.background,
      symbolColor: chrome.foreground,
      height: TITLEBAR_H,
    });
  } catch {
    /* overlay is Windows-only */
  }
}

function createWindow(): BrowserWindow {
  const bounds = readState().bounds;
  const chrome = readThemeChrome();
  const win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 840,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 640,
    frame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: chrome.background,
      symbolColor: chrome.foreground,
      height: TITLEBAR_H,
    },
    autoHideMenuBar: true,
    alwaysOnTop: false,
    backgroundColor: chrome.background,
    title: APP_NAME,
    icon: path.join(rootDir(), 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(false);
  win.setMenuBarVisibility(false);
  void win.loadFile(path.join(rootDir(), 'desktop', 'index.html'));
  win.on('close', () => {
    writeState({ bounds: win.getBounds() });
  });
  win.on('maximize', () => win.webContents.send('grok-maximized', true));
  win.on('unmaximize', () => win.webContents.send('grok-maximized', false));
  return win;
}

function sendUi(payload: unknown): void {
  mainWindow?.webContents.send('grok-host', payload);
}

function sendSidecar(payload: unknown): void {
  sidecar?.stdin.write(`${JSON.stringify(payload)}\n`);
}

const DEFAULT_DESKTOP_THEME = {
  primary: '#1c1c1c',
  secondary: '#737373',
  background: '#ffffff',
  surface: 'glass',
  chromeGlass: true,
} as const;

const LEGACY_INK_SEED = {
  primary: '#f4f4f4',
  secondary: '#737373',
  background: '#000000',
  surface: 'glass',
  chromeGlass: true,
} as const;

function themeEq(raw: unknown, expected: { primary: string; secondary: string; background: string; surface: string; chromeGlass: boolean }): boolean {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const row = raw as Record<string, unknown>;
  return (
    row['primary'] === expected.primary &&
    row['secondary'] === expected.secondary &&
    row['background'] === expected.background &&
    row['surface'] === expected.surface &&
    Boolean(row['chromeGlass']) === expected.chromeGlass
  );
}

function contrastFg(background: string): string {
  const n = Number.parseInt(background.slice(1), 16);
  if (!Number.isFinite(n)) {
    return '#1c1c1c';
  }
  const channel = (shift: number): number => {
    const c = ((n >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.4 ? '#1c1c1c' : '#e8e8e8';
}

function readUiState(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir(), 'ui.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readThemeChrome(): { background: string; foreground: string } {
  const theme = readUiState()['ui.theme'];
  if (theme && typeof theme === 'object') {
    const background = (theme as { background?: unknown }).background;
    if (typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background)) {
      const hex = background.toLowerCase();
      return { background: hex, foreground: contrastFg(hex) };
    }
  }
  return { background: DEFAULT_DESKTOP_THEME.background, foreground: DEFAULT_DESKTOP_THEME.primary };
}

function seedTheme(): void {
  const file = path.join(dataDir(), 'ui.json');
  const all = readUiState();
  const current = all['ui.theme'];
  if (current && !themeEq(current, LEGACY_INK_SEED)) {
    return;
  }
  all['ui.theme'] = { ...DEFAULT_DESKTOP_THEME };
  fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
}

function startSidecar(cwd: string): void {
  seedTheme();
  stopSidecar();
  const hostJs = path.join(rootDir(), 'plugin', 'dist', 'host.js');
  if (!fs.existsSync(hostJs)) {
    sendUi({
      type: 'state',
      state: {
        status: 'error',
        error: 'OpenGrok host.js is missing. Run npm run compile.',
        messages: [],
        attachments: [],
        commands: [],
        locale: 'zh-CN',
      },
    });
    return;
  }
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    GROK_CWD: cwd,
    GROK_VERSION: VERSION,
    GROK_LANG: app.getLocale(),
    GROK_SETTINGS_FILE: path.join(dataDir(), 'settings.json'),
    GROK_STATE_FILE: path.join(dataDir(), 'ui.json'),
    PATH: `${grokBin()}${path.delimiter}${process.env['PATH'] ?? ''}`,
  };
  const child = spawn(process.execPath, [hostJs], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  sidecar = child;
  const rl = readline.createInterface({ input: child.stdout, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg['type'] === 'host' && typeof msg['id'] === 'number') {
      void handleHost(msg as HostRequest);
      return;
    }
    sendUi(msg);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) {
      console.error(text);
    }
  });
  child.on('exit', (code) => {
    if (sidecar === child) {
      sidecar = undefined;
    }
    if (code && code !== 0) {
      sendUi({
        type: 'state',
        state: {
          status: 'error',
          error: `OpenGrok agent exited (${code}).`,
          messages: [],
          attachments: [],
          commands: [],
          locale: 'zh-CN',
        },
      });
    }
  });
}

function stopSidecar(): void {
  if (!sidecar) {
    return;
  }
  try {
    sidecar.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`);
  } catch {
    /* already gone */
  }
  sidecar.kill();
  sidecar = undefined;
}

async function handleHost(msg: HostRequest): Promise<void> {
  const params = msg.params ?? {};
  try {
    const value = await runHost(msg.method, params);
    sendSidecar({ type: 'reply', id: msg.id, ok: true, value });
  } catch (error) {
    sendSidecar({
      type: 'reply',
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runHost(method: string, params: Record<string, unknown>): Promise<unknown> {
  const cwd = readState().cwd || defaultCwd();
  switch (method) {
    case 'info':
      notify(String(params['message'] ?? ''), false);
      return true;
    case 'warn':
      notify(String(params['message'] ?? ''), true);
      return true;
    case 'showLog':
      await shell.openPath(path.join(os.homedir(), '.grok', 'logs'));
      return true;
    case 'input':
      return await openPrompt({
        mode: params['password'] ? 'password' : 'input',
        title: String(params['title'] ?? APP_NAME),
        prompt: String(params['prompt'] ?? params['title'] ?? ''),
      });
    case 'confirm': {
      const result = await dialog.showMessageBox(mainWindow!, {
        type: 'question',
        message: String(params['message'] ?? ''),
        buttons: [String(params['action'] ?? 'OK'), 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      return result.response === 0;
    }
    case 'pick':
      return await openPrompt({
        mode: 'pick',
        title: String(params['title'] ?? APP_NAME),
        items: Array.isArray(params['items']) ? params['items'] : [],
      });
    case 'saveFile': {
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: String(params['defaultPath'] ?? ''),
      });
      return result.canceled ? undefined : result.filePath;
    }
    case 'openFiles': {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: String(params['title'] ?? APP_NAME),
        properties: ['openFile', 'multiSelections'],
      });
      return result.canceled ? undefined : result.filePaths;
    }
    case 'openFolder': {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: String(params['title'] ?? APP_NAME),
        properties: ['openDirectory'],
      });
      return result.canceled ? undefined : result.filePaths;
    }
    case 'openExternal':
      if (typeof params['url'] === 'string') {
        await shell.openExternal(params['url']);
      }
      return true;
    case 'openFile':
      if (typeof params['path'] === 'string') {
        await shell.openPath(params['path']);
      }
      return true;
    case 'clipboardWrite':
      clipboard.writeText(String(params['text'] ?? ''));
      return true;
    case 'hostChrome':
      return readThemeChrome();
    case 'createTerminal':
      openTerminal(String(params['command'] ?? ''), cwd);
      return true;
    case 'closeSidebar':
      return true;
    case 'focusChat':
      mainWindow?.focus();
      return true;
    case 'openText':
      return readText(String(params['path'] ?? ''));
    case 'applyText':
      writeText(String(params['path'] ?? ''), String(params['text'] ?? ''));
      return true;
    case 'deleteFile':
      if (typeof params['path'] === 'string') {
        fs.rmSync(params['path'], { force: true });
      }
      return true;
    case 'refresh':
      return true;
    case 'showDiff':
      openDiffWindow(params);
      return true;
    default:
      throw new Error(`unknown host method ${method}`);
  }
}

function notify(message: string, _warning: boolean): void {
  if (!message) {
    return;
  }
  if (Notification.isSupported()) {
    new Notification({ title: APP_NAME, body: message }).show();
  }
}

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function openTerminal(command: string, cwd: string): void {
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', APP_NAME, 'cmd.exe', '/k', command || 'echo OpenGrok'], {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
    return;
  }
  spawn('x-terminal-emulator', ['-e', command || 'bash'], {
    cwd,
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function openPrompt(config: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    promptResolve?.(undefined);
    promptConfig = config;
    promptResolve = resolve;
    promptWindow?.close();
    const win = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      width: 420,
      height: 260,
      resizable: false,
      frame: false,
      backgroundColor: '#12171f',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: false,
      },
    });
    promptWindow = win;
    void win.loadFile(path.join(rootDir(), 'desktop', 'prompt.html'));
    win.on('closed', () => {
      if (promptWindow === win) {
        promptWindow = undefined;
        promptResolve?.(undefined);
        promptResolve = undefined;
      }
    });
  });
}

async function pickProject(): Promise<void> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'OpenGrok',
    properties: ['openDirectory'],
  });
  const folder = result.filePaths[0];
  if (result.canceled || !folder) {
    return;
  }
  writeState({ cwd: folder });
  startSidecar(folder);
}

app.whenReady().then(() => {
  writeState({ cwd: defaultCwd() });
  seedTheme();
  mainWindow = createWindow();
  mainWindow.webContents.on('did-finish-load', () => {
    startSidecar(readState().cwd || defaultCwd());
  });
});

app.on('window-all-closed', () => {
  stopSidecar();
  app.quit();
});

app.on('before-quit', () => {
  stopSidecar();
});

type DiffSession = {
  payload: Record<string, unknown>;
  messageId?: string;
};

const diffWindows = new Map<number, DiffSession>();

function openDiffWindow(params: Record<string, unknown>): void {
  const payload = {
    locale: params['locale'],
    files: params['files'],
    messageId: params['messageId'],
    theme: params['theme'],
  };
  const existing = [...diffWindows.entries()].find(([, row]) => row.messageId === params['messageId']);
  if (existing) {
    const win = BrowserWindow.fromId(existing[0]);
    if (win && !win.isDestroyed()) {
      diffWindows.set(win.id, {
        payload,
        messageId: typeof params['messageId'] === 'string' ? params['messageId'] : undefined,
      });
      win.webContents.send('grok-host', { type: 'diff', payload });
      win.show();
      win.focus();
      return;
    }
  }
  const chrome = readThemeChrome();
  const win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 640,
    minHeight: 420,
    title: params['locale'] === 'zh-CN' ? '审查' : 'Review',
    autoHideMenuBar: true,
    backgroundColor: chrome.background,
    icon: path.join(rootDir(), 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  diffWindows.set(win.id, {
    payload,
    messageId: typeof params['messageId'] === 'string' ? params['messageId'] : undefined,
  });
  win.on('closed', () => {
    diffWindows.delete(win.id);
  });
  void win.loadFile(path.join(rootDir(), 'plugin', 'media', 'diff.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('grok-host', { type: 'diff', payload });
  });
}

function diffMessage(raw: unknown): { type?: string; path?: string } | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const row = raw as { source?: unknown; message?: unknown; type?: unknown; path?: unknown };
  const inner = row.source === 'grok-diff' ? row.message : raw;
  if (!inner || typeof inner !== 'object') {
    return undefined;
  }
  const msg = inner as { type?: unknown; path?: unknown };
  return {
    type: typeof msg.type === 'string' ? msg.type : undefined,
    path: typeof msg.path === 'string' ? msg.path : undefined,
  };
}

ipcMain.on('grok-ui', (event, message: { type?: string }) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  const session = sender ? diffWindows.get(sender.id) : undefined;
  if (session && sender && !sender.isDestroyed()) {
    const msg = diffMessage(message);
    if (msg?.type === 'ready') {
      sender.webContents.send('grok-host', { type: 'diff', payload: session.payload });
      return;
    }
    if (msg?.type === 'revert') {
      sendSidecar({ type: 'ui', message: { type: 'undoEdits', messageId: session.messageId } });
      return;
    }
    if (msg?.type === 'openFile' && msg.path) {
      void shell.openPath(msg.path);
      return;
    }
    return;
  }
  if (message?.type === 'pickProject') {
    void pickProject();
    return;
  }
  sendSidecar({ type: 'ui', message });
});

ipcMain.on('grok-chrome', (_event, next: { background?: string; foreground?: string }) => {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    return;
  }
  const fallback = readThemeChrome();
  const background =
    typeof next?.background === 'string' && /^#[0-9a-f]{6}$/i.test(next.background)
      ? next.background.toLowerCase()
      : fallback.background;
  const foreground =
    typeof next?.foreground === 'string' && /^#[0-9a-f]{6}$/i.test(next.foreground)
      ? next.foreground.toLowerCase()
      : fallback.foreground;
  win.setBackgroundColor(background);
  applyTitleBarOverlay(win, { background, foreground });
});

ipcMain.on('grok-window', (_event, action: 'min' | 'max' | 'close') => {
  const win = mainWindow;
  if (!win) {
    return;
  }
  if (action === 'min') {
    win.minimize();
    return;
  }
  if (action === 'max') {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return;
  }
  win.close();
});

ipcMain.handle('grok-maximized', () => Boolean(mainWindow?.isMaximized()));

ipcMain.handle('grok-prompt-config', () => promptConfig);

ipcMain.on('grok-prompt-result', (_event, value: unknown) => {
  promptResolve?.(value);
  promptResolve = undefined;
  promptWindow?.close();
  promptWindow = undefined;
});
