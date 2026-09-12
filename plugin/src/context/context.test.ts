import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contextTone,
  formatTokens,
  parseContextInfo,
} from './context';

describe('context usage', () => {
  it('parses session info camelCase', () => {
    const parsed = parseContextInfo({
      context: {
        used: 12_400,
        total: 128_000,
        usagePct: 10,
        freeTokens: 115_600,
        systemPromptTokens: 1200,
        messageTokens: 8100,
        toolDefinitionsTokens: 3100,
        autoCompactThresholdPercent: 85,
        usageCategories: [{ label: 'Skills', tokens: 2400, detail: '21 skills' }],
      },
    });
    assert.equal(parsed?.used, 12_400);
    assert.equal(parsed?.total, 128_000);
    assert.equal(parsed?.percent, 10);
    assert.equal(parsed?.categories?.[0]?.label, 'Skills');
  });

  it('accepts usage_update used/size', () => {
    const parsed = parseContextInfo({ used: 53_000, size: 200_000 });
    assert.equal(parsed?.used, 53_000);
    assert.equal(parsed?.total, 200_000);
    assert.equal(parsed?.percent, 27);
  });

  it('formats compact token counts', () => {
    assert.equal(formatTokens(900), '900');
    assert.equal(formatTokens(8500), '8.5K');
    assert.equal(formatTokens(1_000_000), '1M');
  });

  it('warns at compact threshold', () => {
    assert.equal(contextTone(40, 85), 'ok');
    assert.equal(contextTone(85, 85), 'warn');
    assert.equal(contextTone(96, 85), 'hot');
  });
});
