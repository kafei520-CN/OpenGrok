import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessage } from '../core/types';
import { traceBeats } from './traceBeats';

describe('trace beats', () => {
  it('falls back to one think block then tools when a saved turn has no beats', () => {
    const message: ChatMessage = {
      id: 'a',
      role: 'assistant',
      text: '',
      thinking: 'old',
      tools: [{ id: 't', title: 'Read', status: 'completed' }],
    };
    assert.deepEqual(traceBeats(message), [
      { kind: 'think', text: 'old' },
      { kind: 'tool', id: 't' },
    ]);
  });
});
