import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { bindPlatform, type Platform } from '../../core/platform';
import { runSlashAction, type SlashRuntime } from './slashHost';

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

function runtime(over: Partial<SlashRuntime> = {}): SlashRuntime {
  return {
    status: 'idle',
    messages: [{ id: '1', role: 'assistant', text: 'hello', tools: [] }],
    queue: [],
    compactMode: false,
    timestamps: false,
    multiline: false,
    cwd: () => process.cwd(),
    emit() {},
    note() {},
    async newSession() {},
    async resumePicker() {},
    async openDashboard() {},
    openAgents() {},
    async login() {},
    async logout() {},
    async send() {},
    async compact() {},
    async rewind() {},
    async forkCurrent() {},
    async renameListedSession() {},
    async deleteListedSession() {},
    copyLast() {},
    async exportChat() {},
    async setMode() {},
    async setModel() {},
    async setEffort() {},
    resolveModelId: () => undefined,
    async sendAgentSlash() {},
    openSettings() {},
    openMcps() {},
    openSkills() {},
    openWorktrees() {},
    openExt() {},
    async openTasks() {},
    openMemory() {},
    openPlan() {},
    toggleUiFlag() {},
    ...over,
  };
}

describe('slash copy path', () => {
  it('writes the last reply inside the workspace', async () => {
    const written: Array<{ path: string; text: string }> = [];
    const dest = path.join(process.cwd(), 'out.md');
    bindPlatform(
      fakePlat({
        workspaceFolders: () => [process.cwd()],
        writeFile: async (filePath, data) => {
          written.push({ path: filePath, text: Buffer.from(data).toString('utf8') });
        },
      }),
    );
    await runSlashAction(runtime(), { kind: 'copy', path: dest });
    assert.equal(written.length, 1);
    assert.equal(written[0].text, 'hello');
  });

  it('refuses to write outside the workspace', async () => {
    const written: string[] = [];
    const notes: string[] = [];
    bindPlatform(
      fakePlat({
        workspaceFolders: () => [process.cwd()],
        writeFile: async (filePath) => {
          written.push(filePath);
        },
      }),
    );
    await runSlashAction(
      runtime({
        note(text) {
          notes.push(text);
        },
      }),
      { kind: 'copy', path: path.resolve(process.cwd(), '..', 'outside.md') },
    );
    assert.equal(written.length, 0);
    assert.equal(notes.some((row) => row.includes('workspace') || row.includes('工作区')), true);
  });
});
