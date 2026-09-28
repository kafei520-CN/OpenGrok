import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ENSURE_WATCH_JS,
  PAGE_SNAPSHOT_JS,
  SETTLE_JS,
  buildSnapView,
  shouldClearBeforeType,
  clickTargetScript,
  cropRect,
  focusTargetScript,
  needsShot,
  parsePicture,
  stampScript,
  type PagePicture,
  type SnapControl,
} from './browserSnap';

function control(over: Partial<SnapControl> = {}): SnapControl {
  return {
    ref: 'e1',
    role: 'button',
    name: '查询',
    value: '',
    enabled: true,
    focused: false,
    level: 0,
    x: 10,
    y: 20,
    w: 40,
    h: 16,
    hint: '',
    ...over,
  };
}

function picture(over: Partial<PagePicture> = {}): PagePicture {
  return {
    url: 'https://example.com/orders',
    nodes: [control()],
    rows: [],
    canvas: false,
    flashes: [],
    truncated: false,
    note: '',
    ...over,
  };
}

describe('browser snap', () => {
  it('lists the whole viewport on the first look', () => {
    const view = buildSnapView(undefined, picture({ rows: ['昨天 | 已发货'] }));
    assert.equal(view.mode, 'full');
    const text = view.lines.join('\n');
    assert.match(text, /button "查询" \[ref=e1\]/);
    assert.match(text, /昨天 \| 已发货/);
  });

  it('returns only the change after the first look', () => {
    const next = picture({
      nodes: [control(), control({ ref: 'e2', name: '确定', x: 80 })],
    });
    const view = buildSnapView(picture(), next);
    assert.equal(view.mode, 'diff');
    const text = view.lines.join('\n');
    assert.match(text, /\+ button "确定" \[ref=e2\]/);
    assert.doesNotMatch(text, /查询/);
    assert.equal(view.changed.length, 1);
  });

  it('says the page did not change', () => {
    const view = buildSnapView(picture(), picture());
    assert.deepEqual(view.lines, ['页面没有变化。']);
  });

  it('keeps a flash even when the controls stay the same', () => {
    const text = buildSnapView(picture(), picture({ flashes: ['提示：已保存'] })).lines.join('\n');
    assert.match(text, /中间出现过/);
    assert.match(text, /已保存/);
    assert.doesNotMatch(text, /没有变化/);
  });

  it('sends a full tree again when the url changes', () => {
    const view = buildSnapView(picture(), picture({ url: 'https://example.com/next' }));
    assert.equal(view.mode, 'full');
  });

  it('shows a value edit as a removal plus an addition', () => {
    const prev = picture({ nodes: [control({ role: 'textbox', name: '邮箱', value: '' })] });
    const next = picture({
      nodes: [control({ role: 'textbox', name: '邮箱', value: 'a@b.c', focused: true })],
    });
    const text = buildSnapView(prev, next).lines.join('\n');
    assert.match(text, /\+ textbox "邮箱" \[ref=e1\] \[value="a@b.c"\] \[focused\]/);
    assert.match(text, /- textbox "邮箱" \[ref=e1\]/);
  });

  it('skips the picture when a named control or a table is enough', () => {
    assert.equal(needsShot(picture(), false), false);
    assert.equal(needsShot(picture({ nodes: [], rows: ['a | b'] }), false), false);
    assert.equal(needsShot(picture({ nodes: [] }), false), true);
    assert.equal(needsShot(picture({ canvas: true }), false), false);
    assert.equal(needsShot(picture({ nodes: [], canvas: true }), false), true);
    assert.equal(needsShot(picture({ nodes: [control({ name: '' })] }), false), true);
    assert.equal(needsShot(picture(), true), true);
  });

  it('crops around a small change and keeps a near-fullscreen change whole', () => {
    const small = cropRect([control({ x: 10, y: 10, w: 20, h: 20 })], { width: 800, height: 600 });
    assert.equal(small?.x, 0);
    assert.ok((small?.width ?? 0) < 100);
    const huge = cropRect([control({ x: 0, y: 0, w: 780, h: 560 })], { width: 800, height: 600 });
    assert.equal(huge, undefined);
  });

  it('drops a control that has no ref', () => {
    const parsed = parsePicture('https://example.com', { nodes: [{ role: 'button', name: '查询' }], rows: ['  '] });
    assert.equal(parsed.nodes.length, 0);
    assert.deepEqual(parsed.rows, []);
  });

  it('keeps a focused search box visible and tells the model to type', () => {
    const box = control({
      role: 'textbox',
      name: '',
      focused: true,
      hint: '占位「搜索」，输入后按 Enter 提交',
    });
    const text = buildSnapView(picture({ nodes: [box] }), picture({ nodes: [box] })).lines.join('\n');
    assert.match(text, /当前焦点: textbox "" \[ref=e1\] \[focused\] \[hint="占位「搜索」，输入后按 Enter 提交"\]/);
    assert.doesNotMatch(text, /页面没有变化/);
  });

  it('parses the guest scripts', () => {
    const sources = [
      PAGE_SNAPSHOT_JS,
      ENSURE_WATCH_JS,
      SETTLE_JS,
      clickTargetScript('e1', 'button', '查询'),
      focusTargetScript('e2', 'textbox', '邮箱'),
      stampScript([control()]),
    ];
    for (const source of sources) {
      assert.doesNotThrow(() => new Function(source));
    }
  });

  it('clears text fields before typing unless append is set', () => {
    assert.equal(shouldClearBeforeType('textbox', false), true);
    assert.equal(shouldClearBeforeType('searchbox', false), true);
    assert.equal(shouldClearBeforeType('textbox', true), false);
    assert.equal(shouldClearBeforeType('button', false), false);
  });
});
