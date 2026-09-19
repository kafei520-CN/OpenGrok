import type {
  AskCard,
  Attachment,
  ChatMessage,
  ChatStatus,
  PermissionPrompt,
  SessionRow,
  SessionRunState,
} from '../core/types';
import type { GoalState } from './goal';

export type ParkedSession = {
  id: string;
  cwd?: string;
  messages: ChatMessage[];
  turn: number;
  status: ChatStatus;
  error?: string;
  goal?: GoalState;
  modeId: string;
  attachments: Attachment[];
  queue: string[];
  runGen: number;
  permission?: PermissionPrompt;
  ask?: AskCard;
  /** Finished (or interrupted) while not being viewed. */
  unread?: boolean;
  /** Last turn was stopped; kept after the transcript is slimmed. */
  stopped?: boolean;
};

/** Full transcripts kept besides the current session and live background runs. */
export const PARKED_FULL_MAX = 2;

export function emptyParked(id: string, cwd?: string): ParkedSession {
  return {
    id,
    cwd,
    messages: [],
    turn: 0,
    status: 'ready',
    modeId: 'default',
    attachments: [],
    queue: [],
    runGen: 0,
  };
}

export function sessionIsLive(
  id: string,
  currentId: string | undefined,
  currentStatus: ChatStatus,
  parked: Map<string, ParkedSession>,
): boolean {
  if (id === currentId) {
    return currentStatus === 'streaming';
  }
  return parked.get(id)?.status === 'streaming';
}

export function lastAssistantInterrupted(
  messages?: Array<{ role: string; stopped?: boolean }>,
): boolean {
  return Boolean(messages?.filter((item) => item.role === 'assistant').at(-1)?.stopped);
}

export function markAssistantStopped(messages: ChatMessage[]): void {
  const last = messages.filter((item) => item.role === 'assistant').at(-1);
  if (last) {
    last.stopped = true;
    last.streaming = false;
  }
}

export function sessionRunState(
  id: string,
  currentId: string | undefined,
  currentStatus: ChatStatus,
  parked: Map<string, ParkedSession>,
): SessionRunState | undefined {
  if (sessionIsLive(id, currentId, currentStatus, parked)) {
    return 'running';
  }
  if (id === currentId) {
    return undefined;
  }
  const row = parked.get(id);
  if (!row?.unread) {
    return undefined;
  }
  return row.stopped || lastAssistantInterrupted(row.messages) ? 'stopped' : 'done';
}

export function slimParkedRow(row: ParkedSession): void {
  row.stopped = Boolean(row.stopped || lastAssistantInterrupted(row.messages));
  row.messages = [];
  row.attachments = [];
  row.queue = [];
  row.permission = undefined;
  row.ask = undefined;
}

/** Drop heavy copies of old parked chats so rapid switching cannot pin gigabytes. */
export function trimParkedSessions(
  parked: Map<string, ParkedSession>,
  currentId: string | undefined,
  recentIds: string[],
  maxFull = PARKED_FULL_MAX,
): void {
  const keepFull = new Set<string>();
  for (let i = recentIds.length - 1; i >= 0; i -= 1) {
    const id = recentIds[i];
    if (!id || id === currentId || keepFull.has(id)) {
      continue;
    }
    const row = parked.get(id);
    if (!row || row.status === 'streaming' || row.messages.length === 0) {
      continue;
    }
    keepFull.add(id);
    if (keepFull.size >= maxFull) {
      break;
    }
  }
  for (const [id, row] of parked) {
    if (id === currentId || row.status === 'streaming' || keepFull.has(id)) {
      continue;
    }
    if (row.messages.length === 0) {
      continue;
    }
    slimParkedRow(row);
  }
}

export function overlayLiveSessions(
  rows: SessionRow[] | undefined,
  currentId: string | undefined,
  currentStatus: ChatStatus,
  parked: Map<string, ParkedSession>,
): SessionRow[] {
  const list = [...(rows ?? [])];
  const seen = new Set(list.map((row) => row.id));
  for (const parkedRow of parked.values()) {
    if (seen.has(parkedRow.id)) {
      continue;
    }
    list.unshift({
      id: parkedRow.id,
      title: parkedRow.messages.find((item) => item.role === 'user')?.text?.slice(0, 42) || parkedRow.id.slice(0, 8),
      cwd: parkedRow.cwd,
    });
    seen.add(parkedRow.id);
  }
  return list.map((row) => {
    const runState = sessionRunState(row.id, currentId, currentStatus, parked);
    return {
      ...row,
      live: runState === 'running',
      runState,
    };
  });
}
