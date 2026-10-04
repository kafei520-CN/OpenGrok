import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { AccountInfo, BillingQuota } from '../core/types';

/** A Grok login we can switch back to. Credentials stay in a copied auth.json. */
export interface SavedAccount {
  id: string;
  email?: string;
  name: string;
  avatarUrl?: string;
  tier?: string;
  /** 0–100 used, same scale as billing.usagePercent. */
  usagePercent?: number;
  periodEnd?: string;
  current: boolean;
}

export function accountKey(account: { email?: string; methodId?: string }): string {
  const raw = (account.email || account.methodId || 'default').trim().toLowerCase();
  const safe = raw.replace(/[^a-z0-9._@-]+/gi, '_').slice(0, 96);
  return safe || 'default';
}

export function accountName(account: AccountInfo): string {
  const joined = [account.firstName, account.lastName].filter(Boolean).join(' ').trim();
  if (joined) {
    return joined;
  }
  const email = account.email?.trim();
  if (email) {
    return email.split('@')[0] || email;
  }
  return account.methodId || 'Grok';
}

export function upsertAccount(list: SavedAccount[], next: SavedAccount): SavedAccount[] {
  const rest = list
    .filter((row) => row.id !== next.id)
    .map((row) => ({ ...row, current: next.current ? false : row.current }));
  return [...rest, next];
}

export function markCurrent(list: SavedAccount[], id: string): SavedAccount[] {
  return list.map((row) => ({ ...row, current: row.id === id }));
}

function bookDir(home: string): string {
  return path.join(home, '.grok', 'opengrok-accounts');
}

function authPath(home: string): string {
  return path.join(home, '.grok', 'auth.json');
}

function slotAuth(home: string, id: string): string {
  return path.join(bookDir(home), id, 'auth.json');
}

export async function readAccountBook(home: string): Promise<SavedAccount[]> {
  try {
    const raw = await readFile(path.join(bookDir(home), 'index.json'), 'utf8');
    const parsed = JSON.parse(raw) as { accounts?: SavedAccount[] };
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch {
    return [];
  }
}

export async function writeAccountBook(home: string, accounts: SavedAccount[]): Promise<void> {
  const dir = bookDir(home);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.json'), `${JSON.stringify({ accounts }, null, 2)}\n`, 'utf8');
}

/** Copy the live CLI login into this account's slot. */
export async function snapshotAuth(home: string, id: string): Promise<boolean> {
  try {
    await mkdir(path.dirname(slotAuth(home, id)), { recursive: true });
    await copyFile(authPath(home), slotAuth(home, id));
    return true;
  } catch {
    return false;
  }
}

/** Put a saved login back where the CLI reads it. */
export async function restoreAuth(home: string, id: string): Promise<boolean> {
  try {
    await copyFile(slotAuth(home, id), authPath(home));
    return true;
  } catch {
    return false;
  }
}

export function accountFromLive(account: AccountInfo, billing?: BillingQuota): SavedAccount {
  return {
    id: accountKey(account),
    email: account.email,
    name: accountName(account),
    avatarUrl: account.avatarUrl,
    tier: billing?.subscriptionTier,
    usagePercent: billing?.usagePercent,
    periodEnd: billing?.periodEnd,
    current: true,
  };
}
