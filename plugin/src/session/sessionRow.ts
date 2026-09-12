import type { SessionRow } from '../core/types';
import { asNum, asObject, asString } from '../core/wire';

/** Parse ACP session summary rows and drop empty / hidden history. */

export function parseSessionRow(item: unknown): SessionRow | undefined {
  const obj = asObject(item);
  const info = asObject(obj['info']);
  const legacy = asObject(obj['legacy']);
  const nestedInfo = asObject(legacy['info']);
  const id =
    asString(obj['id']) ??
    asString(obj['sessionId']) ??
    asString(obj['session_id']) ??
    asString(info['id']) ??
    asString(nestedInfo['id']) ??
    asString(asObject(info['id'])['id']) ??
    '';
  if (!id) {
    return undefined;
  }
  const generated = asString(obj['generated_title']) ?? asString(obj['generatedTitle']);
  const summary = asString(obj['session_summary']) ?? asString(obj['sessionSummary']);
  const named = asString(obj['title']) ?? asString(legacy['title']);
  const lastTurn =
    asString(obj['last_turn_summary']) ?? asString(obj['lastTurnSummary']);
  const title = humanTitle(id, generated, summary, named, lastTurn);
  const hidden = obj['hidden'] === true;
  const sessionKind = asString(obj['session_kind']) ?? asString(obj['sessionKind']);
  const numChatMessages =
    asNum(obj['num_chat_messages']) ?? asNum(obj['numChatMessages']);
  const numMessages = asNum(obj['num_messages']) ?? asNum(obj['numMessages']);
  return {
    id,
    title,
    updatedAt: asString(obj['updated_at']) ?? asString(obj['updatedAt']),
    cwd: asString(info['cwd']) ?? asString(nestedInfo['cwd']),
    hidden,
    sessionKind,
    numChatMessages,
    numMessages,
  };
}

export function sessionHasHistory(row: SessionRow): boolean {
  if (row.hidden) {
    return false;
  }
  const kind = row.sessionKind ?? '';
  if (kind.startsWith('subagent') || kind === 'headless') {
    return false;
  }
  if (!row.title.trim() || isSessionIdLike(row.title, row.id)) {
    return false;
  }
  // New ACP sessions persist system + reminder as num_chat_messages=2 with
  // num_messages=0. That is not a user conversation.
  if (row.numMessages !== undefined && row.numMessages < 1) {
    return false;
  }
  if (
    row.numMessages === undefined &&
    row.numChatMessages !== undefined &&
    row.numChatMessages <= 2
  ) {
    return false;
  }
  return true;
}

export function isSessionIdLike(text: string, id?: string): boolean {
  const value = text.trim();
  if (!value) {
    return false;
  }
  if (id && value === id) {
    return true;
  }
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^[0-9a-f]{26,32}$/i.test(value)
  );
}

function humanTitle(id: string, ...candidates: Array<string | undefined>): string {
  for (const raw of candidates) {
    const text = raw?.trim() ?? '';
    if (text && !isSessionIdLike(text, id)) {
      return text;
    }
  }
  return '';
}
