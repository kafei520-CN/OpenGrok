import type { ContextMeter } from '../context/contextMeter';
import { editsFromToolUpdate, mergeEdits } from '../edits/edits';
import { formatRetryUpdate } from '../core/errors';
import { FALLBACK_COMMANDS } from '../chat/prompt/slash';
import { DEFAULT_TERM_ENCODING, type TermEncoding } from '../terminal/termEncoding';
import { decodeTermUnknown } from '../terminal/termText';
import { isOfficialGrokStamp } from '../models/turnModels';
import type {
  ChatMessage,
  ChatState,
  PlanStep,
  PlanStepStatus,
  SessionUpdate,
  SlashCommandInfo,
} from '../core/types';
import { asObject, asString } from '../core/wire';

export interface SessionView {
  replaying: boolean;
  /** True only when this ACP update is historical replay, not a live leftover dump. */
  replayUpdate?: boolean;
  messages: ChatMessage[];
  nextTurn(): number;
  modeId: string;
  models?: ChatState['models'];
  commands: SlashCommandInfo[];
  meter: ContextMeter;
  rememberFile: (filePath: string) => Promise<void>;
  capturePrevious: (filePath: string, previous: string) => void;
  displayPath: (filePath: string) => string;
  emitUnlessReplaying: () => void;
  refreshEditStats?: (assistant: ChatMessage) => void;
  /** Decode terminal tool bytes for display. */
  termEncoding?: TermEncoding;
}

export function parsePlanEntries(raw: unknown): PlanStep[] | undefined {
  const list = Array.isArray(raw) ? raw : asObject(raw)['entries'];
  if (!Array.isArray(list)) {
    return undefined;
  }
  const steps: PlanStep[] = [];
  for (const item of list) {
    const obj = asObject(item);
    const id = asString(obj['id']);
    const content =
      asString(obj['content']) ?? asString(obj['title']) ?? asString(obj['text']) ?? '';
    let status = planStepStatus(
      asString(obj['status']) ?? asString(obj['state']),
      asObject(obj['_meta'] ?? obj['meta']),
    );
    if (obj['completed'] === true || obj['done'] === true) {
      status = 'completed';
    }
    if (!content && !id) {
      continue;
    }
    steps.push({ content: content || '', status, ...(id ? { id } : {}) });
  }
  return steps;
}

/** Full snapshots replace; merge:true patches (id/status without content) update in place. */
export function overlayPlanSteps(
  prev: PlanStep[] | undefined,
  incoming: PlanStep[],
): PlanStep[] {
  const labeled = incoming.filter((step) => step.content);
  if (labeled.length === incoming.length && labeled.length > 0) {
    return incoming;
  }
  if (!prev?.length) {
    return labeled;
  }
  const next = prev.map((step) => ({ ...step }));
  const used = new Set<number>();
  for (let i = 0; i < incoming.length; i += 1) {
    const patch = incoming[i];
    if (!patch) {
      continue;
    }
    let hit = next.findIndex(
      (step, index) =>
        !used.has(index) &&
        ((Boolean(patch.id && step.id && patch.id === step.id) ||
          Boolean(patch.content && patch.content === step.content))),
    );
    if (hit < 0 && incoming.length === next.length && !used.has(i)) {
      hit = i;
    }
    if (hit >= 0) {
      used.add(hit);
      const row = next[hit];
      if (row) {
        row.status = patch.status;
        if (patch.content) {
          row.content = patch.content;
        }
        if (patch.id) {
          row.id = patch.id;
        }
      }
      continue;
    }
    if (patch.content || patch.id) {
      next.push({ ...patch });
    }
  }
  return next;
}

function planStepStatus(raw: string | undefined, meta: Record<string, unknown>): PlanStepStatus {
  const status = (raw ?? '').toLowerCase().replace(/-/g, '_');
  if (status === 'completed' || status === 'complete' || status === 'done') {
    if (meta['failed'] === true) {
      return 'failed';
    }
    if (meta['cancelled'] === true || meta['canceled'] === true) {
      return 'abandoned';
    }
    return 'completed';
  }
  if (
    status === 'in_progress' ||
    status === 'inprogress' ||
    status === 'running' ||
    status === 'active'
  ) {
    return 'in_progress';
  }
  if (status === 'failed' || status === 'error') {
    return 'failed';
  }
  if (
    status === 'abandoned' ||
    status === 'skipped' ||
    status === 'stopped' ||
    status === 'cancelled' ||
    status === 'canceled'
  ) {
    return 'abandoned';
  }
  return 'pending';
}

export function freezeTurnSteps(message: ChatMessage): void {
  if (!message.steps?.length) {
    return;
  }
  message.steps = message.steps.map((step) => {
    if (step.status === 'completed' || step.status === 'failed') {
      return { ...step };
    }
    return { ...step, status: 'abandoned' };
  });
}

function canBindSteps(session: SessionView, assistant?: ChatMessage): boolean {
  if (session.replayUpdate) {
    return true;
  }
  if (assistant?.streaming) {
    return true;
  }
  if (!assistant) {
    const last = session.messages.at(-1);
    return !last || last.role === 'user';
  }
  return false;
}

function applySteps(
  assistant: ChatMessage,
  steps: PlanStep[] | undefined,
  session: SessionView,
): void {
  if (!steps?.length) {
    return;
  }
  if (!canBindSteps(session, assistant)) {
    return;
  }
  assistant.steps = overlayPlanSteps(assistant.steps, steps);
}

export function applySessionUpdate(session: SessionView, update: SessionUpdate): void {
  const replay = session.replaying;
  const kind = update.sessionUpdate;
  if (kind === 'current_mode_update') {
    const mode = update.currentModeId ?? update.modeId;
    if (mode) {
      session.modeId = mode;
    }
    session.emitUnlessReplaying();
    return;
  }
  if (kind === 'current_model_update') {
    const id = update.currentModelId;
    if (id && session.models) {
      session.models = { ...session.models, currentId: id };
    }
    session.emitUnlessReplaying();
    return;
  }
  if (kind === 'available_commands_update' && update.availableCommands) {
    session.commands = mergeCommands(update.availableCommands, FALLBACK_COMMANDS);
    session.emitUnlessReplaying();
    return;
  }
  if (session.meter.applyUpdate(update)) {
    session.emitUnlessReplaying();
    return;
  }
  if (kind === 'retry_state' || kind === 'auto_compact_failed') {
    const assistant = ensureAssistant(session, replay, update);
    assistant.error = formatRetryUpdate(update);
    if (!assistant.error.retrying) {
      assistant.streaming = false;
    }
    session.emitUnlessReplaying();
    return;
  }
  if (kind === 'user_message_chunk') {
    if (!replay) {
      return;
    }
    const text = textFromContent(update.content);
    const last = session.messages.at(-1);
    if (last?.role === 'assistant') {
      last.streaming = false;
      stampTimes(last, update, true);
    }
    if (last?.role === 'user') {
      last.text += text;
      stampTimes(last, update, true);
    } else {
      session.messages.push({
        id: `user-replay-${session.nextTurn()}`,
        role: 'user',
        text,
        tools: [],
        createdAt: isoFromMs(update.turnStartMs ?? update.agentTimestampMs) ?? new Date().toISOString(),
      });
    }
    session.emitUnlessReplaying();
    return;
  }
  if (kind === 'diff_review') {
    const last = session.messages.filter((item) => item.role === 'assistant').at(-1);
    if (last) {
      applyTool(session, last, update);
    }
    session.emitUnlessReplaying();
    return;
  }
  if (kind === 'plan') {
    const last = session.messages.at(-1);
    if (!canBindSteps(session, last?.role === 'assistant' ? last : undefined)) {
      return;
    }
    const assistant = ensureAssistant(session, replay, update);
    const steps = parsePlanEntries(todoListFromUpdate(update) ?? update.entries);
    if (steps !== undefined) {
      applySteps(assistant, steps, session);
    } else {
      const planText = textFromContent(update.content);
      if (planText) {
        assistant.plan = (assistant.plan ?? '') + planText;
      }
    }
    const images = imagesFromContent(update.content);
    if (images.length > 0) {
      assistant.images = [...(assistant.images ?? []), ...images];
    }
    session.emitUnlessReplaying();
    return;
  }
  if (
    kind !== 'agent_message_chunk' &&
    kind !== 'agent_thought_chunk' &&
    kind !== 'tool_call' &&
    kind !== 'tool_call_update'
  ) {
    return;
  }
  const assistant = ensureAssistant(session, replay, update);
  if (assistant.error?.retrying) {
    assistant.error = undefined;
  }
  if (kind === 'agent_message_chunk') {
    assistant.text += textFromContent(update.content);
  } else if (kind === 'agent_thought_chunk') {
    assistant.thinking = (assistant.thinking ?? '') + textFromContent(update.content);
  } else if (kind === 'tool_call' || kind === 'tool_call_update') {
    applyTool(session, assistant, update);
    applySteps(assistant, parsePlanEntries(todoListFromUpdate(update)), session);
  }
  const images = imagesFromContent(update.content);
  if (images.length > 0) {
    assistant.images = [...(assistant.images ?? []), ...images];
  }
  session.emitUnlessReplaying();
}

export function captureModels(meta: Record<string, unknown> | undefined): ChatState['models'] | undefined {
  const modelState = asObject(meta?.['modelState'] ?? meta);
  const currentId =
    asString(modelState['currentModelId']) ??
    asString(asObject(modelState['currentModelId'])['currentModelId']);
  const availableRaw = modelState['availableModels'];
  const available = Array.isArray(availableRaw)
    ? availableRaw
        .map((item) => {
          const obj = asObject(item);
          const id =
            asString(obj['modelId']) ??
            asString(asObject(obj['modelId'])['modelId']) ??
            asString(obj['id']);
          const name = asString(obj['name']) ?? id;
          const extra = asObject(obj['_meta'] ?? obj['meta']);
          const effort = asString(extra['reasoningEffort']);
          const effortsRaw = extra['reasoningEfforts'];
          const efforts = Array.isArray(effortsRaw)
            ? effortsRaw
                .map((entry) => asString(asObject(entry)['id']) ?? asString(asObject(entry)['value']))
                .filter((value): value is string => Boolean(value))
            : undefined;
          return id ? { id, name: name ?? id, currentEffort: effort, efforts } : undefined;
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];
  if (available.length === 0) {
    return undefined;
  }
  return { currentId: currentId ?? available[0].id, available };
}

export function modelsFromResult(result: {
  models?: unknown;
  _meta?: Record<string, unknown>;
}): ChatState['models'] | undefined {
  const obj = asObject(result);
  if (obj['models'] !== undefined && obj['models'] !== null) {
    return captureModels(asObject(obj['models']));
  }
  if (obj['_meta'] !== undefined && obj['_meta'] !== null) {
    const fromMeta = captureModels(asObject(obj['_meta']));
    if (fromMeta) {
      return fromMeta;
    }
  }
  const nested = obj['result'];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const fromResult = captureModels(asObject(nested));
    if (fromResult) {
      return fromResult;
    }
  }
  return captureModels(obj);
}

export function mergeModelCatalog(
  prev: ChatState['models'] | undefined,
  incoming: unknown,
): ChatState['models'] | undefined {
  const obj = asObject(incoming);
  const nested = obj['result'];
  const payload =
    nested && typeof nested === 'object' && !Array.isArray(nested) ? asObject(nested) : obj;
  const parsed = captureModels(payload);
  if (!parsed) {
    return undefined;
  }
  const prevById = new Map((prev?.available ?? []).map((model) => [model.id, model]));
  const available = parsed.available.map((model) => {
    const old = prevById.get(model.id);
    if (!old?.currentEffort) {
      return model;
    }
    return {
      ...model,
      currentEffort: old.currentEffort,
      efforts: model.efforts ?? old.efforts,
    };
  });
  return { currentId: prev?.currentId ?? parsed.currentId, available };
}

export function mergeCommands(
  primary: SlashCommandInfo[],
  fallback: SlashCommandInfo[],
): SlashCommandInfo[] {
  const seen = new Set<string>();
  const out: SlashCommandInfo[] = [];
  for (const cmd of [...primary, ...fallback]) {
    const key = cmd.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cmd);
  }
  return out;
}

function ensureAssistant(
  session: SessionView,
  replay: boolean,
  update: SessionUpdate,
): ChatMessage {
  const last = session.messages.at(-1);
  if (last?.role === 'assistant') {
    stampTimes(last, update, replay);
    if (!replay) {
      stampTurnModel(last, session.models);
    }
    return last;
  }
  const assistant: ChatMessage = {
    id: `assistant-${session.nextTurn()}`,
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    streaming: !replay,
    createdAt:
      isoFromMs(update.turnStartMs ?? update.streamStartMs ?? update.agentTimestampMs) ??
      (replay ? undefined : new Date().toISOString()),
  };
  stampTimes(assistant, update, replay);
  if (!replay) {
    stampTurnModel(assistant, session.models);
  }
  session.messages.push(assistant);
  return assistant;
}

export function catalogTurnModel(models: ChatState['models'] | undefined): {
  modelId?: string;
  modelName?: string;
  effort?: string;
} {
  const id = models?.currentId;
  const model = models?.available.find((item) => item.id === id);
  if (!id && !model) {
    return {};
  }
  return {
    modelId: id ?? model?.id,
    modelName: model?.name ?? id,
    effort: model?.currentEffort,
  };
}

export function stampTurnModel(
  message: ChatMessage,
  models: ChatState['models'] | undefined,
): void {
  if (message.role !== 'assistant') {
    return;
  }
  const stamp = catalogTurnModel(models);
  if (!message.modelId && stamp.modelId) {
    message.modelId = stamp.modelId;
  }
  if (!message.modelName && stamp.modelName) {
    message.modelName = stamp.modelName;
  }
  if (!message.effort && stamp.effort) {
    message.effort = stamp.effort;
  }
}

/** After session/load, fill turns that replay could not label. */
export function applyRestoredTurnModels(
  messages: ChatMessage[],
  models: ChatState['models'] | undefined,
): void {
  const stamp = catalogTurnModel(models);
  if (!stamp.modelId && !stamp.modelName) {
    return;
  }
  // Official grok.com titles collide with custom relays that route grok-4.6.
  // Never paint unlabeled history as the live official model.
  if (isOfficialGrokStamp(stamp)) {
    return;
  }
  for (const message of messages) {
    stampTurnModel(message, models);
  }
}

function todoListFromUpdate(update: SessionUpdate): unknown {
  if (update.entries !== undefined) {
    return update.entries;
  }
  return listFromRaw(update.rawOutput) ?? listFromRaw(update.rawInput);
}

function listFromRaw(raw: unknown): unknown {
  if (raw == null) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  const obj = asObject(raw);
  if (Array.isArray(obj['todos'])) {
    return obj['todos'];
  }
  if (Array.isArray(obj['entries'])) {
    return obj['entries'];
  }
  const updated = asObject(obj['TodosUpdated']);
  if (Array.isArray(updated['todos'])) {
    return updated['todos'];
  }
  const nested = asObject(obj['output']);
  if (Array.isArray(nested['todos'])) {
    return nested['todos'];
  }
  if (Array.isArray(nested['entries'])) {
    return nested['entries'];
  }
  return undefined;
}

export function isTerminalTool(kind?: string, title?: string): boolean {
  const text = `${kind ?? ''} ${title ?? ''}`.toLowerCase();
  return (
    kind === 'execute' ||
    kind === 'terminal' ||
    text.includes('terminal') ||
    text.includes('bash') ||
    text.includes('run_terminal')
  );
}

export function clipTermOutput(text: string, max = 8000): string {
  if (text.length <= max) {
    return text;
  }
  const slice = text.slice(text.length - max);
  const nl = slice.indexOf('\n');
  return slice.slice(nl >= 0 ? nl + 1 : 0);
}

function applyTerminalCard(
  card: ChatMessage['tools'][number],
  update: SessionUpdate,
  replaying: boolean,
  encoding: TermEncoding,
): void {
  if (!isTerminalTool(card.kind, card.title)) {
    return;
  }
  if (!card.startedAt) {
    card.startedAt = new Date().toISOString();
  }
  const command = commandFromUnknown(update.rawInput) ?? commandFromUnknown(update.rawOutput);
  if (command) {
    card.command = command;
  }
  const raw = parseTermRaw(update.rawOutput, encoding, !replaying);
  if (raw.delta !== undefined && !replaying) {
    if (raw.delta.length === 0) {
      card.output = '';
    } else {
      card.output = clipTermOutput(`${card.output ?? ''}${raw.delta}`);
    }
  } else {
    const fromContent = textFromToolContent(update.content, encoding);
    const chunk = raw.text || fromContent;
    if (chunk) {
      const prev = card.output ?? '';
      if (replaying || !prev || chunk.startsWith(prev) || chunk.length >= prev.length) {
        card.output = clipTermOutput(chunk);
      } else if (!prev.endsWith(chunk)) {
        card.output = clipTermOutput(`${prev}${prev.endsWith('\n') ? '' : '\n'}${chunk}`);
      }
    } else if (replaying && raw.delta) {
      card.output = clipTermOutput(`${card.output ?? ''}${raw.delta}`);
    }
  }
  if (card.status === 'completed' || card.status === 'failed') {
    card.endedAt = card.endedAt ?? new Date().toISOString();
  }
}

function commandFromUnknown(raw: unknown): string | undefined {
  const obj = asObject(raw);
  const bash = asObject(obj['Bash']);
  const src = Object.keys(bash).length ? bash : obj;
  return asString(src['command']) ?? asString(src['cmd']) ?? asString(src['script']);
}

function parseTermRaw(
  raw: unknown,
  encoding: TermEncoding,
  skipText = false,
): { text: string; delta?: string } {
  const obj = asObject(raw);
  const bash = asObject(obj['Bash']);
  const src = Object.keys(bash).length ? bash : obj;
  const deltaRaw = src['output_delta'];
  const delta = deltaRaw === undefined ? undefined : decodeTermUnknown(deltaRaw, encoding);
  if (skipText && delta !== undefined) {
    return { text: '', delta };
  }
  const text =
    decodeTermUnknown(src['output'], encoding) ||
    decodeTermUnknown(src['stdout'], encoding) ||
    decodeTermUnknown(src['output_for_prompt'], encoding) ||
    decodeTermUnknown(src['text'], encoding);
  return { text, delta };
}

function textFromToolContent(
  content: SessionUpdate['content'],
  encoding: TermEncoding,
): string {
  if (!content) {
    return '';
  }
  const blocks = Array.isArray(content) ? content : [content];
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'diff' || block.type === 'image' || block.oldText || block.newText) {
      continue;
    }
    if (block.text) {
      parts.push(decodeTermUnknown(block.text, encoding));
      continue;
    }
    const nested = asObject((block as unknown as Record<string, unknown>)['content']);
    const inner = asString(nested['text']);
    if (inner) {
      parts.push(decodeTermUnknown(inner, encoding));
    }
  }
  return parts.join('');
}

function isTodoTool(update: SessionUpdate): boolean {
  const text = `${update.kind ?? ''} ${update.title ?? ''} ${update.toolCallId ?? ''}`.toLowerCase();
  if (text.includes('todo') || text.includes('updating plan')) {
    return true;
  }
  return false;
}

function applyTool(session: SessionView, assistant: ChatMessage, update: SessionUpdate): void {
  if (isTodoTool(update)) {
    return;
  }
  const id = update.toolCallId ?? `tool-${assistant.tools.length}`;
  let card = assistant.tools.find((tool) => tool.id === id);
  if (!card) {
    card = {
      id,
      title: update.title ?? id,
      kind: update.kind,
      status: update.status ?? 'pending',
    };
    assistant.tools.push(card);
  }
  if (update.title) {
    card.title = update.title;
  }
  if (update.kind) {
    card.kind = update.kind;
  }
  if (update.status) {
    card.status = update.status;
  }
  applyTerminalCard(card, update, session.replaying, session.termEncoding ?? DEFAULT_TERM_ENCODING);
  const location = update.locations?.[0]?.path;
  if (location) {
    card.detail = location;
  }
  const found = editsFromToolUpdate(update);
  const status = update.status ?? card.status;
  for (const edit of found) {
    if (edit.previous !== undefined) {
      session.capturePrevious(edit.path, edit.previous);
    } else if (!session.replaying && status !== 'completed' && status !== 'failed') {
      void session.rememberFile(edit.path);
    }
  }
  const labeled = found.map((edit) => ({
    ...edit,
    path: session.displayPath(edit.path),
  }));
  if (labeled.length > 0) {
    assistant.edits = mergeEdits([...(assistant.edits ?? []), ...labeled]);
    if (status === 'completed') {
      session.refreshEditStats?.(assistant);
    }
  }
}

export function isoFromMs(ms?: number): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

export function stampTimes(message: ChatMessage, update: SessionUpdate, replay: boolean): void {
  const start = isoFromMs(update.turnStartMs ?? update.streamStartMs ?? update.agentTimestampMs);
  if (start && !message.createdAt) {
    message.createdAt = start;
  }
  const at = isoFromMs(update.agentTimestampMs);
  if (replay && at) {
    message.endedAt = at;
  }
}

export function finalizeReplayTimes(messages: ChatMessage[]): void {
  for (const message of messages) {
    message.streaming = false;
    if (message.error?.retrying) {
      message.error = { ...message.error, retrying: undefined };
    }
    if (message.createdAt && !message.endedAt) {
      message.endedAt = message.createdAt;
    }
  }
}

function textFromContent(content: SessionUpdate['content']): string {
  if (!content) {
    return '';
  }
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map((block) => block.text ?? '').join('');
}

function imagesFromContent(
  content: SessionUpdate['content'],
): Array<{ mimeType: string; data?: string; uri?: string }> {
  if (!content) {
    return [];
  }
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .filter((block) => block.type === 'image' || Boolean(block.data) || Boolean(block.mimeType))
    .filter((block) => block.type === 'image' || (block.mimeType?.startsWith('image/') ?? false))
    .map((block) => ({
      mimeType: block.mimeType ?? 'image/png',
      data: block.data,
      uri: block.uri,
    }));
}
