import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  clampRemotePort,
  DEFAULT_REMOTE_PORT,
  generatePairCode,
  lanUrls,
  sanitizeRemoteSecret,
  normalizePublicUrl,
  remoteBindHost,
  RemoteGateway,
  safeCspHost,
} from './remoteGateway';

describe('remote gateway helpers', () => {
  it('clamps listen ports', () => {
    assert.equal(clampRemotePort(80), 1024);
    assert.equal(clampRemotePort(8787), 8787);
    assert.equal(clampRemotePort(99999), 65535);
    assert.equal(clampRemotePort('nope'), DEFAULT_REMOTE_PORT);
    assert.equal(clampRemotePort(0), 0);
  });

  it('makes a 6-digit pairing code', () => {
    const code = generatePairCode();
    assert.match(code, /^\d{6}$/);
  });

  it('keeps custom secrets within 4–64 characters', () => {
    assert.equal(sanitizeRemoteSecret('  ab  '), '');
    assert.equal(sanitizeRemoteSecret('abcd'), 'abcd');
    assert.equal(sanitizeRemoteSecret('  ok-pass  '), 'ok-pass');
    assert.equal(sanitizeRemoteSecret('a'.repeat(65)), '');
    assert.equal(sanitizeRemoteSecret('pass\nword'), 'password');
  });

  it('always lists loopback among LAN urls', () => {
    const urls = lanUrls(8787);
    assert.ok(urls.includes('http://127.0.0.1:8787'));
  });

  it('keeps CSP hosts free of header injection', () => {
    assert.equal(safeCspHost('192.168.1.8:8787'), '192.168.1.8:8787');
    assert.equal(safeCspHost('[::1]:8787'), '[::1]:8787');
    assert.equal(safeCspHost('evil.com; script-src *'), '127.0.0.1');
  });

  it('binds LAN on every interface and public-only on loopback', () => {
    assert.equal(remoteBindHost(true), '0.0.0.0');
    assert.equal(remoteBindHost(false), '127.0.0.1');
  });

  it('keeps advertised public urls as origins', () => {
    assert.equal(normalizePublicUrl('https://chat.example.com/app'), 'https://chat.example.com');
    assert.equal(normalizePublicUrl('1.2.3.4:8787'), 'http://1.2.3.4:8787');
    assert.equal(normalizePublicUrl('javascript:alert(1)'), '');
  });
});

describe('remote gateway http', () => {
  it('rejects a bad code and accepts the live pairing code', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-remote-'));
    fs.writeFileSync(path.join(dir, 'webview.js'), 'window.__grok=1;');
    fs.writeFileSync(path.join(dir, 'chat.css'), 'body{}');
    fs.writeFileSync(path.join(dir, 'diff.js'), 'window.__diff=1;');
    fs.writeFileSync(path.join(dir, 'diff.css'), 'body{}');
    const seen: string[] = [];
    const gw = new RemoteGateway(
      {
        webviewJs: path.join(dir, 'webview.js'),
        chatCss: path.join(dir, 'chat.css'),
        diffJs: path.join(dir, 'diff.js'),
        diffCss: path.join(dir, 'diff.css'),
      },
      {
        onClientMessage: (msg) => seen.push(msg.type),
        snapshot: () => ({ status: 'ready', messages: [] }),
      },
    );
    const info = await gw.start(0);
    const port = (gw.info().port || info.port) as number;
    const live = gw.info();
    const actualPort = new URL(live.urls[0] ?? `http://127.0.0.1:${port}`).port;
    const base = `http://127.0.0.1:${actualPort}`;
    const ping = await fetch(`${base}/ping`, { method: 'HEAD' });
    assert.equal(ping.status, 204);
    const bad = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=000000',
      redirect: 'manual',
    });
    assert.equal(bad.status, 403);
    const ok = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `code=${live.code}`,
      redirect: 'manual',
    });
    assert.equal(ok.status, 302);
    const cookie = ok.headers.get('set-cookie') ?? '';
    const location = ok.headers.get('location') ?? '';
    assert.match(cookie, /grok_sess=/);
    assert.match(location, /^\/\?s=[0-9a-f]+$/);
    const retryPair = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookie.split(';')[0],
      },
      body: JSON.stringify({ code: live.code }),
      redirect: 'manual',
    });
    assert.equal(retryPair.status, 302);
    const token = new URL(location, base).searchParams.get('s') ?? '';
    const page = await fetch(`${base}${location}`);
    const html = await page.text();
    assert.match(html, /webview\.js/);
    assert.match(html, /remote-web/);
    assert.match(html, /\/ws\?s=/);
    assert.match(html, /ws:\/\/127\.0\.0\.1:/);
    assert.match(html, /frame-src 'self'/);
    assert.match(html, /worker-src 'self' blob:/);
    assert.match(html, /font-src 'self' data:/);
    assert.match(html, /__grokPrime/);
    assert.match(html, /__grokDeliver/);
    assert.match(html, /user-scalable=no/);
    assert.doesNotMatch(html, /name="code"/);
    const diffPage = await fetch(`${base}/diff.html`, { headers: { cookie: cookie.split(';')[0] } });
    assert.match(await diffPage.text(), /diff\.js/);
    const portNum = Number(actualPort);
    const authed = await wsUpgrade(portNum, `/ws?s=${token}`);
    assert.equal(authed.status, 101);
    await new Promise<void>((resolve) => {
      authed.socket.once('close', () => resolve());
      authed.socket.destroy();
    });
    const again = await wsUpgrade(portNum, `/ws?s=${token}`);
    assert.equal(again.status, 101);
    again.socket.destroy();
    const denied = await wsUpgrade(portNum, '/ws');
    assert.equal(denied.status, 401);
    denied.socket.destroy();
    await gw.stop();
  });

  it('serves monaco files and rejects path escape', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-remote-'));
    fs.writeFileSync(path.join(dir, 'webview.js'), 'window.__grok=1;');
    fs.writeFileSync(path.join(dir, 'chat.css'), 'body{}');
    const monaco = path.join(dir, 'monaco', 'vs');
    fs.mkdirSync(monaco, { recursive: true });
    fs.writeFileSync(path.join(monaco, 'loader.js'), '/* monaco */');
    const gw = new RemoteGateway(
      {
        webviewJs: path.join(dir, 'webview.js'),
        chatCss: path.join(dir, 'chat.css'),
        monacoDir: path.join(dir, 'monaco'),
      },
      { onClientMessage: () => undefined, snapshot: () => ({}) },
    );
    const live = await gw.start(0);
    const ok = await fetch(`http://127.0.0.1:${live.port}/monaco/vs/loader.js`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '/* monaco */');
    const missing = await fetch(`http://127.0.0.1:${live.port}/monaco/vs/nope.js`);
    assert.equal(missing.status, 404);
    await gw.stop();
  });

  it('serves the shiki monaco bridge', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-remote-'));
    fs.writeFileSync(path.join(dir, 'webview.js'), 'window.__grok=1;');
    fs.writeFileSync(path.join(dir, 'chat.css'), 'body{}');
    fs.writeFileSync(path.join(dir, 'shiki-monaco.js'), 'window.__grokShikiReady=Promise.resolve();');
    const gw = new RemoteGateway(
      {
        webviewJs: path.join(dir, 'webview.js'),
        chatCss: path.join(dir, 'chat.css'),
        shikiMonacoJs: path.join(dir, 'shiki-monaco.js'),
      },
      { onClientMessage: () => undefined, snapshot: () => ({}) },
    );
    const live = await gw.start(0);
    const ok = await fetch(`http://127.0.0.1:${live.port}/shiki-monaco.js`);
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /__grokShikiReady/);
    await gw.stop();
  });

  it('rejects a second pairing while one session is already in', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-remote-'));
    fs.writeFileSync(path.join(dir, 'webview.js'), 'window.__grok=1;');
    fs.writeFileSync(path.join(dir, 'chat.css'), 'body{}');
    const gw = new RemoteGateway(
      { webviewJs: path.join(dir, 'webview.js'), chatCss: path.join(dir, 'chat.css') },
      { onClientMessage: () => undefined, snapshot: () => ({}) },
    );
    const live = await gw.start(0, { local: false, public: true, publicUrl: 'http://vps:8787' });
    assert.equal(live.bind, '127.0.0.1');
    const port = live.port;
    const first = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `code=${live.code}`,
      redirect: 'manual',
    });
    assert.equal(first.status, 302);
    const second = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `code=${live.code}`,
      redirect: 'manual',
    });
    assert.equal(second.status, 409);
    await gw.stop();
  });

  it('accepts a saved custom password and serves a password pair page', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-remote-'));
    fs.writeFileSync(path.join(dir, 'webview.js'), 'window.__grok=1;');
    fs.writeFileSync(path.join(dir, 'chat.css'), 'body{}');
    const gw = new RemoteGateway(
      { webviewJs: path.join(dir, 'webview.js'), chatCss: path.join(dir, 'chat.css') },
      { onClientMessage: () => undefined, snapshot: () => ({}) },
    );
    const live = await gw.start(0);
    gw.setPairSecret('ok-pass', 'custom');
    assert.equal(gw.info().codeMode, 'custom');
    assert.equal(gw.info().code, 'ok-pass');
    const pair = await fetch(`http://127.0.0.1:${live.port}/`);
    const html = await pair.text();
    assert.match(html, /maxlength="64"/);
    assert.match(html, /type="password"/);
    assert.doesNotMatch(html, /maxlength="6"/);
    const ok = await fetch(`http://127.0.0.1:${live.port}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ok-pass' }),
      redirect: 'manual',
    });
    assert.equal(ok.status, 302);
    const bad = await fetch(`http://127.0.0.1:${live.port}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'nope' }),
      redirect: 'manual',
    });
    assert.equal(bad.status, 403);
    await gw.stop();
  });

  it('resends the chat snapshot when the browser says ready', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-remote-'));
    fs.writeFileSync(path.join(dir, 'webview.js'), 'window.__grok=1;');
    fs.writeFileSync(path.join(dir, 'chat.css'), 'body{}');
    const gw = new RemoteGateway(
      { webviewJs: path.join(dir, 'webview.js'), chatCss: path.join(dir, 'chat.css') },
      { onClientMessage: () => undefined, snapshot: () => ({ status: 'ready', messages: ['hi'] }) },
    );
    const live = await gw.start(0);
    const paired = await fetch(`http://127.0.0.1:${live.port}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `code=${live.code}`,
      redirect: 'manual',
    });
    const token = new URL(paired.headers.get('location') ?? '', 'http://127.0.0.1').searchParams.get('s') ?? '';
    const session = await openWs(live.port, `/ws?s=${token}`);
    assert.equal(session.status, 101);
    const first = JSON.parse(await session.nextText()) as { type: string; state?: { status?: string } };
    assert.equal(first.type, 'state');
    assert.equal(first.state?.status, 'ready');
    session.sendJson({ type: 'ready' });
    const second = JSON.parse(await session.nextText()) as { type: string; state?: { status?: string } };
    assert.equal(second.type, 'state');
    assert.equal(second.state?.status, 'ready');
    session.socket.destroy();
    await gw.stop();
  });
});

function wsUpgrade(
  port: number,
  pathName: string,
  extraHeaders = '',
): Promise<{ status: number; socket: ReturnType<typeof connect> }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      const key = randomBytes(16).toString('base64');
      socket.write(
        `GET ${pathName} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n${extraHeaders}\r\n`,
      );
    });
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) {
        return;
      }
      const status = Number(buf.subarray(0, idx).toString('utf8').split(' ')[1]);
      socket.removeAllListeners('data');
      resolve({ status, socket });
    });
    socket.on('error', reject);
  });
}

function openWs(
  port: number,
  pathName: string,
): Promise<{
  status: number;
  socket: ReturnType<typeof connect>;
  nextText: () => Promise<string>;
  sendJson: (value: unknown) => void;
}> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      const key = randomBytes(16).toString('base64');
      socket.write(
        `GET ${pathName} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
      );
    });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let status = 0;
    const waiters: Array<(text: string) => void> = [];
    const texts: string[] = [];
    const nextText = () =>
      new Promise<string>((ok, fail) => {
        const timer = setTimeout(() => fail(new Error('websocket text timeout')), 4000);
        const finish = (text: string) => {
          clearTimeout(timer);
          ok(text);
        };
        const hit = texts.shift();
        if (hit !== undefined) {
          finish(hit);
          return;
        }
        waiters.push(finish);
      });
    const sendJson = (value: unknown) => {
      const payload = Buffer.from(JSON.stringify(value));
      const mask = randomBytes(4);
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i += 1) {
        masked[i] = payload[i] ^ mask[i % 4];
      }
      let header: Buffer;
      if (payload.length < 126) {
        header = Buffer.from([0x81, 0x80 | payload.length]);
      } else {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
      }
      socket.write(Buffer.concat([header, mask, masked]));
    };
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) {
          return;
        }
        status = Number(buf.subarray(0, idx).toString('utf8').split(' ')[1]);
        buf = buf.subarray(idx + 4);
        upgraded = true;
        resolve({ status, socket, nextText, sendJson });
      }
      while (true) {
        const frame = readUnmasked(buf);
        if (!frame) {
          break;
        }
        buf = buf.subarray(frame.consumed);
        if (frame.opcode !== 1) {
          continue;
        }
        const waiter = waiters.shift();
        if (waiter) {
          waiter(frame.text);
        } else {
          texts.push(frame.text);
        }
      }
    });
    socket.on('error', reject);
  });
}

function readUnmasked(buf: Buffer): { opcode: number; text: string; consumed: number } | undefined {
  if (buf.length < 2) {
    return undefined;
  }
  const opcode = buf[0] & 0x0f;
  const len7 = buf[1] & 0x7f;
  let offset = 2;
  let len = len7;
  if (len7 === 126) {
    if (buf.length < 4) {
      return undefined;
    }
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len7 === 127) {
    if (buf.length < 10) {
      return undefined;
    }
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  if (buf.length < offset + len) {
    return undefined;
  }
  return { opcode, text: buf.subarray(offset, offset + len).toString('utf8'), consumed: offset + len };
}
