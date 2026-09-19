import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptyParked,
  lastAssistantInterrupted,
  overlayLiveSessions,
  sessionIsLive,
  sessionRunState,
  slimParkedRow,
  trimParkedSessions,
  type ParkedSession,
} from './liveSessions';

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
    assert.equal(rows.find((row) => row.id === 'bg')?.runState, 'running');
    assert.equal(rows.find((row) => row.id === 'fg')?.runState, undefined);
  });

  it('dots unread parked sessions only, not idle history', () => {
    assert.equal(lastAssistantInterrupted([{ role: 'assistant', stopped: true }]), true);
    assert.equal(lastAssistantInterrupted([{ role: 'assistant' }]), false);
    const parked = new Map<string, ParkedSession>([
      [
        'cut',
        {
          ...emptyParked('cut'),
          unread: true,
          messages: [{ id: 'a1', role: 'assistant', text: '', tools: [], stopped: true }],
        },
      ],
      [
        'done',
        {
          ...emptyParked('done'),
          unread: true,
          messages: [{ id: 'a2', role: 'assistant', text: 'ok', tools: [] }],
        },
      ],
      [
        'read',
        {
          ...emptyParked('read'),
          messages: [{ id: 'a3', role: 'assistant', text: 'ok', tools: [] }],
        },
      ],
    ]);
    assert.equal(sessionRunState('cut', 'fg', 'ready', parked), 'stopped');
    assert.equal(sessionRunState('done', 'fg', 'ready', parked), 'done');
    assert.equal(sessionRunState('read', 'fg', 'ready', parked), undefined);
    assert.equal(sessionRunState('fg', 'fg', 'ready', parked), undefined);
    assert.equal(sessionRunState('idle', 'fg', 'ready', parked), undefined);
  });

  it('slims old parked transcripts but keeps unread status', () => {
    const heavy: ParkedSession = {
      ...emptyParked('old'),
      unread: true,
      messages: [
        { id: 'u', role: 'user', text: 'x'.repeat(200), tools: [] },
        { id: 'a', role: 'assistant', text: 'y'.repeat(200), tools: [], stopped: true },
      ],
    };
    const live: ParkedSession = {
      ...emptyParked('live'),
      status: 'streaming',
      messages: [{ id: 'a2', role: 'assistant', text: 'run', tools: [], streaming: true }],
    };
    const recent: ParkedSession = {
      ...emptyParked('new'),
      messages: [{ id: 'a3', role: 'assistant', text: 'keep', tools: [] }],
    };
    const parked = new Map<string, ParkedSession>([
      ['old', heavy],
      ['live', live],
      ['new', recent],
    ]);
    trimParkedSessions(parked, 'fg', ['old', 'live', 'new'], 1);
    assert.equal(parked.get('old')?.messages.length, 0);
    assert.equal(parked.get('old')?.unread, true);
    assert.equal(parked.get('old')?.stopped, true);
    assert.equal(parked.get('live')?.messages.length, 1);
    assert.equal(parked.get('new')?.messages.length, 1);
    slimParkedRow(recent);
    assert.equal(recent.messages.length, 0);
  });
});
