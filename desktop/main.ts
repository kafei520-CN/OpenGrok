import * as ElectronNS from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { DEFAULT_DESKTOP_THEME } from '../plugin/src/settings/theme';
import {
  attachUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  setAutoUpdate,
  updateSnapshot,
} from './updater';
import { labShellResize, labShellStart, labShellStop, labShellWrite, labShells } from './labHost';

const electron = resolveElectron();
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray } = electron;

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
const VERSION = appVersion();

function appVersion(): string {
  const raw = app.getVersion();
  if (/^\d+\.\d+\.\d+$/.test(raw)) {
    return raw;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    if (typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version)) {
      return pkg.version;
    }
  } catch {
    /* unpackaged / missing package.json */
  }
  const trimmed = raw.match(/^(\d+\.\d+\.\d+)/);
  return trimmed?.[1] ?? '0.0.0';
}

type PetState = {
  enabled: boolean;
  x?: number;
  y?: number;
  size: number;
  color: string;
  shape: string;
  eyeColor: string;
  expression: string;
  bubbles: boolean;
};

type AppState = {
  cwd?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  pet?: PetState;
  autoUpdate?: boolean;
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
let tray: InstanceType<typeof Tray> | undefined;
let petWindow: BrowserWindow | undefined;
let lastAgentStatus = '';
let lastPetPayload: { mood: string; headline: string } = { mood: 'idle', headline: '' };
let petDoneTimer: ReturnType<typeof setTimeout> | undefined;
let isQuitting = false;

const DEFAULT_PET: PetState = {
  enabled: false,
  size: 128,
  color: 'ink',
  shape: 'star',
  eyeColor: 'auto',
  expression: 'idle',
  bubbles: true,
};

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

function seedOfficeSkills(): void {
  const srcRoot = path.join(rootDir(), 'resources', 'skills');
  if (!fs.existsSync(srcRoot)) {
    return;
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(srcRoot);
  } catch {
    return;
  }
  const destRoots = [
    path.join(os.homedir(), '.grok', 'skills'),
    path.join(os.homedir(), '.grok', 'bundled', 'skills'),
  ];
  for (const name of names) {
    const src = path.join(srcRoot, name);
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
      continue;
    }
    for (const destRoot of destRoots) {
      const dest = path.join(destRoot, name);
      if (fs.existsSync(path.join(dest, 'SKILL.md'))) {
        continue;
      }
      fs.mkdirSync(destRoot, { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
    }
  }
}

const TITLEBAR_H = 52;

type TitleChrome = {
  background: string;
  foreground: string;
  surface: 'glass' | 'solid' | 'endfield';
};

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

function overlayFill(chrome: TitleChrome): string {
  return chrome.surface === 'glass' ? '#00000000' : chrome.background;
}

function applyTitleBarOverlay(win: BrowserWindow, chrome = readThemeChrome()): void {
  win.setAlwaysOnTop(false);
  try {
    win.setTitleBarOverlay({
      color: overlayFill(chrome),
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
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: overlayFill(chrome),
      symbolColor: chrome.foreground,
      height: TITLEBAR_H,
    },
    autoHideMenuBar: true,
    alwaysOnTop: false,
    // transparent: true uses per-pixel alpha and blocks Windows 11 DWM corners.
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: chrome.surface === 'glass' ? '#00000000' : chrome.background,
    backgroundMaterial: chrome.surface === 'glass' ? 'acrylic' : 'none',
    title: APP_NAME,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });
  win.setAlwaysOnTop(false);
  win.setMenuBarVisibility(false);
  void win.loadFile(path.join(rootDir(), 'desktop', 'index.html'));
  win.on('close', (event) => {
    if (!win.isDestroyed()) {
      writeState({ bounds: win.getBounds() });
    }
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    hideToTray();
  });
  win.on('maximize', () => {
    applyTitleBarOverlay(win);
    win.webContents.send('grok-maximized', true);
  });
  win.on('unmaximize', () => {
    applyTitleBarOverlay(win);
    win.webContents.send('grok-maximized', false);
  });
  return win;
}

function watchTryReload(win: BrowserWindow): void {
  if (process.env['OPENGROK_TRY'] !== '1') {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reload = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      if (!win.isDestroyed()) {
        win.webContents.reloadIgnoringCache();
      }
    }, 180);
  };
  const targets = [
    path.join(rootDir(), 'desktop', 'workbench.css'),
    path.join(rootDir(), 'desktop', 'index.html'),
    path.join(rootDir(), 'plugin', 'media'),
    path.join(rootDir(), 'plugin', 'dist', 'webview.js'),
  ];
  for (const target of targets) {
    try {
      fs.watch(target, { recursive: fs.statSync(target).isDirectory() }, reload);
    } catch {
      /* missing on first boot */
    }
  }
}

function iconPath(): string {
  const ico = path.join(rootDir(), 'resources', 'icon.ico');
  if (fs.existsSync(ico)) {
    return ico;
  }
  return path.join(rootDir(), 'resources', 'icon.png');
}

function hideToTray(): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    return;
  }
  win.hide();
  win.setSkipTaskbar(true);
}

function showMainWindow(): void {
  let win = mainWindow;
  if (!win || win.isDestroyed()) {
    win = createWindow();
    mainWindow = win;
    win.webContents.on('did-finish-load', () => {
      if (!sidecar) {
        startSidecar(readState().cwd || defaultCwd());
      }
    });
  }
  win.setSkipTaskbar(false);
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}

function quitApp(): void {
  isQuitting = true;
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    writeState({ bounds: win.getBounds() });
  }
  savePetBounds();
  petWindow?.destroy();
  petWindow = undefined;
  stopSidecar();
  tray?.destroy();
  tray = undefined;
  app.quit();
}

function createTray(): void {
  if (tray) {
    return;
  }
  const image = nativeImage.createFromPath(iconPath());
  tray = new Tray(image.isEmpty() ? iconPath() : image);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => showMainWindow());
}

function sendUi(payload: unknown): void {
  mainWindow?.webContents.send('grok-host', payload);
  if (!payload || typeof payload !== 'object') {
    return;
  }
  const row = payload as {
    type?: string;
    status?: string;
    message?: unknown;
    state?: {
      status?: string;
      restoringSession?: boolean;
      permission?: unknown;
      messages?: unknown;
      sessions?: unknown;
      currentSessionId?: string;
    };
  };
  if (row.type === 'state') {
    pushPetStatus(row.state);
    return;
  }
  if (row.type === 'tail') {
    if (typeof row.status === 'string') {
      pushPetStatus({ status: row.status });
    }
    return;
  }
  if (typeof row.status === 'string') {
    pushPetStatus({
      status: row.status,
      messages: row.message ? [row.message] : undefined,
    });
  }
}

function readPet(): PetState {
  const raw = readState().pet;
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PET };
  }
  const size = Number(raw.size);
  const colors = new Set(['ink', 'paper', 'moss', 'ice', 'ember']);
  const shapes = new Set(['star', 'mark', 'orb', 'anime', 'adult', 'pixel']);
  const faces = new Set(['idle', 'happy', 'curious']);
  const color = typeof raw.color === 'string' && colors.has(raw.color) ? raw.color : DEFAULT_PET.color;
  const shape = typeof raw.shape === 'string' && shapes.has(raw.shape) ? raw.shape : DEFAULT_PET.shape;
  const expression =
    typeof raw.expression === 'string' && faces.has(raw.expression) ? raw.expression : DEFAULT_PET.expression;
  return {
    enabled: raw.enabled === true,
    x: typeof raw.x === 'number' ? raw.x : undefined,
    y: typeof raw.y === 'number' ? raw.y : undefined,
    size: Number.isFinite(size) ? (size <= 112 ? 96 : size >= 144 ? 160 : 128) : DEFAULT_PET.size,
    color,
    shape,
    eyeColor: 'auto',
    expression,
    bubbles: raw.bubbles !== false,
  };
}

function petConfigPayload(pet = readPet()) {
  return {
    size: pet.size,
    color: pet.color,
    shape: pet.shape,
    eyeColor: pet.eyeColor,
    expression: pet.expression,
    bubbles: pet.bubbles,
    labels: {
      thinking: '思考中…',
      working: '工作中…',
      done: '完成',
      alert: '需要你',
    },
  };
}

/** Matches Grok App Windows overlay: always reserve a chip slot so the mark never jumps. */
const PET_MARK_PAD = 32;
const PET_BUBBLE_SLOT = 84;

function petBox(size = readPet().size, shape = readPet().shape): { width: number; height: number } {
  const grown = shape === 'adult' ? Math.round(size * 1.6) : size;
  const side = Math.max(72, Math.min(280, grown));
  return { width: side + PET_MARK_PAD, height: side + PET_MARK_PAD + PET_BUBBLE_SLOT };
}

function defaultPetPoint(): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  const box = petBox();
  return { x: area.x + area.width - box.width - 16, y: area.y + area.height - box.height - 16 };
}

function clampPetPoint(x: number, y: number, box = petBox()): { x: number; y: number } {
  const area = screen.getPrimaryDisplay().workArea;
  const maxX = area.x + Math.max(0, area.width - box.width);
  const maxY = area.y + Math.max(0, area.height - box.height);
  return {
    x: Math.round(Math.min(Math.max(x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(y, area.y), maxY)),
  };
}

function fitPetWindow(opts?: { bubble?: boolean; size?: number }): void {
  const win = petWindow;
  if (!win || win.isDestroyed()) {
    return;
  }
  const pet = readPet();
  const next = petBox(opts?.size ?? pet.size, pet.shape);
  const [x, y] = win.getPosition();
  const { width, height } = win.getBounds();
  const origin = clampPetPoint(
    x - (next.width - width) / 2,
    y - (next.height - height),
    next,
  );
  if (
    Math.abs(width - next.width) < 1 &&
    Math.abs(height - next.height) < 1 &&
    Math.abs(x - origin.x) < 1 &&
    Math.abs(y - origin.y) < 1
  ) {
    return;
  }
  win.setBounds({
    x: origin.x,
    y: origin.y,
    width: next.width,
    height: next.height,
  });
}

function createPetWindow(): BrowserWindow {
  const pet = readPet();
  const box = petBox(pet.size, pet.shape);
  const origin = defaultPetPoint();
  const win = new BrowserWindow({
    width: box.width,
    height: box.height,
    x: origin.x,
    y: origin.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    title: 'OpenGrok pet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setMenuBarVisibility(false);
  win.setIgnoreMouseEvents(true, { forward: true });
  void win.loadFile(path.join(rootDir(), 'desktop', 'pet.html'));
  win.on('closed', () => {
    if (petWindow === win) {
      petWindow = undefined;
    }
  });
  return win;
}

function savePetBounds(): void {
  const win = petWindow;
  if (!win || win.isDestroyed()) {
    return;
  }
  const [x, y] = win.getPosition();
  const box = win.getBounds();
  const origin = clampPetPoint(x, y, { width: box.width, height: box.height });
  writeState({ pet: { ...readPet(), x: origin.x, y: origin.y } });
}

function parkPetCorner(): void {
  const win = petWindow;
  if (!win || win.isDestroyed()) {
    return;
  }
  const box = petBox();
  const origin = defaultPetPoint();
  win.setBounds({
    x: origin.x,
    y: origin.y,
    width: box.width,
    height: box.height,
  });
}

function showPetWindow(): void {
  const pet = readPet();
  if (!pet.enabled) {
    petWindow?.hide();
    return;
  }
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow();
  }
  petWindow.showInactive();
  petWindow.setAlwaysOnTop(true, 'floating');
  parkPetCorner();
  petWindow.webContents.send('pet-config', petConfigPayload(pet));
}

function hidePetWindow(persist = true): void {
  savePetBounds();
  petWindow?.hide();
  if (persist) {
    writeState({ pet: { ...readPet(), enabled: false } });
    notifyPetSettings();
  }
}

function applyPetPatch(patch: Partial<PetState>): void {
  const prev = readPet();
  const next = { ...prev, ...patch };
  writeState({ pet: next });
  if (next.enabled) {
    showPetWindow();
    fitPetWindow({ size: next.size, bubble: true });
    petWindow?.webContents.send('pet-config', petConfigPayload(next));
  } else {
    hidePetWindow(false);
  }
  const chromeChanged =
    prev.enabled !== next.enabled ||
    prev.color !== next.color ||
    prev.shape !== next.shape ||
    prev.eyeColor !== next.eyeColor ||
    prev.expression !== next.expression ||
    prev.bubbles !== next.bubbles ||
    prev.size !== next.size;
  if (chromeChanged) {
    notifyPetSettings();
    tray?.setContextMenu(buildTrayMenu());
  }
}

function notifyPetSettings(): void {
  mainWindow?.webContents.send('grok-host', { type: 'pet', config: readPet() });
}

function petHeadline(state?: Record<string, unknown>): string {
  if (!state) {
    return '';
  }
  const permission = state.permission as { title?: string } | undefined;
  if (permission?.title) {
    return permission.title;
  }
  const sid = typeof state.currentSessionId === 'string' ? state.currentSessionId : '';
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const session = sessions.find((row) => row && typeof row === 'object' && (row as { id?: string }).id === sid) as
    | { title?: string }
    | undefined;
  const messages = Array.isArray(state.messages) ? state.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i] as {
      role?: string;
      text?: string;
      thinking?: string;
      tools?: Array<{ title?: string; status?: string; detail?: string }>;
    };
    if (msg?.role !== 'assistant') {
      continue;
    }
    const tools = Array.isArray(msg.tools) ? msg.tools : [];
    const live = [...tools].reverse().find((tool) => tool.status === 'in_progress' || tool.status === 'pending');
    const tool = live ?? [...tools].reverse()[0];
    const think = (msg.thinking ?? '').trim();
    const text = (msg.text ?? '').trim();
    if (tool?.title) {
      return tool.title;
    }
    if (think) {
      return think.slice(0, 72);
    }
    if (text) {
      return text.slice(0, 72);
    }
    break;
  }
  return (session?.title ?? '').trim();
}

function pushPetStatus(state?: {
  status?: string;
  restoringSession?: boolean;
  permission?: unknown;
  messages?: unknown;
  sessions?: unknown;
  currentSessionId?: string;
}): void {
  const status = state?.status ?? '';
  const key = `${status}:${state?.permission ? 'p' : ''}:${petHeadline(state as Record<string, unknown>)}`;
  if (key === lastAgentStatus) {
    return;
  }
  const prev = lastAgentStatus.split(':')[0] ?? '';
  lastAgentStatus = key;
  let mood = 'idle';
  if (state?.permission) {
    mood = 'alert';
  } else if (status === 'streaming') {
    mood = 'working';
  } else if (status === 'error') {
    mood = 'alert';
  } else if (prev === 'streaming' && status === 'ready') {
    mood = 'done';
  }
  if (petDoneTimer) {
    clearTimeout(petDoneTimer);
    petDoneTimer = undefined;
  }
  lastPetPayload = { mood, headline: petHeadline(state as Record<string, unknown>) };
  petWindow?.webContents.send('pet-status', lastPetPayload);
}

function buildTrayMenu() {
  const pet = readPet();
  return Menu.buildFromTemplate([
    { label: '打开 OpenGrok', click: () => showMainWindow() },
    {
      label: pet.enabled ? '隐藏宠物' : '显示宠物',
      click: () => applyPetPatch({ enabled: !pet.enabled }),
    },
    { type: 'separator' },
    {
      label: '检查更新',
      click: () => {
        showMainWindow();
        void checkForUpdates();
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ]);
}

function openPetSettings(): void {
  showMainWindow();
  mainWindow?.webContents.send('grok-host', { type: 'openDesk', tab: 'pet' });
}

function sendSidecar(payload: unknown): void {
  sidecar?.stdin.write(`${JSON.stringify(payload)}\n`);
}

const LEGACY_INK_SEED = {
  primary: '#f4f4f4',
  secondary: '#737373',
  background: '#000000',
  surface: 'glass',
  chromeGlass: true,
} as const;

const LEGACY_GLASS_SEED = {
  primary: '#1c1c1c',
  secondary: '#737373',
  background: '#ffffff',
  surface: 'glass',
  chromeGlass: true,
} as const;

const LEGACY_SOLID_SEED = {
  primary: '#1c1c1c',
  secondary: '#737373',
  background: '#ffffff',
  surface: 'solid',
  chromeGlass: false,
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

function readThemeChrome(): TitleChrome {
  const theme = readUiState()['ui.theme'];
  if (theme && typeof theme === 'object') {
    const row = theme as { background?: unknown; surface?: unknown };
    const background = row.background;
    const surface =
      row.surface === 'solid' || row.surface === 'endfield' ? row.surface : 'glass';
    if (typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background)) {
      const hex = background.toLowerCase();
      return { background: hex, foreground: contrastFg(hex), surface };
    }
    return {
      background: DEFAULT_DESKTOP_THEME.background,
      foreground: DEFAULT_DESKTOP_THEME.primary,
      surface,
    };
  }
  return {
    background: DEFAULT_DESKTOP_THEME.background,
    foreground: DEFAULT_DESKTOP_THEME.primary,
    surface: 'glass',
  };
}

function seedTheme(): void {
  const file = path.join(dataDir(), 'ui.json');
  const all = readUiState();
  const current = all['ui.theme'];
  if (
    current &&
    !themeEq(current, LEGACY_INK_SEED) &&
    !themeEq(current, LEGACY_GLASS_SEED) &&
    !themeEq(current, LEGACY_SOLID_SEED)
  ) {
    return;
  }
  if (current && typeof current === 'object' && (current as { wallpaper?: unknown }).wallpaper) {
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
        prompt: typeof params['prompt'] === 'string' ? params['prompt'] : undefined,
        value: typeof params['value'] === 'string' ? params['value'] : '',
        locale: typeof params['locale'] === 'string' ? params['locale'] : undefined,
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
    case 'revealFile':
      if (typeof params['path'] === 'string') {
        shell.showItemInFolder(params['path']);
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
    case 'browserDock':
      return askBrowser(params);
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
      sendUi({ type: 'workspaceDiff', ...params });
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

function openTerminal(command: string, _cwd: string): void {
  sendUi({ type: 'dockRun', command });
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
      width: 380,
      height: 210,
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
  void app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('cn.mckafei.opengrok');
    }
    writeState({ cwd: defaultCwd() });
    seedOfficeSkills();
    seedTheme();
    attachUpdater({
      getWindow: () => mainWindow,
      prepareQuit: () => {
        isQuitting = true;
      },
      getAuto: () => readState().autoUpdate !== false,
      setAuto: (on) => writeState({ autoUpdate: on }),
      packaged: () => app.isPackaged,
      version: () => VERSION,
    });
    createTray();
    mainWindow = createWindow();
    watchTryReload(mainWindow);
    mainWindow.webContents.on('did-finish-load', () => {
      startSidecar(readState().cwd || defaultCwd());
      notifyPetSettings();
      showPetWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (isQuitting) {
    stopSidecar();
    app.quit();
  }
});

app.on('activate', () => {
  showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  savePetBounds();
  stopSidecar();
});

ipcMain.on(
  'grok-ui',
  (
    _event,
    message: {
      type?: string;
      enabled?: boolean;
      size?: number;
      color?: string;
      shape?: string;
      eyeColor?: string;
      expression?: string;
      bubbles?: boolean;
    },
  ) => {
  if (message?.type === 'pickProject') {
    void pickProject();
    return;
  }
  if (message?.type === 'petConfig') {
    const patch: Partial<PetState> = {};
    if (typeof message.enabled === 'boolean') {
      patch.enabled = message.enabled;
    }
    if (typeof message.size === 'number') {
      patch.size = message.size;
    }
    if (typeof message.color === 'string') {
      patch.color = message.color;
    }
    if (typeof message.shape === 'string') {
      patch.shape = message.shape;
    }
    if (typeof message.eyeColor === 'string') {
      patch.eyeColor = message.eyeColor;
    }
    if (typeof message.expression === 'string') {
      patch.expression = message.expression;
    }
    if (typeof message.bubbles === 'boolean') {
      patch.bubbles = message.bubbles;
    }
    applyPetPatch(patch);
    return;
  }
  sendSidecar({ type: 'ui', message });
});

ipcMain.on('pet-ready', () => {
  petWindow?.webContents.send('pet-config', petConfigPayload());
  petWindow?.webContents.send('pet-status', lastPetPayload);
});

ipcMain.on('pet-move', (_event, delta: { dx?: number; dy?: number }) => {
  const win = petWindow;
  if (!win || win.isDestroyed()) {
    return;
  }
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + Number(delta?.dx ?? 0)), Math.round(y + Number(delta?.dy ?? 0)));
});

ipcMain.on('pet-end-move', () => {
  savePetBounds();
});

ipcMain.on('pet-ignore', (_event, ignore: boolean) => {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  petWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

ipcMain.on('pet-fit', (_event, opts: { bubble?: boolean; size?: number }) => {
  fitPetWindow(opts);
});

ipcMain.on('pet-click', () => {
  showMainWindow();
});

ipcMain.on('pet-dblclick', () => {
  hidePetWindow(true);
});

ipcMain.on('pet-menu', () => {
  const pet = readPet();
  Menu.buildFromTemplate([
    { label: '打开 OpenGrok', click: () => showMainWindow() },
    { label: pet.enabled ? '隐藏宠物' : '显示宠物', click: () => applyPetPatch({ enabled: !pet.enabled }) },
    { label: '宠物设置', click: () => openPetSettings() },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ]).popup({ window: petWindow });
});

ipcMain.handle('og-term-shells', () => labShells().map(({ id, label }) => ({ id, label })));

ipcMain.handle('og-term-start', (event, opts: { shellId?: string; cwd?: string; cols?: number; rows?: number }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) {
    return { ok: false, error: '没有窗口' };
  }
  return labShellStart(
    win,
    String(opts?.shellId ?? ''),
    typeof opts?.cwd === 'string' ? opts.cwd : undefined,
    Number(opts?.cols) || 80,
    Number(opts?.rows) || 24,
  );
});

ipcMain.on('og-term-write', (_event, data: unknown) => {
  if (typeof data === 'string') {
    labShellWrite(data);
  }
});

ipcMain.on('og-term-resize', (_event, opts: { cols?: number; rows?: number }) => {
  labShellResize(Number(opts?.cols) || 0, Number(opts?.rows) || 0);
});

ipcMain.on('og-term-kill', () => {
  labShellStop();
});

const browserWait = new Map<number, (value: unknown) => void>();
let browserSeq = 0;

function askBrowser(params: Record<string, unknown>): Promise<unknown> {
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    return Promise.resolve({ ok: false, error: '窗口还没打开' });
  }
  const id = ++browserSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      browserWait.delete(id);
      resolve({ ok: false, error: '浏览器没有在 20 秒内回应' });
    }, 20_000);
    browserWait.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    win.webContents.send('og-browser-req', { ...params, id });
  });
}

ipcMain.on('og-browser-res', (_event, msg: { id?: number; result?: unknown }) => {
  const id = Number(msg?.id);
  const done = browserWait.get(id);
  if (!done) {
    return;
  }
  browserWait.delete(id);
  done(msg.result);
});

ipcMain.on('grok-chrome', (_event, next: { background?: string; foreground?: string; surface?: string }) => {
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
  const surface =
    next?.surface === 'solid' || next?.surface === 'endfield' || next?.surface === 'glass'
      ? next.surface
      : 'glass';
  const glass = surface === 'glass';
  try {
    win.setBackgroundMaterial(glass ? 'acrylic' : 'none');
  } catch {
    /* Windows 11+ */
  }
  win.setBackgroundColor(glass ? '#00000000' : background);
  applyTitleBarOverlay(win, { background, foreground, surface });
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
  hideToTray();
});

ipcMain.handle('grok-maximized', () => Boolean(mainWindow?.isMaximized()));

ipcMain.handle('grok-update-state', () => updateSnapshot());
ipcMain.handle('grok-update-check', () => checkForUpdates());
ipcMain.handle('grok-update-download', () => downloadUpdate());
ipcMain.handle('grok-update-install', () => {
  installUpdate();
});
ipcMain.handle('grok-update-auto', (_event, on: unknown) => setAutoUpdate(on === true));

ipcMain.handle('grok-prompt-config', () => promptConfig);

ipcMain.on('grok-prompt-result', (_event, value: unknown) => {
  promptResolve?.(value);
  promptResolve = undefined;
  promptWindow?.close();
  promptWindow = undefined;
});
