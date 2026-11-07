export type RailMark = { id: string; label: string };

export type RailMessage = {
  id: string;
  role: string;
  text?: string;
  files?: { label?: string; path?: string }[];
};

const LABEL_MAX = 28;

export function userRailMarks(messages: RailMessage[]): RailMark[] {
  const marks: RailMark[] = [];
  for (const message of messages) {
    if (message.role !== 'user') {
      continue;
    }
    const label = railLabel(message);
    if (!label) {
      continue;
    }
    marks.push({ id: message.id, label });
  }
  return marks;
}

export function railLabel(message: Pick<RailMessage, 'text' | 'files'>): string {
  const text = (message.text ?? '').replace(/\s+/g, ' ').trim();
  if (text) {
    return clip(text);
  }
  const file = message.files?.[0];
  const name = file?.label?.trim() || file?.path?.split(/[/\\]/).pop()?.trim() || '';
  return clip(name);
}

/**
 * One page of marks. The next page starts at the middle of this one:
 * 1 2 3 4 5 continues as 3 4 5 6 7. It switches only after the page ends.
 */
export function railSegment(
  count: number,
  active: number,
  previousStart?: number,
  size = 10,
): { start: number; end: number } {
  const total = Math.max(0, count);
  if (total === 0) {
    return { start: 0, end: 0 };
  }
  const page = Math.max(1, size);
  if (total <= page) {
    return { start: 0, end: total };
  }
  const current = Math.min(Math.max(active, 0), total - 1);
  const step = Math.max(1, Math.floor(page / 2));
  const lastStart = total - page;
  let start = Number.isFinite(previousStart) ? Math.max(0, Math.floor(previousStart as number)) : 0;
  if (start > lastStart) {
    start = lastStart;
  }
  while (current >= start + page && start < lastStart) {
    start = Math.min(lastStart, start + step);
  }
  while (current < start && start > 0) {
    start = Math.max(0, start - step);
  }
  if (start > lastStart) {
    start = lastStart;
  }
  return { start, end: start + page };
}

/** First mark on the top edge, last mark on the bottom edge. */
export function evenTickCenter(index: number, count: number, height: number): number {
  if (count <= 1 || height <= 0) {
    return 0;
  }
  const slot = Math.min(Math.max(index, 0), count - 1);
  return (slot / (count - 1)) * height;
}

/** Inclusive painted range. A missing mark is negative, not offset 0. */
export function paintedMarkSpan(tops: number[]): { from: number; to: number } {
  let from = -1;
  let to = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] < 0) {
      continue;
    }
    if (from < 0) {
      from = i;
    }
    to = i + 1;
  }
  if (from < 0) {
    return { from: 0, to: tops.length };
  }
  return { from, to };
}

/**
 * Scroll position where the last line sits clear of the composer.
 * Padding past the overlap is empty, so it is not part of the conversation.
 */
export function scrollReach(maxScroll: number, padding: number, overlap: number): number {
  const extra = Math.max(0, padding - Math.max(0, overlap));
  return Math.max(0, maxScroll - extra);
}

/**
 * Top of the scroll range is the first painted mark.
 * Bottom of the scroll range is the last painted mark.
 * Message offsets are not the scale: one edge never meets both ends.
 */
export function activeRailIndex(
  count: number,
  scrollTop: number,
  maxScroll = Number.POSITIVE_INFINITY,
  from = 0,
  to = count,
): number {
  if (count <= 0 || to <= from) {
    return -1;
  }
  const end = Math.min(count, to) - 1;
  const start = Math.max(0, Math.min(from, end));
  if (start === end) {
    return start;
  }
  const reach = Number.isFinite(maxScroll) ? Math.max(0, maxScroll) : 0;
  if (scrollTop <= 1 || reach <= 1) {
    return start;
  }
  if (scrollTop >= reach - 1) {
    return end;
  }
  const t = scrollTop / reach;
  return start + Math.round(t * (end - start));
}

/**
 * `end` is the right edge. A left VS Code sidebar keeps the scrollbar there.
 * A right sidebar moves the scrollbar to the inner (left) edge.
 */
export function railEdge(
  host: 'start' | 'end' | undefined,
  measured: 'start' | 'end' | 'unknown',
): 'start' | 'end' {
  if (host === 'start' || host === 'end') {
    return host;
  }
  return measured === 'start' ? 'start' : 'end';
}

function clip(value: string): string {
  if (value.length <= LABEL_MAX) {
    return value;
  }
  return `${value.slice(0, LABEL_MAX - 1)}…`;
}
