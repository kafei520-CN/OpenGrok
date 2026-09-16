import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Socket } from 'node:net';
import type { WebviewToHost } from '../core/types';
import { packDelivery, packRemotePayload } from './remoteState';

export const DEFAULT_REMOTE_PORT = 8787;
/** Keep the pairing token after a drop so the same browser can reconnect. */
export const TOKEN_GRACE_MS = 45_000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 8 * 1024 * 1024;
const MAX_CLIENTS = 1;
const COOKIE = 'grok_sess';
const BEAT_MS = 20_000;

export interface RemoteAssets {
  webviewJs: string;
  chatCss: string;
  diffJs?: string;
  diffCss?: string;
  symbol?: string;
  monacoDir?: string;
  shikiMonacoJs?: string;
}

export type RemoteBindHost = '0.0.0.0' | '127.0.0.1';

export interface RemoteStartOpts {
  local?: boolean;
  public?: boolean;
  publicUrl?: string;
}

export interface RemoteInfo {
  running: boolean;
  port: number;
  bind: RemoteBindHost;
  local: boolean;
  public: boolean;
  code: string;
  codeMode: RemotePairMode;
  localCode?: string;
  publicUrl: string;
  urls: string[];
  clients: number;
  error?: string;
}

export interface RemoteHandlers {
  onClientMessage: (message: WebviewToHost) => void;
  snapshot: () => unknown;
  onClients?: () => void;
}

export function clampRemotePort(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(n)) {
    return DEFAULT_REMOTE_PORT;
  }
  if (n === 0) {
    return 0;
  }
  return Math.max(1024, Math.min(65535, n));
}

export type RemotePairMode = 'random' | 'custom';

export function generatePairCode(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

/** Custom pairing secret: 4–64 chars, no control characters. */
export function sanitizeRemoteSecret(raw: unknown): string {
  const text = String(raw ?? '')
    .replace(/[\r\n\0]/g, '')
    .trim();
  if (text.length < 4 || text.length > 64) {
    return '';
  }
  return text;
}

export function lanUrls(port: number): string[] {
  const urls = [`http://127.0.0.1:${port}`];
  for (const rows of Object.values(os.networkInterfaces())) {
    for (const row of rows ?? []) {
      if (row.internal || (row.family !== 'IPv4' && row.family !== 4)) {
        continue;
      }
      urls.push(`http://${row.address}:${port}`);
    }
  }
  return [...new Set(urls)];
}

/** Host header used in CSP connect-src. Safari ignores a bare `ws:` scheme. */
export function safeCspHost(raw: unknown): string {
  const host = String(raw ?? '').trim();
  if (/^(\[[0-9A-Fa-f:.]+\]|\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9.-]+)(?::\d{1,5})?$/.test(host)) {
    return host;
  }
  return '127.0.0.1';
}

/** LAN listens on every interface. Public-only listens on loopback for SSH/frp. */
export function remoteBindHost(local: boolean): RemoteBindHost {
  return local ? '0.0.0.0' : '127.0.0.1';
}

export function normalizePublicUrl(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text.includes('://') ? text : `http://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    return url.origin;
  } catch {
    return '';
  }
}

export function resolveRemoteAssets(fromFile = __dirname): RemoteAssets {
  const env = process.env.GROK_REMOTE_ASSETS?.trim();
  if (env && fs.existsSync(path.join(env, 'webview.js'))) {
    const monacoDir = path.join(env, 'monaco');
    return {
      webviewJs: path.join(env, 'webview.js'),
      chatCss: path.join(env, 'chat.css'),
      diffJs: path.join(env, 'diff.js'),
      diffCss: path.join(env, 'diff.css'),
      symbol: path.join(env, 'grok-symbol.png'),
      ...(fs.existsSync(path.join(monacoDir, 'vs', 'loader.js')) ? { monacoDir } : {}),
      ...(fs.existsSync(path.join(env, 'shiki-monaco.js'))
        ? { shikiMonacoJs: path.join(env, 'shiki-monaco.js') }
        : {}),
    };
  }
  const dir = path.dirname(fromFile);
  const root = path.basename(dir) === 'dist' ? path.join(dir, '..') : dir;
  const monacoDir = path.join(dir, 'monaco');
  const shikiMonacoJs = path.join(dir, 'shiki-monaco.js');
  return {
    webviewJs: path.join(dir, 'webview.js'),
    chatCss: path.join(root, 'media', 'chat.css'),
    diffJs: path.join(dir, 'diff.js'),
    diffCss: path.join(root, 'media', 'diff.css'),
    symbol: path.join(root, 'media', 'grok-symbol.png'),
    ...(fs.existsSync(path.join(monacoDir, 'vs', 'loader.js')) ? { monacoDir } : {}),
    ...(fs.existsSync(shikiMonacoJs) ? { shikiMonacoJs } : {}),
  };
}

export class RemoteGateway {
  private server?: Server;
  private readonly tokens = new Map<string, { kind: 'local' | 'public' }>();
  private readonly sockets = new Set<Socket>();
  private readonly socketToken = new Map<Socket, string>();
  private code = '';
  private pairMode: RemotePairMode = 'random';
  private localOn = false;
  private publicOn = false;
  private publicUrl = '';
  private port = DEFAULT_REMOTE_PORT;
  private bind: RemoteBindHost = '127.0.0.1';
  private fails = 0;
  private failReset?: ReturnType<typeof setTimeout>;
  private tokenGrace?: ReturnType<typeof setTimeout>;
  private beat?: ReturnType<typeof setInterval>;
  private error?: string;
  private readonly unsub: Array<{ dispose(): void }> = [];

  constructor(
    private readonly assets: RemoteAssets,
    private readonly handlers: RemoteHandlers,
  ) {}

  info(): RemoteInfo {
    const urls: string[] = [];
    if (this.localOn && this.server?.listening) {
      urls.push(...lanUrls(this.port));
    }
    if (this.publicOn && this.publicUrl) {
      urls.push(this.publicUrl);
    }
    return {
      running: Boolean(this.server?.listening),
      port: this.port,
      bind: this.bind,
      local: this.localOn,
      public: this.publicOn,
      code: this.code,
      codeMode: this.pairMode,
      localCode: this.localOn ? this.code : undefined,
      publicUrl: this.publicUrl,
      urls: [...new Set(urls)],
      clients: this.sockets.size,
      error: this.error,
    };
  }

  async start(port = DEFAULT_REMOTE_PORT, opts: RemoteStartOpts = {}): Promise<RemoteInfo> {
    return this.apply({
      port,
      local: opts.local ?? true,
      public: opts.public ?? false,
      publicUrl: opts.publicUrl,
    });
  }

  async apply(opts: {
    port?: number;
    local: boolean;
    public: boolean;
    publicUrl?: string;
  }): Promise<RemoteInfo> {
    if (!opts.local && !opts.public) {
      await this.stop();
      return this.info();
    }
    if (opts.publicUrl !== undefined) {
      this.publicUrl = normalizePublicUrl(opts.publicUrl);
    }
    const port = clampRemotePort(opts.port ?? this.port);
    const bind = remoteBindHost(opts.local);
    if (!this.code && this.pairMode !== 'custom') {
      this.code = generatePairCode();
    }
    this.localOn = opts.local;
    this.publicOn = opts.public;
    const rebound = !this.server?.listening || this.port !== port || this.bind !== bind;
    if (rebound) {
      await this.listen(port, bind);
    }
    return this.info();
  }

  private async listen(port: number, bind: RemoteBindHost): Promise<void> {
    await this.closeServer();
    this.port = port;
    this.bind = bind;
    this.error = undefined;
    const server = createServer((req, res) => {
      void this.http(req, res);
    });
    server.on('upgrade', (req, socket) => this.upgrade(req, socket as Socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', (err) => {
        this.error = err.message;
        reject(err);
      });
      server.listen(this.port, bind, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const d of this.unsub.splice(0)) {
      d.dispose();
    }
    this.dropAllSessions();
    this.localOn = false;
    this.publicOn = false;
    this.code = '';
    if (this.failReset) {
      clearTimeout(this.failReset);
      this.failReset = undefined;
    }
    this.clearTokenGrace();
    this.stopBeat();
    this.fails = 0;
    await this.closeServer();
    this.error = undefined;
  }

  private async closeServer(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  rotateCode(): string {
    this.dropAllSessions();
    this.pairMode = 'random';
    this.code = generatePairCode();
    return this.code;
  }

  setPairSecret(code: string, mode: RemotePairMode): void {
    const next = mode === 'custom' ? sanitizeRemoteSecret(code) : String(code ?? '').trim();
    if (this.pairMode === mode && this.code === next) {
      return;
    }
    this.dropAllSessions();
    this.pairMode = mode;
    this.code = next;
  }

  broadcast(payload: unknown): void {
    if (!this.sockets.size) {
      return;
    }
    const frames = packDelivery(payload);
    for (const sock of this.sockets) {
      sendPacked(sock, frames);
    }
  }

  attach(listener: { dispose(): void }): void {
    this.unsub.push(listener);
  }

  private dropAllSessions(): void {
    this.clearTokenGrace();
    this.stopBeat();
    for (const sock of this.sockets) {
      sock.destroy();
    }
    this.sockets.clear();
    this.socketToken.clear();
    this.tokens.clear();
  }

  private scheduleTokenGrace(): void {
    this.clearTokenGrace();
    this.tokenGrace = setTimeout(() => {
      this.tokenGrace = undefined;
      if (this.sockets.size === 0) {
        this.tokens.clear();
      }
    }, TOKEN_GRACE_MS);
    this.tokenGrace.unref?.();
  }

  private clearTokenGrace(): void {
    if (this.tokenGrace) {
      clearTimeout(this.tokenGrace);
      this.tokenGrace = undefined;
    }
  }

  private startBeat(): void {
    if (this.beat) {
      return;
    }
    this.beat = setInterval(() => {
      for (const sock of [...this.sockets]) {
        try {
          sock.write(Buffer.from([0x89, 0x00]));
        } catch {
          sock.destroy();
        }
      }
    }, BEAT_MS);
    this.beat.unref?.();
  }

  private stopBeat(): void {
    if (!this.beat) {
      return;
    }
    clearInterval(this.beat);
    this.beat = undefined;
  }

  private dropToken(token: string): void {
    this.tokens.delete(token);
    for (const [sock, tied] of [...this.socketToken]) {
      if (tied === token) {
        this.socketToken.delete(sock);
        this.sockets.delete(sock);
        sock.destroy();
      }
    }
  }

  private pairHtml(req: IncomingMessage): string {
    return pairPage(zh(req), this.pairMode === 'custom');
  }

  private matchCode(input: string): { kind: 'local' | 'public' } | undefined {
    const guess = input.trim();
    if (!this.code || !guess || !codesEqual(guess, this.code)) {
      return undefined;
    }
    return { kind: this.publicOn ? 'public' : 'local' };
  }

  private async http(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/ping') {
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/pair') {
      this.pair(req, res);
      return;
    }
    if (url.pathname.startsWith('/monaco/')) {
      this.monacoFile(res, url.pathname);
      return;
    }
    if (url.pathname === '/shiki-monaco.js' && this.assets.shikiMonacoJs) {
      this.file(res, this.assets.shikiMonacoJs, 'application/javascript; charset=utf-8', true);
      return;
    }
    if (url.pathname === '/webview.js') {
      this.file(res, this.assets.webviewJs, 'application/javascript; charset=utf-8');
      return;
    }
    if (url.pathname === '/chat.css') {
      this.file(res, this.assets.chatCss, 'text/css; charset=utf-8');
      return;
    }
    if (url.pathname === '/surfaces.css') {
      this.file(
        res,
        path.join(path.dirname(this.assets.chatCss), 'surfaces.css'),
        'text/css; charset=utf-8',
      );
      return;
    }
    if (url.pathname === '/border-glow.css') {
      this.file(
        res,
        path.join(path.dirname(this.assets.chatCss), 'border-glow.css'),
        'text/css; charset=utf-8',
      );
      return;
    }
    if (url.pathname === '/option-wheel.css') {
      this.file(
        res,
        path.join(path.dirname(this.assets.chatCss), 'option-wheel.css'),
        'text/css; charset=utf-8',
      );
      return;
    }
    if (url.pathname === '/diff.js' && this.assets.diffJs) {
      this.file(res, this.assets.diffJs, 'application/javascript; charset=utf-8');
      return;
    }
    if (url.pathname === '/diff.css' && this.assets.diffCss) {
      this.file(res, this.assets.diffCss, 'text/css; charset=utf-8');
      return;
    }
    if (url.pathname === '/diff.html' || url.pathname === '/diff') {
      if (!this.authed(req)) {
        this.html(res, this.pairHtml(req));
        return;
      }
      this.html(res, diffPage());
      return;
    }
    if (url.pathname === '/grok-symbol.png' && this.assets.symbol) {
      this.file(res, this.assets.symbol, 'image/png');
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const token = this.sessionToken(req, url);
      if (!token) {
        this.html(res, this.pairHtml(req));
        return;
      }
      this.html(res, chatPage(token, safeCspHost(req.headers.host), zh(req), hostChromeFrom(this.handlers.snapshot())));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }

  private pair(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (this.fails >= 8) {
        res.writeHead(429);
        res.end('too many attempts');
        return;
      }
      const already = this.sessionToken(req);
      if (already) {
        sendPairRedirect(res, already);
        return;
      }
      let code = '';
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const json = JSON.parse(raw) as { code?: string };
        code = String(json.code ?? '').trim();
      } catch {
        code = (new URLSearchParams(raw).get('code') ?? '').trim();
      }
      const matched = this.matchCode(code);
      if (matched && (this.sockets.size >= 1 || this.tokens.size >= 1)) {
        res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(zh(req) ? '已有人在线，一个插件只允许一个连接。' : 'Already in use. One plugin allows one connection.');
        return;
      }
      if (!matched) {
        this.fails += 1;
        if (!this.failReset) {
          this.failReset = setTimeout(() => {
            this.fails = 0;
            this.failReset = undefined;
          }, 10 * 60_000);
          this.failReset.unref?.();
        }
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('bad code');
        return;
      }
      const token = randomBytes(24).toString('hex');
      this.tokens.set(token, matched);
      sendPairRedirect(res, token);
    });
  }

  private sessionToken(req: IncomingMessage, url?: URL): string | undefined {
    const fromCookie = cookie(req, COOKIE);
    if (fromCookie && this.tokens.has(fromCookie)) {
      return fromCookie;
    }
    let parsed = url;
    if (!parsed) {
      try {
        parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      } catch {
        return undefined;
      }
    }
    const q = parsed.searchParams.get('s') ?? '';
    return q && this.tokens.has(q) ? q : undefined;
  }

  private authed(req: IncomingMessage): boolean {
    return Boolean(this.sessionToken(req));
  }

  private upgrade(req: IncomingMessage, socket: Socket): void {
    const pathName = (req.url ?? '/').split('?')[0];
    if (pathName !== '/ws') {
      socket.destroy();
      return;
    }
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !this.authed(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const incoming = this.sessionToken(req);
    if (this.sockets.size >= MAX_CLIENTS) {
      let replaced = false;
      if (incoming) {
        for (const [old, tied] of [...this.socketToken]) {
          if (tied === incoming) {
            this.socketToken.delete(old);
            this.sockets.delete(old);
            old.destroy();
            replaced = true;
          }
        }
      }
      if (!replaced && this.sockets.size >= MAX_CLIENTS) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    if (incoming) {
      this.socketToken.set(socket, incoming);
    }
    this.clearTokenGrace();
    this.sockets.add(socket);
    this.startBeat();
    this.handlers.onClients?.();
    sendPacked(socket, packRemotePayload({ type: 'state', state: this.handlers.snapshot() }));
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const frame = readFrame(buf);
        if (!frame) {
          break;
        }
        buf = buf.subarray(frame.consumed);
        if (frame.opcode === 8) {
          socket.destroy();
          return;
        }
        if (frame.opcode === 9) {
          sendPong(socket, frame.payload);
          continue;
        }
        if (frame.opcode !== 1) {
          continue;
        }
        try {
          const msg = JSON.parse(frame.payload.toString('utf8')) as WebviewToHost;
          if (msg && typeof msg.type === 'string') {
            if (msg.type === 'ready') {
              sendPacked(socket, packRemotePayload({ type: 'state', state: this.handlers.snapshot() }));
            }
            this.handlers.onClientMessage(msg);
          }
        } catch {
          /* ignore bad client json */
        }
      }
    });
    const drop = (): void => {
      this.socketToken.delete(socket);
      if (this.sockets.delete(socket)) {
        if (this.sockets.size === 0) {
          this.stopBeat();
          this.scheduleTokenGrace();
        }
        this.handlers.onClients?.();
      }
    };
    socket.on('close', drop);
    socket.on('error', () => {
      drop();
      socket.destroy();
    });
  }

  private monacoFile(res: ServerResponse, pathname: string): void {
    const root = this.assets.monacoDir;
    if (!root) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    const rel = pathname.replace(/^\/monaco\/?/, '');
    if (!rel || rel.includes('\0') || rel.split(/[/\\]/).includes('..')) {
      res.writeHead(400);
      res.end('bad path');
      return;
    }
    const abs = path.resolve(root, rel);
    const base = path.resolve(root);
    const inside = abs === base || abs.startsWith(`${base}${path.sep}`);
    if (!inside) {
      res.writeHead(400);
      res.end('bad path');
      return;
    }
    this.file(res, abs, monacoType(abs), true);
  }

  private file(res: ServerResponse, file: string, type: string, cache = false): void {
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('missing');
        return;
      }
      res.writeHead(200, {
        'content-type': type,
        'cache-control': cache ? 'public, max-age=86400' : 'no-store',
      });
      res.end(data);
    });
  }

  private html(res: ServerResponse, body: string): void {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  }
}

function monacoType(file: string): string {
  if (file.endsWith('.js')) {
    return 'application/javascript; charset=utf-8';
  }
  if (file.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (file.endsWith('.ttf')) {
    return 'font/ttf';
  }
  if (file.endsWith('.woff')) {
    return 'font/woff';
  }
  if (file.endsWith('.woff2')) {
    return 'font/woff2';
  }
  return 'application/octet-stream';
}

function codesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a.trim());
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return undefined;
}

function sendPairRedirect(res: ServerResponse, token: string): void {
  res.writeHead(302, {
    Location: `/?s=${token}`,
    'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
  });
  res.end();
}

function zh(req: IncomingMessage): boolean {
  return (req.headers['accept-language'] ?? '').toLowerCase().includes('zh');
}

function pairPage(chinese: boolean, custom: boolean): string {
  const title = chinese ? 'Grok 远程校验' : 'Grok remote pair';
  const hint = custom
    ? chinese
      ? '浏览器会连到本机工作区并可以改文件、跑命令。只把密码给信任的人。'
      : 'This browser session can edit the workspace and run commands. Share the password only with people you trust.'
    : chinese
      ? '浏览器会连到本机工作区并可以改文件、跑命令。只把校验码给信任的人。'
      : 'This browser session can edit the workspace and run commands. Share the code only with people you trust.';
  const label = custom
    ? chinese
      ? '密码'
      : 'Password'
    : chinese
      ? '校验码'
      : 'Pairing code';
  const go = chinese ? '进入' : 'Enter';
  const failNet = JSON.stringify(chinese ? '连不上，请稍后重试。' : 'Could not reach the plugin.');
  const field = custom
    ? '<input name="code" type="password" autocomplete="current-password" maxlength="64" required autofocus/>'
    : '<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required autofocus/>';
  const inputCss = custom
    ? 'letter-spacing:normal;text-align:left'
    : 'letter-spacing:.28em;text-align:center';
  return `<!DOCTYPE html><html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="UTF-8"/>${noZoomMeta()}<title>${title}</title>
<style>html,body{touch-action:manipulation;-webkit-text-size-adjust:100%}body{font:15px/1.45 system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100dvh;margin:0}form{width:min(360px,92vw);display:grid;gap:12px}h1{font-size:1.25rem;margin:0}input{font:inherit;padding:12px;border-radius:12px;border:1px solid #444;background:#1c1c1c;color:#fff;${inputCss}}button{font:inherit;padding:12px;border:0;border-radius:12px;background:#b9d4ff;color:#111;cursor:pointer}p,#err{color:#aaa}#err{color:#f85149;min-height:1.2em}</style></head>
<body><form method="post" action="/pair"><h1>${title}</h1><p>${hint}</p><label>${label}${field}</label><p id="err"></p><button type="submit">${go}</button></form>
${noZoomScript()}
<script>
document.querySelector('form').addEventListener('submit', function(ev) {
  ev.preventDefault();
  var input = document.querySelector('input[name=code]');
  var err = document.getElementById('err');
  err.textContent = '';
  fetch('/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: input.value }), credentials: 'same-origin' })
    .then(function(res) {
      if (res.ok || res.redirected || res.status === 302 || res.status === 0 || res.type === 'opaqueredirect') {
        var next = '/';
        try {
          var u = new URL(res.url || '/', location.href);
          if (u.searchParams.get('s')) next = u.pathname + u.search;
        } catch (e) {}
        location.replace(next);
        return;
      }
      return res.text().then(function(text) {
        var msg = String(text || '').trim();
        err.textContent = msg && msg !== '0' ? msg : String(res.status || ${failNet});
      });
    })
    .catch(function() { err.textContent = ${failNet}; });
});
</script>
</body></html>`;
}

function noZoomMeta(): string {
  return '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover"/>';
}

function noZoomScript(): string {
  return `<script>
(function(){
  function stop(e){ e.preventDefault(); }
  document.addEventListener('gesturestart', stop, {passive:false});
  document.addEventListener('gesturechange', stop, {passive:false});
  document.addEventListener('gestureend', stop, {passive:false});
  document.addEventListener('touchmove', function(e){ if (e.touches && e.touches.length > 1) e.preventDefault(); }, {passive:false});
  document.addEventListener('wheel', function(e){ if (e.ctrlKey) e.preventDefault(); }, {passive:false});
})();
</script>`;
}

function hostChromeFrom(snapshot: unknown): { background?: string; foreground?: string } | undefined {
  if (!snapshot || typeof snapshot !== 'object') {
    return undefined;
  }
  const row = snapshot as {
    hostChrome?: { background?: string; foreground?: string };
    theme?: { background?: string };
  };
  return {
    background: row.hostChrome?.background ?? row.theme?.background,
    foreground: row.hostChrome?.foreground,
  };
}

function hostChromeStyle(chrome?: { background?: string; foreground?: string }): string {
  const hex = (raw: string | undefined, fallback: string): string =>
    raw && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
  const bg = hex(chrome?.background, '#1e1e1e');
  const fg = hex(chrome?.foreground, '#e8e8e8');
  return `<style id="grok-host-chrome">:root{--vscode-sideBar-background:${bg};--vscode-foreground:${fg};--bg:${bg};--fg:${fg};}</style>`;
}

function chatPage(
  token: string,
  host: string,
  chinese: boolean,
  chrome?: { background?: string; foreground?: string },
): string {
  const wsPath = `/ws?s=${encodeURIComponent(token)}`;
  const csp =
    `default-src 'none'; img-src data: blob: https: http:; media-src blob: http: https:; ` +
    `style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; ` +
    `font-src 'self' data:; worker-src 'self' blob:; ` +
    `connect-src 'self' http://${host} https://${host} ws://${host} wss://${host} ws: wss: http: https:`;
  const lang = chinese ? 'zh-CN' : 'en';
  const stalled = JSON.stringify(
    chinese
      ? '页面开了，但会话通道没连上。请刷新后重新输入校验码。'
      : 'The page loaded, but the session channel did not. Refresh and pair again.',
  );
  const reconnecting = JSON.stringify(
    chinese ? '连接中断，正在重连…' : 'Connection lost, reconnecting…',
  );
  const giveUp = JSON.stringify(
    chinese
      ? '会话通道已断开。请刷新后重新输入校验码。'
      : 'The session channel dropped. Refresh and pair again.',
  );
  return `<!DOCTYPE html>
<html lang="${lang}" class="remote-web"><head>
<meta charset="UTF-8"/>
${noZoomMeta()}
<meta name="color-scheme" content="dark light"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<link rel="stylesheet" href="/chat.css"/>
<link rel="stylesheet" href="/surfaces.css"/>
<link rel="stylesheet" href="/border-glow.css"/>
<link rel="stylesheet" href="/option-wheel.css"/>
${hostChromeStyle(chrome)}
<title>Grok Build</title>
</head><body>
<div id="app"></div>
${noZoomScript()}
<script>
window.acquireVsCodeApi = function() {
  if (window.__grokApi) return window.__grokApi;
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var path = ${JSON.stringify(wsPath)};
  var ws;
  var queue = [];
  var inbox = [];
  var primed = false;
  var opened = false;
  var failStreak = 0;
  var retryTimer;
  var state;
  try { state = JSON.parse(sessionStorage.getItem('grok-ui') || 'null'); } catch (e) {}
  function banner(text) {
    var el = document.getElementById('grok-link-banner');
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'grok-link-banner';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
  }
  function retry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function() { retryTimer = 0; open(); }, opened ? 800 : 1500);
  }
  function stripToken() {
    try { if (/[?&]s=/.test(location.search)) history.replaceState(null, '', location.pathname); } catch (e) {}
  }
  function dispatchHost(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return; }
    if (typeof window.__grokDeliver === 'function') {
      try { window.__grokDeliver(data); } catch (e) {}
      return;
    }
    try {
      window.dispatchEvent(new MessageEvent('message', { data: data, origin: location.origin }));
    } catch (e) {}
  }
  function deliver(raw) {
    var go = function(text) {
      if (!primed) { inbox.push(text); return; }
      dispatchHost(text);
    };
    if (typeof raw === 'string') go(raw);
    else if (raw && typeof raw.text === 'function') raw.text().then(go).catch(function() {});
  }
  function bind(sock) {
    sock.onmessage = function(ev) { deliver(ev.data); };
    sock.onopen = function() {
      opened = true;
      failStreak = 0;
      banner('');
      stripToken();
      while (queue.length) sock.send(JSON.stringify(queue.shift()));
    };
    sock.onerror = function() { try { sock.close(); } catch (e) {} };
    sock.onclose = function() {
      failStreak += 1;
      if (!opened) {
        var app = document.getElementById('app');
        if (app && !document.getElementById('grok-header')) {
          app.textContent = ${stalled};
        }
      } else if (failStreak >= 4) {
        banner(${giveUp});
      } else {
        banner(${reconnecting});
      }
      retry();
    };
  }
  function open() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    ws = new WebSocket(proto + '//' + location.host + path);
    bind(ws);
  }
  window.__grokPrime = function() {
    primed = true;
    var held = inbox.splice(0, inbox.length);
    for (var i = 0; i < held.length; i++) dispatchHost(held[i]);
    open();
  };
  window.__grokApi = {
    postMessage: function(msg) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
      else queue.push(msg);
    },
    getState: function() { return state; },
    setState: function(next) {
      state = next;
      try { sessionStorage.setItem('grok-ui', JSON.stringify(next)); } catch (e) {}
    }
  };
  return window.__grokApi;
};
</script>
<script src="/webview.js"></script>
</body></html>`;
}

function diffPage(): string {
  return `<!DOCTYPE html>
<html lang="en" class="remote-web"><head>
<meta charset="UTF-8"/>
${noZoomMeta()}
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';"/>
<link rel="stylesheet" href="/diff.css"/>
<title>Grok Diff</title>
</head><body>
<div id="app"></div>
${noZoomScript()}
<script>
window.acquireVsCodeApi = function() {
  if (window.__grokDiffApi) return window.__grokDiffApi;
  window.__grokDiffApi = {
    postMessage: function(msg) {
      parent.postMessage({ source: 'grok-diff', message: msg }, '*');
    }
  };
  return window.__grokDiffApi;
};
window.addEventListener('message', function(ev) {
  if (ev.data && ev.data.type === 'diff') {
    window.dispatchEvent(new MessageEvent('message', { data: ev.data }));
  }
});
</script>
<script src="/diff.js"></script>
</body></html>`;
}

function sendPacked(socket: Socket, frames: string[]): void {
  for (const frame of frames) {
    sendText(socket, frame);
  }
}

function sendText(socket: Socket, text: string): void {
  const payload = Buffer.from(text);
  socket.write(Buffer.concat([wsHeader(1, payload.length), payload]));
}

function sendPong(socket: Socket, payload: Buffer): void {
  socket.write(Buffer.concat([wsHeader(10, payload.length), payload]));
}

function wsHeader(opcode: number, len: number): Buffer {
  if (len < 126) {
    const h = Buffer.alloc(2);
    h[0] = 0x80 | opcode;
    h[1] = len;
    return h;
  }
  if (len < 65536) {
    const h = Buffer.alloc(4);
    h[0] = 0x80 | opcode;
    h[1] = 126;
    h.writeUInt16BE(len, 2);
    return h;
  }
  const h = Buffer.alloc(10);
  h[0] = 0x80 | opcode;
  h[1] = 127;
  h.writeUInt32BE(Math.floor(len / 0x100000000), 2);
  h.writeUInt32BE(len >>> 0, 6);
  return h;
}

function readFrame(buf: Buffer): { consumed: number; opcode: number; payload: Buffer } | undefined {
  if (buf.length < 2) {
    return undefined;
  }
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) {
      return undefined;
    }
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) {
      return undefined;
    }
    len = buf.readUInt32BE(6);
    offset = 10;
  }
  if (len > MAX_FRAME) {
    return { consumed: buf.length, opcode: 8, payload: Buffer.alloc(0) };
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) {
    return undefined;
  }
  let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    const copy = Buffer.from(payload);
    for (let i = 0; i < copy.length; i += 1) {
      copy[i] ^= mask[i & 3];
    }
    payload = copy;
  }
  return { consumed: offset + maskLen + len, opcode, payload };
}
