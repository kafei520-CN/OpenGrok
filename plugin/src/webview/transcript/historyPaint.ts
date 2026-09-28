/** First paint of a restored transcript: last N turns. Older turns load upward. */
export const HISTORY_TAIL = 6;
/** How close to the top (px) before another page of older turns is pulled in. */
export const HISTORY_OLDER_EDGE_PX = 480;
/** Older turns inserted above the tail in one page. */
export const HISTORY_SLICE_TURNS = 8;

export type PaintAlign =
  | { kind: 'equal' }
  | { kind: 'prefix'; extra: number }
  | { kind: 'suffix'; extra: number }
  | { kind: 'trim'; extra: number }
  | { kind: 'mismatch' };

/** How painted turn ids sit relative to the wanted list. */
export function paintAlign(wanted: string[], painted: string[]): PaintAlign {
  if (painted.length === 0) {
    return wanted.length === 0 ? { kind: 'equal' } : { kind: 'mismatch' };
  }
  if (wanted.length === painted.length) {
    return sameRange(wanted, painted, 0, wanted.length)
      ? { kind: 'equal' }
      : { kind: 'mismatch' };
  }
  if (wanted.length > painted.length) {
    if (sameRange(wanted, painted, 0, painted.length)) {
      return { kind: 'prefix', extra: wanted.length - painted.length };
    }
    const off = wanted.length - painted.length;
    return sameRange(wanted, painted, off, painted.length)
      ? { kind: 'suffix', extra: off }
      : { kind: 'mismatch' };
  }
  return sameRange(wanted, painted, 0, wanted.length)
    ? { kind: 'trim', extra: painted.length - wanted.length }
    : { kind: 'mismatch' };
}

export function tailStart(count: number, tail = HISTORY_TAIL): number {
  return count <= tail ? 0 : count - tail;
}

/**
 * ZCode 先给尾窗，滚到顶边再向上补。
 * 正文还不满一屏时也要补，否则没有滚动事件，开头会一直空着。
 */
export function shouldLoadOlder(input: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  olderCount: number;
}): boolean {
  if (input.olderCount <= 0) {
    return false;
  }
  if (input.scrollHeight <= input.clientHeight + 8) {
    return true;
  }
  return input.scrollTop < HISTORY_OLDER_EDGE_PX;
}

function sameRange(wanted: string[], painted: string[], wantedOff: number, count: number): boolean {
  for (let i = 0; i < count; i++) {
    if (painted[i] !== wanted[wantedOff + i]) {
      return false;
    }
  }
  return true;
}
