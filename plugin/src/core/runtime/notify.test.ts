import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { turnNotify } from './notify';

describe('turnNotify', () => {
  it('is silent when the user cancels', () => {
    assert.equal(turnNotify({ cancelled: true }), undefined);
    assert.equal(turnNotify({ cancelled: true, failed: true }), undefined);
  });

  it('beeps done on a finished turn and fail on an interrupt', () => {
    assert.equal(turnNotify({}), 'done');
    assert.equal(turnNotify({ failed: false }), 'done');
    assert.equal(turnNotify({ failed: true }), 'fail');
  });
});
