import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import {
  BUNDLED_RELAY_TOKEN,
  PublicRelay,
  advertisedRelayUrl,
  decodeMux,
  encodeMux,
  isAdminPath,
  listenPublicRelay,
  parseRelaySlot,
  requestPath,
} from './publicRelay';
import { handleAdmin } from './relayAdmin';
import { hashPassword } from './relayConfig';

describe('public relay helpers', () => {
  it('builds a slot URL without a port on 80', () => {
    assert.equal(advertisedRelayUrl('189.24.78.197', 80, 'abc12345'), 'http://189.24.78.197/s/abc12345');
    assert.equal(advertisedRelayUrl('127.0.0.1', 8788, 'abc12345'), 'http://127.0.0.1:8788/s/abc12345');
    assert.equal(parseRelaySlot('/s/abc12345'), 'abc12345');
    assert.equal(parseRelaySlot('/host'), undefined);
    assert.equal(requestPath('/admin'), '/admin');
    assert.equal(requestPath('/admin/'), '/admin');
    assert.equal(requestPath('http://189.24.78.197/admin'), '/admin');
    assert.equal(isAdminPath('/admin'), true);
    assert.equal(isAdminPath('/'), false);
  });

  it('round-trips mux frames', () => {
    const payload = Buffer.from('hello');
    const packed = encodeMux(2, 7, payload);
    const decoded = decodeMux(packed);
    assert.equal(decoded?.type, 2);
    assert.equal(decoded?.id, 7);
    assert.equal(decoded?.payload.toString(), 'hello');
    assert.equal(decoded?.consumed, packed.length);
    assert.equal(decodeMux(packed.subarray(0, 4)), undefined);
  });
});

describe('public relay loop', () => {
  it('forwards a browser hit through the plugin to a local gateway', async () => {
    const gw = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('pair-ok');
    });
    await new Promise<void>((resolve) => gw.listen(0, '127.0.0.1', resolve));
    const gwAddr = gw.address();
    const gwPort = gwAddr && typeof gwAddr === 'object' ? gwAddr.port : 0;
    const relay = await listenPublicRelay({
      port: 0,
      bind: '127.0.0.1',
      token: BUNDLED_RELAY_TOKEN,
      publicHost: '127.0.0.1',
    });
    const client = new PublicRelay();
    const up = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay did not come up')), 4000);
      const sub = client.onChange(() => {
        if (client.info().state === 'up' && client.info().publicUrl) {
          clearTimeout(timer);
          sub.dispose();
          resolve();
        }
        if (client.info().state === 'error' && client.info().error === 'auth') {
          clearTimeout(timer);
          sub.dispose();
          reject(new Error(client.info().error));
        }
      });
    });
    client.start({ host: '127.0.0.1', port: relay.port, localPort: gwPort, token: BUNDLED_RELAY_TOKEN });
    await up;
    const slotUrl = client.info().publicUrl ?? '';
    assert.match(slotUrl, /\/s\/[A-Za-z0-9_-]+$/);
    const bounced = await fetch(slotUrl, { redirect: 'manual' });
    assert.equal(bounced.status, 302);
    const cookie = bounced.headers.get('set-cookie') ?? '';
    assert.match(cookie, /grok_slot=/);
    const origin = `http://127.0.0.1:${relay.port}`;
    const page = await fetch(`${origin}/`, { headers: { cookie: cookie.split(';')[0] } });
    assert.equal(await page.text(), 'pair-ok');
    client.stop();
    await relay.close();
    await new Promise<void>((resolve) => gw.close(() => resolve()));
  });

  it('rejects a plugin with the wrong token', async () => {
    const relay = await listenPublicRelay({
      port: 0,
      bind: '127.0.0.1',
      token: BUNDLED_RELAY_TOKEN,
      publicHost: '127.0.0.1',
    });
    const client = new PublicRelay();
    const failed = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('expected auth error')), 4000);
      const sub = client.onChange(() => {
        if (client.info().state === 'error' && client.info().error) {
          clearTimeout(timer);
          sub.dispose();
          resolve(client.info().error ?? '');
        }
      });
    });
    client.start({ host: '127.0.0.1', port: relay.port, localPort: 1, token: 'wrong-token-value-not-the-bundled' });
    assert.equal(await failed, 'auth');
    client.stop();
    await relay.close();
  });

  it('accepts a custom host key and rejects the official token when only custom is set', async () => {
    const key = 'gb1.custom-host-key-value-0001';
    const relay = await listenPublicRelay({
      port: 0,
      bind: '127.0.0.1',
      officialToken: BUNDLED_RELAY_TOKEN,
      customToken: key,
      publicHost: '127.0.0.1',
    });
    const client = new PublicRelay();
    const up = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('custom key did not connect')), 4000);
      const sub = client.onChange(() => {
        if (client.info().state === 'up') {
          clearTimeout(timer);
          sub.dispose();
          resolve();
        }
        if (client.info().state === 'error' && client.info().error === 'auth') {
          clearTimeout(timer);
          sub.dispose();
          reject(new Error('auth'));
        }
      });
    });
    client.start({ host: '127.0.0.1', port: relay.port, localPort: 1, token: key, official: false });
    await up;
    assert.equal(relay.peers()[0]?.kind, 'custom');
    client.stop();
    await relay.close();
  });

  it('bans an IP so later HTTP hits are 403', async () => {
    const relay = await listenPublicRelay({
      port: 0,
      bind: '127.0.0.1',
      token: BUNDLED_RELAY_TOKEN,
      publicHost: '127.0.0.1',
    });
    relay.ban('127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${relay.port}/`);
    assert.equal(res.status, 403);
    await relay.close();
  });

  it('serves the Grok Web login page at /admin', async () => {
    const pass = 'correct-horse-admin';
    const auth = { user: 'admin', hash: hashPassword(pass), setHash() {} };
    const relay = await listenPublicRelay({
      port: 0,
      bind: '127.0.0.1',
      token: BUNDLED_RELAY_TOKEN,
      publicHost: '127.0.0.1',
      onHttp: (socket, head, leftover, control) =>
        handleAdmin(socket, head, leftover, auth, control, () => undefined),
    });
    const page = await fetch(`http://127.0.0.1:${relay.port}/admin`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Grok Web/);
    assert.match(html, /\/admin\/login/);
    const root = await fetch(`http://127.0.0.1:${relay.port}/`);
    const home = await root.text();
    assert.equal(root.status, 200);
    assert.match(home, /打开控制面板/);
    assert.match(home, /href="\/admin"/);
    await relay.close();
  });
});
