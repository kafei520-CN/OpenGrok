import * as readline from 'node:readline';
import { GrokController } from './controller';
import { dispatchUi } from './dispatch';
import { NodePlatform } from '../core/platform/nodePlatform';
import { bindPlatform } from '../core/platform';
import type { WebviewToHost } from '../core/types';
import { packDelivery } from '../remote/remoteState';

interface Incoming {
  type?: string;
  id?: number;
  ok?: boolean;
  value?: unknown;
  error?: string;
  method?: string;
  name?: string;
  message?: WebviewToHost;
  selection?: { path: string; text: string; startLine: number; endLine: number };
  file?: { path: string; text: string };
}

const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
let nextId = 1;
let controller: GrokController | undefined;

function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function request(method: string, params?: unknown): Promise<unknown> {
  const id = nextId++;
  send({ type: 'host', id, method, params: params ?? {} });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`host timeout: ${method}`));
    }, hostTimeoutMs(method));
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}

function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let msg: Incoming;
  try {
    msg = JSON.parse(trimmed) as Incoming;
  } catch (error) {
    send({ type: 'error', message: `bad json: ${error instanceof Error ? error.message : error}` });
    return;
  }
  if (msg.type === 'reply' && typeof msg.id === 'number') {
    const waiter = pending.get(msg.id);
    pending.delete(msg.id);
    if (!waiter) {
      return;
    }
    if (msg.ok === false) {
      waiter.reject(new Error(msg.error || 'host error'));
      return;
    }
    waiter.resolve(msg.value);
    return;
  }
  void handleCommand(msg).catch((error) => {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

async function handleCommand(msg: Incoming): Promise<void> {
  if (!controller) {
    return;
  }
  switch (msg.type) {
    case 'ui':
      if (msg.message) {
        await dispatchUi(controller, msg.message);
      }
      return;
    case 'context':
      platform.setContext({ selection: msg.selection, file: msg.file });
      return;
    case 'command':
      await runNamed(msg.name ?? '');
      return;
    case 'shutdown':
      controller.dispose();
      process.exit(0);
      return;
    default:
      return;
  }
}

function hostTimeoutMs(method: string): number {
  switch (method) {
    case 'input':
    case 'confirm':
    case 'pick':
    case 'saveFile':
    case 'openFiles':
    case 'openFolder':
    case 'showDiff':
      return 600_000;
    default:
      return 30_000;
  }
}

async function runNamed(name: string): Promise<void> {
  if (!controller) {
    return;
  }
  switch (name) {
    case 'addSelection':
      controller.addSelection();
      return;
    case 'addActiveFile':
      controller.addActiveFile();
      return;
    case 'newSession':
      await controller.newSession();
      return;
    case 'login':
      await controller.login();
      return;
    case 'logout':
      await controller.logout();
      return;
    case 'setApiKey':
      await controller.setApiKey();
      return;
    case 'restart':
      await controller.restart();
      return;
    case 'cancel':
      controller.cancelTurn();
      return;
    case 'compact':
      await controller.compact();
      return;
    case 'rewind':
      await controller.rewind();
      return;
    case 'resume':
      await controller.resumePicker();
      return;
    case 'cycleMode':
      await controller.cycleMode();
      return;
    case 'fork':
      await controller.send('/fork');
      return;
    case 'export':
      await controller.exportChat();
      return;
    case 'usage':
      await controller.send('/usage');
      return;
    case 'showLog':
      controller.showLog();
      return;
    default:
      return;
  }
}

const platform = new NodePlatform({
  cwd: process.env['GROK_CWD'] || process.cwd(),
  version: process.env['GROK_VERSION'] || '0.1.22',
  language: process.env['GROK_LANG'] || Intl.DateTimeFormat().resolvedOptions().locale,
  request,
  notify: send,
});

bindPlatform(platform);
controller = new GrokController(platform);
controller.onDidChange((state) => {
  const payload = { type: 'state', state, merge: Boolean(state.mergeTranscript) };
  for (const frame of packDelivery(payload)) {
    process.stdout.write(`${frame}\n`);
  }
});
controller.onDidStream((tail) => send(tail));
controller.onDidExtraUi((payload) => send({ type: 'ogPlugin', payload }));

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', handleLine);
rl.on('close', () => {
  controller?.dispose();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  send({ type: 'error', message: error.stack ?? error.message });
});
process.on('unhandledRejection', (error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  send({ type: 'error', message });
});

void controller.start().then(
  () => send({ type: 'ready' }),
  (error: unknown) => {
    send({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  },
);
