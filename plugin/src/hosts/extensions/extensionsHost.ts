import type {
  HookItem,
  MarketplacePlugin,
  PluginItem,
  WorkflowItem,
} from '../../core/types';
import { asNum, asObject, asString, unwrapArray, unwrapPayload } from '../../core/wire';

export function parsePluginList(raw: unknown): PluginItem[] {
  return unwrapArray(raw, ['plugins'])
    .map((item) => {
      const obj = asObject(item);
      const id = asString(obj['id']) ?? asString(obj['name']);
      if (!id) {
        return undefined;
      }
      return {
        id,
        name: asString(obj['name']) ?? id,
        description: asString(obj['description']),
        enabled: obj['enabled'] !== false,
        version: asString(obj['version']),
        scope: asString(obj['scope']),
        skillCount: asNum(obj['skillCount']) ?? asNum(obj['skill_count']) ?? 0,
        source: asString(obj['marketplaceSource']) ?? asString(obj['marketplace_source']),
      } satisfies PluginItem;
    })
    .filter((row): row is PluginItem => Boolean(row));
}

export function parseHookList(raw: unknown): HookItem[] {
  return unwrapArray(raw, ['hooks'])
    .map((item) => {
      const obj = asObject(item);
      const name = asString(obj['name']);
      if (!name) {
        return undefined;
      }
      return {
        id: name,
        name,
        event: asString(obj['event']) ?? '',
        enabled: obj['disabled'] !== true,
        matcher: asString(obj['matcher']),
        command: asString(obj['command']) ?? asString(obj['url']),
      } satisfies HookItem;
    })
    .filter((row): row is HookItem => Boolean(row));
}

export function parseMarketplaceList(raw: unknown): MarketplacePlugin[] {
  const sources = unwrapArray(raw, ['sources']);
  const rows: MarketplacePlugin[] = [];
  for (const source of sources) {
    const src = asObject(source);
    const sourceUrl =
      asString(src['sourceUrlOrPath']) ?? asString(src['source_url_or_path']) ?? '';
    const sourceName = asString(src['sourceName']) ?? asString(src['source_name']) ?? sourceUrl;
    const plugins = Array.isArray(src['plugins']) ? src['plugins'] : [];
    for (const plugin of plugins) {
      const obj = asObject(plugin);
      const relative =
        asString(obj['relativePath']) ?? asString(obj['relative_path']) ?? asString(obj['name']);
      if (!relative) {
        continue;
      }
      rows.push({
        id: `${sourceUrl}::${relative}`,
        name: asString(obj['name']) ?? relative,
        description: asString(obj['description']),
        sourceUrl,
        sourceName,
        relativePath: relative,
        installStatus: asString(obj['installStatus']) ?? asString(obj['install_status']) ?? 'available',
        version: asString(obj['version']),
      });
    }
  }
  return rows;
}

export function parseWorkflowList(raw: unknown): WorkflowItem[] {
  return unwrapArray(raw, ['workflows'])
    .map((item) => {
      const obj = asObject(item);
      const name = asString(obj['name']);
      if (!name) {
        return undefined;
      }
      return {
        id: name,
        name,
        description: asString(obj['description']) ?? '',
        whenToUse: asString(obj['whenToUse']) ?? asString(obj['when_to_use']),
        source: asString(obj['source']) ?? '',
        path: asString(obj['path']),
      } satisfies WorkflowItem;
    })
    .filter((row): row is WorkflowItem => Boolean(row));
}

export function parseActionOutcome(raw: unknown): { ok: boolean; message: string } {
  const value = unwrapPayload(raw);
  const status = (asString(value['status']) ?? '').toLowerCase();
  const message = asString(value['message']) ?? status;
  return { ok: status === 'success' || status === '', message: message || 'done' };
}
