import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FILE_SEARCH_SKIP } from '../core/runtime/fileSearch';

export const WORKSPACE_TEXT_MAX = 2 * 1024 * 1024;
export const WORKSPACE_LINE_MAX = 80;
export const WORKSPACE_DIR_MAX = 800;

export interface WorkspaceEntry {
  path: string;
  rel: string;
  name: string;
  kind: 'file' | 'dir';
}

export function fileHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export function resolveWorkspacePath(root: string, relOrAbs: string): string | undefined {
  if (!root || !relOrAbs) {
    return undefined;
  }
  const base = path.resolve(root);
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(base, relOrAbs);
  const normalized = path.resolve(abs);
  const rel = path.relative(base, normalized);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return undefined;
  }
  return normalized;
}

export function smallEditLimit(_before: string, after: string): 'ok' | 'tooBig' | 'tooMany' {
  if (Buffer.byteLength(after, 'utf8') > WORKSPACE_TEXT_MAX) {
    return 'tooBig';
  }
  return 'ok';
}

export function safeEntryName(raw: string): string | undefined {
  const name = raw.trim();
  if (!name || name === '.' || name === '..' || name.includes('\0') || /[\\/]/.test(name)) {
    return undefined;
  }
  return name;
}

export async function createWorkspaceEntry(
  root: string,
  dirRel: string,
  name: string,
  kind: 'file' | 'dir',
): Promise<{ path: string; rel: string; kind: 'file' | 'dir' } | undefined> {
  const label = safeEntryName(name);
  if (!label) {
    return undefined;
  }
  const parent = dirRel ? resolveWorkspacePath(root, dirRel) : path.resolve(root);
  if (!parent) {
    return undefined;
  }
  const dest = resolveWorkspacePath(root, path.join(parent, label));
  if (!dest) {
    return undefined;
  }
  try {
    if (kind === 'dir') {
      await fs.promises.mkdir(dest, { recursive: true });
    } else {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      const handle = await fs.promises.open(dest, 'wx');
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') {
      return undefined;
    }
  }
  return { path: dest, rel: path.relative(path.resolve(root), dest).replace(/\\/g, '/'), kind };
}

export async function renameWorkspaceEntry(
  root: string,
  relOrAbs: string,
  name: string,
): Promise<{ from: string; to: string; rel: string } | undefined> {
  const label = safeEntryName(name);
  const src = resolveWorkspacePath(root, relOrAbs);
  if (!label || !src) {
    return undefined;
  }
  const dest = resolveWorkspacePath(root, path.join(path.dirname(src), label));
  if (!dest || dest === src) {
    return undefined;
  }
  try {
    await fs.promises.rename(src, dest);
  } catch {
    return undefined;
  }
  return { from: src, to: dest, rel: path.relative(path.resolve(root), dest).replace(/\\/g, '/') };
}

export async function deleteWorkspaceEntry(
  root: string,
  relOrAbs: string,
): Promise<{ path: string; rel: string } | undefined> {
  const dest = resolveWorkspacePath(root, relOrAbs);
  const base = path.resolve(root);
  if (!dest || dest === base) {
    return undefined;
  }
  try {
    await fs.promises.rm(dest, { recursive: true, force: true });
  } catch {
    return undefined;
  }
  return { path: dest, rel: path.relative(base, dest).replace(/\\/g, '/') };
}

export function parentRel(rel: string): string {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export async function listWorkspaceDir(
  root: string,
  dirRel = '',
): Promise<{ dir: string; name: string; entries: WorkspaceEntry[]; truncated: boolean }> {
  const base = path.resolve(root);
  const target = dirRel ? resolveWorkspacePath(base, dirRel) : base;
  if (!target) {
    return { dir: dirRel, name: path.basename(base), entries: [], truncated: false };
  }
  let listing: fs.Dirent[] = [];
  try {
    listing = await fs.promises.readdir(target, { withFileTypes: true });
  } catch {
    return { dir: dirRel, name: path.basename(base), entries: [], truncated: false };
  }
  const entries: WorkspaceEntry[] = [];
  for (const entry of listing) {
    if (entries.length >= WORKSPACE_DIR_MAX) {
      break;
    }
    if (entry.name.startsWith('.') && entry.name !== '.grok') {
      continue;
    }
    if (entry.isDirectory() && FILE_SEARCH_SKIP.has(entry.name)) {
      continue;
    }
    if (!entry.isDirectory() && !entry.isFile()) {
      continue;
    }
    const full = path.join(target, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    entries.push({
      path: full,
      rel,
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
    });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
  return {
    dir: dirRel.replace(/\\/g, '/'),
    name: path.basename(base),
    entries,
    truncated: entries.length >= WORKSPACE_DIR_MAX,
  };
}
