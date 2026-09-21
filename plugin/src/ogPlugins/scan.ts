import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { zipEntryUnsafe } from '../hosts/skills/skillsHost';
import { logWarn } from '../core/logger';
import type { OgPluginInfo, OgPluginStateFile } from './types';

const execFileAsync = promisify(execFile);
const PLUGIN_FILES = new Set(['ui.js', 'host.js', 'style.css', 'plugin.json']);

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

export function pluginUnpackDir(homeDir: string): string {
  return path.join(opengrokHome(homeDir), 'plugin-unpack');
}

async function scanDir(
  root: string,
  disabled: Set<string>,
  unpackRoot: string,
  kind: 'user' | 'project',
): Promise<Map<string, OgPluginInfo>> {
  const out = new Map<string, OgPluginInfo>();
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') {
      continue;
    }
    let dir: string | undefined;
    let folderName = entry.name;
    if (entry.isFile() && /\.zip$/i.test(entry.name)) {
      folderName = entry.name.replace(/\.zip$/i, '');
      dir = await unpackPluginZip(path.join(root, entry.name), unpackRoot, `${kind}-${folderName}`);
    } else if (entry.isDirectory()) {
      dir = path.join(root, entry.name);
    }
    if (!dir) {
      continue;
    }
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
  const unpackRoot = pluginUnpackDir(opts.homeDir);
  const userDir = opengrokPluginsDir(opts.homeDir);
  const found = await scanDir(userDir, disabled, unpackRoot, 'user');
  const projectDir = projectOpengrokPluginsDir(opts.workspaceFolder);
  if (projectDir) {
    const extra = await scanDir(projectDir, disabled, unpackRoot, 'project');
    for (const [id, plugin] of extra) {
      found.set(id, plugin);
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function unpackPluginZip(
  zipPath: string,
  unpackRoot: string,
  stem: string,
): Promise<string | undefined> {
  const dest = path.join(unpackRoot, stem);
  const stampPath = path.join(dest, '.og-unpack-stamp');
  try {
    const zipStat = await stat(zipPath);
    const stamp = await readFile(stampPath, 'utf8');
    if (stamp === String(zipStat.mtimeMs)) {
      return pluginRoot(dest);
    }
  } catch {
    /* unpack or refresh */
  }
  try {
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    const listed = await execFileAsync('tar', ['-tf', zipPath], {
      windowsHide: true,
      maxBuffer: 8_000_000,
    });
    const destRoot = path.resolve(dest);
    for (const line of String(listed.stdout).split(/\r?\n/)) {
      if (zipEntryUnsafe(destRoot, line)) {
        throw new Error(`unsafe plugin zip path: ${line.trim()}`);
      }
    }
    await execFileAsync('tar', ['-xf', zipPath, '-C', dest], { windowsHide: true });
    const zipStat = await stat(zipPath);
    await writeFile(stampPath, String(zipStat.mtimeMs), 'utf8');
    return pluginRoot(dest);
  } catch (error) {
    logWarn(`opengrok plugin zip ${zipPath}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

async function pluginRoot(extracted: string): Promise<string> {
  let names: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
  try {
    names = await readdir(extracted, { withFileTypes: true });
  } catch {
    return extracted;
  }
  const files = names.filter((entry) => entry.isFile() && PLUGIN_FILES.has(entry.name));
  const dirs = names.filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX');
  if (!files.length && dirs.length === 1 && dirs[0]) {
    return path.join(extracted, dirs[0].name);
  }
  return extracted;
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
