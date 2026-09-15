import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyParked, overlayLiveSessions, sessionIsLive, type ParkedSession } from './liveSessions';

describe('live sessions', () => {
  it('treats the current streaming session as live', () => {
    assert.equal(sessionIsLive('a', 'a', 'streaming', new Map()), true);
    assert.equal(sessionIsLive('a', 'a', 'ready', new Map()), false);
  });

  it('treats a parked streaming session as live', () => {
    const parked = new Map<string, ParkedSession>([['b', { ...emptyParked('b'), status: 'streaming' }]]);
    assert.equal(sessionIsLive('b', 'a', 'ready', parked), true);
    assert.equal(sessionIsLive('c', 'a', 'ready', parked), false);
  });

  it('injects parked sessions into the list and marks live rows', () => {
    const parked = new Map<string, ParkedSession>([['bg', { ...emptyParked('bg'), status: 'streaming' }]]);
    const rows = overlayLiveSessions(
      [{ id: 'fg', title: 'Front', updatedAt: '2026-01-01' }],
      'fg',
      'ready',
      parked,
    );
    assert.equal(rows.some((row) => row.id === 'bg' && row.live), true);
    assert.equal(rows.find((row) => row.id === 'fg')?.live, false);
  });
});
