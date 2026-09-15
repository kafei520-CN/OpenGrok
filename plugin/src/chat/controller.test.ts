import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { GrokController, rewindIndexFor } from './controller';
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
  toolCall: { title: 'run', kind: 'execute' },
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
      toolCall: { title: 'other', kind: 'execute' },
    });
    assert.deepEqual(await first, cancelledPermission());
    controller.cancelTurn();
    assert.deepEqual(await second, cancelledPermission());
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
