import type { ChatMessage, ChatStatus, ContextUsage, StreamTail } from '../core/types';

/** 流式游标：只记已下发过的前缀，用来切增量。 */
export type StreamDeltaCursor = {
  id: string;
  text: string;
  thinking: string;
  plan: string;
  meta: string;
};

export function emptyStreamCursor(): StreamDeltaCursor {
  return { id: '', text: '', thinking: '', plan: '', meta: '' };
}

/** 全量 snapshot 之后对齐游标，避免下一次 delta 把已有正文再拼一次。 */
export function cursorFromMessage(message: ChatMessage): StreamDeltaCursor {
  return {
    id: message.id,
    text: message.text,
    thinking: message.thinking ?? '',
    plan: message.plan ?? '',
    meta: streamMetaStamp(message),
  };
}

/** tools/error/images 是否变化；不含正文，避免长输出反复全量序列化。 */
export function streamMetaStamp(message: ChatMessage): string {
  const fields = message.tools.flatMap((tool) => [
    tool.id,
    tool.title,
    tool.status,
    tool.kind,
    tool.detail,
    tool.output,
    tool.command,
    tool.startedAt,
    tool.endedAt,
  ]);
  fields.push(
    message.error?.message,
    message.error?.code,
    message.error?.retrying === undefined ? undefined : String(message.error.retrying),
    message.error?.attempt === undefined ? undefined : String(message.error.attempt),
    message.error?.maxAttempts === undefined ? undefined : String(message.error.maxAttempts),
  );
  for (const image of message.images ?? []) {
    fields.push(image.mimeType, image.data, image.uri);
  }
  return hashFields(fields);
}

function hashFields(fields: Array<string | undefined>): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const field of fields) {
    const value = field ?? '';
    const length = field === undefined ? 0xffffffff : value.length;
    for (let shift = 0; shift < 32; shift += 8) {
      const byte = (length >>> shift) & 0xff;
      first = Math.imul(first ^ byte, 0x01000193);
      second = Math.imul(second ^ byte, 0x85ebca6b);
    }
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
    }
  }
  return `${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

/** 把当前助手消息压成 IPC 增量；edits 只带路径和行数，不带文件正文。 */
export function buildStreamTail(
  cursor: StreamDeltaCursor,
  last: ChatMessage,
  extras: { status: ChatStatus; context?: ContextUsage; queue?: string[] },
): { tail: StreamTail; cursor: StreamDeltaCursor } {
  const reset = last.id !== cursor.id;
  const prevText = reset ? '' : cursor.text;
  const prevThinking = reset ? '' : cursor.thinking;
  const prevPlan = reset ? '' : cursor.plan;
  const prevMeta = reset ? '' : cursor.meta;
  const text = last.text;
  const thinking = last.thinking ?? '';
  const plan = last.plan ?? '';
  const meta = streamMetaStamp(last);
  const canAppendText = text.startsWith(prevText);
  const canAppendThinking = thinking.startsWith(prevThinking);
  const canAppendPlan = plan.startsWith(prevPlan);
  const metaChanged = meta !== prevMeta;
  const textDelta = canAppendText ? text.slice(prevText.length) : '';
  const thinkingDelta = canAppendThinking ? thinking.slice(prevThinking.length) : '';
  const planDelta = canAppendPlan ? plan.slice(prevPlan.length) : '';
  const slim: ChatMessage = {
    id: last.id,
    role: 'assistant',
    text: canAppendText ? '' : text,
    tools: metaChanged ? last.tools.map(slimTool) : [],
    streaming: last.streaming,
    createdAt: last.createdAt,
    endedAt: last.endedAt,
    error: last.error ?? null,
    modelId: last.modelId,
    modelName: last.modelName,
    effort: last.effort,
  };
  if (!canAppendThinking) {
    slim.thinking = last.thinking;
  }
  if (!canAppendPlan) {
    slim.plan = last.plan;
  }
  if (last.edits?.length) {
    slim.edits = last.edits.map(({ path, added, removed }) => ({ path, added, removed }));
  }
  if (last.steps?.length) {
    slim.steps = last.steps.map((step) => ({ ...step }));
  }
  if (metaChanged) {
    if (last.images?.length) {
      slim.images = last.images;
    }
  }
  const tail: StreamTail = {
    type: 'tail',
    message: slim,
    status: extras.status,
    context: extras.context,
    queue: extras.queue,
  };
  if (canAppendText) {
    if (textDelta) {
      tail.appendText = textDelta;
    }
  }
  if (canAppendThinking && thinkingDelta) {
    tail.appendThinking = thinkingDelta;
  }
  if (canAppendPlan && planDelta) {
    tail.appendPlan = planDelta;
  }
  return {
    tail,
    cursor: { id: last.id, text, thinking, plan, meta },
  };
}

function slimTool<T extends { detail?: string; output?: string }>(tool: T): T {
  const next = { ...tool };
  if (next.detail && next.detail.length > 240) {
    next.detail = `${next.detail.slice(0, 237)}...`;
  }
  if (next.output && next.output.length > 8000) {
    next.output = next.output.slice(next.output.length - 8000);
  }
  return next;
}

/** 在 webview 里把增量贴回已有消息，保留 edits / tools。 */
export function mergeStreamTail(last: ChatMessage | undefined, tail: StreamTail): ChatMessage {
  const incoming = tail.message;
  const same = last?.id === incoming.id;
  const text = joinText(same ? last?.text : incoming.text, incoming.text, tail.appendText, same);
  const thinking = joinOptional(
    same ? last?.thinking : incoming.thinking,
    incoming.thinking,
    tail.appendThinking,
    same,
  );
  const plan = joinOptional(same ? last?.plan : incoming.plan, incoming.plan, tail.appendPlan, same);
  const tools = incoming.tools.length > 0 || !same ? incoming.tools : (last?.tools ?? []);
  if (!same || !last) {
    return { ...incoming, text, thinking, plan, tools };
  }
  return {
    ...last,
    ...incoming,
    text,
    thinking,
    plan,
    tools,
    steps: incoming.steps !== undefined ? incoming.steps : last.steps,
    edits: incoming.edits ?? last.edits,
    images: incoming.images ?? last.images,
    error: 'error' in incoming ? incoming.error ?? undefined : last.error,
  };
}

function joinText(
  base: string | undefined,
  incoming: string | undefined,
  append: string | undefined,
  same: boolean,
): string {
  if (append !== undefined) {
    return `${same ? (base ?? '') : (incoming ?? '')}${append}`;
  }
  if (incoming) {
    return incoming;
  }
  return same ? (base ?? '') : (incoming ?? '');
}

function joinOptional(
  base: string | undefined,
  incoming: string | undefined,
  append: string | undefined,
  same: boolean,
): string | undefined {
  if (append !== undefined) {
    const prefix = same ? (base ?? '') : (incoming ?? '');
    return `${prefix}${append}`;
  }
  if (incoming) {
    return incoming;
  }
  return same ? base : incoming;
}
