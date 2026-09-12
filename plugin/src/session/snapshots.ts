export type SnapshotSource = 'disk' | 'tool' | 'git' | 'session';

export interface FileSnapshot {
  absPath: string;
  displayPath: string;
  existed: boolean;
  previous?: string;
  source?: SnapshotSource;
}

export type RevertPlan =
  | { action: 'restore'; absPath: string; previous: string }
  | { action: 'delete'; absPath: string }
  | { action: 'skip'; absPath: string; reason: 'missing-original' };

export const MAX_SNAPSHOT_CHARS = 1_500_000;

export function normalizeFsPath(filePath: string): string {
  const trimmed = filePath.trim().replace(/\\/g, '/');
  return trimmed.replace(/^([a-zA-Z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);
}

export function alreadyCaptured(list: FileSnapshot[], absPath: string): boolean {
  const key = normalizeFsPath(absPath);
  return list.some(
    (item) => normalizeFsPath(item.absPath) === key && (item.source === 'disk' || item.source === undefined),
  );
}

export function addSnapshot(list: FileSnapshot[], snap: FileSnapshot): FileSnapshot[] {
  const key = normalizeFsPath(snap.absPath);
  const same = list
    .map((item, index) => ({ item, index }))
    .filter((row) => normalizeFsPath(row.item.absPath) === key);
  if (same.length === 0) {
    return [...list, snap];
  }
  const source = snap.source ?? 'disk';
  const existing = same.find((row) => (row.item.source ?? 'disk') === source);
  if (existing) {
    return list;
  }
  if (source === 'tool') {
    return list;
  }
  if (source === 'disk') {
    const tool = same.find((row) => row.item.source === 'tool');
    if (tool) {
      const next = [...list];
      next[tool.index] = snap;
      return next;
    }
  }
  return [...list, snap];
}

/** Tool oldText is often a hunk, not the whole file. Reject that as a baseline. */
export function isFullFileBaseline(before: string, after: string): boolean {
  if (before === '') {
    return true;
  }
  const beforeLines = before.split('\n').length;
  const afterLines = after.split('\n').length;
  if (beforeLines < 30 && afterLines < 30) {
    return false;
  }
  if (afterLines >= 30 && beforeLines * 2 + 20 < afterLines) {
    return false;
  }
  if (beforeLines >= 30 && afterLines * 2 + 20 < beforeLines) {
    return false;
  }
  return true;
}

export function sameText(left: string, right: string): boolean {
  const norm = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return norm(left) === norm(right);
}

/** Prefer the live disk capture. Session-owned pairs and git HEAD are fallbacks. */
export function pickBeforeAfter(input: {
  snapshots: FileSnapshot[];
  previous?: string;
  next?: string;
  afterDisk: string;
}): { before: string; after: string } | undefined {
  const { snapshots, previous, next, afterDisk } = input;
  if (snapshots.some((item) => !item.existed)) {
    return { before: '', after: afterDisk };
  }
  const disk = snapshots.find((item) => item.source === 'disk' || item.source === undefined);
  const git = snapshots.find((item) => item.source === 'git');
  if (disk?.previous !== undefined && !sameText(disk.previous, afterDisk)) {
    return { before: disk.previous, after: afterDisk };
  }
  if (
    previous !== undefined &&
    !sameText(previous, afterDisk) &&
    isFullFileBaseline(previous, afterDisk)
  ) {
    return { before: previous, after: afterDisk };
  }
  if (
    previous !== undefined &&
    next !== undefined &&
    isFullFileBaseline(previous, afterDisk) &&
    isFullFileBaseline(next, afterDisk)
  ) {
    return { before: previous, after: next };
  }
  // git show HEAD is a whole file; do not apply the hunk-size heuristic.
  if (git?.previous !== undefined && !sameText(git.previous, afterDisk)) {
    return { before: git.previous, after: afterDisk };
  }
  return undefined;
}

export function planRevert(list: FileSnapshot[]): RevertPlan[] {
  const byPath = new Map<string, FileSnapshot>();
  const rank = (source: SnapshotSource | undefined): number => {
    if (source === 'disk' || source === undefined) {
      return 0;
    }
    if (source === 'session') {
      return 1;
    }
    if (source === 'git') {
      return 2;
    }
    return 3;
  };
  for (const snap of list) {
    const key = normalizeFsPath(snap.absPath);
    const current = byPath.get(key);
    if (!current || rank(snap.source) < rank(current.source)) {
      byPath.set(key, snap);
    }
  }
  return [...byPath.values()].map((snap) => {
    if (!snap.existed) {
      return { action: 'delete', absPath: snap.absPath };
    }
    if (snap.previous === undefined) {
      return { action: 'skip', absPath: snap.absPath, reason: 'missing-original' };
    }
    return { action: 'restore', absPath: snap.absPath, previous: snap.previous };
  });
}

export function isProbablyText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
  return !sample.includes(0);
}
