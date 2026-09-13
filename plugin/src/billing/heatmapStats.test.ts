import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeStreaks,
  emptyHeatmap,
  formatCompactCount,
  formatDurationLong,
  groupHeatmapWeeks,
  heatmapLevel,
  summarizeHeatmap,
} from './heatmapStats';

describe('heatmapStats', () => {
  it('pads a calendar of days', () => {
    assert.equal(emptyHeatmap(14).length, 14);
    assert.equal(emptyHeatmap(14)[13]?.requests, 0);
  });

  it('computes streaks with today grace', () => {
    const today = '2026-09-12';
    const streak = computeStreaks(['2026-09-10', '2026-09-11', '2026-09-12'], today);
    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 3);
    assert.equal(computeStreaks(['2026-09-01'], today).current, 0);
  });

  it('summarizes tokens and peak', () => {
    const stats = summarizeHeatmap(
      [
        { date: '2026-09-10', requests: 1, tokens: 100 },
        { date: '2026-09-11', requests: 2, tokens: 400 },
      ],
      90,
      '2026-09-11',
    );
    assert.equal(stats.totalTokens, 500);
    assert.equal(stats.peakTokens, 400);
    assert.equal(stats.longestSecs, 90);
    assert.equal(stats.currentStreak, 2);
  });

  it('formats compact counts', () => {
    assert.equal(formatCompactCount(2.16e9, true), '21.6亿');
    assert.equal(formatCompactCount(80000, true), '8万');
    assert.equal(formatCompactCount(1500, false), '1.5K');
  });

  it('formats durations', () => {
    assert.equal(formatDurationLong(17 * 3600 + 50 * 60, true), '17小时50分钟');
    assert.equal(heatmapLevel(0, 10), 0);
    assert.equal(heatmapLevel(10, 10), 4);
  });

  it('groups days into Monday-start weeks', () => {
    const weeks = groupHeatmapWeeks([
      { date: '2026-09-07', requests: 1, tokens: 10 },
      { date: '2026-09-08', requests: 1, tokens: 20 },
      { date: '2026-09-14', requests: 1, tokens: 5 },
    ]);
    assert.equal(weeks.length, 2);
    assert.equal(weeks[0]?.start, '2026-09-07');
    assert.equal(weeks[0]?.tokens, 30);
    assert.equal(weeks[1]?.start, '2026-09-14');
    assert.equal(weeks[1]?.tokens, 5);
  });
});
