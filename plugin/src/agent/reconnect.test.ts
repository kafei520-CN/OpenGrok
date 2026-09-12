import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AGENT_RECONNECT_MAX, reconnectDelayMs } from './reconnect';

describe('agent reconnect', () => {
  it('backs off then gives up after the cap', () => {
    assert.equal(reconnectDelayMs(0), undefined);
    assert.equal(reconnectDelayMs(1), 1_000);
    assert.equal(reconnectDelayMs(2), 2_000);
    assert.equal(reconnectDelayMs(3), 5_000);
    assert.equal(reconnectDelayMs(AGENT_RECONNECT_MAX), 5_000);
    assert.equal(reconnectDelayMs(AGENT_RECONNECT_MAX + 1), undefined);
  });
});
