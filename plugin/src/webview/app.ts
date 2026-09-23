import type { ChatState, WebviewToHost } from '../core/types';
import { t, type StringKey, type UiLocale } from '../core/i18n';
import { normalizeTheme } from '../settings/theme';

export type WsFile = {
  path: string;
  rel: string;
  text?: string;
  hash?: string;
  tooLarge?: boolean;
  binary?: boolean;
  missing?: boolean;
  review?: unknown;
};

type VsCodeApi = {
  postMessage(message: WebviewToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
};

function getVsCodeApi(): VsCodeApi {
  const acquire = (
    window as unknown as { acquireVsCodeApi?: () => VsCodeApi }
  ).acquireVsCodeApi;
  if (!acquire) {
    throw new Error('acquireVsCodeApi is not available');
  }
  return acquire();
}

export const vscode = getVsCodeApi();
export const root = document.getElementById('app') ?? document.body;

export const ui = {
  state: prefsOnly(vscode.getState()),
  sessionsMode: readSessionsMode(vscode.getState()),
  draft: '',
  editingGoal: false,
  menu: undefined as 'slash' | 'files' | undefined,
  picker: undefined as 'mode' | 'model' | 'effort' | undefined,
  composerFocused: false,
  moreOpen: false,
  dashDraft: '',
  dashTarget: undefined as string | undefined,
  agentsTab: 'agents' as 'agents' | 'personas',
  editsExpanded: new Set<string>(),
  copiedId: undefined as string | undefined,
  copiedTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  workOpen: new Map<string, boolean>(),
  stepsOpen: new Map<string, boolean>(),
  termOpen: new Map<string, boolean>(),
  sessionGroupOpen: new Map<string, boolean>(),
  permissionOpen: new Map<string, boolean>(),
  askOpen: new Map<string, boolean>(),
  askOtherOpen: false,
  askOtherDraft: '',
  askPicked: new Set<string>(),
  askPickStamp: '',
  askDismissedId: '',
  lightboxSrc: undefined as string | undefined,
  renameSession: undefined as { id: string; draft: string } | undefined,
  stickToBottom: true,
  transcriptScroll: 0,
  composer: undefined as HTMLTextAreaElement | undefined,
  wantFocus: false,
  remoteView: readRemoteView(vscode.getState()),
  wsRootName: '',
  wsDirs: {} as Record<
    string,
    Array<{ path: string; rel: string; name: string; kind: 'file' | 'dir' }>
  >,
  wsTruncated: false,
  wsQuery: '',
  wsFolderLoading: new Set<string>(),
  wsTabs: [] as WsFile[],
  wsActive: '',
  wsDrafts: {} as Record<string, string>,
  wsAsk: '',
  wsNotice: '',
  wsListed: false,
  wsPane: 'file' as 'file' | 'review',
  wsDiff: undefined as
    | {
        locale?: string;
        files?: unknown[];
        messageId?: string;
        theme?: unknown;
      }
    | undefined,
  wsFolderOpen: new Set<string>(),
  wsNavPx: readPx(vscode.getState(), 'wsNavPx', 220),
  wsChatPx: readPx(vscode.getState(), 'wsChatPx', 360),
  dockPx: readPx(vscode.getState(), 'dockPx', 460),
  deskTab: 'account' as DeskTab,
  heatGranularity: 'day' as 'day' | 'week' | 'cumul',
  chosenModelId: undefined as string | undefined,
  chosenEffort: undefined as string | undefined,
  pet: {
    enabled: false,
    size: 128,
    color: 'ink',
    shape: 'star',
    eyeColor: 'auto',
    expression: 'idle',
    bubbles: true,
  } as {
    enabled: boolean;
    size: number;
    color: string;
    shape: string;
    eyeColor: string;
    expression: string;
    bubbles: boolean;
  },
  petTab: 'look' as 'look' | 'bubbles',
  review: undefined as
    | {
        locale?: string;
        files?: unknown[];
        messageId?: string;
        theme?: unknown;
        active?: string;
      }
    | undefined,
};

export type DeskTab =
  | 'account'
  | 'appearance'
  | 'agent'
  | 'models'
  | 'extensions'
  | 'cli'
  | 'remote'
  | 'about'
  | 'pet'
  | 'cron';

export function loc(): UiLocale {
  return ui.state.locale === 'zh-CN' ? 'zh-CN' : 'en';
}

export function tr(key: StringKey, vars?: Record<string, string | number>): string {
  return t(loc(), key, vars);
}

export function post(message: WebviewToHost | { type: string; [key: string]: unknown }): void {
  vscode.postMessage(message as WebviewToHost);
}

/** Plugin copies via the host; remote web writes the browser device clipboard. */
export function copyText(text: string): void {
  if (!isRemoteWeb()) {
    post({ type: 'copyText', text });
    return;
  }
  void writeBrowserClipboard(text);
}

async function writeBrowserClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* HTTP / permission — fall back to a user-gesture execCommand. */
  }
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.top = '0';
  input.style.left = '0';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.opacity = '0';
  document.body.append(input);
  input.focus();
  input.select();
  try {
    document.execCommand('copy');
  } finally {
    input.remove();
  }
}

export function emptyState(): ChatState {
  return {
    status: 'connecting',
    messages: [],
    attachments: [],
    commands: [],
    locale: 'en',
  };
}

export function isRemoteWeb(): boolean {
  return document.documentElement.classList.contains('remote-web');
}

export function isDesktop(): boolean {
  return document.documentElement.classList.contains('opengrok');
}

export function isBooting(): boolean {
  if (ui.state.status !== 'connecting') {
    return false;
  }
  return !(isRemoteWeb() && ui.state.messages.length > 0);
}

let prefsToken = '';

export function persistUi(): void {
  const theme = normalizeTheme(ui.state.theme);
  const next = JSON.stringify({
    locale: ui.state.locale,
    compactMode: ui.state.compactMode,
    timestamps: ui.state.timestamps,
    multiline: ui.state.multiline,
    sessionsMode: ui.sessionsMode,
    remoteView: ui.remoteView,
    wsNavPx: ui.wsNavPx,
    wsChatPx: ui.wsChatPx,
    dockPx: ui.dockPx,
    theme,
  });
  if (next === prefsToken) {
    return;
  }
  prefsToken = next;
  vscode.setState({
    locale: ui.state.locale,
    compactMode: ui.state.compactMode,
    timestamps: ui.state.timestamps,
    multiline: ui.state.multiline,
    sessionsMode: ui.sessionsMode,
    remoteView: ui.remoteView,
    wsNavPx: ui.wsNavPx,
    wsChatPx: ui.wsChatPx,
    dockPx: ui.dockPx,
    theme,
  });
}

function readPx(raw: unknown, key: string, fallback: number): number {
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readRemoteView(raw: unknown): 'sidebar' | 'workspace' {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('opengrok')) {
    return 'sidebar';
  }
  if (raw && typeof raw === 'object' && (raw as { remoteView?: string }).remoteView === 'workspace') {
    return 'workspace';
  }
  return 'sidebar';
}

function readSessionsMode(raw: unknown): 'list' | 'workspace' {
  if (raw && typeof raw === 'object' && (raw as { sessionsMode?: string }).sessionsMode === 'workspace') {
    return 'workspace';
  }
  return 'list';
}

function prefsOnly(raw: unknown): ChatState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const value = raw as Partial<ChatState>;
  return {
    ...base,
    locale: value.locale === 'zh-CN' ? 'zh-CN' : 'en',
    compactMode: value.compactMode,
    timestamps: value.timestamps,
    multiline: value.multiline,
    theme: normalizeTheme((value as { theme?: unknown }).theme),
  };
}

export function normalizeState(raw: unknown): ChatState {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const value = raw as Partial<ChatState>;
  return {
    ...base,
    ...value,
    messages: Array.isArray(value.messages) ? value.messages : [],
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    commands: Array.isArray(value.commands) ? value.commands : [],
    locale: value.locale === 'zh-CN' ? 'zh-CN' : 'en',
  };
}

export function canType(): boolean {
  const status = ui.state.status;
  return status === 'ready' || status === 'error' || status === 'streaming';
}

export function canSend(): boolean {
  return canType();
}

export function turnBusy(): boolean {
  return ui.state.status === 'streaming';
}

let paint = (): void => {};

export function bindRender(fn: () => void): void {
  paint = fn;
}

export function render(): void {
  paint();
}
