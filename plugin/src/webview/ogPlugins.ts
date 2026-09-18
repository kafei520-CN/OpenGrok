import type { OgPluginInfo } from '../ogPlugins/types';
import { post, ui } from './app';

export type OgUiApi = {
  id: string;
  dir: string;
  root: HTMLElement;
  state: () => typeof ui.state;
  post: typeof post;
  onPatch: (fn: () => void) => void;
  onDispose: (fn: () => void) => void;
  addStyle: (css: string) => HTMLStyleElement;
};

type OgPluginFn = (api: OgUiApi) => void;

type LivePlugin = {
  rev: string;
  dispose: () => void;
};

const patchFns: Array<() => void> = [];
const live = new Map<string, LivePlugin>();

function nonce(): string | undefined {
  const value = (window as unknown as { __ogNonce?: string }).__ogNonce;
  return typeof value === 'string' && value ? value : undefined;
}

function fingerprint(plugin: OgPluginInfo): string {
  return [plugin.enabled ? '1' : '0', plugin.ui ?? '', plugin.css ?? ''].join('\n---\n');
}

export function ensureOgPluginRoot(): HTMLElement {
  let el = document.getElementById('og-plugin-root');
  if (el instanceof HTMLElement) {
    return el;
  }
  el = document.createElement('div');
  el.id = 'og-plugin-root';
  document.body.append(el);
  return el;
}

export function fireOgPatch(): void {
  document.dispatchEvent(new Event('og:patch'));
  for (const fn of [...patchFns]) {
    try {
      fn();
    } catch {
      /* plugin errors stay in the plugin */
    }
  }
}

function addStyle(id: string, css: string): HTMLStyleElement {
  let style = document.querySelector<HTMLStyleElement>(`style[data-og-plugin="${id}"]`);
  if (!style) {
    style = document.createElement('style');
    style.dataset.ogPlugin = id;
    document.documentElement.append(style);
  }
  style.textContent = css;
  return style;
}

function unload(id: string): void {
  live.get(id)?.dispose();
  live.delete(id);
  document
    .querySelectorAll(`[data-og-plugin="${id}"], [data-og-plugin="${id}:api"], [data-og-plugin-mount="${id}"]`)
    .forEach((node) => node.remove());
}

function runUi(plugin: OgPluginInfo): void {
  if (!plugin.enabled) {
    return;
  }
  const root = ensureOgPluginRoot();
  const mount = document.createElement('div');
  mount.dataset.ogPluginMount = plugin.id;
  root.append(mount);
  const disposers: Array<() => void> = [];
  const api: OgUiApi = {
    id: plugin.id,
    dir: plugin.dir,
    root: mount,
    state: () => ui.state,
    post,
    onPatch: (fn) => {
      const wrap = () => fn();
      patchFns.push(wrap);
      disposers.push(() => {
        const index = patchFns.indexOf(wrap);
        if (index >= 0) {
          patchFns.splice(index, 1);
        }
      });
    },
    onDispose: (fn) => {
      disposers.push(fn);
    },
    addStyle: (css) => addStyle(`${plugin.id}:api`, css),
  };
  (window as unknown as { OpenGrok: { plugin: (fn: OgPluginFn) => void } }).OpenGrok = {
    plugin(fn) {
      if (typeof fn === 'function') {
        fn(api);
      }
    },
  };
  if (plugin.css) {
    addStyle(plugin.id, plugin.css);
  }
  if (plugin.ui) {
    const script = document.createElement('script');
    const token = nonce();
    if (token) {
      script.nonce = token;
    }
    script.dataset.ogPlugin = plugin.id;
    script.textContent = `"use strict";\n${plugin.ui}\n`;
    document.documentElement.append(script);
  }
  live.set(plugin.id, {
    rev: fingerprint(plugin),
    dispose() {
      for (const fn of disposers.reverse()) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
    },
  });
}

export function syncOgUiPlugins(plugins?: OgPluginInfo[]): void {
  ensureOgPluginRoot();
  const next = plugins ?? [];
  const keep = new Set(next.filter((plugin) => plugin.enabled).map((plugin) => plugin.id));
  for (const id of [...live.keys()]) {
    if (!keep.has(id)) {
      unload(id);
    }
  }
  for (const plugin of next) {
    if (!plugin.enabled) {
      unload(plugin.id);
      continue;
    }
    const current = live.get(plugin.id);
    if (current?.rev === fingerprint(plugin)) {
      continue;
    }
    unload(plugin.id);
    runUi(plugin);
  }
}

(window as unknown as { OpenGrok?: { plugin: (fn: OgPluginFn) => void } }).OpenGrok ??= {
  plugin() {
    /* filled per-plugin during runUi */
  },
};
