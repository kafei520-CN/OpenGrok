import { rgbToHex } from '../../settings/theme';

export type MonacoFile = {
  path: string;
  rel: string;
  text?: string;
};

type MonacoNs = {
  editor: {
    create: (
      el: HTMLElement,
      opts: Record<string, unknown>,
    ) => MonacoEditor;
    createModel: (value: string, language?: string, uri?: MonacoUri) => MonacoModel;
    getModel: (uri: MonacoUri) => MonacoModel | null;
    defineTheme: (name: string, theme: Record<string, unknown>) => void;
    setTheme: (name: string) => void;
  };
  Uri: { parse: (value: string) => MonacoUri };
  KeyMod: { CtrlCmd: number };
  KeyCode: { KeyS: number };
};

type MonacoEditor = {
  getModel: () => MonacoModel | null;
  setModel: (model: MonacoModel | null) => void;
  updateOptions: (opts: Record<string, unknown>) => void;
  addCommand: (id: number, handler: () => void) => void;
  onDidChangeModelContent: (handler: () => void) => void;
  layout: () => void;
  dispose: () => void;
};

type MonacoModel = {
  uri: MonacoUri;
  getValue: () => string;
  setValue: (value: string) => void;
  dispose: () => void;
  setLanguage?: (language: string) => void;
};

type MonacoUri = { toString: () => string };

type AmdRequire = {
  config: (opts: { paths: Record<string, string> }) => void;
  (modules: string[], cb: () => void, err?: (error: unknown) => void): void;
};

declare global {
  interface Window {
    monaco?: MonacoNs;
    require?: AmdRequire;
    MonacoEnvironment?: { getWorkerUrl: (id: string, label: string) => string };
    __grokShikiReady?: Promise<void>;
    __grokShikiTheme?: (dark: boolean) => string;
  }
}

const models = new Map<string, MonacoModel>();
let editor: MonacoEditor | undefined;
let loadOnce: Promise<MonacoNs> | undefined;
let changeHandler: (text: string) => void = () => {};
let saveHandler: () => void = () => {};

const LANG: Record<string, string> = {
  bat: 'bat',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cxx: 'cpp',
  dart: 'dart',
  go: 'go',
  graphql: 'graphql',
  gql: 'graphql',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  m: 'objective-c',
  md: 'markdown',
  mjs: 'javascript',
  mm: 'objective-c',
  php: 'php',
  pl: 'perl',
  ps1: 'powershell',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vb: 'vb',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

export function languageFromPath(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  if (/^dockerfile$/i.test(base)) {
    return 'dockerfile';
  }
  if (/^makefile$/i.test(base)) {
    return 'plaintext';
  }
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return 'plaintext';
  }
  return LANG[base.slice(dot + 1).toLowerCase()] ?? 'plaintext';
}

export function parkMonacoHost(): void {
  const host = document.getElementById('ws-monaco-host');
  if (!host) {
    return;
  }
  let park = document.getElementById('ws-monaco-park');
  if (!park) {
    park = document.createElement('div');
    park.id = 'ws-monaco-park';
    park.hidden = true;
    document.body.append(park);
  }
  if (host.parentElement !== park) {
    park.append(host);
  }
}

export function adoptMonacoHost(): HTMLElement {
  let host = document.getElementById('ws-monaco-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ws-monaco-host';
    host.className = 'ws-monaco';
  }
  return host;
}

export function dropMonacoModel(filePath: string): void {
  const model = models.get(filePath);
  if (!model) {
    return;
  }
  if (editor?.getModel() === model) {
    editor.setModel(null);
  }
  model.dispose();
  models.delete(filePath);
}

export function bindMonacoEditor(opts: {
  host: HTMLElement;
  stack: HTMLElement;
  textarea: HTMLTextAreaElement;
  file: MonacoFile;
  onChange: (text: string) => void;
  onSave: () => void;
}): void {
  const { host, stack, textarea, file, onChange, onSave } = opts;
  changeHandler = onChange;
  saveHandler = onSave;
  void loadMonaco()
    .then((monaco) => {
      applyEditorTheme(monaco);
      const model = modelFor(monaco, file, textarea.value);
      ensureEditor(monaco, host);
      if (editor?.getModel() !== model) {
        editor?.setModel(model);
      }
      if (model.getValue() !== textarea.value) {
        model.setValue(textarea.value);
      }
      if (stack.isConnected) {
        stack.classList.add('monaco-on');
        editor?.layout();
      }
    })
    .catch(() => {
      stack.classList.remove('monaco-on');
    });
}

function ensureEditor(monaco: MonacoNs, host: HTMLElement): boolean {
  if (editor) {
    return false;
  }
  editor = monaco.editor.create(host, {
    model: null,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    renderLineHighlight: 'line',
    padding: { top: 4 },
    theme: editorThemeName(),
    contextmenu: true,
    folding: true,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      useShadows: false,
    },
    overviewRulerLanes: 0,
  });
  editor.onDidChangeModelContent(() => {
    const model = editor?.getModel();
    if (!model) {
      return;
    }
    changeHandler(model.getValue());
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveHandler());
  return true;
}

function modelFor(monaco: MonacoNs, file: MonacoFile, value: string): MonacoModel {
  const existing = models.get(file.path);
  if (existing) {
    return existing;
  }
  const uri = monaco.Uri.parse(fileUri(file.path));
  const found = monaco.editor.getModel(uri);
  if (found) {
    models.set(file.path, found);
    return found;
  }
  const model = monaco.editor.createModel(value, languageFromPath(file.path), uri);
  models.set(file.path, model);
  return model;
}

function fileUri(filePath: string): string {
  const abs = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(abs)) {
    return `file:///${abs}`;
  }
  if (abs.startsWith('/')) {
    return `file://${abs}`;
  }
  return `file:///${abs}`;
}

function loadMonaco(): Promise<MonacoNs> {
  if (window.monaco) {
    return Promise.resolve(window.monaco);
  }
  if (loadOnce) {
    return loadOnce;
  }
  loadOnce = new Promise((resolve, reject) => {
    window.MonacoEnvironment = {
      getWorkerUrl: () => {
        const origin = location.origin;
        const body =
          `self.MonacoEnvironment={baseUrl:${JSON.stringify(`${origin}/monaco/`)}};` +
          `importScripts(${JSON.stringify(`${origin}/monaco/vs/base/worker/workerMain.js`)});`;
        return URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
      },
    };
    const script = document.createElement('script');
    script.src = '/monaco/vs/loader.js';
    script.onload = () => {
      const req = window.require;
      if (!req) {
        reject(new Error('monaco loader'));
        return;
      }
      req.config({ paths: { vs: '/monaco/vs' } });
      req(
        ['vs/editor/editor.main'],
        () => {
          if (!window.monaco) {
            reject(new Error('monaco missing'));
            return;
          }
          void attachShiki()
            .catch(() => undefined)
            .then(() => resolve(window.monaco!));
        },
        reject,
      );
    };
    script.onerror = () => reject(new Error('monaco script'));
    document.head.append(script);
  });
  loadOnce.catch(() => {
    loadOnce = undefined;
  });
  return loadOnce;
}

function attachShiki(): Promise<void> {
  if (window.__grokShikiReady) {
    return window.__grokShikiReady;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/shiki-monaco.js';
    script.onload = () => {
      const ready = window.__grokShikiReady;
      if (!ready) {
        resolve();
        return;
      }
      void ready.then(() => resolve()).catch(reject);
    };
    script.onerror = () => reject(new Error('shiki-monaco script'));
    document.head.append(script);
  });
}

function editorThemeName(): string {
  const style = getComputedStyle(document.documentElement);
  const bg = colorVar(style, '--bg', '#1c1c1c');
  const dark = luminance(bg) < 0.4;
  return window.__grokShikiTheme?.(dark) ?? 'grok';
}

function applyEditorTheme(monaco: MonacoNs): void {
  const name = editorThemeName();
  if (name !== 'grok') {
    monaco.editor.setTheme(name);
    return;
  }
  applyGrokTheme(monaco);
}

function applyGrokTheme(monaco: MonacoNs): void {
  const style = getComputedStyle(document.documentElement);
  const bg = colorVar(style, '--bg', '#1c1c1c');
  const fg = colorVar(style, '--fg', '#e8e8e8');
  const muted = colorVar(style, '--muted', '#9a9a9a');
  const ice = colorVar(style, '--ice', '#b9d4ff');
  const line = colorVar(style, '--line', '#2a2a2a');
  const dark = luminance(bg) < 0.4;
  monaco.editor.defineTheme('grok', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorGutter.background': bg,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': fg,
      'editorCursor.foreground': ice,
      'editor.selectionBackground': `${ice}55`,
      'editor.inactiveSelectionBackground': `${ice}33`,
      'editor.lineHighlightBackground': dark ? '#ffffff08' : '#0000000a',
      'editorWidget.background': bg,
      'editorWidget.border': line,
      'editorIndentGuide.background1': line,
      'editorIndentGuide.activeBackground1': muted,
    },
  });
  monaco.editor.setTheme('grok');
}

function colorVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = style.getPropertyValue(name).trim();
  if (!raw) {
    return fallback;
  }
  return rgbToHex(raw) ?? (/^#[0-9a-f]{3,8}$/i.test(raw) ? raw : fallback);
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(n)) {
    return 0;
  }
  const ch = (shift: number): number => {
    const c = ((n >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
}
