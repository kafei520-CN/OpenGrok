import type { ChatMessage } from '../../core/types';

/** Newest assistant turn that still has a plan, if any. */
export function latestStepMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'assistant' && message.steps?.length) {
      return message;
    }
  }
  return undefined;
}

/**
 * Id of a live turn whose steps just appeared.
 * Later status ticks on the same turn return undefined so the dock is not stolen back.
 */
export function stepTurnToOpen(
  messages: ChatMessage[],
  seen: ReadonlySet<string>,
): string | undefined {
  const live = messages.at(-1);
  if (!live || live.role !== 'assistant' || !live.streaming || !live.steps?.length) {
    return undefined;
  }
  if (seen.has(live.id)) {
    return undefined;
  }
  return live.id;
}
