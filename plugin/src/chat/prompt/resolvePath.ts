import * as path from 'node:path';

export function isAbsoluteFsPath(filePath: string): boolean {
  return path.isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath);
}

export function resolveChatPath(filePath: string, cwd?: string): string {
  const raw = filePath.trim();
  if (!raw) {
    return raw;
  }
  if (isAbsoluteFsPath(raw)) {
    return path.normalize(raw);
  }
  const root = cwd?.trim();
  if (!root) {
    return path.normalize(raw);
  }
  return path.resolve(root, raw);
}

export async function resolveExistingChatPath(
  filePath: string,
  roots: Array<string | undefined>,
  exists: (next: string) => Promise<boolean>,
): Promise<string> {
  const raw = filePath.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (next: string) => {
    const norm = path.normalize(next);
    const key = norm.toLowerCase();
    if (!norm || seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(norm);
  };
  if (isAbsoluteFsPath(raw)) {
    add(raw);
  } else {
    for (const root of roots) {
      if (root?.trim()) {
        add(path.resolve(root.trim(), raw));
      }
    }
    add(raw);
  }
  for (const next of candidates) {
    if (await exists(next)) {
      return next;
    }
  }
  return candidates[0] ?? raw;
}
