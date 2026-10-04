import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accountKey, markCurrent, upsertAccount, type SavedAccount } from './accountBook';

function row(id: string, current = false): SavedAccount {
  return { id, name: id, current };
}

describe('account book', () => {
  it('keys an email into a stable file name', () => {
    assert.equal(accountKey({ email: 'A@Example.com' }), 'a@example.com');
  });

  it('keeps one current account when another is saved', () => {
    const next = upsertAccount([row('a', true), row('b')], { ...row('c'), current: true });
    assert.deepEqual(
      next.map((item) => [item.id, item.current]),
      [
        ['a', false],
        ['b', false],
        ['c', true],
      ],
    );
  });

  it('marks the switched account current', () => {
    const next = markCurrent([row('a', true), row('b')], 'b');
    assert.equal(next.find((item) => item.id === 'b')?.current, true);
    assert.equal(next.find((item) => item.id === 'a')?.current, false);
  });
});
