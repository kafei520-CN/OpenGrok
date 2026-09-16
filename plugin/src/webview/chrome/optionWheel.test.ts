import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampTarget, shortestDelta, wrapIndex } from './optionWheel';

describe('optionWheel math', () => {
  it('wraps indices onto the wheel', () => {
    assert.equal(wrapIndex(0, 4), 0);
    assert.equal(wrapIndex(3, 4), 3);
    assert.equal(wrapIndex(4, 4), 0);
    assert.equal(wrapIndex(-1, 4), 3);
    assert.equal(wrapIndex(0, 0), 0);
  });

  it('clamps a finite wheel and wraps a looping one', () => {
    assert.equal(clampTarget(8, 4, false, true), 3);
    assert.equal(clampTarget(-2, 4, false, true), 0);
    assert.equal(clampTarget(1.4, 4, false, true), 1);
    assert.equal(clampTarget(1.4, 4, false, false), 1.4);
    assert.equal(clampTarget(8.2, 4, true, false), 8.2);
  });

  it('takes the shortest looped delta', () => {
    assert.equal(shortestDelta(0, 0, 6, false), 0);
    assert.equal(shortestDelta(5, 0, 6, false), 5);
    assert.equal(shortestDelta(5, 0, 6, true), -1);
    assert.equal(shortestDelta(0, 5, 6, true), 1);
  });
});
