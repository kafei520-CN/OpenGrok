import * as path from 'node:path';
import { plat } from '../../core/platform';
import { projectGrokDir, sameFsPath } from '../../core/grokDirs';
import type { PersonaItem } from '../../core/types';

const DISABLED = '.disabled';

export function parsePersonaToml(text: string): {
  description?: string;
  instructions?: string;
} {
  const description = tomlString(text, 'description');
  const instructions = tomlString(text, 'instructions');
  return { description, instructions };
}

export function parsePersonaFileName(
  fileName: string,
): { stem: string; enabled: boolean } | undefined {
  if (fileName.endsWith(`.toml${DISABLED}`)) {
    return { stem: fileName.slice(0, -(5 + DISABLED.length)), enabled: false };
  }
  if (fileName.toLowerCase().endsWith('.toml')) {
    return { stem: fileName.slice(0, -5), enabled: true };
  }
  return undefined;
}

export function safePersonaStem(filePath: string): string {
  const base = path.basename(filePath).replace(/\.toml$/i, '');
  const cleaned = base.replace(/[<>:"/\\|?*\u0000]/g, '-').trim() || 'persona';
  return cleaned.slice(0, 80);
}

export function globalPersonasDir(): string {
  return path.join(plat().homeDir(), '.grok', 'personas');
}

export function projectPersonasDir(): string | undefined {
  return projectGrokDir('personas');
}

export async function listPersonas(): Promise<PersonaItem[]> {
  const globalDir = globalPersonasDir();
  const rows = await collectPersonas(globalDir, 'global');
  const seen = new Set(rows.map((row) => normalizePath(row.filePath)));
  const projectDir = projectPersonasDir();
  if (projectDir && !sameFsPath(projectDir, globalDir, plat().os())) {
    for (const row of await collectPersonas(projectDir, 'project')) {
      const key = normalizePath(row.filePath);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function importPersonaFiles(paths: string[]): Promise<number> {
  let imported = 0;
  const destDir = globalPersonasDir();
  for (const filePath of paths) {
    if (!/\.toml$/i.test(filePath)) {
      continue;
    }
    const bytes = await plat().readFile(filePath);
    const stem = await uniqueStem(destDir, safePersonaStem(filePath));
    await plat().writeFile(path.join(destDir, `${stem}.toml`), bytes);
    imported += 1;
  }
  return imported;
}

export async function togglePersona(filePath: string): Promise<void> {
  if (filePath.endsWith(DISABLED)) {
    await moveFile(filePath, filePath.slice(0, -DISABLED.length));
    return;
  }
  await moveFile(filePath, `${filePath}${DISABLED}`);
}

export async function deletePersona(filePath: string): Promise<void> {
  await plat().deleteFile(filePath, true);
}

async function collectPersonas(
  dir: string,
  scope: PersonaItem['scope'],
): Promise<PersonaItem[]> {
  const names = await plat().readDir(dir);
  const rows: PersonaItem[] = [];
  for (const fileName of names) {
    const parsed = parsePersonaFileName(fileName);
    if (!parsed) {
      continue;
    }
    const filePath = path.join(dir, fileName);
    let meta: { description?: string; instructions?: string } = {};
    try {
      meta = parsePersonaToml(Buffer.from(await plat().readFile(filePath)).toString('utf8'));
    } catch {
      /* stem only */
    }
    const description =
      meta.description ||
      meta.instructions?.split(/\r?\n/).find((line) => line.trim())?.slice(0, 120);
    rows.push({
      id: filePath,
      name: parsed.stem,
      description,
      filePath,
      scope,
      enabled: parsed.enabled,
    });
  }
  return rows;
}

async function uniqueStem(dir: string, stem: string): Promise<string> {
  const existing = new Set(await plat().readDir(dir));
  if (!existing.has(`${stem}.toml`) && !existing.has(`${stem}.toml${DISABLED}`)) {
    return stem;
  }
  for (let n = 2; n < 100; n += 1) {
    const next = `${stem}-${n}`;
    if (!existing.has(`${next}.toml`) && !existing.has(`${next}.toml${DISABLED}`)) {
      return next;
    }
  }
  return `${stem}-${Date.now()}`;
}

async function moveFile(from: string, to: string): Promise<void> {
  const bytes = await plat().readFile(from);
  await plat().writeFile(to, bytes);
  await plat().deleteFile(from, false);
}

function normalizePath(value: string): string {
  const next = path.normalize(path.resolve(value));
  return plat().os() === 'win32' ? next.toLowerCase() : next;
}

function tomlString(text: string, key: string): string | undefined {
  const triple = text.match(new RegExp(`^${key}\\s*=\\s*"""([\\s\\S]*?)"""`, 'm'));
  if (triple) {
    return triple[1].trim() || undefined;
  }
  const quoted = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return quoted?.[1]?.trim() || undefined;
}
