/** ZCode snapshotTailWindowRows：打开会话的第一帧只带最新行，不带整段历史。 */
export const SESSION_WINDOW = 60;
/** 向上补一页。比首屏窗口小，避免一次滚顶把后面的正文全铺开。 */
export const SESSION_PAGE = 24;

/** 客户端已经拿到的第一条在完整记录里的下标。更早的还在宿主上。 */
export function initialSessionFloor(length: number, window = SESSION_WINDOW): number {
  if (length <= window) {
    return 0;
  }
  return length - window;
}

export function sessionOlderPage(
  length: number,
  floor: number,
  page = SESSION_PAGE,
): { start: number; end: number } | undefined {
  if (floor <= 0 || length <= 0) {
    return undefined;
  }
  const end = Math.min(floor, length);
  const start = Math.max(0, end - page);
  if (start >= end) {
    return undefined;
  }
  return { start, end };
}
