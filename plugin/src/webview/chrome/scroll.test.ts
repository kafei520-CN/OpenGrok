import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  BOTTOM_SLACK_PX,
  USER_SCROLL_HOLD_MS,
  jumpBottomKind,
  nearBottom,
  onUserScroll,
  shouldPinToBottom,
  userHeldScroll,
  type TranscriptScroll,
} from './scroll';

const lowerHalf: { scrollTop: number; scrollHeight: number; clientHeight: number } = {
  scrollTop: 400,
  scrollHeight: 800,
  clientHeight: 200,
};

const atBottom: { scrollTop: number; scrollHeight: number; clientHeight: number } = {
  scrollTop: 560,
  scrollHeight: 800,
  clientHeight: 200,
};

function idle(over: Partial<TranscriptScroll> = {}): TranscriptScroll {
  return {
    stickToBottom: true,
    transcriptScroll: 0,
    lastUserScroll: 0,
    pinLock: false,
    ...over,
  };
}

describe('transcript scroll', () => {
  it('does not pin to bottom while the user is dragging or wheeling', () => {
    const now = 1_000;
    assert.equal(userHeldScroll(now, now - 100), true);
    assert.equal(userHeldScroll(now, now - USER_SCROLL_HOLD_MS - 1), false);
    assert.equal(
      shouldPinToBottom({
        stickToBottom: true,
        lightbox: false,
        now,
        lastUserScroll: now,
      }),
      false,
    );
    assert.equal(
      shouldPinToBottom({
        stickToBottom: true,
        lightbox: false,
        now,
        lastUserScroll: 0,
      }),
      true,
    );
    assert.equal(
      shouldPinToBottom({
        stickToBottom: true,
        lightbox: false,
        now,
        lastUserScroll: now,
        force: true,
      }),
      true,
    );
  });

  it('keeps stick-to-bottom only near the end and ignores programmatic pin', () => {
    assert.equal(nearBottom(atBottom), true);
    assert.equal(nearBottom(lowerHalf), false);
    assert.equal(
      nearBottom({ scrollTop: 0, scrollHeight: 800, clientHeight: 200 }),
      false,
    );
    const dragged = onUserScroll(idle({ lastUserScroll: 500 }), 500, lowerHalf);
    assert.equal(dragged.stickToBottom, false);
    assert.equal(dragged.lastUserScroll, 500);
    assert.equal(dragged.transcriptScroll, 400);
    const atEnd = onUserScroll(idle({ lastUserScroll: 500 }), 500, atBottom);
    assert.equal(atEnd.stickToBottom, true);
    const pinned = onUserScroll(idle({ pinLock: true, stickToBottom: false }), 500, atBottom);
    assert.equal(pinned.stickToBottom, false);
    assert.equal(pinned.lastUserScroll, 0);
  });

  it('hides at the bottom even while streaming', () => {
    assert.equal(jumpBottomKind({ stickToBottom: true, streaming: true }), 'hidden');
    assert.equal(jumpBottomKind({ stickToBottom: true, streaming: false }), 'hidden');
    assert.equal(jumpBottomKind({ stickToBottom: false, streaming: true }), 'dots');
    assert.equal(jumpBottomKind({ stickToBottom: false, streaming: false }), 'arrow');
  });

  it('keeps the transcript scrollport as block, not flex', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'media', 'chat.css'), 'utf8');
    const block = css.match(/\.transcript\s*\{[^}]+\}/);
    assert.ok(block, 'missing .transcript rule');
    assert.match(block[0], /display:\s*block/);
    assert.doesNotMatch(block[0], /display:\s*flex/);
    assert.match(block[0], /overflow-anchor:\s*none/);
    assert.ok(BOTTOM_SLACK_PX > 0);
  });
});
