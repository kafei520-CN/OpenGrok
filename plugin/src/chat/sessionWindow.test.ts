import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initialSessionFloor, sessionOlderPage, SESSION_PAGE, SESSION_WINDOW } from './sessionWindow';

describe('session window', () => {
  it('sends a short transcript in one piece', () => {
    assert.equal(initialSessionFloor(12), 0);
    assert.equal(initialSessionFloor(SESSION_WINDOW), 0);
  });

  it('opens a long transcript on the newest window', () => {
    assert.equal(initialSessionFloor(500), 500 - SESSION_WINDOW);
  });

  it('pages older messages backward from the floor', () => {
    const first = sessionOlderPage(500, 440);
    assert.deepEqual(first, { start: 440 - SESSION_PAGE, end: 440 });
    const last = sessionOlderPage(500, 10);
    assert.deepEqual(last, { start: 0, end: 10 });
    assert.equal(sessionOlderPage(20, 0), undefined);
  });
});