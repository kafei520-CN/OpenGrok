import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  archiveExt,
  formatArchiveListing,
  isArchivePath,
  looksLikeZip,
  splitArchivePath,
} from './archives';

describe('archives', () => {
  it('recognizes zip and tar names', () => {
    assert.equal(isArchivePath('C:\\work\\mod.jar'), true);
    assert.equal(isArchivePath('/tmp/pack.tar.gz'), true);
    assert.equal(isArchivePath('notes.md'), false);
    assert.equal(archiveExt('foo.tar.gz'), 'tgz');
  });

  it('splits an inner archive path', () => {
    const next = splitArchivePath('E:/work/mod.jar/assets/lang/en_us.json');
    assert.equal(next.archive.replace(/\\/g, '/').endsWith('mod.jar'), true);
    assert.equal(next.member, 'assets/lang/en_us.json');
    assert.equal(splitArchivePath('E:/work/mod.jar').member, undefined);
  });

  it('formats a listing and detects zip magic', () => {
    assert.match(formatArchiveListing('pack.zip', ['a.txt', 'b/']), /2 entries/);
    assert.equal(looksLikeZip(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00])), true);
    assert.equal(looksLikeZip(Uint8Array.from([0x00, 0x01])), false);
  });
});
