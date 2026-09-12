import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveEditSummary, lerpInt } from './liveEdits';
import type { ChatMessage } from '../core/types';

function assistant(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    text: '',
    tools: [],
    streaming: true,
    edits: [{ path: 'src/a.ts', added: 2, removed: 0 }],
    ...over,
  };
}

describe('live edit strip', () => {
  it('is only visible on a streaming assistant turn with edits', () => {
    const edits = [{ path: 'src/a.ts', added: 2, removed: 1 }];
    assert.equal(
      liveEditSummary({
        status: 'streaming',
        messages: [assistant({ edits })],
      })?.files,
      1,
    );
    assert.equal(
      liveEditSummary({
        status: 'ready',
        messages: [assistant({ edits, streaming: false })],
      }),
      undefined,
    );
    assert.equal(
      liveEditSummary({
        status: 'streaming',
        messages: [assistant({ edits: [] })],
      }),
      undefined,
    );
  });

  it('sums added and removed across files', () => {
    const summary = liveEditSummary({
      status: 'streaming',
      messages: [
        assistant({
          edits: [
            { path: 'a.ts', added: 2, removed: 0 },
            { path: 'b.ts', added: 4, removed: 3 },
          ],
        }),
      ],
    });
    assert.equal(summary?.files, 2);
    assert.equal(summary?.added, 6);
    assert.equal(summary?.removed, 3);
  });

  it('eases integer ticks toward the new count', () => {
    assert.equal(lerpInt(0, 10, 0), 0);
    assert.equal(lerpInt(0, 10, 1), 10);
    const mid = lerpInt(0, 10, 0.5);
    assert.ok(mid > 5 && mid < 10);
  });
});
