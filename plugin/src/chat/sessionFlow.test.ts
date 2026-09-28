import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionFlow, type SessionFlowItem } from './sessionFlow';
import type { SessionUpdate } from '../core/types';

function textUpdate(kind: string, text: string): SessionUpdate {
  return { sessionUpdate: kind, content: { type: 'text', text } };
}

function texts(items: SessionFlowItem[]): string[] {
  return items.map((item) => {
    const content = item.update.content;
    const block = Array.isArray(content) ? content[0] : content;
    return `${item.isReplay ? 'replay' : 'live'}:${item.update.sessionUpdate}:${block?.text ?? ''}`;
  });
}

function harness(opts?: { flushDelayMs?: number; maxItems?: number }) {
  const delivered: SessionFlowItem[] = [];
  const bursts: string[] = [];
  const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
  const flow = createSessionFlow({
    deliver: (item) => delivered.push(item),
    onBackgroundBurst: (sessionId) => bursts.push(sessionId),
    flushDelayMs: opts?.flushDelayMs ?? 1_500,
    maxItems: opts?.maxItems,
    schedule: (fn) => {
      const timer = { fn, cancelled: false };
      timers.push(timer);
      return {
        cancel() {
          timer.cancelled = true;
        },
      };
    },
  });
  return {
    flow,
    delivered,
    bursts,
    fire() {
      const due = timers.splice(0);
      for (const timer of due) {
        if (!timer.cancelled) {
          timer.fn();
        }
      }
    },
  };
}

describe('sessionFlow', () => {
  it('delivers the foreground session one update at a time', () => {
    const { flow, delivered } = harness();
    flow.setMode('s', 'foreground');
    flow.accept('s', textUpdate('agent_message_chunk', 'a'), false);
    flow.accept('s', textUpdate('agent_message_chunk', 'b'), false);
    assert.deepEqual(texts(delivered), [
      'live:agent_message_chunk:a',
      'live:agent_message_chunk:b',
    ]);
  });

  it('merges background text and thinking until a structural event flushes them', () => {
    const { flow, delivered, bursts } = harness();
    flow.setMode('s', 'background');
    flow.accept('s', textUpdate('agent_thought_chunk', '想'), false);
    flow.accept('s', textUpdate('agent_thought_chunk', '一下'), false);
    flow.accept('s', textUpdate('agent_message_chunk', '你'), false);
    flow.accept('s', textUpdate('agent_message_chunk', '好'), false);
    assert.deepEqual(delivered, []);
    assert.deepEqual(bursts, ['s']);
    flow.accept('s', { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'read' }, false);
    assert.deepEqual(texts(delivered), [
      'live:agent_thought_chunk:想一下',
      'live:agent_message_chunk:你好',
      'live:tool_call:',
    ]);
  });

  it('flushes merged background text when the session comes to the foreground', () => {
    const { flow, delivered } = harness();
    flow.setMode('s', 'background');
    flow.accept('s', textUpdate('agent_message_chunk', '还'), false);
    flow.accept('s', textUpdate('agent_message_chunk', '在写'), false);
    flow.setMode('s', 'foreground');
    assert.deepEqual(texts(delivered), ['live:agent_message_chunk:还在写']);
    flow.accept('s', textUpdate('agent_message_chunk', '。'), false);
    assert.deepEqual(texts(delivered), [
      'live:agent_message_chunk:还在写',
      'live:agent_message_chunk:。',
    ]);
  });

  it('keeps an image chunk intact instead of folding it into text', () => {
    const { flow, delivered } = harness();
    flow.setMode('s', 'background');
    flow.accept('s', textUpdate('agent_message_chunk', '看'), false);
    flow.accept(
      's',
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'abc', mimeType: 'image/png', text: '图' },
      },
      false,
    );
    assert.equal(delivered.length, 2);
    assert.equal(texts(delivered).at(0), 'live:agent_message_chunk:看');
    const image = delivered[1]?.update.content;
    const block = Array.isArray(image) ? image[0] : image;
    assert.equal(block?.data, 'abc');
  });

  it('holds events until the transcript is installed, then replays history before live tokens', () => {
    const { flow, delivered } = harness();
    flow.setMode('s', 'replaying');
    flow.hold('s');
    flow.accept('s', textUpdate('agent_message_chunk', 'live-1'), false);
    flow.accept('s', textUpdate('user_message_chunk', 'old'), true);
    flow.accept('s', textUpdate('agent_message_chunk', 'live-2'), false);
    assert.deepEqual(delivered, []);
    flow.unhold('s');
    flow.setMode('s', 'foreground');
    flow.releaseBuffered('s');
    assert.deepEqual(texts(delivered), [
      'replay:user_message_chunk:old',
      'live:agent_message_chunk:live-1',
      'live:agent_message_chunk:live-2',
    ]);
  });

  it('applies history immediately while replaying and keeps live tokens buffered', () => {
    const { flow, delivered } = harness();
    flow.setMode('s', 'replaying');
    flow.accept('s', textUpdate('user_message_chunk', '历史'), true);
    flow.accept('s', textUpdate('agent_message_chunk', '现在'), false);
    assert.deepEqual(texts(delivered), ['replay:user_message_chunk:历史']);
    flow.setMode('s', 'foreground');
    flow.releaseBuffered('s');
    assert.deepEqual(texts(delivered), [
      'replay:user_message_chunk:历史',
      'live:agent_message_chunk:现在',
    ]);
  });

  it('flushes a background burst on the timer without dropping the merged text', () => {
    const { flow, delivered, fire } = harness({ flushDelayMs: 1_500 });
    flow.setMode('s', 'background');
    flow.accept('s', textUpdate('agent_message_chunk', '一'), false);
    flow.accept('s', textUpdate('agent_message_chunk', '二'), false);
    assert.deepEqual(delivered, []);
    fire();
    assert.deepEqual(texts(delivered), ['live:agent_message_chunk:一二']);
  });

  it('dropPending forgets the merged background text', () => {
    const { flow, delivered, fire } = harness();
    flow.setMode('s', 'background');
    flow.accept('s', textUpdate('agent_message_chunk', '前缀'), false);
    flow.dropPending('s');
    fire();
    flow.setMode('s', 'foreground');
    assert.deepEqual(delivered, []);
  });

  it('drops a discarded lane instead of delivering it later', () => {
    const { flow, delivered, fire } = harness();
    flow.setMode('s', 'background');
    flow.accept('s', textUpdate('agent_message_chunk', '丢掉'), false);
    flow.discard('s');
    fire();
    assert.deepEqual(delivered, []);
    assert.equal(flow.mode('s'), undefined);
  });
});
