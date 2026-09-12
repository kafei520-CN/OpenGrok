export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Error payloads may be a string or a JSON object from the provider. */
export function asErrorText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function unwrapPayload(raw: unknown): Record<string, unknown> {
  const obj = asObject(raw);
  const inner = obj['result'];
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    return asObject(inner);
  }
  return obj;
}

export function unwrapArray(raw: unknown, keys: string[]): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  const obj = asObject(raw);
  const inner = obj['result'];
  if (Array.isArray(inner)) {
    return inner;
  }
  const payload = unwrapPayload(raw);
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

export function asPath(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    return asString(asObject(value)['path']);
  }
  return undefined;
}

export function asNum(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

export function timesFromMeta(meta: Record<string, unknown>): {
  turnStartMs?: number;
  streamStartMs?: number;
  agentTimestampMs?: number;
} {
  return {
    turnStartMs: asNum(meta['turnStartMs']) ?? asNum(meta['turn_start_ms']),
    streamStartMs: asNum(meta['streamStartMs']) ?? asNum(meta['stream_start_ms']),
    agentTimestampMs: asNum(meta['agentTimestampMs']) ?? asNum(meta['agent_timestamp_ms']),
  };
}
