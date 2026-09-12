export type DiffKind = 'equal' | 'add' | 'del' | 'replace';

export interface DiffOp {
  type: DiffKind;
  value: string;
}

export interface DiffRow {
  type: DiffKind;
  beforeNo?: number;
  afterNo?: number;
  beforeText?: string;
  afterText?: string;
}

export interface DiffGap {
  kind: 'gap';
  count: number;
  rows: DiffRow[];
}

export interface DiffBlock {
  kind: 'block';
  rows: DiffRow[];
}

export type DiffHunk = DiffGap | DiffBlock;

export interface FileDiff {
  path: string;
  absPath: string;
  added: number;
  removed: number;
  created: boolean;
  deleted: boolean;
  hunks: DiffHunk[];
}

const CONTEXT = 2;
/** Git histogram ignores lines that appear more often than this. */
const HIST_MAX_OCCUR = 64;
const MYERS_SMALL = 16;

export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized === '') {
    return [];
  }
  return normalized.split('\n');
}

export function diffOps(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;
  if (n === 0) {
    return after.map((value) => ({ type: 'add', value }));
  }
  if (m === 0) {
    return before.map((value) => ({ type: 'del', value }));
  }
  let start = 0;
  const same = Math.min(n, m);
  while (start < same && before[start] === after[start]) {
    start += 1;
  }
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const prefix: DiffOp[] = before.slice(0, start).map((value) => ({ type: 'equal', value }));
  const suffix: DiffOp[] = before.slice(endA).map((value) => ({ type: 'equal', value }));
  const midA = before.slice(start, endA);
  const midB = after.slice(start, endB);
  if (midA.length === 0) {
    return [...prefix, ...midB.map((value) => ({ type: 'add' as const, value })), ...suffix];
  }
  if (midB.length === 0) {
    return [...prefix, ...midA.map((value) => ({ type: 'del' as const, value })), ...suffix];
  }
  return [...prefix, ...regionOps(midA, midB), ...suffix];
}

function lineCounts(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/**
 * Rare matching lines as split points (Git histogram). Frequency 1 first,
 * then 2, 4, … up to HIST_MAX_OCCUR so common tokens like `}` are last.
 */
function histogramAnchors(a: string[], b: string[]): Array<{ ai: number; bi: number }> {
  const countA = lineCounts(a);
  const countB = lineCounts(b);
  const posB = new Map<string, number[]>();
  for (let j = 0; j < b.length; j += 1) {
    const line = b[j];
    const list = posB.get(line);
    if (list) {
      list.push(j);
    } else {
      posB.set(line, [j]);
    }
  }
  for (let maxOccur = 1; maxOccur <= HIST_MAX_OCCUR; maxOccur *= 2) {
    const anchors = greedyAnchors(a, countA, countB, posB, maxOccur);
    if (anchors.length > 0) {
      return anchors;
    }
  }
  return [];
}

function greedyAnchors(
  a: string[],
  countA: Map<string, number>,
  countB: Map<string, number>,
  posB: Map<string, number[]>,
  maxOccur: number,
): Array<{ ai: number; bi: number }> {
  const cursor = new Map<string, number>();
  const anchors: Array<{ ai: number; bi: number }> = [];
  let lastB = -1;
  for (let i = 0; i < a.length; i += 1) {
    const line = a[i];
    const ca = countA.get(line) ?? 0;
    const cb = countB.get(line) ?? 0;
    if (ca < 1 || cb < 1 || ca > maxOccur || cb > maxOccur) {
      continue;
    }
    const positions = posB.get(line);
    if (!positions) {
      continue;
    }
    let k = cursor.get(line) ?? 0;
    while (k < positions.length && positions[k] <= lastB) {
      k += 1;
    }
    if (k >= positions.length) {
      cursor.set(line, k);
      continue;
    }
    anchors.push({ ai: i, bi: positions[k] });
    lastB = positions[k];
    cursor.set(line, k + 1);
  }
  return anchors;
}

/**
 * Histogram splits on rare lines; Myers corrects each gap (and the whole
 * region when no usable anchor exists).
 */
function regionOps(a: string[], b: string[]): DiffOp[] {
  if (a.length === 0) {
    return b.map((value) => ({ type: 'add' as const, value }));
  }
  if (b.length === 0) {
    return a.map((value) => ({ type: 'del' as const, value }));
  }
  if (a.length + b.length <= MYERS_SMALL) {
    return myersOps(a, b);
  }
  const anchors = histogramAnchors(a, b);
  if (anchors.length === 0) {
    return myersOps(a, b);
  }
  const ops: DiffOp[] = [];
  let ai = 0;
  let bi = 0;
  const points = [...anchors, { ai: a.length, bi: b.length }];
  for (const point of points) {
    const chunkA = a.slice(ai, point.ai);
    const chunkB = b.slice(bi, point.bi);
    if (chunkA.length > 0 || chunkB.length > 0) {
      ops.push(...regionOps(chunkA, chunkB));
    }
    if (point.ai < a.length) {
      ops.push({ type: 'equal', value: a[point.ai] });
    }
    ai = point.ai + 1;
    bi = point.bi + 1;
  }
  return ops;
}

/** Myers shortest edit script, used to correct histogram gaps. */
function myersOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];
  let done = false;
  for (let d = 0; d <= max && !done; d += 1) {
    trace.push(Int32Array.from(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const snap = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && snap[offset + k - 1] < snap[offset + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : snap[offset + prevK];
    const prevY = prevX - prevK;
    while (x > Math.max(prevX, 0) && y > Math.max(prevY, 0) && a[x - 1] === b[y - 1]) {
      ops.push({ type: 'equal', value: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d === 0) {
      break;
    }
    if (x === prevX) {
      if (y > 0) {
        ops.push({ type: 'add', value: b[y - 1] });
        y -= 1;
      }
    } else if (x > 0) {
      ops.push({ type: 'del', value: a[x - 1] });
      x -= 1;
    }
  }
  while (x > 0 && y > 0 && a[x - 1] === b[y - 1]) {
    ops.push({ type: 'equal', value: a[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    ops.push({ type: 'del', value: a[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    ops.push({ type: 'add', value: b[y - 1] });
    y -= 1;
  }
  ops.reverse();
  return ops;
}

export function opsToRows(ops: DiffOp[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let beforeNo = 1;
  let afterNo = 1;
  for (const op of ops) {
    if (op.type === 'equal') {
      rows.push({
        type: 'equal',
        beforeNo,
        afterNo,
        beforeText: op.value,
        afterText: op.value,
      });
      beforeNo += 1;
      afterNo += 1;
    } else if (op.type === 'del') {
      rows.push({ type: 'del', beforeNo, beforeText: op.value });
      beforeNo += 1;
    } else {
      rows.push({ type: 'add', afterNo, afterText: op.value });
      afterNo += 1;
    }
  }
  return rows;
}

/** Put a deleted line on the same split row as the added line that replaces it. */
export function pairReplacements(rows: DiffRow[]): DiffRow[] {
  const out: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].type !== 'del') {
      out.push(rows[index]);
      index += 1;
      continue;
    }
    const dels: DiffRow[] = [];
    while (index < rows.length && rows[index].type === 'del') {
      dels.push(rows[index]);
      index += 1;
    }
    const adds: DiffRow[] = [];
    while (index < rows.length && rows[index].type === 'add') {
      adds.push(rows[index]);
      index += 1;
    }
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i += 1) {
      const del = dels[i];
      const add = adds[i];
      if (del && add) {
        out.push({
          type: 'replace',
          beforeNo: del.beforeNo,
          afterNo: add.afterNo,
          beforeText: del.beforeText,
          afterText: add.afterText,
        });
      } else if (del) {
        out.push(del);
      } else if (add) {
        out.push(add);
      }
    }
  }
  return out;
}

export function collapseRows(rows: DiffRow[], context = CONTEXT): DiffHunk[] {
  if (rows.length === 0) {
    return [];
  }
  const changed = rows.map((row) => row.type !== 'equal');
  const keep = changed.map(() => false);
  for (let i = 0; i < rows.length; i += 1) {
    if (!changed[i]) {
      continue;
    }
    const from = Math.max(0, i - context);
    const to = Math.min(rows.length - 1, i + context);
    for (let j = from; j <= to; j += 1) {
      keep[j] = true;
    }
  }
  if (keep.every((flag) => !flag)) {
    return [
      {
        kind: 'gap',
        count: rows.length,
        rows,
      },
    ];
  }
  const hunks: DiffHunk[] = [];
  let index = 0;
  while (index < rows.length) {
    if (keep[index]) {
      const block: DiffRow[] = [];
      while (index < rows.length && keep[index]) {
        block.push(rows[index]);
        index += 1;
      }
      hunks.push({ kind: 'block', rows: block });
    } else {
      const gap: DiffRow[] = [];
      while (index < rows.length && !keep[index]) {
        gap.push(rows[index]);
        index += 1;
      }
      hunks.push({ kind: 'gap', count: gap.length, rows: gap });
    }
  }
  return hunks;
}

export function countOps(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'add') {
      added += 1;
    } else if (op.type === 'del') {
      removed += 1;
    }
  }
  return { added, removed };
}

export function countChange(before: string, after: string): { added: number; removed: number } {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const bag = new Map<string, number>();
  for (const line of oldLines) {
    bag.set(line, (bag.get(line) ?? 0) + 1);
  }
  let added = 0;
  for (const line of newLines) {
    const left = bag.get(line) ?? 0;
    if (left > 0) {
      bag.set(line, left - 1);
    } else {
      added += 1;
    }
  }
  let removed = 0;
  for (const left of bag.values()) {
    removed += left;
  }
  return { added, removed };
}

export function buildFileDiff(input: {
  path: string;
  absPath: string;
  before: string;
  after: string;
}): FileDiff {
  const beforeLines = splitLines(input.before);
  const afterLines = splitLines(input.after);
  const ops = diffOps(beforeLines, afterLines);
  const stats = countOps(ops);
  return {
    path: input.path,
    absPath: input.absPath,
    added: stats.added,
    removed: stats.removed,
    created: input.before === '' && input.after !== '',
    deleted: input.after === '' && input.before !== '',
    hunks: collapseRows(pairReplacements(opsToRows(ops))),
  };
}

const REMOTE_BLOCK_ROWS = 400;

/** Drop quiet gap bodies and cap huge hunks so a review can travel over the wire. */
export function slimFileDiffs(files: FileDiff[]): FileDiff[] {
  return files.map((file) => ({
    ...file,
    hunks: file.hunks.map((hunk) => {
      if (hunk.kind === 'gap') {
        return { kind: 'gap' as const, count: hunk.count, rows: [] };
      }
      if (hunk.rows.length > REMOTE_BLOCK_ROWS) {
        return { kind: 'block' as const, rows: hunk.rows.slice(0, REMOTE_BLOCK_ROWS) };
      }
      return hunk;
    }),
  }));
}
