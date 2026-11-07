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
  it('registers glass and solid', () => {
    assert.deepEqual(
      SURFACES.map((pack) => pack.id),
      ['glass', 'solid'],
    );
    assert.equal(isSurfaceId('endfield'), false);
    assert.equal(isSurfaceId('flat'), false);
    assert.equal(surfaceKind('endfield'), undefined);
    assert.equal(surfaceKind('nope'), undefined);
  });

  it('marks framed / frost / chrome per pack', () => {
    assert.equal(framedSurface('glass'), true);
    assert.equal(frostSurface('glass'), true);
    assert.equal(opaqueChrome('glass'), false);
    assert.equal(frostSurface('solid'), false);
    assert.equal(opaqueChrome('solid'), true);
    assert.equal(getSurface('endfield'), undefined);
  });
});
