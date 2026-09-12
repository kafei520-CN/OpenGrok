import * as path from 'node:path';
import { plat } from '../../core/platform';
import { projectGrokDir, sameFsPath } from '../../core/grokDirs';
import type { AgentDefItem } from '../../core/types';

const DISABLED = '.disabled';

export const BUILTIN_AGENTS: Array<{ name: string; description: string }> = [
  { name: 'grok-build', description: 'Default Grok Build session' },
  { name: 'explore', description: 'Read-only research agent' },
  { name: 'plan', description: 'Planning agent; does not edit files' },
  { name: 'general-purpose', description: 'Full-capability agent' },
];

export function parseAgentFrontmatter(
  markdown: string,
): { name?: string; description?: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }
  const block = match[1];
  const name = stripQuotes(block.match(/^name:\s*(.+)$/m)?.[1]?.trim());
  const description = stripQuotes(block.match(/^description:\s*(.+)$/m)?.[1]?.trim());
  return { name, description };
}

export function parseAgentFileName(
  fileName: string,
): { stem: string; enabled: boolean } | undefined {
  if (fileName.endsWith(`.md${DISABLED}`)) {
    return { stem: fileName.slice(0, -(3 + DISABLED.length)), enabled: false };
  }
  if (fileName.toLowerCase().endsWith('.md')) {
    return { stem: fileName.slice(0, -3), enabled: true };
  }
  return undefined;
}

export function wrapAgentMarkdown(name: string, body: string): string {
  if (/^---\r?\n/.test(body)) {
    return body;
  }
  return `---\nname: ${name}\ndescription: Custom agent\n---\n\n${body}`;
}

export function safeAgentStem(filePath: string): string {
  const base = path.basename(filePath).replace(/\.(md|txt)$/i, '');
  const cleaned = base.replace(/[<>:"/\\|?*\u0000]/g, '-').trim() || 'agent';
  return cleaned.slice(0, 80);
}

export function globalAgentsDir(): string {
  return path.join(plat().homeDir(), '.grok', 'agents');
}

export function projectAgentsDir(): string | undefined {
  return projectGrokDir('agents');
}

export async function listAgents(): Promise<AgentDefItem[]> {
  const globalDir = globalAgentsDir();
  const files = await collectAgents(globalDir, 'global');
  const seen = new Set(files.map((row) => normalizePath(row.filePath ?? row.name)));
  const projectDir = projectAgentsDir();
  if (projectDir && !sameFsPath(projectDir, globalDir, plat().os())) {
    for (const row of await collectAgents(projectDir, 'project')) {
      const key = normalizePath(row.filePath ?? row.name);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      files.push(row);
    }
  }
  const fileNames = new Set(files.map((row) => row.name.toLowerCase()));
  const builtins: AgentDefItem[] = BUILTIN_AGENTS.filter(
    (item) => !fileNames.has(item.name.toLowerCase()),
  ).map((item) => ({
    id: `builtin:${item.name}`,
    name: item.name,
    description: item.description,
    scope: 'builtin',
    enabled: true,
  }));
  return [...builtins, ...files.sort((a, b) => a.name.localeCompare(b.name))];
}

export async function importAgentFiles(paths: string[]): Promise<number> {
  let imported = 0;
  const destDir = globalAgentsDir();
  for (const filePath of paths) {
    if (!/\.(md|txt)$/i.test(filePath)) {
      continue;
    }
    const bytes = await plat().readFile(filePath);
    const stem = await uniqueStem(destDir, safeAgentStem(filePath));
    const body = wrapAgentMarkdown(stem, Buffer.from(bytes).toString('utf8'));
    await plat().writeFile(path.join(destDir, `${stem}.md`), Buffer.from(body, 'utf8'));
    imported += 1;
  }
  return imported;
}

export async function toggleAgent(filePath: string): Promise<void> {
  if (filePath.endsWith(DISABLED)) {
    await moveFile(filePath, filePath.slice(0, -DISABLED.length));
    return;
  }
  await moveFile(filePath, `${filePath}${DISABLED}`);
}

export async function deleteAgent(filePath: string): Promise<void> {
  await plat().deleteFile(filePath, true);
}

async function collectAgents(
  dir: string,
  scope: 'global' | 'project',
): Promise<AgentDefItem[]> {
  const names = await plat().readDir(dir);
  const rows: AgentDefItem[] = [];
  for (const fileName of names) {
    const parsed = parseAgentFileName(fileName);
    if (!parsed) {
      continue;
    }
    const filePath = path.join(dir, fileName);
    let meta: { name?: string; description?: string } = {};
    try {
      meta = parseAgentFrontmatter(Buffer.from(await plat().readFile(filePath)).toString('utf8'));
    } catch {
      /* keep stem */
    }
    rows.push({
      id: filePath,
      name: meta.name || parsed.stem,
      description: meta.description,
      filePath,
      scope,
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

function normalizePath(value: string): string {
  const next = path.normalize(path.resolve(value));
  return plat().os() === 'win32' ? next.toLowerCase() : next;
}

function stripQuotes(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/^['"]|['"]$/g, '');
}
