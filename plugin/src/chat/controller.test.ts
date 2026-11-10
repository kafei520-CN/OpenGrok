import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { GrokController, editRewindIndex, messagesBeforePrompt, rewindIndexFor } from './controller';
import type { GrokAgent } from '../agent/agent';
import { cancelledPermission } from '../core/permissions';
import { bindPlatform, type Platform } from '../core/platform';

function fakePlat(over: Partial<Platform> = {}): Platform {
  return {
    cwd: () => process.cwd(),
    workspaceFolders: () => [process.cwd()],
    homeDir: () => process.cwd(),
    isTrusted: () => true,
    extensionVersion: () => '0',
    pathEnv: () => '',
    os: () => process.platform,
    language: () => 'en',
    getConfig: (_key, fallback) => fallback,
    setConfig: async () => {},
    getState: (_key, fallback) => fallback,
    setState: async () => {},
    log() {},
    showLog() {},
    info() {},
    warn() {},
    input: async () => undefined,
    confirm: async () => false,
    pick: async () => undefined,
    saveFile: async () => undefined,
    openFiles: async () => undefined,
    openFolders: async () => undefined,
    readDir: async () => [],
    openExternal: async () => {},
    openFile: async () => {},
    clipboardWrite: async () => {},
    findFiles: async () => [],
    relativePath: (filePath) => filePath,
    readFile: async () => new Uint8Array(),
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async () => false,
    createTerminal() {},
    closeSidebar: async () => {},
    focusChat() {},
    getActiveSelection: () => undefined,
    getActiveFile: () => undefined,
    onTrustChange: () => ({ dispose() {} }),
    onConfigChange: () => ({ dispose() {} }),
    ...over,
  };
}

const toolParams = {
  options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }],
  toolCall: { title: 'run', kind: 'read' },
};

describe('controller agent lifecycle', () => {
  it('does not keep an agent when the CLI is missing', async () => {
    bindPlatform(
      fakePlat({
        pathEnv: () => '',
        homeDir: () => path.join(process.cwd(), 'no-such-grok-home'),
        workspaceFolders: () => [],
      }),
    );
    const controller = new GrokController();
    await controller.start();
    assert.equal(controller.agent, undefined);
    assert.equal(controller.snapshot().status, 'missingCli');
    controller.dispose();
  });

  it('restart during start does not reuse the invalidated start', async () => {
    bindPlatform(
      fakePlat({
        pathEnv: () => '',
        homeDir: () => path.join(process.cwd(), 'no-such-grok-home'),
        workspaceFolders: () => [],
      }),
    );
    const controller = new GrokController();
    const first = controller.start();
    await controller.restart();
    await first;
    assert.equal(controller.agent, undefined);
    assert.equal(controller.snapshot().status, 'missingCli');
    controller.dispose();
  });

  it('skipLogin remembers the choice and still starts', async () => {
    const state = new Map<string, unknown>();
    bindPlatform(
      fakePlat({
        pathEnv: () => '',
        homeDir: () => path.join(process.cwd(), 'no-such-grok-home'),
        workspaceFolders: () => [],
        getState: (key, fallback) =>
          state.has(key) ? (state.get(key) as typeof fallback) : fallback,
        setState: async (key, value) => {
          state.set(key, value);
        },
      }),
    );
    const controller = new GrokController();
    await controller.skipLogin();
    assert.equal(state.get('ui.skipLogin'), true);
    assert.equal(controller.snapshot().status, 'missingCli');
    controller.dispose();
  });

  it('useApiLogin skips sign-in and opens API management', async () => {
    const state = new Map<string, unknown>();
    bindPlatform(
      fakePlat({
        pathEnv: () => '',
        homeDir: () => path.join(process.cwd(), 'no-such-grok-home'),
        workspaceFolders: () => [],
        getState: (key, fallback) =>
          state.has(key) ? (state.get(key) as typeof fallback) : fallback,
        setState: async (key, value) => {
          state.set(key, value);
        },
      }),
    );
    const controller = new GrokController();
    await controller.useApiLogin();
    const snap = controller.snapshot();
    assert.equal(state.get('ui.skipLogin'), true);
    assert.equal(snap.settingsOpen, true);
    assert.equal(snap.settingsPage, 'apis');
    controller.dispose();
  });
});

describe('controller reverse requests', () => {
  it('cancels a pending permission on cancelTurn', async () => {
    bindPlatform(fakePlat());
    const controller = new GrokController();
    const pending = controller.requestToolPermission(toolParams);
    controller.cancelTurn();
    assert.deepEqual(await pending, cancelledPermission());
    assert.equal(controller.snapshot().permission, undefined);
    controller.dispose();
  });

  it('keeps a pending permission parked across newSession and cancels it on dispose', async () => {
    bindPlatform(fakePlat());
    const controller = new GrokController();
    const first = controller.requestToolPermission(toolParams);
    await controller.newSession();
    assert.equal(controller.snapshot().permission, undefined);
    assert.equal(controller.pendingPermissions.size, 1);
    const second = controller.requestToolPermission(toolParams);
    controller.dispose();
    assert.deepEqual(await first, cancelledPermission());
    assert.deepEqual(await second, cancelledPermission());
  });

  it('cancels the previous permission when a new one arrives', async () => {
    bindPlatform(fakePlat());
    const controller = new GrokController();
    const first = controller.requestToolPermission(toolParams);
    const second = controller.requestToolPermission({
      ...toolParams,
      toolCall: { title: 'other', kind: 'read' },
    });
    assert.deepEqual(await first, cancelledPermission());
    controller.cancelTurn();
    assert.deepEqual(await second, cancelledPermission());
    controller.dispose();
  });
});

describe('controller send preparation', () => {
  it('queues a second send while the first prompt is being prepared', async () => {
    bindPlatform(fakePlat());
    const controller = new GrokController();
    let releasePrompt: (() => void) | undefined;
    let promptStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      promptStarted = resolve;
    });
    const agent = {
      sessionId: 'session-1',
      prompt: async () => {
        promptStarted?.();
        await new Promise<void>((resolve) => {
          releasePrompt = resolve;
        });
      },
      cancelTurn: () => releasePrompt?.(),
    } as unknown as GrokAgent;
    controller.agent = agent;
    controller.currentSessionId = 'session-1';
    controller.status = 'ready';

    const first = controller.send('first');
    const second = controller.send('second');
    await second;
    await started;

    assert.ok(releasePrompt);
    assert.equal(controller.status, 'streaming');
    assert.equal(controller.queue.length, 1);
    assert.equal(controller.queue[0]?.text, 'second');

    controller.cancelTurn();
    await Promise.all([first, second]);
    controller.dispose();
  });
});

describe('controller new chat workspace', () => {
  it('clears the workspace until a folder is chosen', async () => {
    bindPlatform(fakePlat());
    const controller = new GrokController();
    controller.status = 'ready';
    const home = controller.snapshot();
    assert.equal(home.needsWorkspace, true);
    assert.equal(home.sessionCwd, undefined);
    await controller.newSession();
    const snap = controller.snapshot();
    assert.equal(snap.needsWorkspace, true);
    assert.equal(snap.sessionCwd, undefined);
    await controller.send('hello');
    assert.equal(controller.messages.length, 0);
    controller.dispose();
  });
});

describe('controller session clis', () => {
  function quietPlat(): Platform {
    return fakePlat({
      pathEnv: () => '',
      homeDir: () => path.join(process.cwd(), 'no-such-grok-home'),
      workspaceFolders: () => [],
    });
  }

  it('keeps one CLI when the session is idle', async () => {
    bindPlatform(quietPlat());
    const controller = new GrokController();
    let cleared = false;
    const agent = {
      sessionId: 'session-1',
      clearSession() {
        cleared = true;
        this.sessionId = undefined;
      },
      dispose() {},
    } as unknown as GrokAgent;
    controller.agent = agent;
    controller.currentSessionId = 'session-1';
    controller.status = 'ready';

    await controller.newSession();

    assert.equal(cleared, true);
    assert.equal(controller.agent, agent);
    controller.dispose();
  });

  it('opens a second CLI slot while another session is still prompting', async () => {
    bindPlatform(quietPlat());
    const controller = new GrokController();
    let releasePrompt: (() => void) | undefined;
    let promptStarted: (() => void) | undefined;
    let loaded = false;
    let cleared = false;
    const started = new Promise<void>((resolve) => {
      promptStarted = resolve;
    });
    const agent = {
      sessionId: 'session-1',
      prompt: async () => {
        promptStarted?.();
        await new Promise<void>((resolve) => {
          releasePrompt = resolve;
        });
      },
      clearSession() {
        cleared = true;
      },
      loadSession: async () => {
        loaded = true;
      },
      cancelTurn() {
        releasePrompt?.();
      },
      dispose() {},
    } as unknown as GrokAgent;
    controller.agent = agent;
    controller.currentSessionId = 'session-1';
    controller.status = 'ready';

    const pending = controller.send('hello');
    await started;
    await controller.newSession();

    assert.equal(cleared, false);
    assert.equal(controller.agent, undefined);
    assert.equal(controller.currentSessionId, undefined);

    await controller.loadSession('session-1');

    assert.equal(loaded, false);
    assert.equal(controller.agent, agent);
    assert.equal(controller.currentSessionId, 'session-1');
    assert.equal(controller.status, 'streaming');

    releasePrompt?.();
    await pending;
    controller.dispose();
  });
});

describe('rewindIndexFor', () => {
  const turns = [
    { id: 'u1', role: 'user' },
    { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' },
    { id: 'a2', role: 'assistant' },
    { id: 'u3', role: 'user' },
    { id: 'a3', role: 'assistant' },
  ];

  it('keeps an earlier assistant turn and drops what follows', () => {
    assert.equal(rewindIndexFor(turns, 'a1'), 1);
    assert.equal(rewindIndexFor(turns, 'a2'), 2);
  });

  it('undoes the latest assistant turn', () => {
    assert.equal(rewindIndexFor(turns, 'a3'), 2);
  });

  it('ignores user bubbles', () => {
    assert.equal(rewindIndexFor(turns, 'u2'), undefined);
  });

  it('keeps a note with the earlier turn', () => {
    const withNote = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'n1', role: 'assistant' },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant' },
    ];
    assert.equal(rewindIndexFor(withNote, 'a2'), 1);
    assert.equal(messagesBeforePrompt(withNote, 1), 3);
  });

  it('does not drop the previous visible turn when a hidden prompt advanced the index', () => {
    const hidden = [
      { id: 'u1', role: 'user', promptIndex: 0 },
      { id: 'a1', role: 'assistant' },
      { id: 'u2', role: 'user', promptIndex: 2 },
      { id: 'a2', role: 'assistant' },
      { id: 'u3', role: 'user', promptIndex: 4 },
      { id: 'a3', role: 'assistant' },
    ];
    assert.equal(rewindIndexFor(hidden, 'a1'), 2);
    assert.equal(rewindIndexFor(hidden, 'a2'), 4);
    assert.equal(rewindIndexFor(hidden, 'a3'), 4);
    assert.equal(messagesBeforePrompt(hidden, 2), 2);
    assert.equal(messagesBeforePrompt(hidden, 4), 4);
  });
});

describe('editRewindIndex', () => {
  const messages = [
    { role: 'user', text: '预览网格有问题' },
    { role: 'assistant', text: '看预览' },
    { role: 'user', text: '这个问题存在吗' },
    { role: 'assistant', text: '地图扫描报错' },
    { role: 'user', text: '修复这个问题' },
  ];
  const points = [
    { index: 0, preview: '预览网格有问题' },
    { index: 1, preview: 'Background task abc completed' },
    { index: 2, preview: '这个问题存在吗' },
    { index: 3, preview: '修复这个问题' },
  ];

  it('keeps the error turn when a hidden prompt sits between user messages', () => {
    assert.equal(editRewindIndex(messages, 4, points), 3);
    assert.equal(editRewindIndex(messages, 4), 2);
  });

  it('uses the prompt index stamped on that user message', () => {
    assert.equal(editRewindIndex([{ role: 'user', text: '修复这个问题', promptIndex: 7 }], 0), 7);
  });

  it('matches a truncated rewind preview', () => {
    const text = '截图说的是跨进新区块时，地图会一口气把刚加载的区块都扫掉，画面顿一下。';
    const preview = `${text.slice(0, 57)}...`;
    assert.equal(editRewindIndex([{ role: 'user', text }], 0, [{ index: 5, preview }]), 5);
  });
});
