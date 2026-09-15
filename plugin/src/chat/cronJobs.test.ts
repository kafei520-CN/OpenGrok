import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dueJobs,
  jobFromDraft,
  markJobRan,
  nextRunAt,
  parseHm,
  parseLocalDateTime,
  stampJob,
} from './cronJobs';
import type { CronJob } from '../core/types';

function job(partial: Partial<CronJob> & Pick<CronJob, 'kind'>): CronJob {
  return {
    id: 'c1',
    title: 't',
    prompt: 'hello',
    enabled: true,
    createdAt: 0,
    ...partial,
  };
}

describe('cronJobs', () => {
  it('parses local date-time', () => {
    const t = parseLocalDateTime('2026-09-16T09:30');
    assert.ok(t);
    const d = new Date(t);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 8);
    assert.equal(d.getDate(), 16);
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 30);
  });

  it('parses HH:mm', () => {
    assert.deepEqual(parseHm('9:05'), { h: 9, m: 5 });
    assert.equal(parseHm('24:00'), undefined);
  });

  it('once job stays due until it runs', () => {
    const once = job({ kind: 'once', at: '2026-09-16T10:00' });
    const at = parseLocalDateTime('2026-09-16T10:00')!;
    assert.equal(nextRunAt(once, at - 1), at);
    assert.equal(nextRunAt({ ...once, lastRunAt: at }, at + 1), undefined);
    assert.equal(dueJobs([stampJob(once, at - 1)], at).length, 1);
    assert.equal(markJobRan(once, at).enabled, false);
  });

  it('daily rolls to tomorrow after the time passes', () => {
    const daily = job({ kind: 'daily', at: '09:00' });
    const before = new Date(2026, 8, 16, 8, 0).getTime();
    const after = new Date(2026, 8, 16, 9, 1).getTime();
    assert.equal(nextRunAt(daily, before), new Date(2026, 8, 16, 9, 0).getTime());
    assert.equal(nextRunAt(daily, after), new Date(2026, 8, 17, 9, 0).getTime());
  });

  it('weekly lands on the next weekday', () => {
    const weekly = job({ kind: 'weekly', at: '09:00', weekday: 3 });
    const tue = new Date(2026, 8, 15, 10, 0).getTime();
    assert.equal(nextRunAt(weekly, tue), new Date(2026, 8, 16, 9, 0).getTime());
  });

  it('interval skips missed ticks', () => {
    const hour = job({ kind: 'interval', everyMs: 60 * 60_000, createdAt: 0, lastRunAt: 0 });
    const now = 3.5 * 60 * 60_000;
    assert.equal(nextRunAt(hour, now), 4 * 60 * 60_000);
  });

  it('rejects empty prompt', () => {
    assert.equal(jobFromDraft({ title: '', prompt: '  ', kind: 'daily', at: '09:00', weekday: 1, everyMs: 60_000 }), undefined);
  });
});
