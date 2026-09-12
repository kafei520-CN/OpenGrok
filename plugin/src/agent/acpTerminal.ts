import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { plat, type AgentTerminal, type AgentTerminalExit, type AgentTerminalSpawn } from '../core/platform';
import { asObject, asString } from '../core/wire';

const terms = new Map<string, AgentTerminal>();

export function isTerminalMethod(name: string): boolean {
  const op = terminalOp(name);
  return (
    op === 'terminal/create' ||
    op === 'terminal/output' ||
    op === 'terminal/wait_for_exit' ||
    op === 'terminal/kill' ||
    op === 'terminal/release'
  );
}

export async function handleTerminalMethod(name: string, params: unknown): Promise<unknown> {
  const op = terminalOp(name);
  if (op === 'terminal/create') {
    return createTerm(params);
  }
  const id = terminalIdOf(params);
  const term = id ? terms.get(id) : undefined;
  if (!term) {
    throw new Error('terminal not found');
  }
  if (op === 'terminal/output') {
    const snap = term.snapshot();
    return {
      output: snap.output,
      truncated: snap.truncated,
      exitStatus: snap.exitStatus,
    };
  }
  if (op === 'terminal/wait_for_exit') {
    return term.wait();
  }
  if (op === 'terminal/kill') {
    const outcome = term.kill();
    return { outcome };
  }
  term.release();
  terms.delete(term.id);
  return {};
}

/** Kill every ACP PTY. Called when the agent or extension shuts down. */
export function disposeAllTerminals(): void {
  const all = [...terms.values()];
  terms.clear();
  for (const term of all) {
    try {
      term.release();
    } catch {
      /* ignore teardown errors */
    }
  }
}

export function spawnProcessTerminal(opts: AgentTerminalSpawn): AgentTerminal {
  return new ProcessTerminal(opts);
}

function createTerm(params: unknown): { terminalId: string } {
  const obj = asObject(params);
  const command = asString(obj['command']);
  if (!command) {
    throw new Error('terminal/create missing command');
  }
  const args = Array.isArray(obj['args'])
    ? obj['args'].filter((item): item is string => typeof item === 'string')
    : [];
  const limitRaw = obj['outputByteLimit'] ?? obj['output_byte_limit'];
  const spawnOpts: AgentTerminalSpawn = {
    command,
    args,
    cwd: asString(obj['cwd']),
    env: envMap(obj['env']),
    outputByteLimit: typeof limitRaw === 'number' ? limitRaw : undefined,
  };
  const term = plat().spawnAgentTerminal?.(spawnOpts) ?? spawnProcessTerminal(spawnOpts);
  terms.set(term.id, term);
  return { terminalId: term.id };
}

function terminalIdOf(params: unknown): string | undefined {
  const obj = asObject(params);
  return asString(obj['terminalId']) ?? asString(obj['terminal_id']);
}

function terminalOp(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

function envMap(raw: unknown): Record<string, string> | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const item of raw) {
    const obj = asObject(item);
    const key = asString(obj['name']);
    const value = asString(obj['value']);
    if (key && value !== undefined) {
      env[key] = value;
    }
  }
  return Object.keys(env).length ? env : undefined;
}

class ProcessTerminal implements AgentTerminal {
  readonly id = randomBytes(8).toString('hex');
  private output = '';
  private truncated = false;
  private exit?: AgentTerminalExit;
  private readonly waiters: Array<(exit: AgentTerminalExit) => void> = [];
  private child?: ChildProcess;
  private readonly limit: number;
  private killed = false;

  constructor(opts: AgentTerminalSpawn) {
    this.limit = opts.outputByteLimit ?? 2_000_000;
    const env = { ...process.env, ...opts.env };
    this.child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      env,
      shell: !opts.args?.length,
      windowsHide: true,
    });
    const onData = (chunk: Buffer) => this.push(chunk.toString('utf8'));
    this.child.stdout?.on('data', onData);
    this.child.stderr?.on('data', onData);
    this.child.on('close', (code, signal) => {
      this.finish({
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
      });
    });
    this.child.on('error', (error) => {
      this.push(error.message);
      this.finish({ exitCode: 1 });
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
  }

  protected push(text: string): void {
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

  protected finish(exit: AgentTerminalExit): void {
    if (this.exit) {
      return;
    }
    this.exit = this.killed && exit.exitCode == null ? { ...exit, signal: exit.signal ?? 'SIGTERM' } : exit;
    for (const wait of this.waiters.splice(0)) {
      wait(this.exit);
    }
  }
}

export { ProcessTerminal };
