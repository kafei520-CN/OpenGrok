import { plat } from '../core/platform';

const DEPRECATED_KEY = 'session.deprecatedTurns';

export type DeprecatedMessage = {
  id: string;
  role: string;
  text?: string;
  promptIndex?: number;
  deprecated?: boolean;
  deprecatedNoted?: boolean;
};

export type DeprecatedStamp = { promptIndex?: number; text: string };

/**
 * Mark the clicked assistant turn, walking outward from that message.
 * The previous user bubble is the start. The next user bubble is the end.
 * No turn count is involved, so a hidden prompt cannot slide the mark.
 */
export function deprecateClickedTurn(messages: DeprecatedMessage[], messageId: string): boolean {
  const idx = messages.findIndex((item) => item.id === messageId);
  if (idx < 0 || messages[idx]?.role !== 'assistant') {
    return false;
  }
  let from = idx;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      from = i;
      break;
    }
  }
  let end = messages.length;
  for (let i = idx + 1; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      end = i;
      break;
    }
  }
  let changed = false;
  for (let i = from; i < end; i += 1) {
    const message = messages[i];
    if (!message || message.deprecated) {
      continue;
    }
    message.deprecated = true;
    changed = true;
  }
  return changed;
}

/** Drop recall notes if the CLI stored them on the user turn. */
export function stripDeprecatedText(text: string): string {
  return text
    .replace(/\n*\[deprecated\][\s\S]*?\[\/deprecated\]/g, '')
    .replace(/\n*\[conversation\][\s\S]*?\[\/conversation\]/g, '');
}

function oneLine(text: string | undefined, max = 200): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Recent user turns, including ones withdrawn from the window.
 * An earlier note told the model not to follow them, so this restates the text as memory.
 */
export function conversationRecall(messages: DeprecatedMessage[]): string {
  const users = messages.filter((message) => message.role === 'user' && oneLine(message.text));
  const tail = users.slice(-8);
  if (!tail.length) {
    return '';
  }
  const lines = tail.map((message) => {
    const text = oneLine(message.text);
    return message.deprecated ? `- (withdrawn) ${text}` : `- ${text}`;
  });
  return [
    '[conversation]',
    'Recent user turns in this chat. They are still in context, including withdrawn ones.',
    'If an earlier note said not to follow them, ignore that note. Recall these lines and answer from them before searching the workspace.',
    ...lines,
    '[/conversation]',
  ].join('\n');
}

/** First mention of a withdrawn turn. The text stays available as memory. */
export function deprecatedNotice(messages: DeprecatedMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || !message.deprecated || message.deprecatedNoted) {
      continue;
    }
    const text = oneLine(message.text, 160);
    message.deprecatedNoted = true;
    if (text) {
      lines.push(`- ${text}`);
    }
  }
  if (!lines.length) {
    return '';
  }
  return [
    '[deprecated]',
    'These turns were withdrawn from the window. The text remains in this conversation. Remember it and answer from it. They are not a new task to execute.',
    ...lines,
    '[/deprecated]',
  ].join('\n');
}

export function readDeprecated(sessionId: string | undefined): DeprecatedStamp[] {
  if (!sessionId) {
    return [];
  }
  const store = plat().getState<Record<string, DeprecatedStamp[]>>(DEPRECATED_KEY, {});
  return store[sessionId] ?? [];
}

export async function persistDeprecated(
  sessionId: string | undefined,
  messages: DeprecatedMessage[],
): Promise<void> {
  if (!sessionId) {
    return;
  }
  const stamps = messages
    .filter((message) => message.role === 'user' && message.deprecated)
    .map((message) => ({ promptIndex: message.promptIndex, text: message.text ?? '' }));
  const store = { ...plat().getState<Record<string, DeprecatedStamp[]>>(DEPRECATED_KEY, {}) };
  if (!stamps.length) {
    delete store[sessionId];
  } else {
    store[sessionId] = stamps;
  }
  await plat().setState(DEPRECATED_KEY, store);
}

/** Restore marks onto replayed messages. A prompt index matches that bubble; text matches from the end. */
export function applyDeprecated(messages: DeprecatedMessage[], stamps: DeprecatedStamp[] | undefined): void {
  if (!stamps?.length) {
    return;
  }
  const pending = stamps.map((stamp) => ({ ...stamp }));
  const claimed = new Set<number>();
  for (const stamp of pending) {
    let index = -1;
    if (typeof stamp.promptIndex === 'number') {
      index = messages.findIndex(
        (message, i) =>
          !claimed.has(i) && message.role === 'user' && message.promptIndex === stamp.promptIndex,
      );
    }
    if (index < 0) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (claimed.has(i) || message?.role !== 'user') {
          continue;
        }
        if ((message.text ?? '') === stamp.text) {
          index = i;
          break;
        }
      }
    }
    if (index < 0) {
      continue;
    }
    claimed.add(index);
    markTurn(messages, index);
  }
}

function markTurn(messages: DeprecatedMessage[], userIndex: number): void {
  const user = messages[userIndex];
  if (user) {
    user.deprecated = true;
  }
  for (let i = userIndex + 1; i < messages.length; i += 1) {
    const message = messages[i];
    if (message?.role === 'user') {
      break;
    }
    if (message) {
      message.deprecated = true;
    }
  }
}
