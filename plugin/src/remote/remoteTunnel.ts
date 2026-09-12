import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AUTO_FORWARD_MAX,
  AUTO_FORWARD_MIN,
  DEFAULT_FORWARD_PORT,
  DEFAULT_PUBLIC_HOST,
  DEFAULT_PUBLIC_USER,
  DEFAULT_RELAY_PORT,
  DEFAULT_SSH_PORT,
} from './remoteDefaults';
import { randomBytes } from 'node:crypto';

export {
  AUTO_FORWARD_MAX,
  AUTO_FORWARD_MIN,
  DEFAULT_FORWARD_PORT,
  DEFAULT_PUBLIC_HOST,
  DEFAULT_PUBLIC_USER,
  DEFAULT_SSH_PORT,
} from './remoteDefaults';

export type TunnelState = 'off' | 'connecting' | 'up' | 'error';

export interface TunnelConfig {
  host: string;
  user: string;
  sshPort: number;
  remotePort: number;
  localPort: number;
}

export interface TunnelInfo {
  state: TunnelState;
  error?: string;
  host: string;
  user: string;
  sshPort: number;
  remotePort: number;
  sshPublicKey?: string;
  bundledRelay?: boolean;
}

const AUTH_FAIL = /permission denied \(publickey|permission denied \(publickey,password|too many authentication/i;
const HOST_KEY_FAIL =
  /host key verification failed|remote host identification has changed|no matching host key type|no matching host key/i;
const KEY_FILE_FAIL = /invalid format|unprotected private key|bad permissions|error loading key|load key/i;
const BAD_HOST = /could not resolve hostname|name or service not known/i;
const BAD_STRICT = /bad configuration option.*stricthostkeychecking|invalid strict host key/i;

export function parseRelayEndpoint(raw: unknown): { host: string; port: number } {
  const text = String(raw ?? '').trim();
  let host = '';
  let port = DEFAULT_RELAY_PORT;
  try {
    if (/^https?:\/\//i.test(text)) {
      const url = new URL(text);
      host = url.hostname;
      if (url.port) {
        port = Number(url.port);
      }
    } else {
      const first = (text.split('/')[0] ?? text).trim();
      const tagged = /^(.+):(\d{1,5})$/.exec(first);
      if (tagged) {
        host = tagged[1] ?? '';
        port = Number(tagged[2]);
      } else {
        host = first;
      }
    }
  } catch {
    host = '';
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    port = DEFAULT_RELAY_PORT;
  }
  return { host: sanitizeTunnelHost(host), port };
}

export function sanitizeTunnelHost(raw: unknown): string {
  let text = String(raw ?? '').trim();
  if (!text) {
    return '';
  }
  try {
    if (/^https?:\/\//i.test(text)) {
      text = new URL(text).hostname;
    } else {
      text = (text.split('/')[0] ?? text).trim();
      if (!text.startsWith('[')) {
        text = text.split(':')[0] ?? text;
      }
    }
  } catch {
    return '';
  }
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(text) || /^[A-Za-z0-9.-]+$/.test(text)) {
    return text;
  }
  return '';
}

export function sanitizeTunnelUser(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return /^[A-Za-z0-9._-]+$/.test(text) ? text : DEFAULT_PUBLIC_USER;
}

export function clampSshPort(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(n)) {
    return DEFAULT_SSH_PORT;
  }
  return Math.max(1, Math.min(65535, n));
}

export function resolvePublicHost(raw: unknown): string {
  return sanitizeTunnelHost(raw) || DEFAULT_PUBLIC_HOST;
}

export function resolveForwardPort(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(n) || n <= 0) {
    return DEFAULT_FORWARD_PORT;
  }
  return Math.max(1024, Math.min(65535, n));
}

export function pickAutoForwardPort(): number {
  const span = AUTO_FORWARD_MAX - AUTO_FORWARD_MIN + 1;
  return AUTO_FORWARD_MIN + (randomBytes(2).readUInt16BE(0) % span);
}

export function advertisedPublicUrl(host: string, remotePort: number): string {
  if (!host) {
    return '';
  }
  return remotePort === 80 ? `http://${host}` : `http://${host}:${remotePort}`;
}

export function sshBinary(): string {
  return openSshTool('ssh');
}

export function sshKeygenBinary(): string {
  return openSshTool('ssh-keygen');
}

function openSshTool(name: string): string {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot ?? 'C:\\Windows';
    const bundled = path.join(root, 'System32', 'OpenSSH', `${name}.exe`);
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }
  return name;
}

function sshPath(file: string): string {
  return file.replace(/\\/g, '/');
}

export function grokSshDir(): string {
  return path.join(os.homedir(), '.grok', 'ssh');
}

export function isBundledRelayHost(host: string | undefined): boolean {
  return Boolean(host && host === DEFAULT_PUBLIC_HOST);
}

/** SSH identity for a custom VPS reverse tunnel. Built-in public access does not use SSH. */
export function ensureTunnelIdentity(): {
  privateKey: string;
  publicKey: string;
} {
  const dir = grokSshDir();
  fs.mkdirSync(dir, { recursive: true });
  const privateKey = path.join(dir, 'id_ed25519');
  const publicFile = `${privateKey}.pub`;
  if (!fs.existsSync(privateKey) || !fs.existsSync(publicFile)) {
    const result = spawnSync(
      sshKeygenBinary(),
      ['-t', 'ed25519', '-f', privateKey, '-N', '', '-q', '-C', 'grok-build-remote'],
      { windowsHide: true, encoding: 'utf8' },
    );
    if (result.status !== 0 && !fs.existsSync(privateKey)) {
      throw new Error(result.stderr?.toString().trim() || 'ssh-keygen failed');
    }
    protectPrivateKey(privateKey);
  }
  const publicKey = fs.readFileSync(publicFile, 'utf8').trim();
  if (!publicKey) {
    throw new Error('empty tunnel public key');
  }
  return { privateKey, publicKey };
}

function protectPrivateKey(file: string): void {
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* ignore */
    }
    return;
  }
  const user = os.userInfo().username;
  spawnSync('icacls', [file, '/inheritance:r'], { windowsHide: true });
  for (const who of [
    'SYSTEM',
    'Administrators',
    'BUILTIN\\Administrators',
    'Users',
    'Authenticated Users',
    'Everyone',
  ]) {
    spawnSync('icacls', [file, '/remove', who], { windowsHide: true });
  }
  spawnSync('icacls', [file, '/grant:r', `${user}:(R)`], { windowsHide: true });
}

export function tunnelKnownHostsFile(): string {
  return path.join(grokSshDir(), 'known_hosts');
}

/** Reverse tunnel: local machine dials the VPS, VPS listens, browsers hit the VPS. */
export function buildSshArgs(
  cfg: TunnelConfig,
  extra: { identity?: string; knownHosts?: string; strict?: 'accept-new' | 'no' } = {},
): string[] {
  const args = [
    '-N',
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', `StrictHostKeyChecking=${extra.strict ?? 'accept-new'}`,
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'HostKeyAlgorithms=+ssh-ed25519,rsa-sha2-512,rsa-sha2-256,ssh-rsa',
  ];
  if (extra.identity) {
    args.push('-i', extra.identity, '-o', 'IdentitiesOnly=yes');
  }
  if (extra.knownHosts) {
    args.push('-o', `UserKnownHostsFile=${sshPath(extra.knownHosts)}`);
  }
  args.push(
    '-p', String(cfg.sshPort),
    '-R', `0.0.0.0:${cfg.remotePort}:127.0.0.1:${cfg.localPort}`,
    `${cfg.user}@${cfg.host}`,
  );
  return args;
}

export class ReverseTunnel {
  private child?: ChildProcess;
  private wanted = false;
  private cfg?: TunnelConfig;
  private autoPort = false;
  private boundPort = 0;
  private state: TunnelState = 'off';
  private error?: string;
  private retry?: ReturnType<typeof setTimeout>;
  private ready?: ReturnType<typeof setTimeout>;
  private delay = 1500;
  private strict: 'accept-new' | 'no' = 'accept-new';
  private identity?: string;
  private publicKey?: string;
  private readonly listeners = new Set<() => void>();

  info(): TunnelInfo {
    return {
      state: this.state,
      error: this.error,
      host: this.cfg?.host ?? '',
      user: this.cfg?.user ?? 'root',
      sshPort: this.cfg?.sshPort ?? 22,
      remotePort: this.boundPort || this.cfg?.remotePort || 0,
      sshPublicKey: this.publicKey,
      bundledRelay: false,
    };
  }

  onChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  start(cfg: TunnelConfig): void {
    this.autoPort = cfg.remotePort <= 0;
    this.boundPort = this.autoPort ? pickAutoForwardPort() : cfg.remotePort;
    this.cfg = { ...cfg, remotePort: this.boundPort };
    this.wanted = true;
    this.delay = 1500;
    this.spawn();
  }

  stop(): void {
    this.wanted = false;
    this.clearTimers();
    this.kill();
    this.state = 'off';
    this.error = undefined;
    this.emit();
  }

  private spawn(): void {
    this.kill();
    this.clearTimers();
    const cfg = this.cfg;
    if (!this.wanted || !cfg?.host) {
      this.state = 'error';
      this.error = 'missing-host';
      this.emit();
      return;
    }
    this.state = 'connecting';
    this.error = undefined;
    this.emit();
    try {
      const id = ensureTunnelIdentity();
      this.identity = id.privateKey;
      this.publicKey = id.publicKey;
    } catch {
      this.fail('keyfile', false);
      return;
    }
    const child = spawn(
      sshBinary(),
      buildSshArgs(cfg, {
        identity: this.identity,
        knownHosts: tunnelKnownHostsFile(),
        strict: this.strict,
      }),
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      },
    );
    this.child = child;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4000);
      if (this.strict === 'accept-new' && BAD_STRICT.test(stderr)) {
        this.strict = 'no';
      }
      const msg = classifySshError(stderr);
      if (msg) {
        this.error = msg;
      }
    });
    child.on('error', (err) => {
      if (this.child !== child) {
        return;
      }
      this.fail(err.message, false);
    });
    child.on('close', () => {
      if (this.child !== child) {
        return;
      }
      this.child = undefined;
      const msg = classifySshError(stderr) ?? this.error ?? 'tunnel-closed';
      this.fail(msg, !isAuthFailure(msg));
    });
    this.ready = setTimeout(() => {
      this.ready = undefined;
      if (this.child === child && this.state === 'connecting') {
        this.state = 'up';
        this.error = undefined;
        this.delay = 1500;
        this.emit();
      }
    }, 1200);
  }

  private fail(message: string, retry: boolean): void {
    this.clearTimers();
    this.kill();
    this.state = 'error';
    this.error = message;
    this.emit();
    if (!this.wanted || !retry) {
      return;
    }
    if (this.autoPort && this.cfg && message === 'forward') {
      this.boundPort = pickAutoForwardPort();
      this.cfg = { ...this.cfg, remotePort: this.boundPort };
    }
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.spawn();
    }, this.delay);
    this.retry.unref?.();
    this.delay = Math.min(30_000, Math.round(this.delay * 1.6));
  }

  private kill(): void {
    const child = this.child;
    this.child = undefined;
    if (!child || child.killed) {
      return;
    }
    child.kill();
  }

  private clearTimers(): void {
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = undefined;
    }
    if (this.ready) {
      clearTimeout(this.ready);
      this.ready = undefined;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function classifySshError(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) {
    return undefined;
  }
  if (KEY_FILE_FAIL.test(text)) {
    return 'keyfile';
  }
  if (HOST_KEY_FAIL.test(text)) {
    return 'hostkey';
  }
  if (AUTH_FAIL.test(text)) {
    return 'auth';
  }
  if (BAD_HOST.test(text)) {
    return 'host';
  }
  if (/remote port forwarding failed/i.test(text)) {
    return 'forward';
  }
  if (/connection timed out|connection reset|network is unreachable/i.test(text)) {
    return 'network';
  }
  return undefined;
}

function isAuthFailure(code: string): boolean {
  return code === 'auth' || code === 'host' || code === 'hostkey' || code === 'keyfile';
}
