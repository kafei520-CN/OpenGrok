import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatGoalChip,
  formatGoalClock,
  goalDelivered,
  goalElapsedMs,
  parseGoalWireStatus,
  pauseGoalClock,
  resumeGoalClock,
  truncateGoal,
} from './goal';

describe('goal clock', () => {
  it('formats elapsed time', () => {
    assert.equal(formatGoalClock(0), '0:00');
    assert.equal(formatGoalClock(65_000), '1:05');
    assert.equal(formatGoalClock(3_661_000), '1:01:01');
  });

  it('formats chip elapsed time', () => {
    assert.equal(formatGoalChip(35_000), '35s');
    assert.equal(formatGoalChip(96_000), '1m 36s');
  });

  it('pauses without losing elapsed time', () => {
    const running = { text: 'Ship it', status: 'running' as const, startedAt: 1_000, elapsedMs: 5_000 };
    const paused = pauseGoalClock(running, 4_000);
    assert.equal(paused.status, 'paused');
    assert.equal(paused.elapsedMs, 8_000);
    assert.equal(goalElapsedMs(paused, 9_000), 8_000);
    const again = resumeGoalClock(paused, 10_000);
    assert.equal(again.status, 'running');
    assert.equal(goalElapsedMs(again, 12_000), 10_000);
  });

  it('truncates the objective', () => {
    assert.equal(truncateGoal('short'), 'short');
    assert.equal(truncateGoal('abcdefghij', 8), 'abcdefg…');
  });

  it('parses goal_updated wire status', () => {
    assert.equal(parseGoalWireStatus('active'), 'running');
    assert.equal(parseGoalWireStatus('complete'), 'done');
    assert.equal(parseGoalWireStatus('cleared'), 'done');
    assert.equal(parseGoalWireStatus('user_paused'), 'paused');
    assert.equal(parseGoalWireStatus('infra-paused'), 'paused');
  });

  it('treats all completed steps plus a reply as delivered', () => {
    assert.equal(goalDelivered([{ status: 'completed' }, { status: 'completed' }], '今天是 9 月 15 日'), true);
    assert.equal(goalDelivered([{ status: 'completed' }, { status: 'in_progress' }], 'partial'), false);
    assert.equal(goalDelivered([{ status: 'completed' }], ''), false);
    assert.equal(goalDelivered([], 'done'), false);
  });
});
