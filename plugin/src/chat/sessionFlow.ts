import type { ContentBlock, SessionUpdate } from '../core/types';

/**
 * 会话事件通道，运作方式对齐 ZCode 的 session subscribe：
 * 前台逐条实时投递；后台把正文/思考增量合并成一段再投递；
 * 结构事件（工具、计划、权限）先把已合并的正文落地再立即投递。
 * 会话正文还没就位时先攒着，松开后再按「回放在前、实时在后」补上，
 * 避免历史回放和正在生成的 token 插在一起。
 */

export const BACKGROUND_STREAM_FLUSH_MS = 1_500;
export const BACKGROUND_STREAM_MAX_ITEMS = 96;

export type SessionLaneMode = 'foreground' | 'background' | 'replaying';

export type SessionFlowItem = {
  sessionId: string;
  update: SessionUpdate;
  isReplay: boolean;
};

type PendingItem = {
  key: string;
  item: SessionFlowItem;
};

type Scheduled = { cancel(): void };

type Lane = {
  mode: SessionLaneMode;
  /** 正文还没换上来时，回放和实时都先攒着。 */
  held: boolean;
  pending: PendingItem[];
  buffer: SessionFlowItem[];
  timer?: Scheduled;
};

const COALESCE_KINDS = new Set(['agent_message_chunk', 'agent_thought_chunk']);

export type SessionFlow = {
  accept(sessionId: string, update: SessionUpdate, isReplay: boolean): void;
  setMode(sessionId: string, mode: SessionLaneMode): void;
  mode(sessionId: string): SessionLaneMode | undefined;
  hold(sessionId: string): void;
  unhold(sessionId: string): void;
  isHeld(sessionId: string): boolean;
  /** 把后台已合并、还没落地的正文立刻投递。不碰 hold 期间攒下的事件。 */
  flush(sessionId: string): void;
  /** 丢掉还没落地的后台正文。历史回放会再带上这段，不能先写进空会话。 */
  dropPending(sessionId: string): void;
  /** 丢掉 hold/回放期间攒下的历史回放，实时事件还留着。 */
  discardBufferedReplay(sessionId: string): void;
  /** 先投递回放，再投递实时。调用方要先把通道从 replaying/hold 松开。 */
  releaseBuffered(sessionId: string): void;
  discard(sessionId: string): void;
  dispose(): void;
};

export function createSessionFlow(opts: {
  deliver: (item: SessionFlowItem) => void;
  /** 后台开始攒正文时通知一次，用来把侧边栏点成「还在跑」，不必等合并窗口。 */
  onBackgroundBurst?: (sessionId: string) => void;
  flushDelayMs?: number;
  maxItems?: number;
  schedule?: (fn: () => void, ms: number) => Scheduled;
}): SessionFlow {
  const flushDelayMs = opts.flushDelayMs ?? BACKGROUND_STREAM_FLUSH_MS;
  const maxItems = opts.maxItems ?? BACKGROUND_STREAM_MAX_ITEMS;
  const schedule =
    opts.schedule ??
    ((fn, ms) => {
      const timer = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(timer) };
    });
  const lanes = new Map<string, Lane>();

  function ensure(sessionId: string, mode: SessionLaneMode): Lane {
    let lane = lanes.get(sessionId);
    if (!lane) {
      lane = { mode, held: false, pending: [], buffer: [] };
      lanes.set(sessionId, lane);
    }
    return lane;
  }

  function cancelTimer(lane: Lane): void {
    if (!lane.timer) {
      return;
    }
    lane.timer.cancel();
    lane.timer = undefined;
  }

  function flushPending(lane: Lane): void {
    cancelTimer(lane);
    if (lane.pending.length === 0) {
      return;
    }
    const items = lane.pending.splice(0).map((entry) => entry.item);
    for (const item of items) {
      opts.deliver(item);
    }
  }

  function scheduleFlush(lane: Lane, sessionId: string): void {
    if (lane.timer || flushDelayMs <= 0) {
      return;
    }
    lane.timer = schedule(() => {
      lane.timer = undefined;
      const current = lanes.get(sessionId);
      if (current !== lane) {
        return;
      }
      flushPending(lane);
    }, flushDelayMs);
  }

  function enqueueBackground(lane: Lane, sessionId: string, item: SessionFlowItem): void {
    const key = coalesceKey(item.update);
    if (!key) {
      flushPending(lane);
      opts.deliver(item);
      return;
    }
    const wasEmpty = lane.pending.length === 0;
    const existing = lane.pending.find((entry) => entry.key === key);
    if (existing) {
      existing.item = {
        ...existing.item,
        update: mergeTextUpdate(existing.item.update, item.update),
      };
    } else {
      lane.pending.push({ key, item });
    }
    if (wasEmpty) {
      opts.onBackgroundBurst?.(sessionId);
    }
    if (lane.pending.length >= maxItems || flushDelayMs <= 0) {
      flushPending(lane);
      return;
    }
    scheduleFlush(lane, sessionId);
  }

  return {
    accept(sessionId, update, isReplay) {
      const lane = ensure(sessionId, 'foreground');
      const item: SessionFlowItem = { sessionId, update, isReplay };
      if (lane.held || (lane.mode === 'replaying' && !isReplay)) {
        lane.buffer.push(item);
        return;
      }
      if (lane.mode === 'replaying' || lane.mode === 'foreground') {
        opts.deliver(item);
        return;
      }
      enqueueBackground(lane, sessionId, item);
    },

    setMode(sessionId, mode) {
      const existing = lanes.get(sessionId);
      if (!existing) {
        ensure(sessionId, mode);
        return;
      }
      if (existing.mode === mode) {
        return;
      }
      if (existing.mode === 'background') {
        flushPending(existing);
      }
      existing.mode = mode;
    },

    mode(sessionId) {
      return lanes.get(sessionId)?.mode;
    },

    hold(sessionId) {
      ensure(sessionId, lanes.get(sessionId)?.mode ?? 'foreground').held = true;
    },

    unhold(sessionId) {
      const lane = lanes.get(sessionId);
      if (lane) {
        lane.held = false;
      }
    },

    isHeld(sessionId) {
      return lanes.get(sessionId)?.held === true;
    },

    flush(sessionId) {
      const lane = lanes.get(sessionId);
      if (lane) {
        flushPending(lane);
      }
    },

    dropPending(sessionId) {
      const lane = lanes.get(sessionId);
      if (!lane) {
        return;
      }
      cancelTimer(lane);
      lane.pending = [];
    },

    discardBufferedReplay(sessionId) {
      const lane = lanes.get(sessionId);
      if (!lane) {
        return;
      }
      lane.buffer = lane.buffer.filter((item) => !item.isReplay);
    },

    releaseBuffered(sessionId) {
      const lane = lanes.get(sessionId);
      if (!lane || lane.buffer.length === 0) {
        return;
      }
      const items = lane.buffer.splice(0);
      const replay = items.filter((item) => item.isReplay);
      const live = items.filter((item) => !item.isReplay);
      for (const item of [...replay, ...live]) {
        opts.deliver(item);
      }
    },

    discard(sessionId) {
      const lane = lanes.get(sessionId);
      if (!lane) {
        return;
      }
      cancelTimer(lane);
      lanes.delete(sessionId);
    },

    dispose() {
      for (const lane of lanes.values()) {
        cancelTimer(lane);
      }
      lanes.clear();
    },
  };
}

function coalesceKey(update: SessionUpdate): string | null {
  const kind = update.sessionUpdate;
  if (!kind || !COALESCE_KINDS.has(kind)) {
    return null;
  }
  if (coalescibleText(update) === null) {
    return null;
  }
  return kind;
}

/** 只合并纯文本增量。带图片或 diff 的块必须原样落地，不能折进字符串。 */
function coalescibleText(update: SessionUpdate): string | null {
  const content = update.content;
  if (!content) {
    return '';
  }
  const blocks = Array.isArray(content) ? content : [content];
  let text = '';
  for (const block of blocks) {
    if (!isPlainTextBlock(block)) {
      return null;
    }
    text += block.text ?? '';
  }
  return text;
}

function isPlainTextBlock(block: ContentBlock): boolean {
  if (block.type && block.type !== 'text') {
    return false;
  }
  if (block.data || block.mimeType || block.oldText || block.newText || block.uri) {
    return false;
  }
  return true;
}

function mergeTextUpdate(current: SessionUpdate, next: SessionUpdate): SessionUpdate {
  const text = `${coalescibleText(current) ?? ''}${coalescibleText(next) ?? ''}`;
  const content: ContentBlock = { type: 'text', text };
  return {
    ...current,
    content,
    turnStartMs: current.turnStartMs ?? next.turnStartMs,
    streamStartMs: current.streamStartMs ?? next.streamStartMs,
    agentTimestampMs: current.agentTimestampMs ?? next.agentTimestampMs,
  };
}
