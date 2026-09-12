import type { ContextCategory, ContextUsage } from '../core/types';
import { asNum, asObject, asString } from '../core/wire';

export type { ContextUsage };
export { asNum };

export function parseContextInfo(raw: unknown): ContextUsage | undefined {
  const obj = asObject(raw);
  const nested = asObject(obj['context']);
  const src =
    nested['used'] !== undefined || nested['total'] !== undefined || nested['size'] !== undefined
      ? nested
      : obj;
  const used = asNum(src['used']);
  const total = asNum(src['total']) ?? asNum(src['size']);
  if (used === undefined && total === undefined) {
    return undefined;
  }
  const usedTokens = used ?? 0;
  const totalTokens = total ?? 0;
  const percent =
    asNum(src['usagePct']) ??
    asNum(src['usage_pct']) ??
    (totalTokens > 0 ? Math.min(100, Math.round((usedTokens / totalTokens) * 100)) : 0);
  const categoriesRaw = src['usageCategories'] ?? src['usage_categories'];
  const categories = Array.isArray(categoriesRaw)
    ? categoriesRaw
        .map((item) => {
          const row = asObject(item);
          const label = asString(row['label']);
          const tokens = asNum(row['tokens']);
          if (!label || tokens === undefined) {
            return undefined;
          }
          const detail = asString(row['detail']);
          const category: ContextCategory = { label, tokens };
          if (detail) {
            category.detail = detail;
          }
          return category;
        })
        .filter((row): row is ContextCategory => Boolean(row))
    : undefined;
  return {
    used: usedTokens,
    total: totalTokens,
    percent,
    free: asNum(src['freeTokens']) ?? asNum(src['free_tokens']),
    systemTokens: asNum(src['systemPromptTokens']) ?? asNum(src['system_prompt_tokens']),
    messageTokens: asNum(src['messageTokens']) ?? asNum(src['message_tokens']),
    toolTokens: asNum(src['toolDefinitionsTokens']) ?? asNum(src['tool_definitions_tokens']),
    compactAt:
      asNum(src['autoCompactThresholdPercent']) ??
      asNum(src['auto_compact_threshold_percent']),
    categories,
  };
}

export function mergeContext(
  prev: ContextUsage | undefined,
  next: ContextUsage,
): ContextUsage {
  return {
    ...prev,
    ...next,
    categories: next.categories?.length ? next.categories : prev?.categories,
    systemTokens: next.systemTokens ?? prev?.systemTokens,
    messageTokens: next.messageTokens ?? prev?.messageTokens,
    toolTokens: next.toolTokens ?? prev?.toolTokens,
    compactAt: next.compactAt ?? prev?.compactAt,
    free: next.free ?? prev?.free,
  };
}

export function formatTokens(n: number): string {
  const abs = Math.max(0, n);
  if (abs < 1000) {
    return String(Math.round(abs));
  }
  if (abs < 1_000_000) {
    const v = abs / 1000;
    return `${v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')}K`;
  }
  const v = abs / 1_000_000;
  return `${v.toFixed(1).replace(/\.0$/, '')}M`;
}

export function contextTone(
  percent: number,
  compactAt = 85,
): 'ok' | 'warn' | 'hot' {
  if (percent >= 95) {
    return 'hot';
  }
  if (percent >= compactAt) {
    return 'warn';
  }
  return 'ok';
}
