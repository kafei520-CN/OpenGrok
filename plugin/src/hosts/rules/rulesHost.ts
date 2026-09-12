import * as path from 'node:path';
import { plat } from '../../core/platform';
import { projectGrokDir, sameFsPath } from '../../core/grokDirs';
import type { RuleItem } from '../../core/types';

const DISABLED = '.disabled';

/** Named instruction files Grok loads from ~/.claude and ~/.cursor. */
export const COMPAT_NAMED_RULES = [
  'AGENTS.md',
  'Agents.md',
  'AGENT.md',
  'Claude.md',
  'CLAUDE.md',
  'CLAUDE.local.md',
];

export function parseRuleFileName(fileName: string): { name: string; enabled: boolean } | undefined {
  if (fileName.endsWith(`.md${DISABLED}`)) {
    return { name: fileName.slice(0, -(3 + DISABLED.length)), enabled: false };
  }
  if (fileName.toLowerCase().endsWith('.md')) {
    return { name: fileName.slice(0, -3), enabled: true };
  }
  return undefined;
}

export function safeRuleStem(filePath: string): string {
  const base = path.basename(filePath).replace(/\.(md|txt)$/i, '');
  const cleaned = base.replace(/[<>:"/\\|?*\u0000]/g, '-').trim() || 'rule';
  return cleaned.slice(0, 80);
}

export function globalRulesDir(): string {
  return path.join(plat().homeDir(), '.grok', 'rules');
}

export function projectRulesDir(): string | undefined {
  return projectGrokDir('rules');
}

export async function listRules(): Promise<RuleItem[]> {
  const home = plat().homeDir();
  const workspace = plat().workspaceFolders()[0];
  const rows: RuleItem[] = [];
  const seen = new Set<string>();
  const add = async (batch: Promise<RuleItem[]>) => {
    for (const row of await batch) {
      const key = normalizeDir(row.filePath);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push(row);
    }
  };
  await add(collectRules(globalRulesDir(), 'global', 'grok'));
  const projectDir = projectRulesDir();
  if (projectDir && !sameFsPath(projectDir, globalRulesDir(), plat().os())) {
    await add(collectRules(projectDir, 'project', 'grok'));
  }
  await add(collectNamed(path.join(home, '.claude'), 'global', 'claude'));
  await add(collectRules(path.join(home, '.claude', 'rules'), 'global', 'claude'));
  await add(collectNamed(path.join(home, '.cursor'), 'global', 'cursor'));
  await add(collectRules(path.join(home, '.cursor', 'rules'), 'global', 'cursor'));
  if (workspace) {
    await add(collectNamed(path.join(workspace, '.claude'), 'project', 'claude'));
    await add(collectRules(path.join(workspace, '.claude', 'rules'), 'project', 'claude'));
    await add(collectNamed(path.join(workspace, '.cursor'), 'project', 'cursor'));
    await add(collectRules(path.join(workspace, '.cursor', 'rules'), 'project', 'cursor'));
    await add(collectNamed(workspace, 'project', 'grok'));
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function importRuleFiles(paths: string[]): Promise<number> {
  let imported = 0;
  const destDir = globalRulesDir();
  for (const filePath of paths) {
    if (!/\.(md|txt)$/i.test(filePath)) {
      continue;
    }
    const bytes = await plat().readFile(filePath);
    const stem = await uniqueStem(destDir, safeRuleStem(filePath));
    await plat().writeFile(path.join(destDir, `${stem}.md`), bytes);
    imported += 1;
  }
  return imported;
}

export async function toggleRule(filePath: string): Promise<void> {
  if (filePath.endsWith(DISABLED)) {
    await moveFile(filePath, filePath.slice(0, -DISABLED.length));
    return;
  }
  await moveFile(filePath, `${filePath}${DISABLED}`);
}

export async function deleteRule(filePath: string): Promise<void> {
  await plat().deleteFile(filePath, true);
}

async function collectRules(
  dir: string,
  scope: RuleItem['scope'],
  origin: NonNullable<RuleItem['origin']>,
): Promise<RuleItem[]> {
  let names: string[];
  try {
    names = await plat().readDir(dir);
  } catch {
    return [];
  }
  const rows: RuleItem[] = [];
  for (const fileName of names) {
    const parsed = parseRuleFileName(fileName);
    if (!parsed) {
      continue;
    }
    const filePath = path.join(dir, fileName);
    rows.push({
      id: filePath,
      name: parsed.name,
      filePath,
      scope,
      origin,
      enabled: parsed.enabled,
    });
  }
  return rows;
}

async function collectNamed(
  dir: string,
  scope: RuleItem['scope'],
  origin: NonNullable<RuleItem['origin']>,
): Promise<RuleItem[]> {
  let names: string[];
  try {
    names = await plat().readDir(dir);
  } catch {
    return [];
  }
  const allow = new Set(COMPAT_NAMED_RULES.map((item) => item.toLowerCase()));
  const seen = new Set<string>();
  const rows: RuleItem[] = [];
  for (const fileName of names) {
    const parsed = parseRuleFileName(fileName);
    if (!parsed) {
      continue;
    }
    const live = parsed.enabled ? fileName : fileName.slice(0, -DISABLED.length);
    const key = live.toLowerCase();
    if (!allow.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push({
      id: path.join(dir, fileName),
      name: live,
      filePath: path.join(dir, fileName),
      scope,
      origin,
      enabled: parsed.enabled,
    });
  }
  return rows;
}

async function uniqueStem(dir: string, stem: string): Promise<string> {
  const existing = new Set(await plat().readDir(dir));
  if (!existing.has(`${stem}.md`) && !existing.has(`${stem}.md${DISABLED}`)) {
    return stem;
  }
  for (let n = 2; n < 100; n += 1) {
    const next = `${stem}-${n}`;
    if (!existing.has(`${next}.md`) && !existing.has(`${next}.md${DISABLED}`)) {
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

function normalizeDir(dir: string): string {
  const value = path.normalize(path.resolve(dir));
  return plat().os() === 'win32' ? value.toLowerCase() : value;
}
