import type {
  AskCard,
  Attachment,
  ChatMessage,
  ChatStatus,
  PermissionPrompt,
  SessionRow,
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
};

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
  return list.map((row) => ({
    ...row,
    live: sessionIsLive(row.id, currentId, currentStatus, parked),
  }));
}
