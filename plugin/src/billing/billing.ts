import { AUTH_METHODS } from '../core/constants';
import type { UiLocale } from '../core/i18n';
import { t } from '../core/i18n';
import type { BillingProduct, BillingQuota } from '../core/types';
import { asNum, asObject, asString } from '../core/wire';

export type { BillingProduct, BillingQuota };

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** grok.com / OIDC / 缓存 token，不含 API key 与自定义端点。 */
export function isOfficialGrokAccount(account?: { methodId?: string }): boolean {
  const id = account?.methodId;
  return (
    id === AUTH_METHODS.grokCom ||
    id === AUTH_METHODS.oidc ||
    id === AUTH_METHODS.cachedToken
  );
}

export function parseBilling(raw: unknown): BillingQuota | undefined {
  const root = asObject(raw);
  const payload = asObject(root['result'] ?? root);
  const config = asObject(payload['config']);
  const usagePercent = readUsagePercent(config);
  if (usagePercent === undefined) {
    return undefined;
  }
  const period = asObject(config['currentPeriod'] ?? config['current_period']);
  const periodType = periodKind(
    asString(period['type']) ??
      asString(period['periodType']) ??
      asString(period['period_type']),
  );
  const periodEnd =
    asString(period['end']) ??
    asString(config['billingPeriodEnd']) ??
    asString(config['billing_period_end']);
  const subscriptionTier = pickSubscriptionTier(payload, config);
  return {
    usagePercent,
    periodType,
    periodEnd,
    subscriptionTier,
    products: officialProducts(config, usagePercent),
  };
}

export function pickSubscriptionTier(
  ...bags: Array<Record<string, unknown>>
): string | undefined {
  for (const bag of bags) {
    const value =
      asString(bag['subscription_tier_display']) ??
      asString(bag['subscriptionTierDisplay']) ??
      asString(bag['subscriptionTier']) ??
      asString(bag['subscription_tier']);
    if (value?.trim()) {
      return value.trim();
    }
    const nested = asObject(bag['settings']);
    const inner =
      asString(nested['subscription_tier_display']) ??
      asString(nested['subscriptionTierDisplay']) ??
      asString(nested['subscriptionTier']) ??
      asString(nested['subscription_tier']);
    if (inner?.trim()) {
      return inner.trim();
    }
  }
  return undefined;
}

export function displayUsagePercent(n: number): number {
  return Math.floor(clampPercent(n));
}

export function quotaTitle(locale: UiLocale, quota: BillingQuota): string {
  const tier = quota.subscriptionTier?.trim();
  if (quota.periodType === 'weekly') {
    return tier ? t(locale, 'quotaWeeklyNamed', { tier }) : t(locale, 'quotaWeekly');
  }
  if (quota.periodType === 'monthly') {
    return tier ? t(locale, 'quotaMonthlyNamed', { tier }) : t(locale, 'quotaMonthly');
  }
  return tier ? t(locale, 'quotaNamed', { tier }) : t(locale, 'quotaUsage');
}

export function formatQuotaReset(locale: UiLocale, iso?: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (locale === 'zh-CN') {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
  }
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${hh}:${mm}`;
}

function readUsagePercent(config: Record<string, unknown>): number | undefined {
  const direct =
    asNum(config['creditUsagePercent']) ?? asNum(config['credit_usage_percent']);
  if (direct !== undefined) {
    return clampPercent(direct);
  }
  const limit = centVal(config['monthlyLimit'] ?? config['monthly_limit']);
  const used = centVal(config['used']);
  if (limit !== undefined && limit > 0 && used !== undefined) {
    return clampPercent((used / limit) * 100);
  }
  return undefined;
}

function officialProducts(
  config: Record<string, unknown>,
  fallbackPercent: number,
): BillingProduct[] {
  const raw = config['productUsage'] ?? config['product_usage'];
  const products: BillingProduct[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const row = asObject(item);
      const id = asString(row['product']) ?? asString(row['name']) ?? '';
      if (!isOfficialBuildProduct(id)) {
        continue;
      }
      const pct = asNum(row['usagePercent']) ?? asNum(row['usage_percent']);
      products.push({
        id,
        label: 'Grok Build',
        usagePercent: pct === undefined ? fallbackPercent : clampPercent(pct),
      });
    }
  }
  if (!products.length) {
    products.push({
      id: 'PRODUCT_GROK_BUILD',
      label: 'Grok Build',
      usagePercent: fallbackPercent,
    });
  }
  return products;
}

function isOfficialBuildProduct(id: string): boolean {
  const value = id.toUpperCase().replace(/[\s-]+/g, '_');
  return value.includes('GROK_BUILD');
}

function periodKind(raw?: string): 'weekly' | 'monthly' | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.toUpperCase();
  if (value.includes('WEEKLY')) {
    return 'weekly';
  }
  if (value.includes('MONTHLY')) {
    return 'monthly';
  }
  return undefined;
}

function centVal(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  return asNum(asObject(raw)['val']);
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(100, Math.max(0, n));
}
