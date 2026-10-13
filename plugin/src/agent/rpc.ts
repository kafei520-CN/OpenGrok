import { EventEmitter } from 'node:events';
import type { Writable } from 'node:stream';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/** Same ceiling as the CLI line reader (`xai-acp-lib` MAX_LINE_SIZE). */
export const MAX_RPC_BUFFER = 64 * 1024 * 1024;

export class JsonRpcConnection extends EventEmitter {
  private nextId = 1;
  private buffer = '';
  /** Drop bytes until the next newline after one line passes `maxBuffer`. */
  private skipping = false;
  private readonly pending = new Map<number, Pending>();
  private readonly stdin: Writable;
  private readonly maxBuffer: number;
  private closed = false;

  constructor(stdin: Writable, maxBuffer = MAX_RPC_BUFFER) {
    super();
    this.stdin = stdin;
    this.maxBuffer = maxBuffer;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  feed(chunk: Buffer | string): void {
    if (this.closed) {
      return;
    }
    let text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (this.skipping) {
      const nl = text.indexOf('\n');
      if (nl < 0) {
        return;
      }
      this.skipping = false;
      text = text.slice(nl + 1);
    }
    if (text) {
      this.buffer += text;
    }
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx < 0) {
        break;
      }
      if (idx > this.maxBuffer) {
        this.buffer = this.buffer.slice(idx + 1);
        this.emit('log', 'skipped an oversized ACP stdout line');
        continue;
      }
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) {
        this.handleLine(line);
      }
      if (this.closed) {
        return;
      }
    }
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = '';
      this.skipping = true;
      this.emit('log', 'skipped an oversized ACP stdout line');
    }
  }

  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('ACP connection is closed'));
    }
    const id = this.nextId++;
    this.write({ jsonrpc: '2.0', id, method, params: params ?? {} });
    return new Promise((resolve, reject) => {
      const pending: Pending = { resolve, reject };
      if (timeoutMs && timeoutMs > 0) {
        pending.timer = setTimeout(() => {
          if (!this.pending.has(id)) {
            return;
          }
          this.pending.delete(id);
          reject(new Error(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, params: params ?? {} });
  }

  respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  respondError(id: number | string, message: string, code = -32000): void {
    this.write({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
  }

  close(error?: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.buffer = '';
    for (const [id, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(error ?? new Error('ACP connection closed'));
      this.pending.delete(id);
    }
  }

  private write(payload: unknown): void {
    if (this.closed) {
      return;
    }
    this.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.emit('log', `skipping non-JSON ACP line: ${line.slice(0, 200)}`);
      return;
    }
    const id = message['id'];
    const method = message['method'];
    if (typeof method === 'string') {
      if (id === undefined) {
        this.emit('notification', method, message['params']);
        return;
      }
      this.emit('request', method, message['params'], id);
      return;
    }
    const key = rpcId(id);
    if (key === undefined) {
      return;
    }
    const pending = this.pending.get(key);
    if (!pending) {
      this.emit('log', `no pending RPC for id ${id}`);
      return;
    }
    this.pending.delete(key);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    if (message['error']) {
      const err = message['error'] as { message?: string; code?: number; data?: unknown };
      pending.reject(
        new RpcError(err.message ?? 'ACP error', err.code, err.data),
      );
      return;
    }
    pending.resolve(message['result']);
  }
}

function rpcId(id: unknown): number | undefined {
  if (typeof id === 'number' && Number.isFinite(id)) {
    return id;
  }
  if (typeof id === 'string' && id.trim() !== '') {
    const n = Number(id);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

export { asObject, asString } from '../core/wire';

export function catchRpc(error: unknown): never {
  throw error;
}
