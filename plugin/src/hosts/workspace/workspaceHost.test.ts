import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { bindPlatform, type Platform } from '../../core/platform';
import { fileHash } from '../../workspace/workspaceIndex';
import { saveWorkspaceFile } from './workspaceHost';

describe('workspace file saves', () => {
  it('rejects a stale draft without overwriting the current file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-ws-save-'));
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'updated elsewhere');
    bindPlatform({
      cwd: () => root,
      workspaceFolders: () => [root],
      language: () => 'en',
      getConfig: (_key, fallback) => fallback,
      readFile: (target) => fs.promises.readFile(target),
      writeFile: (target, data) => fs.promises.writeFile(target, data),
      info() {},
      warn() {},
      relativePath: (target) => path.relative(root, target),
    } as unknown as Platform);
    const messages: unknown[] = [];
    await saveWorkspaceFile(
      { running: () => true, broadcast: (message) => messages.push(message) },
      filePath,
      fileHash('original'),
      'my stale draft',
    );
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'updated elsewhere');
    assert.deepEqual(messages, [
      { type: 'workspaceSaveResult', path: filePath, ok: false, conflict: true },
    ]);
  });

  it('saves when the current file still matches the supplied hash', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-ws-save-'));
    const filePath = path.join(root, 'notes.md');
    fs.writeFileSync(filePath, 'original');
    bindPlatform({
      cwd: () => root,
      workspaceFolders: () => [root],
      language: () => 'en',
      getConfig: (_key, fallback) => fallback,
      readFile: (target) => fs.promises.readFile(target),
      writeFile: (target, data) => fs.promises.writeFile(target, data),
      info() {},
      warn() {},
      relativePath: (target) => path.relative(root, target),
    } as unknown as Platform);
    const messages: unknown[] = [];
    await saveWorkspaceFile(
      { running: () => true, broadcast: (message) => messages.push(message) },
      filePath,
      fileHash('original'),
      'new text',
    );
    assert.equal(fs.readFileSync(filePath, 'utf8'), 'new text');
    assert.deepEqual(messages, [
      { type: 'workspaceSaveResult', path: filePath, ok: true, hash: fileHash('new text') },
    ]);
  });
});
