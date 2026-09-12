import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface CliLookupInput {
  configuredPath?: string;
  preferWorkspaceBinary: boolean;
  workspaceFolders: string[];
  homeDir: string;
  pathEnv: string;
  platform: NodeJS.Platform;
}

const BINARY_NAMES: Record<string, string[]> = {
  win32: ['grok.exe', 'grok', 'xai-grok-pager.exe', 'xai-grok-pager'],
  default: ['grok', 'xai-grok-pager'],
};

export function candidateCliPaths(input: CliLookupInput): string[] {
  const names =
    input.platform === 'win32' ? BINARY_NAMES.win32 : BINARY_NAMES.default;
  const out: string[] = [];
  const add = (value: string | undefined) => {
    if (!value) {
      return;
    }
    const resolved = path.resolve(value);
    if (!out.includes(resolved)) {
      out.push(resolved);
    }
  };

  if (input.configuredPath?.trim()) {
    add(input.configuredPath.trim());
  }

  if (input.preferWorkspaceBinary) {
    for (const folder of input.workspaceFolders) {
      add(path.join(folder, 'target', 'release', names[names.length - 1]));
      add(path.join(folder, 'target', 'debug', names[names.length - 1]));
    }
  }

  add(path.join(input.homeDir, '.grok', 'bin', names[0]));
  if (names[1] && names[1] !== names[0]) {
    add(path.join(input.homeDir, '.grok', 'bin', names[1]));
  }

  const pathParts = input.pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of pathParts) {
    if (!input.preferWorkspaceBinary && isWorkspaceBuildDir(dir, input.workspaceFolders)) {
      continue;
    }
    for (const name of names) {
      add(path.join(dir, name));
    }
  }

  return out;
}

function isWorkspaceBuildDir(dir: string, folders: string[]): boolean {
  const norm = path.normalize(dir).toLowerCase();
  return folders.some((folder) => {
    const root = path.normalize(folder).toLowerCase();
    return (
      norm.startsWith(path.join(root, 'target')) ||
      norm.startsWith(path.join(root, 'target', 'release')) ||
      norm.startsWith(path.join(root, 'target', 'debug'))
    );
  });
}

export function firstExistingCli(candidates: string[]): string | undefined {
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

export function resolveGrokBinary(input: CliLookupInput): string | undefined {
  return firstExistingCli(candidateCliPaths(input));
}

export function defaultHomeDir(): string {
  return os.homedir();
}

export function installHint(platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return 'irm https://x.ai/cli/install.ps1 | iex';
  }
  return 'curl -fsSL https://x.ai/cli/install.sh | bash';
}

export function parseSemver(version: string): number[] | undefined {
  const match = version.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersionAtLeast(actual: string, minimum: string): boolean {
  const a = parseSemver(actual);
  const b = parseSemver(minimum);
  if (!a || !b) {
    return true;
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) {
      return true;
    }
    if (a[i] < b[i]) {
      return false;
    }
  }
  return true;
}
