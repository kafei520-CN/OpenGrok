import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { WRAP_UP_NOTE, stripWrapUpText, upgradeWrapUpRule, wrapUpRulePath } from './wrapUp';

describe('wrap-up instruction', () => {
  it('lives in a CLI rule file, not a user prompt block', () => {
    assert.match(WRAP_UP_NOTE, /Write like Codex/);
    assert.match(WRAP_UP_NOTE, /leading @/);
    assert.match(WRAP_UP_NOTE, /@path\/to\/artifact\.jar/);
    assert.equal(
      wrapUpRulePath('/home/dev'),
      path.join('/home/dev', '.grok', 'rules', 'opengrok-wrap-up.md'),
    );
  });

  it('upgrades an old wrap-up rule to require the @ file marker', () => {
    const old = [
      '# OpenGrok wrap-up',
      '',
      '3. A closing line that names the output files as real paths (so they render as file links), for example:',
      'path/to/artifact.jar',
      '',
      'Do not omit the file paths after edits.',
    ].join('\n');
    const next = upgradeWrapUpRule(old);
    assert.match(next, /@path\/to\/artifact\.jar/);
    assert.match(next, /leading @/);
    assert.match(next, /1\/5/);
    assert.doesNotMatch(next, /(?<!@)path\/to\/artifact\.jar/);
  });

  it('strips wrap-up text glued onto a short user message', () => {
    const glued = '那你为什么最后一直卡着不结束对话，是网络问题吗# OpenGrok wrap-up\nWhen you finish actual work';
    assert.equal(stripWrapUpText(glued), '那你为什么最后一直卡着不结束对话，是网络问题吗');
    assert.equal(stripWrapUpText('hello'), 'hello');
  });
});
