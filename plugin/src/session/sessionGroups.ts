import type { SessionRow } from '../core/types';

export type SessionListMode = 'list' | 'workspace';

export interface SessionGroup {
  key: string;
  label: string;
  path?: string;
  current: boolean;
  sessions: SessionRow[];
}

export function normalizeWorkspacePath(raw?: string): string {
  const text = (raw ?? '').trim();
  if (!text) {
    return '';
  }
  return text.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function workspaceFolderLabel(raw?: string): string {
  const text = (raw ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!text) {
    return '';
  }
  const parts = text.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? text;
  return last.replace(/^[A-Za-z]:$/, text);
}

export function groupSessionsByWorkspace(sessions: SessionRow[], cwd?: string): SessionGroup[] {
  const currentKey = normalizeWorkspacePath(cwd);
  const groups = new Map<string, SessionGroup>();
  for (const row of sessions) {
    const key = normalizeWorkspacePath(row.cwd);
    const existing = groups.get(key);
    if (existing) {
      existing.sessions.push(row);
      continue;
    }
    groups.set(key, {
      key,
      label: workspaceFolderLabel(row.cwd),
      path: row.cwd,
      current: Boolean(key && currentKey && key === currentKey),
      sessions: [row],
    });
  }
  return [...groups.values()].sort((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    if (!left.key !== !right.key) {
      return left.key ? -1 : 1;
    }
    return latestStamp(right).localeCompare(latestStamp(left));
  });
}

function latestStamp(group: SessionGroup): string {
  return group.sessions.reduce((latest, row) => {
    const stamp = row.updatedAt ?? '';
    return stamp > latest ? stamp : latest;
  }, '');
}
