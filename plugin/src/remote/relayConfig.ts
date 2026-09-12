import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_RELAY_PORT } from './remoteDefaults';

export const DEFAULT_MAX_FRAME = 8 * 1024 * 1024;
export const HARD_MAX_FRAME = 32 * 1024 * 1024;
export const DEFAULT_MAX_FILE = 32 * 1024 * 1024;
const SCRYPT_N = 16_384;
const SCRYPT_KEYLEN = 32;

export interface RelayFileConfig {
  publicHost: string;
  listenPort: number;
  maxFrameBytes: number;
  maxFileBytes: number;
  /** Custom plugin host key. Official plugins use the bundled token instead. */
  hostKey: string;
  adminUser: string;
  adminHash: string;
  bannedIps: string[];
}

export const DEFAULT_RELAY_FILE: RelayFileConfig = {
  publicHost: '127.0.0.1',
  listenPort: DEFAULT_RELAY_PORT,
  maxFrameBytes: DEFAULT_MAX_FRAME,
  maxFileBytes: DEFAULT_MAX_FILE,
  hostKey: '',
  adminUser: 'admin',
  adminHash: '',
  bannedIps: [],
};

export function configPath(home: string): string {
  return path.join(home, 'grok-web.json');
}

export function clampListenPort(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return DEFAULT_RELAY_PORT;
  }
  return Math.max(1, Math.min(65535, n));
}

export function clampFrameBytes(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return DEFAULT_MAX_FRAME;
  }
  return Math.max(256 * 1024, Math.min(HARD_MAX_FRAME, Math.floor(n)));
}

export function clampFileBytes(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return DEFAULT_MAX_FILE;
  }
  return Math.max(256 * 1024, Math.min(HARD_MAX_FRAME * 4, Math.floor(n)));
}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1 });
  return `${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, packed: string): boolean {
  const cut = packed.indexOf('$');
  if (cut <= 0) {
    return false;
  }
  const salt = Buffer.from(packed.slice(0, cut), 'hex');
  const want = Buffer.from(packed.slice(cut + 1), 'hex');
  if (!salt.length || want.length !== SCRYPT_KEYLEN) {
    return false;
  }
  const got = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: 8, p: 1 });
  return got.length === want.length && timingSafeEqual(got, want);
}

export function randomSecret(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

export function newHostKey(): string {
  return `gb1.${randomBytes(24).toString('hex')}`;
}

export function normalizeIp(raw: string | undefined): string {
  const text = String(raw ?? '').trim();
  if (text.startsWith('::ffff:')) {
    return text.slice(7);
  }
  return text;
}

export function loadRelayConfig(
  home: string,
  opts?: { resetAdmin?: boolean },
): { cfg: RelayFileConfig; created: boolean; adminPass?: string } {
  const file = configPath(home);
  let created = false;
  let raw: Partial<RelayFileConfig> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RelayFileConfig>;
  } catch {
    created = true;
  }
  const cfg: RelayFileConfig = {
    ...DEFAULT_RELAY_FILE,
    publicHost: String(raw.publicHost ?? '').trim() || DEFAULT_RELAY_FILE.publicHost,
    listenPort: clampListenPort(raw.listenPort),
    maxFrameBytes: clampFrameBytes(raw.maxFrameBytes),
    maxFileBytes: clampFileBytes(raw.maxFileBytes),
    hostKey: String(raw.hostKey ?? '').trim(),
    adminUser: /^[A-Za-z0-9._-]{1,32}$/.test(String(raw.adminUser ?? ''))
      ? String(raw.adminUser)
      : 'admin',
    adminHash: String(raw.adminHash ?? ''),
    bannedIps: Array.isArray(raw.bannedIps)
      ? raw.bannedIps.map((row) => normalizeIp(String(row))).filter(Boolean)
      : [],
  };
  let adminPass: string | undefined;
  const envPass = process.env.GROK_WEB_ADMIN_PASS?.trim();
  const resetAdmin = Boolean(opts?.resetAdmin) || process.env.GROK_WEB_RESET_ADMIN === '1';
  if (envPass && envPass.length >= 12) {
    cfg.adminHash = hashPassword(envPass);
    created = true;
  } else if (resetAdmin || !cfg.adminHash) {
    adminPass = randomSecret(16);
    cfg.adminHash = hashPassword(adminPass);
    created = true;
  }
  if (!cfg.hostKey) {
    cfg.hostKey = newHostKey();
    created = true;
  }
  if (created) {
    saveRelayConfig(home, cfg);
  }
  return { cfg, created, adminPass };
}

export function saveRelayConfig(home: string, cfg: RelayFileConfig): void {
  fs.mkdirSync(home, { recursive: true });
  const tmp = `${configPath(home)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, configPath(home));
}
