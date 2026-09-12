import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  displayUsagePercent,
  formatQuotaReset,
  isOfficialGrokAccount,
  parseBilling,
  quotaTitle,
} from './billing';

describe('billing', () => {
  it('only treats grok.com login as official', () => {
    assert.equal(isOfficialGrokAccount(undefined), false);
    assert.equal(isOfficialGrokAccount({ email: 'a@x.ai' }), false);
    assert.equal(isOfficialGrokAccount({ methodId: 'xai.api_key' }), false);
    assert.equal(isOfficialGrokAccount({ methodId: 'grok.com' }), true);
    assert.equal(isOfficialGrokAccount({ methodId: 'oidc' }), true);
    assert.equal(isOfficialGrokAccount({ methodId: 'cached_token' }), true);
  });

  it('parses credits-config billing and keeps only Grok Build', () => {
    const quota = parseBilling({
      config: {
        creditUsagePercent: 65.9,
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          end: '2026-09-08T00:25:00+08:00',
        },
        productUsage: [
          { product: 'PRODUCT_GROK', usagePercent: 10 },
          { product: 'PRODUCT_GROK_BUILD', usagePercent: 65.9 },
        ],
      },
      subscriptionTier: 'SuperGrok Heavy',
    });
    assert.ok(quota);
    assert.equal(quota.usagePercent, 65.9);
    assert.equal(quota.periodType, 'weekly');
    assert.equal(quota.periodEnd, '2026-09-08T00:25:00+08:00');
    assert.equal(quota.subscriptionTier, 'SuperGrok Heavy');
    assert.deepEqual(quota.products, [
      { id: 'PRODUCT_GROK_BUILD', label: 'Grok Build', usagePercent: 65.9 },
    ]);
    assert.equal(displayUsagePercent(quota.usagePercent), 65);
    assert.equal(quotaTitle('zh-CN', quota), '每周 SuperGrok Heavy 限额');
    assert.equal(quotaTitle('en', quota), 'Weekly SuperGrok Heavy limit');
  });

  it('reads subscription_tier_display from nested settings', () => {
    const quota = parseBilling({
      config: { creditUsagePercent: 10 },
      settings: { subscription_tier_display: 'SuperGrok Heavy' },
    });
    assert.equal(quota?.subscriptionTier, 'SuperGrok Heavy');
  });

  it('falls back to legacy monthlyLimit/used and synthesizes Grok Build', () => {
    const quota = parseBilling({
      result: {
        config: {
          monthlyLimit: { val: 2000 },
          used: { val: 500 },
          billingPeriodEnd: '2026-10-01T00:00:00Z',
        },
      },
    });
    assert.ok(quota);
    assert.equal(quota.usagePercent, 25);
    assert.equal(quota.periodType, undefined);
    assert.equal(quota.products[0]?.label, 'Grok Build');
    assert.equal(quotaTitle('zh-CN', quota), '用量');
  });

  it('clamps percent and ignores empty config', () => {
    assert.equal(parseBilling({ config: { creditUsagePercent: 140 } })?.usagePercent, 100);
    assert.equal(parseBilling({ config: null }), undefined);
    assert.equal(parseBilling({}), undefined);
  });

  it('formats reset time with year', () => {
    const iso = new Date(2026, 8, 8, 0, 25).toISOString();
    assert.equal(formatQuotaReset('zh-CN', iso), '2026年9月8日 00:25');
    assert.equal(formatQuotaReset('en', iso), 'Sep 8, 2026, 00:25');
    assert.equal(formatQuotaReset('zh-CN', 'nope'), '');
  });
});
