/** Hold after pointer/wheel so streaming re-renders do not fight a drag. */
export const USER_SCROLL_HOLD_MS = 480;
export const BOTTOM_SLACK_PX = 56;

export interface TranscriptMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface TranscriptScroll {
  stickToBottom: boolean;
  transcriptScroll: number;
  lastUserScroll: number;
  pinLock: boolean;
}

export function userHeldScroll(
  now: number,
  lastUserScroll: number,
  holdMs = USER_SCROLL_HOLD_MS,
): boolean {
  return now - lastUserScroll < holdMs;
}

export function nearBottom(
  metrics: TranscriptMetrics,
  slack = BOTTOM_SLACK_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < slack;
}

/** True when a render may assign scrollTop = scrollHeight. */
export function shouldPinToBottom(opts: {
  stickToBottom: boolean;
  lightbox: boolean;
  now: number;
  lastUserScroll: number;
  /** Jump-to-bottom button: ignore the post-drag hold. */
  force?: boolean;
}): boolean {
  if (opts.lightbox) {
    return false;
  }
  if (!opts.force && userHeldScroll(opts.now, opts.lastUserScroll)) {
    return false;
  }
  return opts.stickToBottom;
}

/** Ignore programmatic pin; otherwise record the user thumb/wheel. */
export function onUserScroll(
  state: TranscriptScroll,
  now: number,
  metrics: TranscriptMetrics,
): TranscriptScroll {
  if (state.pinLock) {
    return state;
  }
  return {
    ...state,
    lastUserScroll: now,
    stickToBottom: nearBottom(metrics),
    transcriptScroll: metrics.scrollTop,
  };
}

export type JumpBottomKind = 'hidden' | 'arrow' | 'dots';

/** Hidden while pinned to the bottom; dots if a turn is live, else an arrow. */
export function jumpBottomKind(opts: {
  stickToBottom: boolean;
  streaming: boolean;
}): JumpBottomKind {
  if (opts.stickToBottom) {
    return 'hidden';
  }
  return opts.streaming ? 'dots' : 'arrow';
}
