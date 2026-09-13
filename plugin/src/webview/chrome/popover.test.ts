import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeFloating } from './popover';

const view = { left: 0, top: 0, width: 400, height: 600 };

describe('placeFloating', () => {
  it('keeps a pad away from the top of the view', () => {
    const placed = placeFloating({
      view,
      anchor: { left: 40, top: 500, right: 760, bottom: 560 },
      size: { width: 720, height: 800 },
      prefer: 'above',
      pad: 52,
    });
    assert.ok(placed.top >= 52);
    assert.ok(placed.maxHeight <= 500 - 52 - 6);
  });

  it('opens above when there is room', () => {
    const placed = placeFloating({
      view,
      anchor: { left: 40, top: 500, right: 140, bottom: 530 },
      size: { width: 160, height: 120 },
      prefer: 'above',
    });
    assert.equal(placed.top, 500 - 6 - 120);
    assert.equal(placed.left, 40);
  });

  it('flips below when the top of the screen is too tight', () => {
    const placed = placeFloating({
      view,
      anchor: { left: 20, top: 20, right: 80, bottom: 48 },
      size: { width: 180, height: 200 },
      prefer: 'above',
    });
    assert.ok(placed.top >= 48);
    assert.ok(placed.top + Math.min(200, placed.maxHeight) <= 600 - 8);
  });

  it('flips above when a below menu would cross the bottom edge', () => {
    const placed = placeFloating({
      view,
      anchor: { left: 200, top: 520, right: 392, bottom: 552 },
      size: { width: 176, height: 240 },
      prefer: 'below',
      align: 'end',
    });
    assert.ok(placed.top + Math.min(240, placed.maxHeight) <= 552);
    assert.ok(placed.top >= 8);
  });

  it('shifts left when the panel would cross the right edge', () => {
    const placed = placeFloating({
      view,
      anchor: { left: 350, top: 40, right: 392, bottom: 68 },
      size: { width: 180, height: 80 },
      prefer: 'below',
      align: 'end',
    });
    assert.ok(placed.left + Math.min(180, placed.maxWidth) <= 400 - 8);
    assert.ok(placed.left >= 8);
  });

  it('keeps a menu as wide as its trigger', () => {
    const placed = placeFloating({
      view,
      anchor: { left: 200, top: 500, right: 292, bottom: 530 },
      size: { width: 92, height: 120 },
      prefer: 'above',
    });
    assert.equal(placed.left, 200);
    assert.ok(placed.maxWidth >= 92);
  });

  it('opens to the right of the anchor', () => {
    const placed = placeFloating({
      view,
      anchor: { left: 40, top: 100, right: 140, bottom: 280 },
      size: { width: 80, height: 120 },
      prefer: 'right',
    });
    assert.equal(placed.left, 140 + 6);
    assert.equal(placed.top, 100);
  });

  it('flips left when the right edge is too tight', () => {
    const placed = placeFloating({
      view: { left: 0, top: 0, width: 200, height: 400 },
      anchor: { left: 80, top: 40, right: 180, bottom: 200 },
      size: { width: 90, height: 80 },
      prefer: 'right',
    });
    assert.ok(placed.left + Math.min(90, placed.maxWidth) <= 180);
    assert.ok(placed.left >= 8);
  });

  it('clamps a wide panel to the viewport', () => {
    const placed = placeFloating({
      view: { left: 0, top: 0, width: 120, height: 400 },
      anchor: { left: 8, top: 40, right: 80, bottom: 68 },
      size: { width: 240, height: 80 },
      prefer: 'below',
    });
    assert.ok(placed.left >= 8);
    assert.ok(placed.left + Math.min(240, placed.maxWidth) <= 120 - 8);
  });
});
