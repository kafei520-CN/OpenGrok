import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SURFACES,
  framedSurface,
  frostSurface,
  getSurface,
  isSurfaceId,
  opaqueChrome,
  surfaceKind,
} from './surfaces';

describe('surface packs', () => {
  it('registers glass, solid, and endfield', () => {
    assert.deepEqual(
      SURFACES.map((pack) => pack.id),
      ['glass', 'solid', 'endfield'],
    );
    assert.equal(isSurfaceId('endfield'), true);
    assert.equal(isSurfaceId('flat'), false);
    assert.equal(surfaceKind('endfield'), 'endfield');
    assert.equal(surfaceKind('nope'), undefined);
  });

  it('marks framed / frost / chrome per pack', () => {
    assert.equal(framedSurface('glass'), true);
    assert.equal(frostSurface('glass'), true);
    assert.equal(opaqueChrome('glass'), false);
    assert.equal(frostSurface('solid'), false);
    assert.equal(opaqueChrome('solid'), true);
    assert.equal(frostSurface('endfield'), false);
    assert.equal(opaqueChrome('endfield'), true);
    assert.equal(getSurface('endfield')?.theme?.background, '#191919');
    assert.equal(getSurface('endfield')?.theme?.primary, '#fff936');
    assert.equal(getSurface('endfield')?.theme?.secondary, '#ffffff');
  });
});
