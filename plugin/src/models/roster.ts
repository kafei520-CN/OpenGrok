import type { RosterActivity, RosterEntry, SessionRow, SubagentLive } from '../core/types';
import { asNum, asObject, asString } from '../core/wire';

const ACTIVITIES = new Set<RosterActivity>([
  'working',
  'idle',
  'needs_input',
  'dormant',
  'completed',
  'dead',
]);

export function parseRosterList(raw: unknown): RosterEntry[] {
  const value = unwrapResult(raw);
  const list = Array.isArray(value['sessions'])
    ? (value['sessions'] as unknown[])
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  return list
    .map(parseRosterEntry)
    .filter((row): row is RosterEntry => Boolean(row));
}

export function parseSubagentList(raw: unknown): SubagentLive[] {
  const value = unwrapResult(raw);
  const list = Array.isArray(value['subagents'])
    ? (value['subagents'] as unknown[])
    : Array.isArray(raw)
      ? (raw as unknown[])
      : [];
  return list
    .map(parseSubagent)
    .filter((row): row is SubagentLive => Boolean(row));
}

/** Fallback when the stdio agent has no live FleetView roster. */
export function rosterFromHistory(
  rows: SessionRow[],
  currentId?: string,
  streaming = false,
): RosterEntry[] {
  return rows.map((row) => {
    const current = row.id === currentId;
    const kind = (row.sessionKind ?? '').toLowerCase();
    return {
      id: row.id,
      title: row.title,
      cwd: row.cwd ?? '',
      isWorktree: kind === 'worktree' || kind.startsWith('worktree'),
      activity: current ? (streaming ? 'working' : 'idle') : 'dormant',
    };
  });
}

export function parseRosterEntry(item: unknown): RosterEntry | undefined {
  const obj = asObject(item);
  const id = asString(obj['sessionId']) ?? asString(obj['session_id']);
  if (!id) {
    return undefined;
  }
  const activityRaw = (asString(obj['activity']) ?? 'idle').toLowerCase();
  const activity = ACTIVITIES.has(activityRaw as RosterActivity)
    ? (activityRaw as RosterActivity)
    : 'idle';
  return {
    id,
    title: asString(obj['title']) ?? id.slice(0, 8),
    cwd: asString(obj['cwd']) ?? '',
    isWorktree: Boolean(obj['isWorktree'] ?? obj['is_worktree']),
    modelId: asString(obj['modelId']) ?? asString(obj['model_id']),
    activity,
    lastTurnSummary:
      asString(obj['lastTurnSummary']) ?? asString(obj['last_turn_summary']),
    resident: Boolean(obj['resident']),
  };
}

function parseSubagent(item: unknown): SubagentLive | undefined {
  const obj = asObject(item);
  const id = asString(obj['subagentId']) ?? asString(obj['subagent_id']);
  if (!id) {
    return undefined;
  }
  return {
    id,
    parentSessionId:
      asString(obj['parentSessionId']) ?? asString(obj['parent_session_id']) ?? '',
    childSessionId:
      asString(obj['childSessionId']) ?? asString(obj['child_session_id']),
    type: asString(obj['subagentType']) ?? asString(obj['subagent_type']) ?? 'general-purpose',
    description: asString(obj['description']) ?? '',
    durationMs: asNum(obj['durationMs']) ?? asNum(obj['duration_ms']) ?? 0,
    contextUsagePct:
      asNum(obj['contextUsagePct']) ?? asNum(obj['context_usage_pct']),
  };
}

function unwrapResult(raw: unknown): Record<string, unknown> {
  const obj = asObject(raw);
  const inner = obj['result'];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return asObject(inner);
  }
  return obj;
}
