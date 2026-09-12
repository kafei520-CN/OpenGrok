import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { AgentTerminal, AgentTerminalExit, AgentTerminalSpawn } from '../core/platform';

export function createVscodeAgentTerminal(opts: AgentTerminalSpawn): AgentTerminal {
  return new VscodeAgentTerminal(opts);
}

class VscodeAgentTerminal implements AgentTerminal {
  readonly id = randomBytes(8).toString('hex');
  private output = '';
  private truncated = false;
  private exit?: AgentTerminalExit;
  private readonly waiters: Array<(exit: AgentTerminalExit) => void> = [];
  private child?: ChildProcess;
  private readonly limit: number;
  private killed = false;
  private opened = false;
  private pending: string[] = [];
  private readonly write = new vscode.EventEmitter<string>();
  private readonly closed = new vscode.EventEmitter<number | void>();
  private vsTerm: vscode.Terminal;

  constructor(opts: AgentTerminalSpawn) {
    this.limit = opts.outputByteLimit ?? 2_000_000;
    const pty: vscode.Pseudoterminal = {
      onDidWrite: this.write.event,
      onDidClose: this.closed.event,
      open: () => {
        this.opened = true;
        for (const chunk of this.pending) {
          this.write.fire(chunk);
        }
        this.pending = [];
      },
      close: () => {
        this.kill();
      },
      handleInput: (data) => this.onInput(data),
    };
    this.vsTerm = vscode.window.createTerminal({
      name: 'Grok',
      cwd: opts.cwd,
      pty,
    });
    const env = { ...process.env, ...opts.env };
    this.child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      env,
      shell: !opts.args?.length,
      windowsHide: true,
    });
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      this.push(text);
      this.echo(text.replace(/\n/g, '\r\n'));
    };
    this.child.stdout?.on('data', onData);
    this.child.stderr?.on('data', onData);
    this.child.on('close', (code, signal) => {
      this.finish({
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
      });
      // VS Code treats a non-zero onDidClose number as "terminal failed to start".
      this.closed.fire();
    });
    this.child.on('error', (error) => {
      this.push(error.message);
      this.echo(`\r\n${error.message}\r\n`);
      this.finish({ exitCode: 1 });
      this.closed.fire();
    });
  }

  snapshot(): { output: string; truncated: boolean; exitStatus?: AgentTerminalExit } {
    return {
      output: this.output,
      truncated: this.truncated,
      exitStatus: this.exit,
    };
  }

  wait(): Promise<AgentTerminalExit> {
    if (this.exit) {
      return Promise.resolve(this.exit);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  kill(): 'killed' | 'alreadyExited' {
    if (this.exit) {
      return 'alreadyExited';
    }
    this.killed = true;
    this.child?.kill();
    return 'killed';
  }

  release(): void {
    if (!this.exit) {
      this.kill();
      this.finish({ signal: 'SIGTERM' });
    }
    this.child = undefined;
    this.write.dispose();
    this.closed.dispose();
    try {
      this.vsTerm.dispose();
    } catch {
      /* already closed */
    }
  }

  private onInput(data: string): void {
    if (data === '\u0003') {
      this.kill();
      return;
    }
    this.child?.stdin?.write(data === '\r' ? '\n' : data);
  }

  private echo(text: string): void {
    if (this.opened) {
      this.write.fire(text);
      return;
    }
    this.pending.push(text);
  }

  private push(text: string): void {
    if (this.truncated) {
      return;
    }
    const next = this.output + text;
    if (Buffer.byteLength(next) > this.limit) {
      this.output = next.slice(0, this.limit);
      this.truncated = true;
      return;
    }
    this.output = next;
  }

  private finish(exit: AgentTerminalExit): void {
    if (this.exit) {
      return;
    }
    this.exit =
      this.killed && exit.exitCode == null ? { ...exit, signal: exit.signal ?? 'SIGTERM' } : exit;
    for (const wait of this.waiters.splice(0)) {
      wait(this.exit);
    }
  }
}
