import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { OgPluginInfo, OgPluginStateFile } from './types';

export function opengrokHome(homeDir: string): string {
  return path.join(homeDir, '.opengrok');
}

export function opengrokPluginsDir(homeDir: string): string {
  return path.join(opengrokHome(homeDir), 'plugins');
}

export function opengrokPluginStatePath(homeDir: string): string {
  return path.join(opengrokHome(homeDir), 'plugin-state.json');
}

export function projectOpengrokPluginsDir(workspaceFolder?: string): string | undefined {
  const folder = workspaceFolder?.trim();
  if (!folder) {
    return undefined;
  }
  return path.join(folder, '.opengrok', 'plugins');
}

export async function readPluginState(homeDir: string): Promise<Set<string>> {
  try {
    const raw = await readFile(opengrokPluginStatePath(homeDir), 'utf8');
    const parsed = JSON.parse(raw) as OgPluginStateFile;
    return new Set((parsed.disabled ?? []).filter((id) => typeof id === 'string' && id.trim()));
  } catch {
    return new Set();
  }
}

export async function writePluginDisabled(homeDir: string, disabled: Iterable<string>): Promise<void> {
  const dir = opengrokHome(homeDir);
  await mkdir(dir, { recursive: true });
  const payload: OgPluginStateFile = { disabled: [...new Set(disabled)].sort() };
  await writeFile(opengrokPluginStatePath(homeDir), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

type Manifest = {
  id?: string;
  name?: string;
  enabled?: boolean;
};

async function readManifest(dir: string, folderName: string): Promise<Manifest> {
  try {
    const raw = await readFile(path.join(dir, 'plugin.json'), 'utf8');
    const parsed = JSON.parse(raw) as Manifest;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { id: folderName, name: folderName };
  }
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

async function scanDir(
  root: string,
  disabled: Set<string>,
): Promise<Map<string, OgPluginInfo>> {
  const out = new Map<string, OgPluginInfo>();
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return out;
  }
  for (const folderName of names.sort()) {
    const dir = path.join(root, folderName);
    const manifest = await readManifest(dir, folderName);
    const id = (manifest.id?.trim() || folderName).trim();
    if (!id) {
      continue;
    }
    const ui = await readOptional(path.join(dir, 'ui.js'));
    const css = await readOptional(path.join(dir, 'style.css'));
    const host = await readOptional(path.join(dir, 'host.js'));
    if (!ui && !css && !host) {
      continue;
    }
    const enabled = manifest.enabled !== false && !disabled.has(id);
    out.set(id, {
      id,
      name: manifest.name?.trim() || id,
      enabled,
      dir,
      hasUi: Boolean(ui),
      hasHost: Boolean(host),
      hasCss: Boolean(css),
      ui: enabled ? ui : undefined,
      css: enabled ? css : undefined,
      hostPath: host ? path.join(dir, 'host.js') : undefined,
    });
  }
  return out;
}

export async function scanOgPlugins(opts: {
  homeDir: string;
  workspaceFolder?: string;
}): Promise<OgPluginInfo[]> {
  const disabled = await readPluginState(opts.homeDir);
  const userDir = opengrokPluginsDir(opts.homeDir);
  const found = await scanDir(userDir, disabled);
  const projectDir = projectOpengrokPluginsDir(opts.workspaceFolder);
  if (projectDir) {
    const extra = await scanDir(projectDir, disabled);
    for (const [id, plugin] of extra) {
      found.set(id, plugin);
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function ensureOgPluginsDir(homeDir: string): Promise<string> {
  const dir = opengrokPluginsDir(homeDir);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function publicOgPlugins(plugins: OgPluginInfo[]): OgPluginInfo[] {
  return plugins.map((plugin) => ({
    ...plugin,
    hostPath: undefined,
    ui: plugin.enabled ? plugin.ui : undefined,
    css: plugin.enabled ? plugin.css : undefined,
  }));
}
