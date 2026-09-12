import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { connect, createServer, type Server, type Socket } from 'node:net';
import {
  DEFAULT_PUBLIC_HOST,
  DEFAULT_RELAY_PORT,
  RELAY_FALLBACK_PORT,
} from './remoteDefaults';
import { DEFAULT_MAX_FILE, DEFAULT_MAX_FRAME, HARD_MAX_FRAME, newHostKey, normalizeIp } from './relayConfig';
import type { TunnelState } from './remoteTunnel';

export {
  DEFAULT_RELAY_PORT,
  RELAY_FALLBACK_PORT,
} from './remoteDefaults';

/** Shared with the built-in VPS process. Same trust model as the bundled SSH key. */
export const BUNDLED_RELAY_TOKEN =
  'gb1.8c2e1a7b4d9f0c6e3a5b7d1f9c4e8a2b6d0f3c5e7a9b1d3f5c7e9a1b3d5f7';
export const SLOT_COOKIE = 'grok_slot';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = HARD_MAX_FRAME;
const MAX_HEADER = 16 * 1024;
const MAX_STREAMS = 64;
const BEAT_MS = 20_000;
const HELLO_MS = 8_000;

const MUX_OPEN = 1;
const MUX_DATA = 2;
const MUX_CLOSE = 3;
const MUX_HELLO = 4;
const MUX_ERROR = 7;

export function advertisedRelayUrl(host: string, port: number, slot: string): string {
  if (!host || !slot) {
    return '';
  }
  const origin = port === 80 ? `http://${host}` : `http://${host}:${port}`;
  return `${origin}/s/${slot}`;
}

export function parseRelaySlot(pathname: string): string | undefined {
  const match = /^\/s\/([A-Za-z0-9_-]{8,24})\/?$/.exec(pathname);
  return match?.[1];
}

/** Path only, including when the request line carries an absolute URL. */
export function requestPath(url: string): string {
  const raw = String(url ?? '').trim().split('?')[0] || '/';
  let path = raw;
  if (raw.includes('://')) {
    try {
      path = new URL(raw).pathname || '/';
    } catch {
      path = raw;
    }
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path.replace(/\/+$/, '') || '/';
}

export function isAdminPath(pathName: string): boolean {
  return pathName === '/admin' || pathName.startsWith('/admin/');
}

export function encodeMux(type: number, id: number, payload = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(9);
  head[0] = type;
  head.writeUInt32BE(id >>> 0, 1);
  head.writeUInt32BE(payload.length, 5);
  return Buffer.concat([head, payload]);
}

export function decodeMux(
  buf: Buffer,
): { type: number; id: number; payload: Buffer; consumed: number } | undefined {
  if (buf.length < 9) {
    return undefined;
  }
  const type = buf[0];
  const id = buf.readUInt32BE(1);
  const len = buf.readUInt32BE(5);
  if (len > MAX_FRAME) {
    return { type: MUX_CLOSE, id, payload: Buffer.alloc(0), consumed: buf.length };
  }
  if (buf.length < 9 + len) {
    return undefined;
  }
  return { type, id, payload: buf.subarray(9, 9 + len), consumed: 9 + len };
}

export interface RelayInfo {
  state: TunnelState;
  error?: string;
  host: string;
  port: number;
  slot?: string;
  publicUrl?: string;
  bundledRelay: boolean;
}

export interface RelayStartOpts {
  host: string;
  localPort: number;
  port?: number;
  token?: string;
  official?: boolean;
}

export class PublicRelay {
  private wanted = false;
  private cfg?: RelayStartOpts;
  private socket?: Socket;
  private ws?: WsConn;
  private state: TunnelState = 'off';
  private error?: string;
  private slot?: string;
  private publicUrl?: string;
  private boundPort = 0;
  private ports: number[] = [];
  private portIndex = 0;
  private delay = 1500;
  private retry?: ReturnType<typeof setTimeout>;
  private helloTimer?: ReturnType<typeof setTimeout>;
  private beat?: ReturnType<typeof setInterval>;
  private muxBuf = Buffer.alloc(0);
  private readonly streams = new Map<number, LocalStream>();
  private readonly listeners = new Set<() => void>();

  info(): RelayInfo {
    return {
      state: this.state,
      error: this.error,
      host: this.cfg?.host ?? '',
      port: this.boundPort,
      slot: this.slot,
      publicUrl: this.publicUrl,
      bundledRelay: this.cfg?.official !== false,
    };
  }

  onChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  start(cfg: RelayStartOpts): void {
    this.cfg = cfg;
    this.wanted = true;
    this.delay = 1500;
    this.ports =
      cfg.port && cfg.port > 0 ? [cfg.port] : [DEFAULT_RELAY_PORT, RELAY_FALLBACK_PORT];
    this.portIndex = 0;
    this.connect();
  }

  stop(): void {
    this.wanted = false;
    this.clearTimers();
    this.drop();
    this.state = 'off';
    this.error = undefined;
    this.slot = undefined;
    this.publicUrl = undefined;
    this.emit();
  }

  private connect(): void {
    this.drop();
    this.clearTimers();
    const cfg = this.cfg;
    if (!this.wanted || !cfg?.host) {
      this.fail('missing-host', false);
      return;
    }
    const port = this.ports[this.portIndex] ?? DEFAULT_RELAY_PORT;
    this.boundPort = port;
    this.state = 'connecting';
    this.error = undefined;
    this.slot = undefined;
    this.publicUrl = undefined;
    this.emit();
    const socket = connect({ host: cfg.host, port });
    this.socket = socket;
    const key = randomBytes(16).toString('base64');
    const token = cfg.token || BUNDLED_RELAY_TOKEN;
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      if (this.socket !== socket) {
        return;
      }
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) {
        if (buf.length > MAX_HEADER) {
          this.fail('network', true);
        }
        return;
      }
      const head = buf.subarray(0, idx).toString('utf8');
      const leftover = buf.subarray(idx + 4);
      socket.removeListener('data', onData);
      const status = Number(head.split(' ')[1]);
      if (status === 401) {
        this.fail('auth', false);
        return;
      }
      if (status !== 101) {
        this.fail('network', true);
        return;
      }
      const ws = new WsConn(socket, true);
      this.ws = ws;
      this.helloTimer = setTimeout(() => {
        this.helloTimer = undefined;
        if (this.ws === ws && this.state === 'connecting') {
          this.fail('relay', true);
        }
      }, HELLO_MS);
      this.helloTimer.unref?.();
      this.startBeat();
      ws.onFrame((opcode, payload) => this.onWsFrame(opcode, payload));
      ws.onClose(() => {
        if (this.ws === ws) {
          this.fail(this.error ?? 'tunnel-closed', true);
        }
      });
      if (leftover.length) {
        ws.push(leftover);
      }
    };
    socket.on('error', (err) => {
      if (this.socket !== socket) {
        return;
      }
      this.onDialError(err);
    });
    socket.on('connect', () => {
      socket.write(
        `GET /host HTTP/1.1\r\nHost: ${cfg.host}:${port}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n` +
          `Authorization: Bearer ${token}\r\n\r\n`,
      );
    });
    socket.on('data', onData);
  }

  private onDialError(err: NodeJS.ErrnoException): void {
    const code = String(err.code ?? err.message);
    if (/ENOTFOUND|EAI_AGAIN/i.test(code)) {
      this.fail('host', false);
      return;
    }
    if (
      /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(code) &&
      this.portIndex + 1 < this.ports.length
    ) {
      this.portIndex += 1;
      this.connect();
      return;
    }
    this.fail('network', true);
  }

  private onWsFrame(opcode: number, payload: Buffer): void {
    if (opcode === 8) {
      this.fail(this.error ?? 'tunnel-closed', true);
      return;
    }
    if (opcode === 9) {
      this.ws?.send(10, payload);
      return;
    }
    if (opcode === 10) {
      return;
    }
    if (opcode !== 2) {
      return;
    }
    this.muxBuf = Buffer.concat([this.muxBuf, payload]);
    while (true) {
      const msg = decodeMux(this.muxBuf);
      if (!msg) {
        break;
      }
      this.muxBuf = this.muxBuf.subarray(msg.consumed);
      this.onMux(msg.type, msg.id, msg.payload);
    }
  }

  private onMux(type: number, id: number, payload: Buffer): void {
    if (type === MUX_HELLO) {
      this.clearHello();
      try {
        const row = JSON.parse(payload.toString('utf8')) as { slot?: string; url?: string };
        this.slot = String(row.slot ?? '');
        this.publicUrl = advertisedRelayUrl(this.cfg?.host ?? '', this.boundPort, this.slot);
        if (!this.slot) {
          this.fail('relay', true);
          return;
        }
        this.state = 'up';
        this.error = undefined;
        this.delay = 1500;
        this.portIndex = Math.max(0, this.ports.indexOf(this.boundPort));
        this.emit();
      } catch {
        this.fail('relay', true);
      }
      return;
    }
    if (type === MUX_ERROR) {
      const code = payload.toString('utf8') || 'relay';
      this.fail(code === 'auth' ? 'auth' : 'relay', code !== 'auth');
      return;
    }
    if (type === MUX_OPEN) {
      this.openLocal(id);
      return;
    }
    if (type === MUX_DATA) {
      const row = this.streams.get(id);
      if (!row) {
        return;
      }
      if (row.ready) {
        row.sock.write(payload);
      } else {
        row.queue.push(payload);
      }
      return;
    }
    if (type === MUX_CLOSE) {
      this.closeLocal(id);
    }
  }

  private openLocal(id: number): void {
    if (this.streams.has(id) || this.streams.size >= MAX_STREAMS) {
      this.sendMux(MUX_CLOSE, id);
      return;
    }
    const port = this.cfg?.localPort ?? 0;
    const sock = connect({ host: '127.0.0.1', port });
    const row: LocalStream = { sock, queue: [], ready: false };
    this.streams.set(id, row);
    sock.on('connect', () => {
      row.ready = true;
      for (const chunk of row.queue.splice(0)) {
        sock.write(chunk);
      }
    });
    sock.on('data', (chunk) => this.sendMux(MUX_DATA, id, chunk));
    const close = (): void => {
      if (!this.streams.delete(id)) {
        return;
      }
      this.sendMux(MUX_CLOSE, id);
    };
    sock.on('close', close);
    sock.on('error', () => {
      close();
      sock.destroy();
    });
  }

  private closeLocal(id: number): void {
    const row = this.streams.get(id);
    this.streams.delete(id);
    row?.sock.destroy();
  }

  private sendMux(type: number, id: number, payload?: Buffer): void {
    this.ws?.send(2, encodeMux(type, id, payload));
  }

  private startBeat(): void {
    this.stopBeat();
    this.beat = setInterval(() => this.ws?.send(9, Buffer.alloc(0)), BEAT_MS);
    this.beat.unref?.();
  }

  private stopBeat(): void {
    if (this.beat) {
      clearInterval(this.beat);
      this.beat = undefined;
    }
  }

  private fail(message: string, retry: boolean): void {
    this.clearTimers();
    this.drop();
    this.state = 'error';
    this.error = message;
    this.emit();
    if (!this.wanted || !retry) {
      return;
    }
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect();
    }, this.delay);
    this.retry.unref?.();
    this.delay = Math.min(30_000, Math.round(this.delay * 1.6));
  }

  private drop(): void {
    this.stopBeat();
    this.clearHello();
    this.muxBuf = Buffer.alloc(0);
    for (const id of [...this.streams.keys()]) {
      this.closeLocal(id);
    }
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    const socket = this.socket;
    this.socket = undefined;
    socket?.destroy();
  }

  private clearHello(): void {
    if (this.helloTimer) {
      clearTimeout(this.helloTimer);
      this.helloTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.clearHello();
    this.stopBeat();
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = undefined;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

interface LocalStream {
  sock: Socket;
  queue: Buffer[];
  ready: boolean;
}

export interface RelayPeer {
  slot: string;
  pluginIp: string;
  browsers: string[];
  since: number;
  kind: 'official' | 'custom';
}

export interface RelayControl {
  port: number;
  publicHost: string;
  maxFrameBytes: number;
  maxFileBytes: number;
  customKeySet: boolean;
  peers(): RelayPeer[];
  kick(ip?: string, slot?: string): number;
  ban(ip: string): void;
  unban(ip: string): void;
  banned(): string[];
  patchSettings(fields: {
    publicHost?: string;
    maxFrameBytes?: number;
    maxFileBytes?: number;
    hostKey?: string;
  }): void;
  rotateHostKey(): string;
}

export interface PublicRelayListener extends RelayControl {
  host: string;
  close(): Promise<void>;
  slots(): string[];
}

type HttpHandler = (
  socket: Socket,
  head: HttpHead,
  leftover: Buffer,
  control: RelayControl,
) => boolean;

export async function listenPublicRelay(opts: {
  port?: number;
  bind?: string;
  token?: string;
  officialToken?: string;
  customToken?: string;
  publicHost: string;
  advertisePort?: number;
  maxFrameBytes?: number;
  maxFileBytes?: number;
  bannedIps?: string[];
  onHttp?: HttpHandler;
}): Promise<PublicRelayListener> {
  const bind = opts.bind ?? '0.0.0.0';
  const wanted = opts.port ?? 0;
  const hosts = new Map<string, HostSession>();
  const sockets = new Set<Socket>();
  const banned = new Set((opts.bannedIps ?? []).map((ip) => normalizeIp(ip)).filter(Boolean));
  const state = {
    publicHost: opts.publicHost,
    officialToken: opts.officialToken || BUNDLED_RELAY_TOKEN,
    customToken: opts.customToken ?? '',
    legacyToken: opts.token ?? '',
    maxFrameBytes: opts.maxFrameBytes ?? DEFAULT_MAX_FRAME,
    maxFileBytes: opts.maxFileBytes ?? DEFAULT_MAX_FILE,
  };
  const control: RelayControl = {
    get port() {
      return livePort(server, wanted);
    },
    get publicHost() {
      return state.publicHost;
    },
    get maxFrameBytes() {
      return state.maxFrameBytes;
    },
    get maxFileBytes() {
      return state.maxFileBytes;
    },
    get customKeySet() {
      return Boolean(state.customToken);
    },
    peers: () => [...hosts.values()].map((row) => row.peer()),
    kick(ip, slot) {
      let n = 0;
      for (const row of [...hosts.values()]) {
        if (slot && row.slot === slot) {
          row.close();
          n += 1;
          continue;
        }
        if (ip && row.dropIp(ip)) {
          n += 1;
        }
      }
      return n;
    },
    ban(ip) {
      const id = normalizeIp(ip);
      if (!id) {
        return;
      }
      banned.add(id);
      control.kick(id);
    },
    unban(ip) {
      banned.delete(normalizeIp(ip));
    },
    banned: () => [...banned],
    patchSettings(fields) {
      if (fields.publicHost?.trim()) {
        state.publicHost = fields.publicHost.trim();
      }
      if (fields.maxFrameBytes) {
        state.maxFrameBytes = fields.maxFrameBytes;
      }
      if (fields.maxFileBytes) {
        state.maxFileBytes = fields.maxFileBytes;
      }
      if (fields.hostKey !== undefined) {
        state.customToken = fields.hostKey;
      }
    },
    rotateHostKey() {
      const next = newHostKey();
      state.customToken = next;
      return next;
    },
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    acceptBrowser(socket, {
      state,
      banned,
      advertisePort: () => opts.advertisePort ?? livePort(server, wanted),
      hosts,
      control,
      onHttp: opts.onHttp,
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(wanted, bind, () => resolve());
  });
  const port = livePort(server, wanted);
  return {
    ...control,
    port,
    host: bind,
    slots: () => [...hosts.keys()],
    close: () =>
      new Promise<void>((resolve) => {
        for (const row of hosts.values()) {
          row.close();
        }
        hosts.clear();
        for (const sock of sockets) {
          sock.destroy();
        }
        server.close(() => resolve());
      }),
  };
}

function livePort(server: Server, fallback: number): number {
  const addr = server.address();
  return addr && typeof addr === 'object' ? addr.port : fallback;
}

function acceptBrowser(
  socket: Socket,
  ctx: {
    state: {
      publicHost: string;
      officialToken: string;
      customToken: string;
      legacyToken: string;
      maxFrameBytes: number;
      maxFileBytes: number;
    };
    banned: Set<string>;
    advertisePort: () => number;
    hosts: Map<string, HostSession>;
    control: RelayControl;
    onHttp?: HttpHandler;
  },
): void {
  const ip = normalizeIp(socket.remoteAddress);
  if (ip && ctx.banned.has(ip)) {
    writeHttp(socket, 403, landingPage(false, '此 IP 已被拉黑。'));
    return;
  }
  let buf = Buffer.alloc(0);
  const onData = (chunk: Buffer): void => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > MAX_HEADER && buf.indexOf('\r\n\r\n') === -1) {
      socket.destroy();
      return;
    }
    const head = parseHttpHead(buf);
    if (!head) {
      return;
    }
    socket.removeListener('data', onData);
    const leftover = buf.subarray(head.raw.length);
    const pathName = requestPath(head.url);
    if (ctx.onHttp?.(socket, head, leftover, ctx.control)) {
      return;
    }
    if (isAdminPath(pathName)) {
      writeHttp(
        socket,
        404,
        landingPage(false, '这台机器还在跑旧版中继。请用新的 grok-web 包替换 relay.js 并重启，再打开 /admin。'),
      );
      return;
    }
    if (pathName === '/host' && isWsUpgrade(head.headers)) {
      upgradeHost(socket, head, leftover, ctx, ip);
      return;
    }
    const pathSlot = parseRelaySlot(pathName);
    if (pathSlot) {
      if (!ctx.hosts.has(pathSlot)) {
        writeHttp(socket, 404, landingPage(true));
        return;
      }
      writeHttp(socket, 302, '', [
        'Location: /',
        `Set-Cookie: ${SLOT_COOKIE}=${pathSlot}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      ]);
      return;
    }
    const cookieSlot = cookieValue(head.headers.cookie, SLOT_COOKIE);
    const session = cookieSlot ? ctx.hosts.get(cookieSlot) : undefined;
    if (!session) {
      writeHttp(socket, 200, pathName === '/' ? homePage() : landingPage(false));
      return;
    }
    session.splice(socket, Buffer.concat([head.raw, leftover]), ip, ctx.state.maxFileBytes);
  };
  socket.on('data', onData);
  socket.on('error', () => socket.destroy());
}

function upgradeHost(
  socket: Socket,
  head: HttpHead,
  leftover: Buffer,
  ctx: {
    state: {
      publicHost: string;
      officialToken: string;
      customToken: string;
      legacyToken: string;
      maxFrameBytes: number;
    };
    advertisePort: () => number;
    hosts: Map<string, HostSession>;
  },
  pluginIp: string,
): void {
  const token = bearerToken(head.headers.authorization) || queryToken(head.url);
  const kind = hostKind(token, ctx.state);
  if (!kind) {
    writeHttp(socket, 401, 'auth');
    return;
  }
  const key = head.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const slot = randomBytes(9).toString('base64url');
  const url = advertisedRelayUrl(ctx.state.publicHost || DEFAULT_PUBLIC_HOST, ctx.advertisePort(), slot);
  const session = new HostSession(slot, socket, pluginIp, kind, ctx.state.maxFrameBytes, () =>
    ctx.hosts.delete(slot),
  );
  ctx.hosts.set(slot, session);
  session.send(MUX_HELLO, 0, Buffer.from(JSON.stringify({ slot, url }), 'utf8'));
  if (leftover.length) {
    session.push(leftover);
  }
}

function hostKind(
  token: string,
  state: { officialToken: string; customToken: string; legacyToken: string },
): 'official' | 'custom' | undefined {
  if (state.legacyToken && tokensEqual(token, state.legacyToken)) {
    return tokensEqual(token, BUNDLED_RELAY_TOKEN) ? 'official' : 'custom';
  }
  if (tokensEqual(token, state.officialToken)) {
    return 'official';
  }
  if (state.customToken && tokensEqual(token, state.customToken)) {
    return 'custom';
  }
  return undefined;
}

class HostSession {
  private readonly ws: WsConn;
  private readonly streams = new Map<number, { sock: Socket; ip: string }>();
  private nextId = 0;
  private muxBuf = Buffer.alloc(0);
  private dead = false;
  readonly since = Date.now();

  constructor(
    readonly slot: string,
    socket: Socket,
    readonly pluginIp: string,
    readonly kind: 'official' | 'custom',
    private readonly maxFrameBytes: number,
    private readonly gone: () => void,
  ) {
    this.ws = new WsConn(socket, false);
    this.ws.onFrame((opcode, payload) => {
      if (opcode === 8) {
        this.close();
        return;
      }
      if (opcode === 9) {
        this.ws.send(10, payload);
        return;
      }
      if (opcode !== 2) {
        return;
      }
      this.muxBuf = Buffer.concat([this.muxBuf, payload]);
      while (true) {
        const msg = decodeMux(this.muxBuf);
        if (!msg) {
          break;
        }
        this.muxBuf = this.muxBuf.subarray(msg.consumed);
        if (msg.payload.length > this.maxFrameBytes) {
          this.send(MUX_CLOSE, msg.id);
          const row = this.streams.get(msg.id);
          this.streams.delete(msg.id);
          row?.sock.destroy();
          continue;
        }
        if (msg.type === MUX_DATA) {
          this.streams.get(msg.id)?.sock.write(msg.payload);
        } else if (msg.type === MUX_CLOSE) {
          const row = this.streams.get(msg.id);
          this.streams.delete(msg.id);
          row?.sock.destroy();
        }
      }
    });
    this.ws.onClose(() => this.close());
  }

  send(type: number, id: number, payload?: Buffer): void {
    this.ws.send(2, encodeMux(type, id, payload));
  }

  push(chunk: Buffer): void {
    this.ws.push(chunk);
  }

  splice(browser: Socket, first: Buffer, ip: string, maxFileBytes: number): void {
    if (this.streams.size >= MAX_STREAMS) {
      browser.destroy();
      return;
    }
    if (httpBodyTooLarge(first, maxFileBytes)) {
      writeHttp(browser, 413, landingPage(false, '文件超过服务端上限。'));
      return;
    }
    const id = (this.nextId += 1);
    this.streams.set(id, { sock: browser, ip });
    this.send(MUX_OPEN, id);
    if (first.length) {
      this.send(MUX_DATA, id, first);
    }
    browser.on('data', (chunk) => this.send(MUX_DATA, id, chunk));
    const close = (): void => {
      if (!this.streams.delete(id)) {
        return;
      }
      this.send(MUX_CLOSE, id);
    };
    browser.on('close', close);
    browser.on('error', () => {
      close();
      browser.destroy();
    });
  }

  peer(): RelayPeer {
    return {
      slot: this.slot,
      pluginIp: this.pluginIp,
      browsers: [...new Set([...this.streams.values()].map((row) => row.ip).filter(Boolean))],
      since: this.since,
      kind: this.kind,
    };
  }

  dropIp(ip: string): boolean {
    const want = normalizeIp(ip);
    if (!want) {
      return false;
    }
    if (this.pluginIp === want) {
      this.close();
      return true;
    }
    let hit = false;
    for (const [id, row] of [...this.streams.entries()]) {
      if (row.ip !== want) {
        continue;
      }
      hit = true;
      this.streams.delete(id);
      row.sock.destroy();
      this.send(MUX_CLOSE, id);
    }
    return hit;
  }

  close(): void {
    if (this.dead) {
      return;
    }
    this.dead = true;
    for (const row of this.streams.values()) {
      row.sock.destroy();
    }
    this.streams.clear();
    this.ws.close();
    this.gone();
  }
}

class WsConn {
  private buf = Buffer.alloc(0);
  private frame?: (opcode: number, payload: Buffer) => void;
  private closed?: () => void;
  private dead = false;

  constructor(
    private readonly socket: Socket,
    private readonly mask: boolean,
  ) {
    socket.on('data', (chunk) => this.push(chunk));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }

  onFrame(fn: (opcode: number, payload: Buffer) => void): void {
    this.frame = fn;
  }

  onClose(fn: () => void): void {
    this.closed = fn;
  }

  push(chunk: Buffer): void {
    if (this.dead) {
      return;
    }
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const frame = readFrame(this.buf);
      if (!frame) {
        break;
      }
      this.buf = this.buf.subarray(frame.consumed);
      this.frame?.(frame.opcode, frame.payload);
    }
  }

  send(opcode: number, payload = Buffer.alloc(0)): void {
    if (this.dead) {
      return;
    }
    try {
      this.socket.write(encodeFrame(opcode, payload, this.mask));
    } catch {
      this.close();
    }
  }

  close(): void {
    if (this.dead) {
      return;
    }
    this.dead = true;
    this.socket.destroy();
    this.closed?.();
  }
}

interface HttpHead {
  method: string;
  url: string;
  headers: Record<string, string>;
  raw: Buffer;
}

function parseHttpHead(buf: Buffer): HttpHead | undefined {
  const idx = buf.indexOf('\r\n\r\n');
  if (idx === -1) {
    return undefined;
  }
  const raw = buf.subarray(0, idx + 4);
  const text = raw.toString('latin1');
  const lines = text.split('\r\n');
  const start = lines[0]?.split(' ') ?? [];
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const cut = line.indexOf(':');
    if (cut > 0) {
      headers[line.slice(0, cut).trim().toLowerCase()] = line.slice(cut + 1).trim();
    }
  }
  return { method: start[0] ?? '', url: start[1] ?? '/', headers, raw };
}

function isWsUpgrade(headers: Record<string, string>): boolean {
  return (headers.upgrade ?? '').toLowerCase() === 'websocket';
}

function bearerToken(raw: string | undefined): string {
  const value = String(raw ?? '');
  const match = /^Bearer\s+(\S+)/i.exec(value);
  return match?.[1] ?? '';
}

function queryToken(url: string): string {
  const cut = url.indexOf('?');
  if (cut < 0) {
    return '';
  }
  return new URLSearchParams(url.slice(cut)).get('token') ?? '';
}

function cookieValue(raw: string | undefined, name: string): string | undefined {
  for (const part of String(raw ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }
  return undefined;
}

function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (!left.length || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function httpBodyTooLarge(buf: Buffer, maxFileBytes: number): boolean {
  const head = parseHttpHead(buf);
  if (!head) {
    return false;
  }
  const n = Number(head.headers['content-length']);
  return Number.isFinite(n) && n > maxFileBytes;
}

function writeHttp(socket: Socket, status: number, body: string, extra: string[] = []): void {
  const reason =
    status === 302
      ? 'Found'
      : status === 401
        ? 'Unauthorized'
        : status === 403
          ? 'Forbidden'
          : status === 404
            ? 'Not Found'
            : status === 413
              ? 'Payload Too Large'
              : 'OK';
  const payload = Buffer.from(body, 'utf8');
  const headers = [
    `HTTP/1.1 ${status} ${reason}`,
    'Content-Type: text/html; charset=utf-8',
    `Content-Length: ${payload.length}`,
    'Connection: close',
    ...extra,
    '',
    '',
  ].join('\r\n');
  socket.end(Buffer.concat([Buffer.from(headers, 'utf8'), payload]));
}

function homePage(): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Grok Web</title>
<style>
:root{color-scheme:dark}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100dvh}
main{width:min(440px,92vw)}h1{font-size:1.35rem;margin:0 0 10px}p{color:#9aa;margin:0 0 16px}
a{display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;padding:8px 14px}
</style></head>
<body><main>
<h1>Grok Web</h1>
<p>这是公网中转服务。管理这台服务器请打开控制面板。对话请用插件复制的地址（带 /s/…），并输入授权码。</p>
<p><a href="/admin">打开控制面板</a></p>
</main></body></html>`;
}

function landingPage(missing: boolean, hintOverride?: string): string {
  const title = missing ? '会话不在线' : 'Grok Build';
  const hint =
    hintOverride ??
    (missing
      ? '这套插件已经关掉公网，或地址已失效。请让对方重新打开「公网开放」再发一次地址。'
      : '请使用插件里复制的公网地址打开，并输入授权码。');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title>
<style>body{font:15px/1.45 system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100dvh;margin:0}main{width:min(420px,92vw)}h1{font-size:1.25rem;margin:0 0 12px}p{color:#aaa}</style></head>
<body><main><h1>${title}</h1><p>${hint}</p></main></body></html>`;
}

function encodeFrame(opcode: number, payload: Buffer, mask: boolean): Buffer {
  const maskKey = mask ? randomBytes(4) : undefined;
  const data = maskKey ? Buffer.from(payload) : payload;
  if (maskKey) {
    for (let i = 0; i < data.length; i += 1) {
      data[i] ^= maskKey[i & 3];
    }
  }
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = (mask ? 0x80 : 0) | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = (mask ? 0x80 : 0) | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = (mask ? 0x80 : 0) | 127;
    header.writeUInt32BE(Math.floor(len / 0x100000000), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  return maskKey ? Buffer.concat([header, maskKey, data]) : Buffer.concat([header, data]);
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
