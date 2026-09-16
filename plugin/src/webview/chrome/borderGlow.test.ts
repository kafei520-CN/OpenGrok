import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cursorAngle,
  edgeProximity,
  glowPalette,
  isLightColor,
  parseCssColor,
  parseHsl,
  rgbToHsl,
} from './borderGlow';

describe('borderGlow', () => {
  it('parses HSL triplets', () => {
    assert.deepEqual(parseHsl('40 80 80'), { h: 40, s: 80, l: 80 });
    assert.deepEqual(parseHsl('210 50% 40%'), { h: 210, s: 50, l: 40 });
  });

  it('treats white as a light surface', () => {
    assert.equal(isLightColor('#ffffff'), true);
    assert.equal(isLightColor('#120F17'), false);
  });

  it('uses iridescent defaults for ink accents', () => {
    const light = glowPalette('#ffffff', '#1c1c1c', '#444444');
    assert.equal(light.light, true);
    assert.equal(light.glowColor, '40 50 92');
    assert.equal(light.colors.length, 3);

    const dark = glowPalette('#0b1620', '#111111', '#222222');
    assert.equal(dark.light, false);
    assert.deepEqual(dark.colors, ['#c084fc', '#f472b6', '#38bdf8']);
  });

  it('follows a chromatic accent', () => {
    const next = glowPalette('#0b1620', '#7dd3fc', 'rgb(52, 211, 153)');
    assert.equal(next.light, false);
    assert.equal(next.colors[0], '#7dd3fc');
    assert.match(next.glowColor, /^\d+\.\d \d+\.\d 70\.0$/);
  });

  it('reads hex and rgb colors', () => {
    assert.deepEqual(parseCssColor('#fff'), [255, 255, 255]);
    assert.deepEqual(parseCssColor('rgb(125, 211, 252)'), [125, 211, 252]);
    assert.deepEqual(rgbToHsl(255, 0, 0), { h: 0, s: 100, l: 50 });
  });

  it('maps pointer position to edge proximity and angle', () => {
    assert.equal(edgeProximity(200, 100, 100, 50), 0);
    assert.equal(edgeProximity(200, 100, 200, 50), 100);
    assert.equal(cursorAngle(200, 100, 200, 50), 90);
    assert.equal(cursorAngle(200, 100, 100, 0), 0);
  });
});
