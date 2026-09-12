import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatContextWindow, parseContextWindow } from './contextWindow';

describe('context window', () => {
  it('parses k and raw token counts', () => {
    assert.equal(parseContextWindow(''), undefined);
    assert.equal(parseContextWindow('  '), undefined);
    assert.equal(parseContextWindow('128k'), 128_000);
    assert.equal(parseContextWindow('128K'), 128_000);
    assert.equal(parseContextWindow('128 k'), 128_000);
    assert.equal(parseContextWindow('128000'), 128_000);
    assert.equal(parseContextWindow('128_000'), 128_000);
    assert.equal(parseContextWindow('1m'), 1_000_000);
  });

  it('rejects junk', () => {
    assert.throws(() => parseContextWindow('k'));
    assert.throws(() => parseContextWindow('abc'));
    assert.throws(() => parseContextWindow('0'));
    assert.throws(() => parseContextWindow('-128k'));
  });

  it('formats with a k suffix when it divides evenly', () => {
    assert.equal(formatContextWindow(undefined), '');
    assert.equal(formatContextWindow(128_000), '128k');
    assert.equal(formatContextWindow(1_000_000), '1m');
    assert.equal(formatContextWindow(8192), '8192');
  });
});
