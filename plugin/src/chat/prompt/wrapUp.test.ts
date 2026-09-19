import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  WRAP_UP_NOTE,
  stripWrapUpText,
  wrapUpMeta,
  wrapUpPromptBlock,
  wrapUpRulePath,
} from './wrapUp';

describe('wrap-up instruction', () => {
  it('uses a fixed layout with change, effect, and file list', () => {
    assert.match(WRAP_UP_NOTE, /Codex-style recap/);
    assert.match(WRAP_UP_NOTE, /file paths/);
    assert.match(WRAP_UP_NOTE, /bullet list/);
    assert.equal(wrapUpMeta().instructions, WRAP_UP_NOTE);
    assert.deepEqual(wrapUpPromptBlock(), { type: 'text', text: WRAP_UP_NOTE });
    assert.equal(
      wrapUpRulePath('/home/dev'),
      path.join('/home/dev', '.grok', 'rules', 'opengrok-wrap-up.md'),
    );
  });

  it('strips wrap-up text glued onto a short user message', () => {
    const glued = '那你为什么最后一直卡着不结束对话，是网络问题吗# OpenGrok wrap-up\nWhen you finish actual work';
    assert.equal(stripWrapUpText(glued), '那你为什么最后一直卡着不结束对话，是网络问题吗');
    assert.equal(stripWrapUpText('hello'), 'hello');
  });
});
