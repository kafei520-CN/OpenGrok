import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampListenPort, hashPassword, newHostKey, normalizeIp, verifyPassword } from './relayConfig';

describe('relay config secrets', () => {
  it('hashes and verifies an admin password', () => {
    const packed = hashPassword('correct-horse-battery');
    assert.equal(verifyPassword('correct-horse-battery', packed), true);
    assert.equal(verifyPassword('wrong-password-value', packed), false);
  });

  it('makes a host key and strips v4-mapped IPs', () => {
    assert.match(newHostKey(), /^gb1\.[0-9a-f]+$/);
    assert.equal(normalizeIp('::ffff:10.1.2.3'), '10.1.2.3');
    assert.equal(clampListenPort(9000), 9000);
    assert.equal(clampListenPort(80), 80);
    assert.equal(clampListenPort(0), 8788);
  });
});

