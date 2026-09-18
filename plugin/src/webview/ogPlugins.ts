import type { OgPluginInfo } from '../ogPlugins/types';
import { post, ui } from './app';

export type OgUiApi = {
  id: string;
  dir: string;
  root: HTMLElement;
  state: () => typeof ui.state;
  post: typeof post;
  onPatch: (fn: () => void) => void;
  addStyle: (css: string) => HTMLStyleElement;
};

type OgPluginFn = (api: OgUiApi) => void;

const patchFns: Array<() => void> = [];
const injected = new Set<string>();

function nonce(): string | undefined {
  const value = (window as unknown as { __ogNonce?: string }).__ogNonce;
  return typeof value === 'string' && value ? value : undefined;
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
  for (const fn of patchFns) {
    try {
      fn();
    } catch {
      /* plugin errors stay in the plugin */
    }
  }
}

function addStyle(id: string, css: string): HTMLStyleElement {
  const existing = document.querySelector<HTMLStyleElement>(`style[data-og-plugin="${id}"]`);
  if (existing) {
    existing.textContent = css;
    return existing;
  }
  const style = document.createElement('style');
  style.dataset.ogPlugin = id;
  style.textContent = css;
  document.documentElement.append(style);
  return style;
}

function runUi(plugin: OgPluginInfo): void {
  if (!plugin.enabled || injected.has(plugin.id)) {
    return;
  }
  const root = ensureOgPluginRoot();
  const api: OgUiApi = {
    id: plugin.id,
    dir: plugin.dir,
    root,
    state: () => ui.state,
    post,
    onPatch: (fn) => {
      patchFns.push(fn);
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
  injected.add(plugin.id);
}

export function syncOgUiPlugins(plugins?: OgPluginInfo[]): void {
  ensureOgPluginRoot();
  for (const plugin of plugins ?? []) {
    runUi(plugin);
  }
}

(window as unknown as { OpenGrok?: { plugin: (fn: OgPluginFn) => void } }).OpenGrok ??= {
  plugin() {
    /* filled per-plugin during runUi */
  },
};
