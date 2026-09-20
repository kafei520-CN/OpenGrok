import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergeLiveMessages,
  mergeTranscript,
  resolveIncomingMessages,
  stabilizeIncomingChat,
} from '../chat/messageMerge';
import { packDelivery, packRemotePayload, REMOTE_STATE_SOFT, chunkMessages } from './remoteState';

describe('remote state packing', () => {
  it('keeps a small snapshot as one frame', () => {
    const frames = packRemotePayload({ type: 'state', state: { status: 'ready', messages: [{ id: '1', text: 'hi' }] } });
    assert.equal(frames.length, 1);
    const row = JSON.parse(frames[0] ?? '') as { type: string; state: { status: string } };
    assert.equal(row.type, 'state');
    assert.equal(row.state.status, 'ready');
  });

  it('tags hydrate message frames with the session id', () => {
    const messages = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      text: 'x'.repeat(2000),
      tools: [],
    }));
    const frames = packRemotePayload({
      type: 'state',
      state: { status: 'ready', messages, currentSessionId: 'sess-1' },
    });
    const part = frames
      .map((frame) => JSON.parse(frame) as { type: string; sessionId?: string })
      .find((row) => row.type === 'messages');
    assert.equal(part?.type, 'messages');
    assert.equal(part?.sessionId, 'sess-1');
  });

  it('splits a 16-message restore without a full-payload size check', () => {
    const messages = Array.from({ length: 16 }, (_, i) => ({
      id: `m${i}`,
      text: 'hi',
      tools: [],
    }));
    const frames = packRemotePayload({ type: 'state', state: { status: 'ready', messages } });
    const boot = JSON.parse(frames[0] ?? '') as { type: string; hydrate?: number };
    assert.equal(boot.type, 'state');
    assert.equal(typeof boot.hydrate, 'number');
  });

  it('does not pack non-state payloads', () => {
    const frames = packRemotePayload({ type: 'tail', message: { id: '1' } });
    assert.equal(frames.length, 1);
    assert.equal(JSON.parse(frames[0] ?? '').type, 'tail');
  });

  it('sends each review file in its own frame after the first', () => {
    const files = [
      { path: 'a.ts', added: 1, removed: 0, hunks: [] },
      { path: 'b.ts', added: 2, removed: 1, hunks: [] },
      { path: 'c.css', added: 3, removed: 2, hunks: [] },
    ];
    const frames = packRemotePayload({
      type: 'diff',
      payload: { locale: 'en', files, messageId: 'm1' },
    });
    assert.equal(frames.length, 3);
    const first = JSON.parse(frames[0] ?? '') as { type: string; payload: { files: Array<{ path: string }> } };
    assert.equal(first.type, 'diff');
    assert.deepEqual(
      first.payload.files.map((file) => file.path),
      ['a.ts'],
    );
    const second = JSON.parse(frames[1] ?? '') as { type: string; files: Array<{ path: string }> };
    assert.equal(second.type, 'diffMore');
    assert.equal(second.files[0]?.path, 'b.ts');
  });

  it('splits a long transcript so the first frame stays under the soft cap', () => {
    const messages = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'x'.repeat(2000),
      tools: [],
    }));
    const full = JSON.stringify({ type: 'state', state: { status: 'ready', messages } });
    assert.ok(Buffer.byteLength(full) > REMOTE_STATE_SOFT);
    const frames = packRemotePayload({ type: 'state', state: { status: 'ready', messages } });
    assert.ok(frames.length >= 2);
    const boot = JSON.parse(frames[0] ?? '') as {
      type: string;
      hydrate: number;
      state: { status: string; restoringSession?: boolean; messages: Array<{ id: string }> };
    };
    assert.equal(boot.type, 'state');
    assert.equal(boot.state.status, 'ready');
    assert.ok(Buffer.byteLength(frames[0] ?? '') <= REMOTE_STATE_SOFT);
    const ids: string[] = boot.state.messages.map((row) => row.id);
    for (let i = 1; i < frames.length; i += 1) {
      const part = JSON.parse(frames[i] ?? '') as {
        type: string;
        prepend?: boolean;
        reset?: boolean;
        done?: boolean;
        messages: Array<{ id: string }>;
      };
      assert.equal(part.type, 'messages');
      if (part.prepend) {
        ids.unshift(...part.messages.map((row) => row.id));
      } else if (part.reset) {
        ids.length = 0;
        ids.push(...part.messages.map((row) => row.id));
      } else {
        ids.push(...part.messages.map((row) => row.id));
      }
    }
    assert.deepEqual(
      ids,
      messages.map((row) => row.id),
    );
    assert.equal(boot.state.restoringSession, false);
  });

  it('keeps a full restore on the replay path instead of a merge tail', () => {
    const messages = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'x'.repeat(2000),
      tools: [],
    }));
    const frames = packDelivery({ type: 'state', state: { status: 'ready', messages } });
    assert.ok(frames.length >= 2);
    const boot = JSON.parse(frames[0] ?? '') as {
      merge?: boolean;
      hydrate?: number;
      state: { restoringSession?: boolean; messages: Array<{ id: string }> };
    };
    assert.equal(boot.merge, undefined);
    assert.equal(typeof boot.hydrate, 'number');
    assert.equal(boot.state.restoringSession, false);
  });

  it('only shows the restore spinner when the host is restoring', () => {
    const messages = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'x'.repeat(2000),
      tools: [],
    }));
    const frames = packRemotePayload({
      type: 'state',
      state: { status: 'ready', restoringSession: true, messages },
    });
    const boot = JSON.parse(frames[0] ?? '') as {
      state: { restoringSession?: boolean };
    };
    assert.equal(boot.state.restoringSession, true);
  });

  it('live updates of a long chat send a merge tail instead of replaying history', () => {
    const messages = Array.from({ length: 80 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: 'x'.repeat(2000),
      tools: [],
    }));
    const frames = packRemotePayload({ type: 'state', state: { status: 'ready', messages } }, 'update');
    assert.equal(frames.length, 1);
    const row = JSON.parse(frames[0] ?? '') as {
      merge?: boolean;
      state: { messages: Array<{ id: string }>; restoringSession?: boolean };
    };
    assert.equal(row.merge, true);
    assert.equal(row.state.restoringSession, false);
    assert.ok(row.state.messages.length < messages.length);
    assert.equal(row.state.messages.at(-1)?.id, 'm79');
    const kept = mergeLiveMessages(messages.slice(0, 80), row.state.messages);
    assert.equal(kept?.at(-1)?.id, 'm79');
    assert.equal(kept?.length, 80);
  });

  it('merges a sent tail onto an already-open transcript', () => {
    const had = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const tail = [{ id: 'b', text: 'upd' }, { id: 'c' }, { id: 'd' }];
    const merged = mergeLiveMessages(had, tail);
    assert.deepEqual(
      merged?.map((row) => row.id),
      ['a', 'b', 'c', 'd'],
    );
    assert.equal((merged?.[1] as { text?: string }).text, 'upd');
  });

  it('does not merge when the last live message vanished (rewind / new session)', () => {
    const had = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.equal(mergeLiveMessages(had, [{ id: 'a' }, { id: 'b' }]), undefined);
  });

  it('does not treat a same-session empty restore as a real restore', () => {
    const had = [{ id: 'u' }, { id: 'a' }];
    const next = stabilizeIncomingChat({
      incomingSessionId: 's1',
      incomingRestoring: true,
      incomingMessages: [],
      hadSessionId: 's1',
      hadMessages: had,
    });
    assert.equal(next.restoring, false);
    assert.equal(next.merge, true);
    assert.deepEqual(
      next.messages.map((row) => row.id),
      ['u', 'a'],
    );
  });

  it('still restores when the session id actually changes', () => {
    const next = stabilizeIncomingChat({
      incomingSessionId: 's2',
      incomingRestoring: true,
      incomingMessages: [],
      hadSessionId: 's1',
      hadMessages: [{ id: 'old' }],
    });
    assert.equal(next.restoring, true);
    assert.equal(next.messages.length, 0);
  });

  it('merges a same-session hydrate replay instead of replacing the open chat', () => {
    const next = stabilizeIncomingChat({
      incomingSessionId: 's1',
      incomingRestoring: false,
      incomingMessages: [{ id: 'a' }],
      hadSessionId: 's1',
      hadMessages: [{ id: 'u' }, { id: 'a' }],
      hydrate: 9,
    });
    assert.equal(next.merge, true);
    assert.equal(next.restoring, false);
  });

  it('keeps the open transcript when a live snapshot omits messages', () => {
    const had = [{ id: 'a' }, { id: 'b' }];
    assert.deepEqual(
      mergeTranscript(had, []).map((row) => row.id),
      ['a', 'b'],
    );
  });

  it('puts a late user bubble back before its assistant after a stream tail raced ahead', () => {
    const had = [{ id: 'u1' }, { id: 'a1' }, { id: 'a2' }];
    const incoming = [{ id: 'u2' }, { id: 'a2' }];
    const merged = mergeLiveMessages(had, incoming);
    assert.deepEqual(
      merged?.map((row) => row.id),
      ['u1', 'a1', 'u2', 'a2'],
    );
  });

  it('appends a new user turn that is not in the live tail', () => {
    const had = [{ id: 'a' }, { id: 'b' }];
    const next = mergeTranscript(had, [{ id: 'c' }, { id: 'd' }]);
    assert.deepEqual(
      next.map((row) => row.id),
      ['a', 'b', 'c', 'd'],
    );
  });

  it('does not skip hydrate prepends on a fresh large restore', () => {
    const tail = [{ id: 'c' }, { id: 'd' }];
    const fresh = resolveIncomingMessages([], tail, { hydrate: 3 });
    assert.deepEqual(
      fresh.messages.map((row) => row.id),
      ['c', 'd'],
    );
    assert.equal(fresh.skipHydrate, undefined);
    assert.equal(fresh.live, false);
  });

  it('skips hydrate prepends only when the open transcript already overlaps', () => {
    const had = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const hit = resolveIncomingMessages(had, [{ id: 'c' }, { id: 'd' }], { hydrate: 9 });
    assert.deepEqual(
      hit.messages.map((row) => row.id),
      ['a', 'b', 'c', 'd'],
    );
    assert.equal(hit.skipHydrate, 9);
  });

  it('chunks messages without dropping a oversized single item', () => {
    const huge = { id: 'big', text: 'y'.repeat(90_000) };
    const chunks = chunkMessages([huge, { id: 'b', text: 'z' }], 8_000);
    assert.equal(chunks[0]?.[0], huge);
    const last = chunks.at(-1)?.at(-1) as { id: string };
    assert.equal(last.id, 'b');
  });
});
