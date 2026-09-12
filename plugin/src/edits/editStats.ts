import type { FileEdit } from '../core/types';

export interface EditStatsItem {
  messageId: string;
  edits: Array<{ path: string; added: number; removed: number }>;
}

/** Patch edit chips on already-open messages, including turns that are no longer in the live tail. */
export function applyEditStatsToMessages<T extends { id?: string; edits?: FileEdit[] }>(
  messages: T[],
  items: EditStatsItem[],
): T[] {
  if (!messages.length || !items.length) {
    return messages;
  }
  const byId = new Map<string, EditStatsItem['edits']>();
  for (const item of items) {
    if (item.messageId) {
      byId.set(item.messageId, item.edits);
    }
  }
  if (!byId.size) {
    return messages;
  }
  let changed = false;
  const next = messages.map((message) => {
    if (!message.id || !byId.has(message.id)) {
      return message;
    }
    changed = true;
    return { ...message, edits: byId.get(message.id) };
  });
  return changed ? next : messages;
}
