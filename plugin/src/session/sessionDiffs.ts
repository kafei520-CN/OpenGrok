import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { logError } from '../core/logger';
import { normalizeFsPath } from './snapshots';

/** Frozen before/after for one file in one assistant turn. */
export interface StoredFileDiff {
  path: string;
  absPath: string;
  before: string;
  after: string;
}

export interface StoredTurnDiff {
  files: StoredFileDiff[];
}

export function safeSessionFile(sessionId: string): string {
  const trimmed = sessionId.trim();
  const safe = trimmed.replace(/[^A-Za-z0-9._-]/g, '_');
  return safe.slice(0, 180) || 'session';
}

export function reviewDir(home = os.homedir()): string {
  return path.join(home, '.grok', 'review');
}

export function reviewFile(sessionId: string, home = os.homedir()): string {
  return path.join(reviewDir(home), `${safeSessionFile(sessionId)}.json`);
}

export function editTurnIndex(
  messages: Array<{ id: string; role: string; edits?: unknown[] }>,
  messageId: string,
): number {
  let index = 0;
  for (const message of messages) {
    if (message.role !== 'assistant' || !(message.edits && message.edits.length)) {
      continue;
    }
    if (message.id === messageId) {
      return index;
    }
    index += 1;
  }
  return -1;
}

export function findTurn(turns: StoredTurnDiff[], ordinal: number): StoredTurnDiff | undefined {
  if (ordinal < 0) {
    return undefined;
  }
  const byOrd = turns[ordinal];
  if (byOrd && byOrd.files.length > 0) {
    return byOrd;
  }
  return undefined;
}

export function upsertTurn(
  turns: StoredTurnDiff[],
  ordinal: number,
  files: StoredFileDiff[],
): StoredTurnDiff[] {
  if (ordinal < 0 || files.length === 0) {
    return turns;
  }
  const next = turns.slice();
  while (next.length < ordinal) {
    next.push({ files: [] });
  }
  const turn: StoredTurnDiff = { files };
  if (ordinal === next.length) {
    next.push(turn);
  } else {
    next[ordinal] = turn;
  }
  return next;
}

export function trimTurns(turns: StoredTurnDiff[], count: number): StoredTurnDiff[] {
  if (count < 0 || turns.length <= count) {
    return turns;
  }
  return turns.slice(0, count);
}

export function removeTurn(turns: StoredTurnDiff[], ordinal: number): StoredTurnDiff[] {
  if (ordinal < 0 || ordinal >= turns.length) {
    return turns;
  }
  return [...turns.slice(0, ordinal), ...turns.slice(ordinal + 1)];
}

export function parseSessionDiffs(raw: unknown): StoredTurnDiff[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [];
  }
  const turns = (raw as { turns?: unknown }).turns;
  if (!Array.isArray(turns)) {
    return [];
  }
  const out: StoredTurnDiff[] = [];
  for (const turn of turns) {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
      out.push({ files: [] });
      continue;
    }
    const filesRaw = (turn as { files?: unknown }).files;
    if (!Array.isArray(filesRaw)) {
      out.push({ files: [] });
      continue;
    }
    const files: StoredFileDiff[] = [];
    for (const file of filesRaw) {
      const parsed = parseFile(file);
      if (parsed) {
        files.push(parsed);
      }
    }
    out.push({ files });
  }
  return out;
}

export function serializeSessionDiffs(sessionId: string, turns: StoredTurnDiff[]): string {
  return `${JSON.stringify({ v: 1, sessionId, turns })}\n`;
}

export async function readStoredTurns(sessionId: string, home = os.homedir()): Promise<StoredTurnDiff[]> {
  if (!sessionId) {
    return [];
  }
  try {
    const raw = await fs.readFile(reviewFile(sessionId, home), 'utf8');
    return parseSessionDiffs(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export async function writeStoredTurns(
  sessionId: string,
  turns: StoredTurnDiff[],
  home = os.homedir(),
): Promise<void> {
  if (!sessionId) {
    return;
  }
  try {
    await fs.mkdir(reviewDir(home), { recursive: true });
    await fs.writeFile(reviewFile(sessionId, home), serializeSessionDiffs(sessionId, turns), 'utf8');
  } catch (error) {
    logError(`review persist ${sessionId}`, error);
  }
}

export async function deleteStoredTurns(sessionId: string, home = os.homedir()): Promise<void> {
  if (!sessionId) {
    return;
  }
  try {
    await fs.unlink(reviewFile(sessionId, home));
  } catch {
    /* missing */
  }
}

export function storedFileMatches(file: StoredFileDiff, onlyPath: string): boolean {
  const want = normalizeFsPath(onlyPath);
  const abs = normalizeFsPath(file.absPath);
  const rel = normalizeFsPath(file.path);
  return (
    abs === want ||
    rel === want ||
    abs.endsWith(`/${want}`) ||
    want.endsWith(`/${abs}`) ||
    rel.endsWith(`/${want}`) ||
    want.endsWith(`/${rel}`)
  );
}

function parseFile(raw: unknown): StoredFileDiff | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const filePath = typeof obj['path'] === 'string' ? obj['path'] : '';
  const absPath = typeof obj['absPath'] === 'string' ? obj['absPath'] : '';
  if (!filePath && !absPath) {
    return undefined;
  }
  return {
    path: filePath || absPath,
    absPath: absPath || filePath,
    before: typeof obj['before'] === 'string' ? obj['before'] : '',
    after: typeof obj['after'] === 'string' ? obj['after'] : '',
  };
}
