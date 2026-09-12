import * as fs from 'node:fs';
import * as path from 'node:path';

/** Top-level folders that usually mean a large checkout. Cheap existsSync only. */
const HEAVY_MARKERS = [
  'target',
  'node_modules',
  'crates',
  'vendor',
  'third_party',
  '.gradle',
  'Pods',
  'bazel-out',
  '.next',
];

export interface StartupHints {
  skipGitStatus: boolean;
  skipProjectLayout: boolean;
}

export function isHeavyWorkspace(
  roots: string[],
  exists: (filePath: string) => boolean = (filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  },
): boolean {
  for (const root of roots) {
    if (!root) {
      continue;
    }
    for (const name of HEAVY_MARKERS) {
      if (exists(path.join(root, name))) {
        return true;
      }
    }
  }
  return false;
}

export function workspaceStartupHints(
  roots: string[],
  exists?: (filePath: string) => boolean,
): StartupHints | undefined {
  if (!isHeavyWorkspace(roots, exists)) {
    return undefined;
  }
  return { skipGitStatus: true, skipProjectLayout: true };
}
