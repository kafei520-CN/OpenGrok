import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { emptyHeatmap, ymd, type HeatmapDay } from './heatmapStats';

export interface HeatmapBundle {
  days: HeatmapDay[];
  longestSecs: number;
}

interface DayAgg {
  requests: number;
  tokens: number;
  duration: number;
}

export function loadLocalHeatmap(days = 371): HeatmapBundle {
  const padded = emptyHeatmap(days);
  const root = path.join(os.homedir(), '.grok', 'sessions');
  const aggs = new Map<string, DayAgg>();
  let longest = 0;
  const seen = new Set<string>();
  walk(root, 0, seen, aggs, (secs) => {
    if (secs > longest) {
      longest = secs;
    }
  });
  for (const row of padded) {
    const hit = aggs.get(row.date);
    if (hit) {
      row.requests = hit.requests;
      row.tokens = hit.tokens;
    }
  }
  return { days: padded, longestSecs: longest };
}

function walk(
  dir: string,
  depth: number,
  seen: Set<string>,
  aggs: Map<string, DayAgg>,
  onDuration: (secs: number) => void,
): void {
  if (depth > 6) {
    return;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const folder = path.join(dir, entry.name);
    const signals = path.join(folder, 'signals.json');
    if (fs.existsSync(signals)) {
      if (!seen.add(entry.name)) {
        continue;
      }
      ingest(folder, signals, aggs, onDuration);
    } else {
      walk(folder, depth + 1, seen, aggs, onDuration);
    }
  }
}

function ingest(
  folder: string,
  signalsPath: string,
  aggs: Map<string, DayAgg>,
  onDuration: (secs: number) => void,
): void {
  let raw: string;
  try {
    raw = fs.readFileSync(signalsPath, 'utf8');
  } catch {
    return;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const duration = num(data['sessionDurationSeconds']);
  if (duration > 0) {
    onDuration(duration);
  }
  const tokens = Math.max(tokenSum(folder), signalsTokens(data));
  const day = dayKey(folder, signalsPath);
  const row = aggs.get(day) ?? { requests: 0, tokens: 0, duration: 0 };
  row.requests += 1;
  row.tokens += tokens;
  row.duration = Math.max(row.duration, duration);
  aggs.set(day, row);
}

function signalsTokens(data: Record<string, unknown>): number {
  const context = num(data['contextTokensUsed']);
  const before = num(data['totalTokensBeforeCompaction']);
  return before > 0 ? before + context : context;
}

function tokenSum(folder: string): number {
  const file = path.join(folder, 'updates.jsonl');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return 0;
  }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
    return 0;
  }
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return 0;
  }
  let sum = 0;
  for (const line of text.split('\n')) {
    if (
      !line.includes('turn_completed') ||
      (!line.includes('totalTokens') && !line.includes('total_tokens'))
    ) {
      continue;
    }
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const update = asObj(row['update'] ?? asObj(row['params'])['update']);
      const kind = String(update['sessionUpdate'] ?? update['session_update'] ?? '');
      if (kind !== 'turn_completed') {
        continue;
      }
      const usage = asObj(update['usage']);
      const tokens = num(usage['totalTokens'] ?? usage['total_tokens']);
      if (tokens > 0) {
        sum += tokens;
      }
    } catch {
      /* skip bad line */
    }
  }
  return sum;
}

function dayKey(folder: string, signalsPath: string): string {
  const summary = path.join(folder, 'summary.json');
  try {
    const info = JSON.parse(fs.readFileSync(summary, 'utf8')) as Record<string, unknown>;
    const stamp = String(info['last_active_at'] ?? info['updated_at'] ?? info['created_at'] ?? '');
    if (stamp) {
      const date = new Date(stamp);
      if (!Number.isNaN(date.getTime())) {
        return ymd(date);
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const mtime = fs.statSync(signalsPath).mtime;
    return ymd(mtime);
  } catch {
    return ymd(new Date());
  }
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
