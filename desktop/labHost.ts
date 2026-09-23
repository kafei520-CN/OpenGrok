import { existsSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import { spawn as spawnPty, type IPty } from 'node-pty';

export type LabShell = {
  id: string;
  label: string;
  command: string;
  args: string[];
};

let child: IPty | undefined;

export function defaultLabShell(): LabShell {
  if (process.platform === 'win32') {
    return { id: 'powershell', label: 'PowerShell', command: 'powershell.exe', args: ['-NoExit'] };
  }
  if (process.platform === 'darwin') {
    return { id: 'zsh', label: 'zsh', command: '/bin/zsh', args: ['-il'] };
  }
  const shell = process.env['SHELL'];
  if (shell && existsSync(shell)) {
    return { id: 'system', label: shell, command: shell, args: ['-il'] };
  }
  return { id: 'bash', label: 'bash', command: '/bin/bash', args: ['-il'] };
}

export function labShells(): LabShell[] {
  const primary = defaultLabShell();
  if (process.platform === 'win32') {
    const shells: LabShell[] = [
      primary,
      { id: 'cmd', label: '命令提示符 (cmd)', command: 'cmd.exe', args: [] },
    ];
    const pwsh = [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
    ].find((file) => existsSync(file));
    if (pwsh) {
      shells.push({ id: 'pwsh', label: 'PowerShell 7', command: pwsh, args: ['-NoExit'] });
    }
    const bash = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ].find((file) => existsSync(file));
    if (bash) {
      shells.push({ id: 'git-bash', label: 'Git Bash', command: bash, args: ['--login', '-i'] });
    }
    if (existsSync('C:\\Windows\\System32\\wsl.exe')) {
      shells.push({ id: 'wsl', label: 'WSL', command: 'wsl.exe', args: [] });
    }
    return shells;
  }
  if (process.platform === 'darwin') {
    return [
      primary,
      { id: 'bash', label: 'bash', command: '/bin/bash', args: ['-il'] },
    ];
  }
  const unix: LabShell[] = [];
  for (const [id, command] of [
    ['bash', '/bin/bash'],
    ['zsh', '/bin/zsh'],
    ['sh', '/bin/sh'],
    ['fish', '/usr/bin/fish'],
  ] as const) {
    if (existsSync(command) && command !== primary.command) {
      unix.push({
        id,
        label: id,
        command,
        args: id === 'fish' || id === 'sh' ? [] : ['-il'],
      });
    }
  }
  return [primary, ...unix];
}

function ptyEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  env['TERM'] = 'xterm-256color';
  env['COLORTERM'] = 'truecolor';
  return env;
}

export function labShellStart(
  win: BrowserWindow,
  shellId: string,
  cwd?: string,
  cols = 80,
  rows = 24,
): { ok: true } | { ok: false; error: string } {
  labShellStop();
  const spec = labShells().find((item) => item.id === shellId) ?? defaultLabShell();
  if (!spec) {
    return { ok: false, error: '没有可用的命令行' };
  }
  const work = cwd && existsSync(cwd) ? cwd : undefined;
  const send = (data: string) => {
    if (!win.isDestroyed()) {
      win.webContents.send('og-term-data', data);
    }
  };
  try {
    const next = spawnPty(spec.command, spec.args, {
      name: 'xterm-256color',
      cols: Math.max(2, Math.floor(cols) || 80),
      rows: Math.max(1, Math.floor(rows) || 24),
      cwd: work,
      env: ptyEnv(),
      useConpty: process.platform === 'win32',
    });
    child = next;
    next.onData((data) => send(data));
    next.onExit(({ exitCode }) => {
      if (child !== next) {
        return;
      }
      child = undefined;
      send(`\r\n[进程已退出 ${exitCode}]\r\n`);
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

export function labShellWrite(data: string): void {
  child?.write(data);
}

export function labShellResize(cols: number, rows: number): void {
  if (!child || cols < 2 || rows < 1) {
    return;
  }
  try {
    child.resize(Math.floor(cols), Math.floor(rows));
  } catch {
    /* The pty can exit between a resize and the write. */
  }
}

export function labShellStop(): void {
  if (!child) {
    return;
  }
  const proc = child;
  child = undefined;
  proc.kill();
}
