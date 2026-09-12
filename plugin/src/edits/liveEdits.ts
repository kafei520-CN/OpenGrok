import { totals } from './edits';
import type { ChatState } from '../core/types';

export interface LiveEditSummary {
  messageId: string;
  files: number;
  added: number;
  removed: number;
}

/** Streaming turn only — the composer strip hides when the turn ends. */
export function liveEditSummary(
  state: Pick<ChatState, 'status' | 'messages'>,
): LiveEditSummary | undefined {
  if (state.status !== 'streaming') {
    return undefined;
  }
  const last = state.messages.at(-1);
  if (!last || last.role !== 'assistant' || !last.streaming) {
    return undefined;
  }
  const edits = last.edits ?? [];
  if (!edits.length) {
    return undefined;
  }
  const sum = totals(edits);
  return {
    messageId: last.id,
    files: edits.length,
    added: sum.added,
    removed: sum.removed,
  };
}

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

export function lerpInt(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * easeOutCubic(t));
}
