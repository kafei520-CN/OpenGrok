import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paintAlign, tailStart } from './historyPaint';

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
