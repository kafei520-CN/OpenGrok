import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  activeRailIndex,
  evenTickCenter,
  paintedMarkSpan,
  railEdge,
  railSegment,
  scrollReach,
  userRailMarks,
} from './userRail';

describe('user message rail', () => {
  it('keeps one mark per user turn, including a file-only send', () => {
    assert.deepEqual(
      userRailMarks([
        { id: 'u1', role: 'user', text: '请使用 Python-pptx 脚本生成' },
        { id: 'a1', role: 'assistant', text: '好' },
        { id: 'u2', role: 'user', text: '   ' },
        { id: 'u3', role: 'user', text: '', files: [{ label: '图片.png' }] },
      ]),
      [
        { id: 'u1', label: '请使用 Python-pptx 脚本生成' },
        { id: 'u3', label: '图片.png' },
      ],
    );
  });

  it('maps the top of the transcript to the first mark and the bottom to the last', () => {
    assert.equal(activeRailIndex(3, 0, 900), 0);
    assert.equal(activeRailIndex(3, 450, 900), 1);
    assert.equal(activeRailIndex(3, 900, 900), 2);
    assert.equal(activeRailIndex(0, 0, 0), -1);
    assert.equal(scrollReach(864, 264, 180), 780);
    assert.equal(activeRailIndex(10, 780, 780), 9);
  });

  it('maps a painted tail onto that tail, not the unpainted prefix', () => {
    assert.deepEqual(paintedMarkSpan([-1, -1, 0, 400, 900]), { from: 2, to: 5 });
    assert.equal(activeRailIndex(5, 0, 900, 2, 5), 2);
    assert.equal(activeRailIndex(5, 900, 900, 2, 5), 4);
    assert.equal(activeRailIndex(5, 450, 900, 2, 5), 3);
  });

  it('continues the next segment from the middle of this one', () => {
    assert.deepEqual(railSegment(7, 4, 0, 5), { start: 0, end: 5 });
    assert.deepEqual(railSegment(7, 5, 0, 5), { start: 2, end: 7 });
    assert.deepEqual(railSegment(7, 2, 2, 5), { start: 2, end: 7 });
    assert.deepEqual(railSegment(7, 1, 2, 5), { start: 0, end: 5 });
    assert.deepEqual(railSegment(25, 9, 0), { start: 0, end: 10 });
    assert.deepEqual(railSegment(25, 10, 0), { start: 5, end: 15 });
    assert.deepEqual(railSegment(23, 22, 10), { start: 13, end: 23 });
    assert.equal(railSegment(23, 0, 0).end - railSegment(23, 0, 0).start, 10);
    assert.equal(railSegment(23, 22, 13).end - railSegment(23, 22, 13).start, 10);
  });

  it('puts the first dash on the top edge and the last dash on the bottom edge', () => {
    assert.equal(evenTickCenter(0, 10, 100), 0);
    assert.equal(evenTickCenter(9, 10, 100), 100);
    assert.equal(evenTickCenter(0, 1, 100), 0);
  });

  it('puts the rail on the scrollbar side', () => {
    assert.equal(railEdge('end', 'start'), 'end');
    assert.equal(railEdge('start', 'end'), 'start');
    assert.equal(railEdge(undefined, 'start'), 'start');
    assert.equal(railEdge(undefined, 'unknown'), 'end');
  });
});
