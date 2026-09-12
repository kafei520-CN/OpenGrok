import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRuleFileName, safeRuleStem } from './rulesHost';

describe('rules files', () => {
  it('parses enabled and disabled markdown names', () => {
    assert.deepEqual(parseRuleFileName('style.md'), { name: 'style', enabled: true });
    assert.deepEqual(parseRuleFileName('style.md.disabled'), {
      name: 'style',
      enabled: false,
    });
    assert.equal(parseRuleFileName('notes.txt'), undefined);
    assert.deepEqual(parseRuleFileName('Claude.md'), { name: 'Claude', enabled: true });
    assert.deepEqual(parseRuleFileName('CLAUDE.md.disabled'), {
      name: 'CLAUDE',
      enabled: false,
    });
  });

  it('strips extension and unsafe characters from import stems', () => {
    assert.equal(safeRuleStem('/tmp/My Rule.md'), 'My Rule');
    assert.equal(safeRuleStem('notes.txt'), 'notes');
    assert.equal(safeRuleStem('foo:bar.md'), 'foo-bar');
  });
});
