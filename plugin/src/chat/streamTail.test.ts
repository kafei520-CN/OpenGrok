import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStreamTail, emptyStreamCursor, mergeStreamTail } from './streamTail';
import type { ChatMessage } from '../core/types';

function assistant(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'text'>): ChatMessage {
  return {
    role: 'assistant',
    tools: [],
    streaming: true,
    ...partial,
  };
}

describe('streamTail', () => {
  it('sends the first body as appendText and edit counts without file bodies', () => {
    const last = assistant({
      id: 'a1',
      text: 'hello world',
      tools: [{ id: 't1', title: 'read', status: 'done' }],
      edits: [{ path: 'a.ts', added: 1, removed: 0, previous: 'x'.repeat(20_000), next: 'y'.repeat(20_000) }],
    });
    const { tail } = buildStreamTail(emptyStreamCursor(), last, { status: 'streaming' });
    assert.equal(tail.appendText, 'hello world');
    assert.equal(tail.message.text, '');
    assert.deepEqual(tail.message.edits, [{ path: 'a.ts', added: 1, removed: 0 }]);
    assert.equal(JSON.stringify(tail).includes('previous'), false);
    assert.equal(tail.message.tools.length, 1);
  });

  it('later ticks only carry the new bytes and reuse tools', () => {
    const first = assistant({
      id: 'a1',
      text: 'hello',
      tools: [{ id: 't1', title: 'read', status: 'done', detail: 'a.ts' }],
    });
    const { tail: t1, cursor } = buildStreamTail(emptyStreamCursor(), first, { status: 'streaming' });
    const web = mergeStreamTail(undefined, t1);
    const next = assistant({
      ...first,
      text: 'hello world',
      edits: [{ path: 'a.ts', added: 2, removed: 0, previous: 'old'.repeat(30_000), next: 'new'.repeat(30_000) }],
    });
    const { tail: t2 } = buildStreamTail(cursor, next, { status: 'streaming' });
    assert.equal(t2.appendText, ' world');
    assert.equal(t2.message.text, '');
    assert.equal(t2.message.tools.length, 0);
    assert.ok(JSON.stringify(t2).length < 800);
    const merged = mergeStreamTail(web, t2);
    assert.equal(merged.text, 'hello world');
    assert.equal(merged.tools.length, 1);
    assert.equal(merged.tools[0]?.title, 'read');
    assert.deepEqual(merged.edits, [{ path: 'a.ts', added: 2, removed: 0 }]);
  });

  it('appends thinking without resending the prefix', () => {
    const first = assistant({ id: 'a1', text: '', thinking: 'why' });
    const { tail: t1, cursor } = buildStreamTail(emptyStreamCursor(), first, { status: 'streaming' });
    const web = mergeStreamTail(undefined, t1);
    assert.equal(web.thinking, 'why');
    const next = assistant({ id: 'a1', text: '', thinking: 'why not' });
    const { tail: t2 } = buildStreamTail(cursor, next, { status: 'streaming' });
    assert.equal(t2.appendThinking, ' not');
    assert.equal(t2.message.thinking, undefined);
    assert.equal(mergeStreamTail(web, t2).thinking, 'why not');
  });

  it('keeps webview edits when the host omits them', () => {
    const first = assistant({
      id: 'a1',
      text: 'hi',
      edits: [{ path: 'a.ts', added: 1, removed: 0 }],
    });
    const { tail: t1, cursor } = buildStreamTail(emptyStreamCursor(), first, { status: 'streaming' });
    const web = { ...mergeStreamTail(undefined, t1), edits: first.edits };
    const { tail: t2 } = buildStreamTail(cursor, assistant({ id: 'a1', text: 'hi!' }), {
      status: 'streaming',
    });
    const merged = mergeStreamTail(web, t2);
    assert.equal(merged.text, 'hi!');
    assert.equal(merged.edits?.[0]?.path, 'a.ts');
  });

  it('clears a retry error across JSON IPC when the stream resumes', () => {
    const first = assistant({
      id: 'a1',
      text: '',
      error: { message: 'empty response from model (no_visible_content)', code: 'no_visible_content', retrying: true, attempt: 1 },
    });
    const { cursor } = buildStreamTail(emptyStreamCursor(), first, { status: 'streaming' });
    const web = mergeStreamTail(
      undefined,
      JSON.parse(JSON.stringify(buildStreamTail(emptyStreamCursor(), first, { status: 'streaming' }).tail)),
    );
    assert.equal(web.error?.retrying, true);
    const next = assistant({ id: 'a1', text: 'ok', thinking: 'why' });
    const wire = JSON.parse(JSON.stringify(buildStreamTail(cursor, next, { status: 'streaming' }).tail));
    const merged = mergeStreamTail(web, wire);
    assert.equal(merged.error, undefined);
    assert.equal(merged.text, 'ok');
  });

  it('sends step status changes on later ticks', () => {
    const first = assistant({
      id: 'a1',
      text: 'x',
      steps: [
        { content: 'One', status: 'in_progress' },
        { content: 'Two', status: 'pending' },
      ],
    });
    const { tail: t1, cursor } = buildStreamTail(emptyStreamCursor(), first, { status: 'streaming' });
    const web = mergeStreamTail(undefined, JSON.parse(JSON.stringify(t1)));
    assert.equal(web.steps?.[0]?.status, 'in_progress');
    const next = assistant({
      id: 'a1',
      text: 'xy',
      steps: [
        { content: 'One', status: 'completed' },
        { content: 'Two', status: 'in_progress' },
      ],
    });
    const { tail: t2 } = buildStreamTail(cursor, next, { status: 'streaming' });
    const wire = JSON.parse(JSON.stringify(t2));
    assert.equal(wire.message.steps[0].status, 'completed');
    const merged = mergeStreamTail(web, wire);
    assert.equal(merged.steps?.[0]?.status, 'completed');
    assert.equal(merged.steps?.[1]?.status, 'in_progress');
    assert.equal(merged.text, 'xy');
  });

  it('does not put a huge tool body on the wire', () => {
    const last = assistant({
      id: 'a1',
      text: 'x',
      tools: [{ id: 't1', title: 'read', status: 'done', detail: 'z'.repeat(20_000) }],
    });
    const { tail } = buildStreamTail(emptyStreamCursor(), last, { status: 'streaming' });
    assert.ok((tail.message.tools[0]?.detail?.length ?? 0) <= 240);
    assert.ok(JSON.stringify(tail).length < 2000);
  });

  it('resends tools when the stamp changes', () => {
    const first = assistant({
      id: 'a1',
      text: 'x',
      tools: [{ id: 't1', title: 'read', status: 'running' }],
    });
    const { cursor } = buildStreamTail(emptyStreamCursor(), first, { status: 'streaming' });
    const next = assistant({
      id: 'a1',
      text: 'x',
      tools: [{ id: 't1', title: 'read', status: 'done' }],
    });
    const { tail } = buildStreamTail(cursor, next, { status: 'streaming' });
    assert.equal(tail.message.tools[0]?.status, 'done');
  });
});
