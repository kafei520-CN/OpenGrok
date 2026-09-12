import * as path from 'node:path';
import { plat } from './platform';

/** True when two filesystem paths point at the same directory. */
export function sameFsPath(a: string, b: string, os: NodeJS.Platform): boolean {
  const left = path.normalize(path.resolve(a));
  const right = path.normalize(path.resolve(b));
  return os === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** True when `filePath` is `root` or a descendant. */
export function pathInside(root: string, filePath: string, os: NodeJS.Platform): boolean {
  const base = path.normalize(path.resolve(root));
  const target = path.normalize(path.resolve(filePath));
  const left = os === 'win32' ? base.toLowerCase() : base;
  const right = os === 'win32' ? target.toLowerCase() : target;
  if (left === right) {
    return true;
  }
  const rel = path.relative(left, right);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function pathInsideAny(roots: string[], filePath: string, os: NodeJS.Platform): boolean {
  return roots.some((root) => pathInside(root, filePath, os));
}

/**
 * Project `.grok/<kind>` directory, or undefined when there is no workspace
 * or it would be the same as `~/.grok/<kind>` (empty window, home folder).
 */
export type GrokKind = 'skills' | 'rules' | 'agents' | 'personas';

export function resolveProjectGrokDir(
  workspaceFolders: string[],
  homeDir: string,
  kind: GrokKind,
  os: NodeJS.Platform,
): string | undefined {
  const folder = workspaceFolders[0];
  if (!folder) {
    return undefined;
  }
  const dir = path.join(folder, '.grok', kind);
  if (sameFsPath(dir, path.join(homeDir, '.grok', kind), os)) {
    return undefined;
  }
  return dir;
}

export function projectGrokDir(kind: GrokKind): string | undefined {
  return resolveProjectGrokDir(
    plat().workspaceFolders(),
    plat().homeDir(),
    kind,
    plat().os(),
  );
}
