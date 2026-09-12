import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { plat } from '../../core/platform';
import { projectGrokDir, sameFsPath } from '../../core/grokDirs';
import type { SkillItem } from '../../core/types';

const execFileAsync = promisify(execFile);
const SKILL_FILE = 'SKILL.md';
const SKILL_OFF = 'SKILL.md.disabled';

export function parseSkillMeta(markdown: string): { name?: string; description?: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }
  const block = match[1];
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name: stripQuotes(name), description: stripQuotes(description) };
}

export function safeSkillDirName(raw: string): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000]/g, '-')
    .trim()
    .replace(/\s+/g, '-');
  return cleaned.slice(0, 80) || 'skill';
}

export function globalSkillsDir(): string {
  return path.join(plat().homeDir(), '.grok', 'skills');
}

export function projectSkillsDir(): string | undefined {
  return projectGrokDir('skills');
}

export async function listSkills(): Promise<SkillItem[]> {
  const globalDir = globalSkillsDir();
  const rows = await collectSkills(globalDir, 'global');
  const seen = new Set(rows.map((row) => normalizeDir(row.dirPath)));
  const projectDir = projectSkillsDir();
  if (projectDir && !sameFsPath(projectDir, globalDir, plat().os())) {
    for (const row of await collectSkills(projectDir, 'project')) {
      const key = normalizeDir(row.dirPath);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function importSkillZips(paths: string[]): Promise<number> {
  let imported = 0;
  for (const filePath of paths) {
    if (!/\.zip$/i.test(filePath)) {
      continue;
    }
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-skill-'));
    try {
      await extractZip(filePath, tmp);
      imported += await importSkillRoots(await findSkillRoots(tmp));
    } catch (error) {
      plat().warn(`skill zip skipped: ${error instanceof Error ? error.message : error}`);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }
  return imported;
}

export async function importSkillFolders(paths: string[]): Promise<number> {
  let imported = 0;
  for (const dir of paths) {
    imported += await importSkillRoots(await findSkillRoots(dir));
  }
  return imported;
}

export async function toggleSkill(dirPath: string): Promise<void> {
  const on = path.join(dirPath, SKILL_FILE);
  const off = path.join(dirPath, SKILL_OFF);
  try {
    await fs.rename(on, off);
    return;
  } catch {
    /* was disabled */
  }
  await fs.rename(off, on);
}

export async function deleteSkill(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

export async function findSkillRoots(dir: string, depth = 0): Promise<string[]> {
  if (depth > 3) {
    return [];
  }
  if (await hasSkillMarker(dir)) {
    return [dir];
  }
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const hits: string[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) {
      continue;
    }
    const child = path.join(dir, name);
    try {
      const st = await fs.stat(child);
      if (st.isDirectory()) {
        hits.push(...(await findSkillRoots(child, depth + 1)));
      }
    } catch {
      /* skip */
    }
  }
  return hits;
}

async function importSkillRoots(roots: string[]): Promise<number> {
  const destRoot = globalSkillsDir();
  await fs.mkdir(destRoot, { recursive: true });
  let imported = 0;
  for (const root of roots) {
    const meta = await readMeta(root);
    const stem = await uniqueDir(destRoot, safeSkillDirName(meta.name || path.basename(root)));
    await fs.cp(root, path.join(destRoot, stem), { recursive: true });
    imported += 1;
  }
  return imported;
}

async function collectSkills(dir: string, scope: SkillItem['scope']): Promise<SkillItem[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const rows: SkillItem[] = [];
  for (const name of names) {
    const dirPath = path.join(dir, name);
    try {
      if (!(await fs.stat(dirPath)).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    const on = path.join(dirPath, SKILL_FILE);
    const off = path.join(dirPath, SKILL_OFF);
    const enabled = await fileExists(on);
    if (!enabled && !(await fileExists(off))) {
      continue;
    }
    const meta = await readMeta(dirPath);
    rows.push({
      id: dirPath,
      name: meta.name || name,
      description: meta.description,
      dirPath,
      skillFile: enabled ? on : off,
      scope,
      enabled,
    });
  }
  return rows;
}

async function readMeta(dir: string): Promise<{ name?: string; description?: string }> {
  for (const file of [SKILL_FILE, SKILL_OFF]) {
    try {
      const text = await fs.readFile(path.join(dir, file), 'utf8');
      return parseSkillMeta(text);
    } catch {
      /* try next */
    }
  }
  return {};
}

async function hasSkillMarker(dir: string): Promise<boolean> {
  return (await fileExists(path.join(dir, SKILL_FILE))) || (await fileExists(path.join(dir, SKILL_OFF)));
}

async function uniqueDir(parent: string, stem: string): Promise<string> {
  const exists = async (name: string) => {
    try {
      await fs.access(path.join(parent, name));
      return true;
    } catch {
      return false;
    }
  };
  if (!(await exists(stem))) {
    return stem;
  }
  for (let n = 2; n < 100; n += 1) {
    const next = `${stem}-${n}`;
    if (!(await exists(next))) {
      return next;
    }
  }
  return `${stem}-${Date.now()}`;
}

/** True when a zip/tar member would extract outside `dest`. */
export function zipEntryUnsafe(dest: string, entry: string): boolean {
  const name = entry.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!name || name === '.') {
    return false;
  }
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    return true;
  }
  const parts = name.split('/').filter((part) => part && part !== '.');
  if (parts.includes('..')) {
    return true;
  }
  const root = path.resolve(dest);
  const resolved = path.resolve(root, ...parts);
  const rel = path.relative(root, resolved);
  return rel.startsWith('..') || path.isAbsolute(rel);
}

async function extractZip(zipPath: string, dest: string): Promise<void> {
  const listed = await execFileAsync('tar', ['-tf', zipPath], {
    windowsHide: true,
    maxBuffer: 8_000_000,
  });
  const destRoot = path.resolve(dest);
  for (const line of String(listed.stdout).split(/\r?\n/)) {
    if (zipEntryUnsafe(destRoot, line)) {
      throw new Error(`unsafe skill zip path: ${line.trim()}`);
    }
  }
  await fs.mkdir(dest, { recursive: true });
  await execFileAsync('tar', ['-xf', zipPath, '-C', dest], { windowsHide: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stripQuotes(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/^['"]|['"]$/g, '').trim() || undefined;
}

function normalizeDir(dir: string): string {
  const value = path.normalize(path.resolve(dir));
  return plat().os() === 'win32' ? value.toLowerCase() : value;
}
