import * as path from 'node:path';
import { plat } from '../../core/platform';
import type { MemoryFile } from '../../core/types';

export function globalMemoryDir(): string {
  return path.join(plat().homeDir(), '.grok', 'memory');
}

export async function listMemoryFiles(): Promise<MemoryFile[]> {
  const root = globalMemoryDir();
  const names = await plat().readDir(root);
  const rows: MemoryFile[] = [];
  for (const name of names) {
    if (name === 'MEMORY.md') {
      const filePath = path.join(root, name);
      rows.push({
        id: filePath,
        name,
        filePath,
        scope: 'global',
      });
      continue;
    }
    if (name.startsWith('.')) {
      continue;
    }
    const filePath = path.join(root, name, 'MEMORY.md');
    if (await plat().fileExists(filePath)) {
      rows.push({
        id: filePath,
        name,
        filePath,
        scope: 'workspace',
      });
    }
  }
  return rows.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
}

export function latestPlan(messages: Array<{ plan?: string }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const plan = messages[i]?.plan?.trim();
    if (plan) {
      return plan;
    }
  }
  return '';
}
