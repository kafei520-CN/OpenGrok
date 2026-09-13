import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BillingQuota } from '../core/types';
import { pickSubscriptionTier } from './billing';
import { asObject } from '../core/wire';

export function withCachedSubscription(quota?: BillingQuota): BillingQuota | undefined {
  if (quota?.subscriptionTier?.trim()) {
    return quota;
  }
  const cached = readCachedSubscriptionTier();
  if (!cached) {
    return quota;
  }
  return {
    usagePercent: quota?.usagePercent ?? 0,
    periodType: quota?.periodType,
    periodEnd: quota?.periodEnd,
    products: quota?.products ?? [],
    subscriptionTier: cached,
  };
}

export function readCachedSubscriptionTier(): string | undefined {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.grok', 'settings_cache.json'), 'utf8'),
    ) as { payload?: unknown };
    const payload =
      typeof raw.payload === 'string'
        ? (JSON.parse(raw.payload) as Record<string, unknown>)
        : asObject(raw.payload);
    const settings = asObject(payload['settings']);
    return pickSubscriptionTier(payload, settings);
  } catch {
    return undefined;
  }
}
