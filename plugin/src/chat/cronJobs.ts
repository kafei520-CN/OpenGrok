import type { CronJob, CronKind } from '../core/types';

export const CRON_STATE_KEY = 'ui.cronJobs';
export const CRON_TICK_MS = 15_000;
export const CRON_MIN_INTERVAL_MS = 60_000;

export const CRON_INTERVALS = [
  { id: '15m', ms: 15 * 60_000 },
  { id: '1h', ms: 60 * 60_000 },
  { id: '6h', ms: 6 * 60 * 60_000 },
  { id: '12h', ms: 12 * 60 * 60_000 },
  { id: '1d', ms: 24 * 60 * 60_000 },
] as const;

export type CronDraft = {
  title: string;
  prompt: string;
  kind: CronKind;
  at: string;
  weekday: number;
  everyMs: number;
};

export function emptyCronDraft(): CronDraft {
  return {
    title: '',
    prompt: '',
    kind: 'daily',
    at: '09:00',
    weekday: 1,
    everyMs: 60 * 60_000,
  };
}

export function newCronId(): string {
  return `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseHm(value: string | undefined): { h: number; m: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) {
    return undefined;
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) {
    return undefined;
  }
  return { h, m };
}

export function parseLocalDateTime(value: string | undefined): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) {
    return undefined;
  }
  const t = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  ).getTime();
  return Number.isFinite(t) ? t : undefined;
}

export function nextRunAt(job: CronJob, now: number): number | undefined {
  if (!job.enabled) {
    return undefined;
  }
  if (job.kind === 'once') {
    if (job.lastRunAt) {
      return undefined;
    }
    return parseLocalDateTime(job.at);
  }
  if (job.kind === 'interval') {
    const every = job.everyMs ?? 0;
    if (every < CRON_MIN_INTERVAL_MS) {
      return undefined;
    }
    const start = job.lastRunAt ?? job.createdAt;
    let t = start + every;
    if (t <= now) {
      const skipped = Math.floor((now - t) / every);
      t += skipped * every;
      if (t <= now) {
        t += every;
      }
    }
    return t;
  }
  const hm = parseHm(job.at);
  if (!hm) {
    return undefined;
  }
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMilliseconds(0);
  d.setHours(hm.h, hm.m, 0, 0);
  if (job.kind === 'daily') {
    if (d.getTime() <= now) {
      d.setDate(d.getDate() + 1);
    }
    return d.getTime();
  }
  const weekday = ((job.weekday ?? 0) % 7 + 7) % 7;
  let add = (weekday - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() <= now) {
    add = 7;
  }
  d.setDate(d.getDate() + add);
  return d.getTime();
}

export function stampJob(job: CronJob, now = Date.now()): CronJob {
  return { ...job, nextRunAt: nextRunAt(job, now) };
}

export function jobFromDraft(draft: CronDraft, now = Date.now()): CronJob | undefined {
  const prompt = draft.prompt.trim();
  if (!prompt) {
    return undefined;
  }
  const title = draft.title.trim() || prompt.slice(0, 32);
  const job = stampJob(
    {
      id: newCronId(),
      title,
      prompt,
      enabled: true,
      kind: draft.kind,
      at: draft.kind === 'interval' ? undefined : draft.at.trim(),
      weekday: draft.kind === 'weekly' ? draft.weekday : undefined,
      everyMs: draft.kind === 'interval' ? draft.everyMs : undefined,
      createdAt: now,
    },
    now,
  );
  if (job.kind === 'once' && job.nextRunAt === undefined) {
    return undefined;
  }
  if ((job.kind === 'daily' || job.kind === 'weekly') && !parseHm(job.at)) {
    return undefined;
  }
  if (job.kind === 'interval' && (job.everyMs ?? 0) < CRON_MIN_INTERVAL_MS) {
    return undefined;
  }
  return job;
}

export function markJobRan(job: CronJob, now = Date.now()): CronJob {
  const next: CronJob = { ...job, lastRunAt: now };
  if (job.kind === 'once') {
    next.enabled = false;
    next.nextRunAt = undefined;
    return next;
  }
  return stampJob(next, now);
}

export function dueJobs(jobs: CronJob[], now: number): CronJob[] {
  return jobs.filter((job) => job.enabled && job.nextRunAt !== undefined && job.nextRunAt <= now);
}

export function readCronJobs(raw: unknown, now = Date.now()): CronJob[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: CronJob[] = [];
  for (const row of raw) {
    const job = normalizeJob(row, now);
    if (job) {
      out.push(job);
    }
  }
  return out;
}

function normalizeJob(raw: unknown, now: number): CronJob | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  const prompt = typeof row.prompt === 'string' ? row.prompt.trim() : '';
  const kind = row.kind;
  if (!id || !prompt || (kind !== 'once' && kind !== 'daily' && kind !== 'weekly' && kind !== 'interval')) {
    return undefined;
  }
  const createdAt = typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) ? row.createdAt : now;
  return stampJob(
    {
      id,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : prompt.slice(0, 32),
      prompt,
      enabled: row.enabled !== false,
      kind,
      at: typeof row.at === 'string' ? row.at : undefined,
      weekday: typeof row.weekday === 'number' ? row.weekday : undefined,
      everyMs: typeof row.everyMs === 'number' ? row.everyMs : undefined,
      lastRunAt: typeof row.lastRunAt === 'number' ? row.lastRunAt : undefined,
      createdAt,
    },
    now,
  );
}
