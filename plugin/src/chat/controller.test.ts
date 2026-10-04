import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { GrokController, rewindIndexFor } from './controller';
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
});
