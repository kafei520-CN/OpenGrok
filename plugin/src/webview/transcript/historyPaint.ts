/** First paint of a restored transcript: last N turns, then older ones. */
export const HISTORY_TAIL = 6;
/** Build this many off-DOM turn nodes per frame. */
export const HISTORY_SLICE_MS = 10;
export const HISTORY_SLICE_TURNS = 8;
/** Commit older turns to the DOM in larger chunks to avoid flicker. */
export const HISTORY_FLUSH_TURNS = 40;

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

function sameRange(wanted: string[], painted: string[], wantedOff: number, count: number): boolean {
  for (let i = 0; i < count; i++) {
    if (painted[i] !== wanted[wantedOff + i]) {
      return false;
    }
  }
  return true;
}
