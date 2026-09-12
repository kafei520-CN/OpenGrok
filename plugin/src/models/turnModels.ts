import { DEFAULT_CUSTOM_EFFORTS } from './apiEndpoints';
import { plat } from '../core/platform';
import type { ApiEndpoint, ChatMessage, ModelOption } from '../core/types';

const STATE_KEY = 'session.turnModels';

export type TurnModelStamp = {
  modelId?: string;
  modelName?: string;
  effort?: string;
};

type Store = Record<string, TurnModelStamp[]>;

export function isCustomModelId(id?: string): boolean {
  return Boolean(id?.startsWith('endpoint-'));
}

/** Custom / relay endpoints that need their own API key, not grok.com login. */
export function isRelayEndpoint(modelId: string | undefined, apis: ApiEndpoint[]): boolean {
  if (!modelId) {
    return false;
  }
  return (
    isCustomModelId(modelId) ||
    apis.some((row) => row.enabled && !row.builtin && row.id === modelId)
  );
}

export function isOfficialPickerModel(model: { id: string; name: string }): boolean {
  return !isCustomModelId(model.id) && !model.name.trim().startsWith('[');
}

/** Official grok.com catalog titles — do not stamp these onto unlabeled history. */
export function isOfficialGrokStamp(stamp: TurnModelStamp): boolean {
  const id = (stamp.modelId ?? '').trim();
  const name = (stamp.modelName ?? '').trim();
  if (isCustomModelId(id) || name.startsWith('[')) {
    return false;
  }
  return /^grok-[\d.]+$/i.test(id) || /^Grok\s+[\d.]+$/i.test(name);
}

export function overlayApiModels(
  models: { currentId?: string; available: ModelOption[] } | undefined,
  apis: ApiEndpoint[],
): { currentId?: string; available: ModelOption[] } | undefined {
  if (!models) {
    return models;
  }
  const hiddenOfficial = new Set(
    apis.filter((row) => row.builtin && !row.enabled).map((row) => row.id),
  );
  const enabled = apis.filter((row) => row.enabled);
  const byId = new Map(enabled.filter((row) => !row.builtin).map((row) => [row.id, row]));
  const available = models.available
    .filter((model) => {
      if (hiddenOfficial.has(model.id)) {
        return false;
      }
      if (byId.has(model.id)) {
        return true;
      }
      if (isCustomModelId(model.id) || model.name.trim().startsWith('[')) {
        return false;
      }
      return true;
    })
    .map((model) => {
      const api = byId.get(model.id);
      return api ? { ...model, name: api.name } : model;
    });
  for (const api of enabled) {
    if (api.builtin || available.some((model) => model.id === api.id)) {
      continue;
    }
    available.push({
      id: api.id,
      name: api.name,
      currentEffort: 'high',
      efforts: DEFAULT_CUSTOM_EFFORTS,
    });
  }
  let currentId = models.currentId;
  if (currentId && !available.some((model) => model.id === currentId)) {
    currentId = available.find((model) => !isCustomModelId(model.id))?.id ?? available[0]?.id;
  }
  return { ...models, currentId, available };
}

export function assistantStamps(messages: ChatMessage[]): TurnModelStamp[] {
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => ({
      modelId: message.modelId,
      modelName: message.modelName,
      effort: message.effort,
    }))
    .filter((stamp) => Boolean(stamp.modelId || stamp.modelName));
}

export function applyStoredTurnModels(
  messages: ChatMessage[],
  stamps: TurnModelStamp[] | undefined,
): void {
  if (!stamps?.length) {
    return;
  }
  let index = 0;
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const stamp = stamps[index];
    index += 1;
    if (!stamp) {
      continue;
    }
    if (stamp.modelId) {
      message.modelId = stamp.modelId;
    }
    if (stamp.modelName) {
      message.modelName = stamp.modelName;
    }
    if (stamp.effort) {
      message.effort = stamp.effort;
    }
  }
}

export function readStoredTurnModels(sessionId: string | undefined): TurnModelStamp[] {
  if (!sessionId) {
    return [];
  }
  return readStore()[sessionId] ?? [];
}

export async function persistTurnModels(
  sessionId: string | undefined,
  messages: ChatMessage[],
): Promise<void> {
  if (!sessionId) {
    return;
  }
  const stamps = assistantStamps(messages);
  if (!stamps.length) {
    return;
  }
  const store = { ...readStore(), [sessionId]: stamps };
  await plat().setState(STATE_KEY, trimStore(store));
}

function readStore(): Store {
  const raw = plat().getState<Store>(STATE_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function trimStore(store: Store): Store {
  const ids = Object.keys(store);
  if (ids.length <= 80) {
    return store;
  }
  const keep = new Set(ids.slice(-80));
  const next: Store = {};
  for (const id of ids) {
    if (keep.has(id)) {
      next[id] = store[id];
    }
  }
  return next;
}
