export interface HeatmapDay {
  date: string;
  requests: number;
  tokens: number;
}

export interface HeatmapStats {
  totalTokens: number;
  peakTokens: number;
  longestSecs: number;
  currentStreak: number;
  longestStreak: number;
}

export function ymd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseYmd(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function emptyHeatmap(days: number): HeatmapDay[] {
  const count = Math.max(7, Math.min(400, days));
  const out: HeatmapDay[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    out.push({ date: ymd(day), requests: 0, tokens: 0 });
  }
  return out;
}

export function summarizeHeatmap(days: HeatmapDay[], longestSecs = 0, today = ymd(new Date())): HeatmapStats {
  let total = 0;
  let peak = 0;
  const active: string[] = [];
  for (const row of days) {
    if (row.tokens > 0 || row.requests > 0) {
      active.push(row.date);
    }
    total += row.tokens;
    if (row.tokens > peak) {
      peak = row.tokens;
    }
  }
  const streaks = computeStreaks(active, today);
  return {
    totalTokens: total,
    peakTokens: peak,
    longestSecs,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
  };
}

export function computeStreaks(active: string[], today: string): { current: number; longest: number } {
  const days = [...active].sort();
  if (!days.length) {
    return { current: 0, longest: 0 };
  }
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (gapDays(days[i - 1]!, days[i]!) === 1) {
      run += 1;
      if (run > longest) {
        longest = run;
      }
    } else {
      run = 1;
    }
  }
  const last = days[days.length - 1]!;
  const gap = gapDays(last, today);
  if (gap === undefined || gap > 1) {
    return { current: 0, longest };
  }
  let current = 1;
  for (let i = days.length - 1; i > 0; i -= 1) {
    if (gapDays(days[i - 1]!, days[i]!) === 1) {
      current += 1;
    } else {
      break;
    }
  }
  return { current, longest };
}

export function formatCompactCount(n: number, zh: boolean): string {
  if (!Number.isFinite(n) || n <= 0) {
    return '0';
  }
  if (zh) {
    if (n >= 1e8) {
      return `${trimNum(n / 1e8)}亿`;
    }
    if (n >= 1e4) {
      return `${trimNum(n / 1e4)}万`;
    }
    return String(Math.round(n));
  }
  if (n >= 1e9) {
    return `${trimNum(n / 1e9)}B`;
  }
  if (n >= 1e6) {
    return `${trimNum(n / 1e6)}M`;
  }
  if (n >= 1e3) {
    return `${trimNum(n / 1e3)}K`;
  }
  return String(Math.round(n));
}

export function formatDurationLong(secs: number, zh: boolean): string {
  if (!Number.isFinite(secs) || secs <= 0) {
    return zh ? '0分钟' : '0m';
  }
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (zh) {
    if (hours && mins) {
      return `${hours}小时${mins}分钟`;
    }
    if (hours) {
      return `${hours}小时`;
    }
    return `${Math.max(1, mins)}分钟`;
  }
  if (hours && mins) {
    return `${hours}h ${mins}m`;
  }
  if (hours) {
    return `${hours}h`;
  }
  return `${Math.max(1, mins)}m`;
}

export type HeatmapWeek = {
  start: string;
  end: string;
  tokens: number;
  requests: number;
};

/** Fold days into Monday-start calendar weeks. */
export function groupHeatmapWeeks(days: HeatmapDay[]): HeatmapWeek[] {
  const buckets = new Map<string, HeatmapWeek>();
  for (const row of days) {
    const date = parseYmd(row.date);
    if (!date) {
      continue;
    }
    const start = startOfWeek(date);
    const key = ymd(start);
    const cur = buckets.get(key);
    if (cur) {
      cur.tokens += row.tokens;
      cur.requests += row.requests;
      if (row.date > cur.end) {
        cur.end = row.date;
      }
      continue;
    }
    buckets.set(key, {
      start: key,
      end: row.date,
      tokens: row.tokens,
      requests: row.requests,
    });
  }
  return [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
}

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const weekday = next.getDay();
  const mondayOffset = weekday === 0 ? 6 : weekday - 1;
  next.setDate(next.getDate() - mondayOffset);
  return next;
}

export function heatmapLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) {
    return 0;
  }
  const ratio = value / max;
  if (ratio > 0.75) {
    return 4;
  }
  if (ratio > 0.5) {
    return 3;
  }
  if (ratio > 0.25) {
    return 2;
  }
  return 1;
}

function gapDays(a: string, b: string): number | undefined {
  const da = parseYmd(a);
  const db = parseYmd(b);
  if (!da || !db) {
    return undefined;
  }
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

function trimNum(n: number): string {
  const rounded = n >= 10 ? n.toFixed(1) : n.toFixed(1);
  return rounded.replace(/\.0$/, '');
}
