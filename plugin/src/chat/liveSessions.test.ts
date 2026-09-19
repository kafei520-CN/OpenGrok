import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cloneMessages,
  emptyParked,
  lastAssistantInterrupted,
  overlayLiveSessions,
  resolveIncomingSessionId,
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

  it('clones parked transcripts so sessions cannot share the same array', () => {
    const original = [{ id: 'a', role: 'assistant' as const, text: 'one', tools: [] }];
    const copy = cloneMessages(original);
    copy[0].text = 'two';
    copy.push({ id: 'b', role: 'user', text: 'x', tools: [] });
    assert.equal(original[0]?.text, 'one');
    assert.equal(original.length, 1);
  });

  it('keeps the current session in the list even after it leaves parked', () => {
    const rows = overlayLiveSessions(
      [{ id: 'old', title: 'Older chat' }],
      'fresh',
      'ready',
      new Map(),
      [{ id: 'u', role: 'user', text: '【编曲】风格: 交响乐', tools: [] }],
    );
    const current = rows.find((row) => row.id === 'fresh');
    assert.ok(current);
    assert.equal(current?.title, '【编曲】风格: 交响乐');
  });

  it('keeps untitled parked chats in the list', () => {
    const parked = new Map<string, ParkedSession>([
      [
        'new',
        {
          ...emptyParked('new'),
          title: 'hello there',
          messages: [{ id: 'u', role: 'user', text: 'hello there', tools: [] }],
        },
      ],
    ]);
    const rows = overlayLiveSessions([{ id: 'new', title: '', cwd: '/tmp' }], 'old', 'ready', parked);
    assert.equal(rows.find((row) => row.id === 'new')?.title, 'hello there');
  });

  it('routes live updates without sessionId to the parked running session', () => {
    const parked = new Map<string, ParkedSession>([
      ['a', { ...emptyParked('a'), status: 'streaming' }],
    ]);
    assert.equal(
      resolveIncomingSessionId({
        currentId: 'b',
        currentStreaming: false,
        parked,
      }),
      'a',
    );
    assert.equal(
      resolveIncomingSessionId({
        sessionId: 'b',
        currentId: 'b',
        currentStreaming: false,
        parked,
      }),
      'b',
    );
    assert.equal(
      resolveIncomingSessionId({
        currentId: 'b',
        currentStreaming: false,
        replaying: true,
        isReplay: true,
        parked,
      }),
      'b',
    );
  });
});
