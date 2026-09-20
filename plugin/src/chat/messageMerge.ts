/**
 * A later full snapshot of the *same* open chat must not look like a session
 * restore. Billing / meter ticks pack huge transcripts as hydrate frames and
 * would otherwise wipe the body, then pin the viewport to the bottom.
 */
export function stabilizeIncomingChat<T extends { id?: string }>(opts: {
  incomingSessionId?: string;
  incomingRestoring?: boolean;
  incomingMessages: T[];
  hadSessionId?: string;
  hadMessages: T[];
  hydrate?: number;
  merge?: boolean;
}): { messages: T[]; restoring: boolean; merge: boolean } {
  const same =
    Boolean(opts.incomingSessionId) && opts.incomingSessionId === opts.hadSessionId;
  let restoring = Boolean(opts.incomingRestoring);
  let merge = Boolean(opts.merge);
  let messages = opts.incomingMessages;
  if (same && opts.hadMessages.length > 0) {
    if (restoring && messages.length === 0) {
      messages = opts.hadMessages;
      merge = true;
      restoring = false;
    } else if (typeof opts.hydrate === 'number' && !restoring) {
      merge = true;
    }
  }
  return { messages, restoring, merge };
}

/** Keep the open transcript when a live update omits history or only appends new turns. */
export function mergeTranscript<T extends { id?: string }>(had: T[], incoming: T[]): T[] {
  if (!incoming.length) {
    return had;
  }
  if (!had.length) {
    return incoming;
  }
  return mergeLiveMessages(had, incoming) ?? appendUnseen(had, incoming);
}

/**
 * Live tails merge in place. A hydrate frame only skips history prepends when
 * the open transcript already overlaps the incoming tail (reconnect), not on a
 * fresh restore of a large session.
 */
export function resolveIncomingMessages<T extends { id?: string }>(
  had: T[],
  incoming: T[],
  flags: { merge?: boolean; mergeTranscript?: boolean; hydrate?: number },
): { messages: T[]; skipHydrate?: number; live: boolean } {
  const live = Boolean(flags.merge || flags.mergeTranscript);
  const messages = live ? mergeTranscript(had, incoming) : incoming;
  if (typeof flags.hydrate !== 'number') {
    return { messages, live };
  }
  const merged = mergeLiveMessages(had, messages);
  if (!merged) {
    return { messages, live };
  }
  return { messages: merged, skipHydrate: flags.hydrate, live };
}

function appendUnseen<T extends { id?: string }>(had: T[], incoming: T[]): T[] {
  const seen = new Set<string>();
  for (const row of had) {
    if (row.id) {
      seen.add(row.id);
    }
  }
  const extra = incoming.filter((row) => row.id && !seen.has(row.id));
  return extra.length ? had.concat(extra) : had;
}

/** If `incoming` is a live tail of `had` (same last id, plus optional new ids), merge in place. */
export function mergeLiveMessages<T extends { id?: string }>(had: T[], incoming: T[]): T[] | undefined {
  if (!had.length || !incoming.length) {
    return undefined;
  }
  const lastHad = had[had.length - 1]?.id;
  if (!lastHad) {
    return undefined;
  }
  const incomingIds = new Set(incoming.map((row) => row.id).filter(Boolean) as string[]);
  if (!incomingIds.has(lastHad)) {
    return undefined;
  }
  let cut = -1;
  for (const row of incoming) {
    if (!row.id) {
      continue;
    }
    const at = had.findIndex((item) => item.id === row.id);
    if (at >= 0) {
      cut = at;
      break;
    }
  }
  if (cut < 0) {
    return undefined;
  }
  const byId = new Map<string, T>();
  for (const row of had) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  for (const row of incoming) {
    if (row.id) {
      byId.set(row.id, row);
    }
  }
  const prefix = had.slice(0, cut).filter((row) => !row.id || !incomingIds.has(row.id));
  const tail = incoming.map((row) => (row.id ? (byId.get(row.id) ?? row) : row));
  return prefix.concat(tail);
}
