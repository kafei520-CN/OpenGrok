import { spawn, type ChildProcess } from 'node:child_process';
import { decodeTermBytes } from './termText';
import { DEFAULT_TERM_ENCODING, type TermEncoding } from './termEncoding';
import { readGrokSettings } from '../settings/settings';

/** Force UTF-8 on Windows child processes so Chinese PowerShell/cmd is not GBK. */
export function windowsUtf8Env(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...base };
  env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8';
  env.PYTHONUTF8 = env.PYTHONUTF8 || '1';
  if (process.platform === 'win32') {
    env.LANG = env.LANG || 'zh_CN.UTF-8';
    env.LC_ALL = env.LC_ALL || 'zh_CN.UTF-8';
  }
  return env;
}

export function isPowershellCommand(command: string): boolean {
  const base = command.replace(/^"|"$/g, '').split(/[/\\]/).pop()?.toLowerCase() ?? '';
  return base === 'powershell.exe' || base === 'powershell' || base === 'pwsh.exe' || base === 'pwsh';
}

export function isCmdCommand(command: string): boolean {
  const base = command.replace(/^"|"$/g, '').split(/[/\\]/).pop()?.toLowerCase() ?? '';
  return base === 'cmd.exe' || base === 'cmd';
}

const PS_UTF8 =
  '[Console]::InputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();$OutputEncoding=[Console]::OutputEncoding;';

export function utf8PowershellArgs(args: string[]): string[] {
  const lower = args.map((item) => item.toLowerCase());
  if (lower.some((item) => item === '-file' || item === '-encodedcommand')) {
    return args;
  }
  const idx = lower.findIndex((item) => item === '-command' || item === '-c');
  if (idx >= 0 && args[idx + 1]) {
    const next = args.slice();
    next[idx + 1] = `${PS_UTF8}${next[idx + 1]}`;
    return next;
  }
  if (!args.length) {
    return ['-NoLogo', '-NoProfile', '-Command', PS_UTF8];
  }
  return args;
}

export function utf8CmdArgs(args: string[]): string[] {
  const lower = args.map((item) => item.toLowerCase());
  const idx = lower.findIndex((item) => item === '/c' || item === '/k');
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].includes('chcp 65001')) {
    const next = args.slice();
    next[idx + 1] = `chcp 65001>nul & ${next[idx + 1]}`;
    return next;
  }
  return args;
}

export function wrapWindowsShellCommand(command: string): { command: string; args: string[] } {
  const comspec = process.env.ComSpec || 'cmd.exe';
  return {
    command: comspec,
    args: ['/d', '/s', '/c', `chcp 65001>nul & ${command}`],
  };
}

export function prepareWindowsSpawn(
  command: string,
  args: string[],
  shell: boolean,
): { command: string; args: string[]; shell: boolean } {
  if (process.platform !== 'win32') {
    return { command, args, shell };
  }
  if (shell) {
    const exe = leadingExecutable(command);
    if (exe && isPowershellCommand(exe)) {
      const rest = command.slice(command.toLowerCase().indexOf(exe.toLowerCase()) + exe.length).trim();
      const parsed = rest ? splitWinArgs(rest) : [];
      return {
        command: exe.replace(/^"|"$/g, ''),
        args: utf8PowershellArgs(parsed.length ? parsed : ['-NoLogo', '-NoProfile', '-Command', PS_UTF8]),
        shell: false,
      };
    }
    const wrapped = wrapWindowsShellCommand(command);
    return { command: wrapped.command, args: wrapped.args, shell: false };
  }
  if (isPowershellCommand(command)) {
    return { command, args: utf8PowershellArgs(args), shell: false };
  }
  if (isCmdCommand(command)) {
    return { command, args: utf8CmdArgs(args), shell: false };
  }
  return { command, args, shell };
}

export function spawnWindowsAware(
  command: string,
  args: string[] | undefined,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv },
): ChildProcess {
  const env = windowsUtf8Env({ ...process.env, ...opts.env });
  const prepared = prepareWindowsSpawn(command, args ?? [], !args?.length);
  return spawn(prepared.command, prepared.args, {
    cwd: opts.cwd,
    env,
    shell: prepared.shell,
    windowsHide: true,
  });
}

export function decodeTermChunk(chunk: Buffer): string {
  return decodeTermBytes(Uint8Array.from(chunk), readGrokSettings().termEncoding);
}

/** Decode a byte stream, holding trailing GBK/UTF-8 fragments until the next chunk. */
export class TermStreamDecoder {
  private pending = Buffer.alloc(0);

  constructor(private encoding?: TermEncoding) {}

  push(chunk: Buffer): string {
    const buf = this.pending.length ? Buffer.concat([this.pending, chunk]) : Buffer.from(chunk);
    const hold = incompleteTailBytes(buf);
    const complete = hold ? buf.subarray(0, buf.length - hold) : buf;
    this.pending = hold ? Buffer.from(buf.subarray(buf.length - hold)) : Buffer.alloc(0);
    if (!complete.length) {
      return '';
    }
    return decodeTermBytes(complete, this.resolveEncoding());
  }

  flush(): string {
    if (!this.pending.length) {
      return '';
    }
    const text = decodeTermBytes(this.pending, this.resolveEncoding());
    this.pending = Buffer.alloc(0);
    return text;
  }

  private resolveEncoding(): TermEncoding {
    if (this.encoding) {
      return this.encoding;
    }
    try {
      return readGrokSettings().termEncoding;
    } catch {
      return DEFAULT_TERM_ENCODING;
    }
  }
}

function leadingExecutable(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end > 1) {
      return trimmed.slice(1, end);
    }
  }
  return trimmed.split(/\s+/, 1)[0];
}

function splitWinArgs(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) {
    out.push(cur);
  }
  return out;
}

function incompleteTailBytes(buf: Buffer): number {
  if (!buf.length) {
    return 0;
  }
  const utf8Hold = utf8IncompleteCount(buf);
  const head = utf8Hold ? buf.subarray(0, buf.length - utf8Hold) : buf;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return utf8Hold;
  } catch {
    return gbkEndsOnLead(buf) ? 1 : 0;
  }
}

function gbkEndsOnLead(buf: Buffer): boolean {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) {
      i += 1;
      continue;
    }
    if (b >= 0x81 && b <= 0xfe) {
      if (i + 1 >= buf.length) {
        return true;
      }
      i += 2;
      continue;
    }
    i += 1;
  }
  return false;
}

function utf8IncompleteCount(buf: Buffer): number {
  for (let n = 1; n <= 3 && n <= buf.length; n += 1) {
    const b = buf[buf.length - n];
    const need = utf8SeqLen(b);
    if (need > n) {
      return n;
    }
  }
  return 0;
}

function utf8SeqLen(b: number): number {
  if ((b & 0x80) === 0) {
    return 1;
  }
  if ((b & 0xe0) === 0xc0) {
    return 2;
  }
  if ((b & 0xf0) === 0xe0) {
    return 3;
  }
  if ((b & 0xf8) === 0xf0) {
    return 4;
  }
  return 0;
}
