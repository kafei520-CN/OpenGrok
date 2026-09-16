import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gravatarUrl, parseAccountInfo, pickAvatarUrl } from './account';

describe('account avatar', () => {
  it('picks https avatar fields', () => {
    assert.equal(
      pickAvatarUrl({ avatar_url: 'https://cdn.example/a.png' }),
      'https://cdn.example/a.png',
    );
    assert.equal(
      pickAvatarUrl({ user: { picture: 'https://cdn.example/b.png' } as unknown as Record<string, unknown> }),
      undefined,
    );
    assert.equal(
      pickAvatarUrl(undefined, { picture: 'https://cdn.example/b.png' }),
      'https://cdn.example/b.png',
    );
  });

  it('ignores non-url values', () => {
    assert.equal(pickAvatarUrl({ avatar: 'not-a-url' }), undefined);
  });

  it('builds a gravatar url from email', () => {
    const url = gravatarUrl('  Foo@Example.COM ');
    assert.ok(url?.startsWith('https://www.gravatar.com/avatar/'));
    assert.ok(url?.includes('d=404'));
    assert.equal(gravatarUrl('nope'), undefined);
  });

  it('parses nested auth info', () => {
    const info = parseAccountInfo({
      email: 'a@b.com',
      first_name: 'Ada',
      user: { picture: 'https://cdn.example/ada.png' },
    });
    assert.equal(info.firstName, 'Ada');
    assert.equal(info.avatarUrl, 'https://cdn.example/ada.png');
  });
});
