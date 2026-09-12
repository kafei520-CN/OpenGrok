import type { McpItem } from '../../core/types';
import { asObject, asString } from '../../core/wire';

export type { McpItem };

export function parseMcpList(raw: unknown): McpItem[] {
  const value = unwrapList(raw);
  const rows: McpItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const obj = asObject(item);
    const session = asObject(obj['session']);
    const name = asString(obj['name']) ?? asString(obj['displayName']) ?? asString(obj['display_name']);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const tools = Array.isArray(session['tools'])
      ? session['tools']
      : Array.isArray(obj['tools'])
        ? obj['tools']
        : [];
    const enabled =
      typeof session['enabled'] === 'boolean'
        ? session['enabled']
        : typeof obj['enabled'] === 'boolean'
          ? obj['enabled']
          : true;
    const source = asString(obj['source']) === 'managed' ? 'managed' : 'local';
    rows.push({
      id: name,
      name: asString(obj['displayName']) ?? asString(obj['display_name']) ?? name,
      source,
      enabled,
      status: asString(session['status']) ?? asString(obj['status']),
      toolCount:
        typeof obj['toolCount'] === 'number'
          ? obj['toolCount']
          : typeof obj['tool_count'] === 'number'
            ? obj['tool_count']
            : tools.length,
      sourceLabel: asString(obj['sourceLabel']) ?? asString(obj['source_label']) ?? asString(obj['config_source']),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function unwrapList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  const obj = asObject(raw);
  const inner = obj['result'];
  if (Array.isArray(inner)) {
    return inner;
  }
  if (inner && typeof inner === 'object') {
    const nested = asObject(inner)['servers'];
    if (Array.isArray(nested)) {
      return nested;
    }
  }
  const servers = obj['servers'];
  return Array.isArray(servers) ? servers : [];
}
