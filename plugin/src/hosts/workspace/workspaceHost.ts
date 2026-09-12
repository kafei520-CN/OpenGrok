import * as path from 'node:path';
import { tr } from '../../core/i18n/locale';
import { logWarn } from '../../core/logger';
import { plat } from '../../core/platform';
import {
  WORKSPACE_TEXT_MAX,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  fileHash,
  listWorkspaceDir,
  parentRel,
  renameWorkspaceEntry,
  resolveWorkspacePath,
  smallEditLimit,
} from '../../workspace/workspaceIndex';

export interface WorkspaceBus {
  running(): boolean;
  broadcast(payload: unknown): void;
  busyFile?(relOrAbs: string): boolean;
}

export async function pushWorkspaceIndex(bus: WorkspaceBus, dir = ''): Promise<void> {
  if (!bus.running()) {
    return;
  }
  const listed = await listWorkspaceDir(workspaceRoot(), dir.trim().replace(/\\/g, '/'));
  bus.broadcast({
    type: 'workspaceIndex',
    dir: listed.dir,
    name: listed.name,
    entries: listed.entries,
    truncated: listed.truncated,
  });
}

export async function pushWorkspaceFile(bus: WorkspaceBus, relOrAbs: string): Promise<void> {
  if (!bus.running()) {
    return;
  }
  const resolved = resolveWorkspacePath(workspaceRoot(), relOrAbs);
  if (!resolved) {
    report(tr('wsMissing'));
    bus.broadcast({ type: 'workspaceFile', path: relOrAbs, missing: true });
    return;
  }
  const rel = plat().relativePath(resolved).replace(/\\/g, '/');
  try {
    const raw = await plat().readFile(resolved);
    if (raw.byteLength > WORKSPACE_TEXT_MAX) {
      report(tr('wsTooBig'));
      bus.broadcast({ type: 'workspaceFile', path: resolved, rel, tooLarge: true });
      return;
    }
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (bytes.includes(0)) {
      report(tr('wsBinary'));
      bus.broadcast({ type: 'workspaceFile', path: resolved, rel, binary: true });
      return;
    }
    const text = new TextDecoder('utf-8').decode(bytes);
    bus.broadcast({
      type: 'workspaceFile',
      path: resolved,
      rel,
      text,
      hash: fileHash(text),
    });
  } catch (error) {
    report(tr('wsMissing'), error);
    bus.broadcast({ type: 'workspaceFile', path: resolved, rel, missing: true });
  }
}

export async function mutateWorkspace(
  bus: WorkspaceBus,
  op: {
    action: 'create' | 'rename' | 'delete';
    dir?: string;
    path?: string;
    name?: string;
    kind?: 'file' | 'dir';
  },
): Promise<void> {
  if (!bus.running()) {
    return;
  }
  const root = workspaceRoot();
  if (op.action === 'create' && op.name && (op.kind === 'file' || op.kind === 'dir')) {
    const created = await createWorkspaceEntry(root, op.dir ?? '', op.name, op.kind);
    if (!created) {
      return;
    }
    await pushWorkspaceIndex(bus, parentRel(created.rel));
    if (created.kind === 'file') {
      await pushWorkspaceFile(bus, created.path);
    }
    return;
  }
  if (op.action === 'rename' && op.path && op.name) {
    const moved = await renameWorkspaceEntry(root, op.path, op.name);
    if (!moved) {
      return;
    }
    bus.broadcast({ type: 'workspaceMoved', from: moved.from, to: moved.to, rel: moved.rel });
    await pushWorkspaceIndex(bus, parentRel(moved.rel));
    return;
  }
  if (op.action === 'delete' && op.path) {
    const gone = await deleteWorkspaceEntry(root, op.path);
    if (!gone) {
      return;
    }
    bus.broadcast({ type: 'workspaceGone', path: gone.path, rel: gone.rel });
    await pushWorkspaceIndex(bus, parentRel(gone.rel));
  }
}

export async function saveWorkspaceFile(
  bus: WorkspaceBus,
  relOrAbs: string,
  hash: string,
  text: string,
): Promise<void> {
  if (!bus.running()) {
    return;
  }
  const resolved = resolveWorkspacePath(workspaceRoot(), relOrAbs);
  if (!resolved) {
    return;
  }
  if (bus.busyFile?.(resolved) || bus.busyFile?.(relOrAbs)) {
    return;
  }
  try {
    const raw = await plat().readFile(resolved);
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (bytes.includes(0)) {
      return;
    }
  } catch {
    // create on save
  }
  if (smallEditLimit('', text) !== 'ok') {
    return;
  }
  try {
    await plat().writeFile(resolved, Buffer.from(text, 'utf8'));
  } catch {
    return;
  }
  plat().info(tr('wsSaved', { name: path.basename(resolved) }));
  bus.broadcast({
    type: 'workspaceSaveResult',
    path: resolved,
    ok: true,
    hash: fileHash(text),
  });
}

function report(message: string, cause?: unknown): void {
  plat().warn(message);
  logWarn(cause instanceof Error ? `${message}: ${cause.message}` : message);
}

function workspaceRoot(): string {
  return plat().workspaceFolders()[0] ?? plat().cwd();
}
