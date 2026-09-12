/** Consecutive process losses before we stop respawning. */
export const AGENT_RECONNECT_MAX = 5;

export const AGENT_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 5_000, 5_000];

/** Milliseconds to wait before the next spawn, or undefined to give up. `failCount` is 1-based. */
export function reconnectDelayMs(failCount: number): number | undefined {
  if (failCount < 1 || failCount > AGENT_RECONNECT_MAX) {
    return undefined;
  }
  return AGENT_RECONNECT_DELAYS_MS[failCount - 1] ?? AGENT_RECONNECT_DELAYS_MS[AGENT_RECONNECT_DELAYS_MS.length - 1];
}
