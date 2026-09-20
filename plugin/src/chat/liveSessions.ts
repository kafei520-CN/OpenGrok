import type {
  AskCard,
  Attachment,
  ChatMessage,
  ChatStatus,
  PermissionPrompt,
  QueuedPrompt,
  SessionRow,
  SessionRunState,
} from '../core/types';
import type { GoalState } from './goal';

export type ParkedSession = {
  id: string;
  title?: string;
  cwd?: string;
  messages: ChatMessage[];
  turn: number;
  status: ChatStatus;
  error?: string;
  goal?: GoalState;
  modeId: string;
  attachments: Attachment[];
  queue: QueuedPrompt[];
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

export function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    tools: message.tools.map((tool) => ({ ...tool })),
    steps: message.steps?.map((step) => ({ ...step })),
    edits: message.edits?.map((edit) => ({ ...edit })),
    images: message.images?.map((image) => ({ ...image })),
    files: message.files?.map((file) => ({ ...file })),
  }));
}

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
  if (!row.title?.trim()) {
    row.title = parkedSessionTitle(row, row.id);
  }
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

export function parkedSessionTitle(row?: ParkedSession, fallbackId?: string): string {
  const titled = row?.title?.trim();
  if (titled) {
    return titled;
  }
  const fromUser = row?.messages.find((item) => item.role === 'user')?.text?.trim();
  if (fromUser) {
    return fromUser.slice(0, 42);
  }
  return fallbackId?.slice(0, 8) ?? '';
}

export function resolveIncomingSessionId(opts: {
  sessionId?: string;
  currentId?: string;
  currentStreaming: boolean;
  replaying?: boolean;
  isReplay?: boolean;
  parked: Map<string, ParkedSession>;
  promptSessionId?: string;
}): string | undefined {
  if (opts.sessionId) {
    return opts.sessionId;
  }
  if (opts.replaying && opts.isReplay && opts.currentId) {
    return opts.currentId;
  }
  if (opts.currentStreaming && opts.currentId) {
    return opts.currentId;
  }
  const live = [...opts.parked.values()].filter((row) => row.status === 'streaming');
  if (live.length === 1 && !opts.isReplay) {
    return live[0]?.id;
  }
  if (opts.replaying && opts.currentId) {
    return opts.currentId;
  }
  if (opts.promptSessionId) {
    return opts.promptSessionId;
  }
  return opts.currentId;
}

export function overlayLiveSessions(
  rows: SessionRow[] | undefined,
  currentId: string | undefined,
  currentStatus: ChatStatus,
  parked: Map<string, ParkedSession>,
  currentMessages?: ChatMessage[],
  currentCwd?: string,
): SessionRow[] {
  const list = [...(rows ?? [])];
  const seen = new Set(list.map((row) => row.id));
  for (const parkedRow of parked.values()) {
    if (seen.has(parkedRow.id)) {
      continue;
    }
    list.unshift({
      id: parkedRow.id,
      title: parkedSessionTitle(parkedRow, parkedRow.id),
      cwd: parkedRow.cwd,
    });
    seen.add(parkedRow.id);
  }
  if (currentId && !seen.has(currentId)) {
    const fromUser = currentMessages?.find((item) => item.role === 'user')?.text?.trim().slice(0, 42);
    list.unshift({
      id: currentId,
      title: fromUser || parkedSessionTitle(parked.get(currentId), currentId),
      cwd: currentCwd,
    });
    seen.add(currentId);
  }
  return list.map((row) => {
    const runState = sessionRunState(row.id, currentId, currentStatus, parked);
    const parkedRow = parked.get(row.id);
    const currentTitle =
      row.id === currentId
        ? currentMessages?.find((item) => item.role === 'user')?.text?.trim().slice(0, 42)
        : undefined;
    const title = row.title?.trim() || currentTitle || parkedSessionTitle(parkedRow, row.id);
    return {
      ...row,
      title,
      live: runState === 'running',
      runState,
    };
  });
}
