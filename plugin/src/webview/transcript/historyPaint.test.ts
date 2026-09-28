import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paintAlign, shouldLoadOlder, tailStart } from './historyPaint';

describe('shouldLoadOlder', () => {
  it('keeps pulling while the tail is shorter than the screen', () => {
    assert.equal(
      shouldLoadOlder({ scrollTop: 0, scrollHeight: 400, clientHeight: 800, olderCount: 3 }),
      true,
    );
  });

  it('pulls when the viewport is near the top of a long transcript', () => {
    assert.equal(
      shouldLoadOlder({ scrollTop: 40, scrollHeight: 4000, clientHeight: 800, olderCount: 12 }),
      true,
    );
  });

  it('leaves history alone while the reader is on the latest turns', () => {
    assert.equal(
      shouldLoadOlder({ scrollTop: 3000, scrollHeight: 4000, clientHeight: 800, olderCount: 12 }),
      false,
    );
    assert.equal(
      shouldLoadOlder({ scrollTop: 0, scrollHeight: 400, clientHeight: 800, olderCount: 0 }),
      false,
    );
  });
});

describe('paintAlign', () => {
  it('treats empty lists as equal', () => {
    assert.deepEqual(paintAlign([], []), { kind: 'equal' });
  });

  it('rebuilds when nothing is painted yet', () => {
    assert.deepEqual(paintAlign(['a', 'b'], []), { kind: 'mismatch' });
  });

  it('matches equal ids', () => {
    assert.deepEqual(paintAlign(['a', 'b'], ['a', 'b']), { kind: 'equal' });
  });

  it('detects appended turns as a prefix', () => {
    assert.deepEqual(paintAlign(['a', 'b', 'c'], ['a', 'b']), { kind: 'prefix', extra: 1 });
  });

  it('detects prepended history as a suffix', () => {
    assert.deepEqual(paintAlign(['old', 'a', 'b'], ['a', 'b']), { kind: 'suffix', extra: 1 });
  });

  it('trims extra painted turns after rewind', () => {
    assert.deepEqual(paintAlign(['a', 'b'], ['a', 'b', 'c']), { kind: 'trim', extra: 1 });
  });

  it('mismatches when the painted window is not a prefix or suffix', () => {
    assert.deepEqual(paintAlign(['x', 'y'], ['a', 'b']), { kind: 'mismatch' });
    assert.deepEqual(paintAlign(['a', 'b', 'c'], ['b', 'x']), { kind: 'mismatch' });
  });
});

describe('tailStart', () => {
  it('paints everything when the transcript is short', () => {
    assert.equal(tailStart(2), 0);
    assert.equal(tailStart(1), 0);
  });

  it('keeps only the last tail of a long transcript', () => {
    assert.equal(tailStart(10), 4);
    assert.equal(tailStart(10, 4), 6);
  });
});
