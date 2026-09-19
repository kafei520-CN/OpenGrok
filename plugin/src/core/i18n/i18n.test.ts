import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EN,
  ZH,
  effortLabel,
  formatDuration,
  modelDisplayName,
  resolveLocale,
  t,
  toolKindLabel,
  turnSourceText,
} from './index';

describe('i18n', () => {
  it('resolves auto from VS Code language', () => {
    assert.equal(resolveLocale('auto', 'zh-cn'), 'zh-CN');
    assert.equal(resolveLocale(undefined, 'zh-tw'), 'zh-CN');
    assert.equal(resolveLocale('auto', 'en'), 'en');
    assert.equal(resolveLocale('en', 'zh-cn'), 'en');
    assert.equal(resolveLocale('zh-CN', 'en'), 'zh-CN');
  });

  it('keeps Chinese and English catalogs in sync', () => {
    const enKeys = Object.keys(EN).sort();
    const zhKeys = Object.keys(ZH).sort();
    assert.deepEqual(zhKeys, enKeys);
  });

  it('fills placeholders', () => {
    assert.equal(t('en', 'editsTitle', { n: 3 }), '3 changes');
    assert.equal(t('zh-CN', 'editsTitle', { n: 3 }), '3 处修改');
  });

  it('labels Claude and Grok effort levels', () => {
    assert.equal(effortLabel('zh-CN', 'xhigh'), '极高');
    assert.equal(effortLabel('zh-CN', 'max'), '最强');
    assert.equal(effortLabel('en', 'max'), 'Max');
    assert.equal(effortLabel('en', 'high'), 'High');
  });

  it('puts model name and effort after the timestamp', () => {
    assert.equal(modelDisplayName('endpoint-2', '[Hu]Claude-Opus-5'), '[Hu]Claude-Opus-5');
    const createdAt = new Date(2026, 7, 29, 10, 38, 0).toISOString();
    assert.equal(
      turnSourceText(
        'zh-CN',
        {
          modelId: 'endpoint-2',
          modelName: '[Hu]Claude-Opus-5',
          effort: 'xhigh',
          createdAt,
        },
        true,
      ),
      '8月29日 10:38 · [Hu]Claude-Opus-5 · 极高',
    );
    assert.equal(
      turnSourceText(
        'en',
        { modelId: 'grok-4.6', modelName: 'Grok 4.6', effort: 'high' },
        false,
      ),
      'Grok 4.6 · High',
    );
  });

  it('labels collapsed tool kinds', () => {
    assert.equal(toolKindLabel('en', 'read'), 'Read');
    assert.equal(toolKindLabel('zh-CN', 'execute'), '终端');
    assert.equal(toolKindLabel('zh-CN', 'compact'), '压缩');
  });

  it('formats elapsed work time', () => {
    assert.equal(formatDuration(42_000), '42s');
    assert.equal(formatDuration(15 * 60_000 + 42_000), '15m 42s');
    assert.equal(t('zh-CN', 'elapsed', { time: '15m 42s' }), '用时 15m 42s');
    assert.equal(t('zh-CN', 'elapsedLive', { time: '15m 42s' }), '已用时 15m 42s');
  });
});
