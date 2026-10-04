import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { padBox, shouldCropRed, tileSpans, type RedBox } from './visionPrep';

const box: RedBox = { x: 100, y: 80, w: 200, h: 60, count: 80 };

describe('vision prep', () => {
  it('crops a red mark that is a region of the screenshot', () => {
    assert.equal(shouldCropRed(box, 2000, 1200), true);
    assert.equal(shouldCropRed({ ...box, count: 3 }, 2000, 1200), false);
    assert.equal(shouldCropRed({ x: 0, y: 0, w: 1900, h: 1100, count: 500 }, 2000, 1200), false);
  });

  it('pads the crop and keeps it inside the image', () => {
    const padded = padBox({ x: 4, y: 4, w: 20, h: 20, count: 50 }, 100, 80);
    assert.equal(padded.x, 0);
    assert.equal(padded.y, 0);
    assert.ok(padded.w > 20);
  });

  it('splits only a tall screenshot', () => {
    assert.deepEqual(tileSpans(800, 600), []);
    const spans = tileSpans(800, 2600);
    assert.ok(spans.length >= 2);
    assert.equal(spans[0]?.y, 0);
  });
});
