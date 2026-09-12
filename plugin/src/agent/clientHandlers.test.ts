import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readWorkspaceFile, shouldSendBase64, writeWorkspaceFile } from './clientHandlers';
import { bindPlatform, type Platform } from '../core/platform';

function fakePlat(over: Partial<Platform>): Platform {
  return {
    cwd: () => '/tmp',
    workspaceFolders: () => ['/tmp'],
    homeDir: () => '/tmp',
    isTrusted: () => true,
    extensionVersion: () => '0',
    pathEnv: () => '',
    os: () => 'linux',
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

describe('workspace writes', () => {
  it('applies through an open editor instead of writing the disk', async () => {
    const applied: string[] = [];
    const disk: string[] = [];
    bindPlatform(
      fakePlat({
        openText: () => 'old',
        applyText: async (_path, text) => {
          applied.push(text);
          return true;
        },
        writeFile: async () => {
          disk.push('disk');
        },
      }),
    );
    await writeWorkspaceFile({ path: '/tmp/a.ts', content: 'new' });
    assert.deepEqual(applied, ['new']);
    assert.deepEqual(disk, []);
  });

  it('does not clobber a dirty buffer when applyEdit fails', async () => {
    bindPlatform(
      fakePlat({
        openText: () => 'dirty',
        applyText: async () => false,
        writeFile: async () => {
          throw new Error('should not write disk');
        },
      }),
    );
    await assert.rejects(
      () => writeWorkspaceFile({ path: '/tmp/a.ts', content: 'new' }),
      /open file/,
    );
  });

  it('uses readOpenText when the file is open in the host editor', async () => {
    const applied: string[] = [];
    bindPlatform(
      fakePlat({
        readOpenText: async () => 'from-editor',
        applyText: async (_path, text) => {
          applied.push(text);
          return true;
        },
        writeFile: async () => {
          throw new Error('should not write disk');
        },
      }),
    );
    await writeWorkspaceFile({ path: '/tmp/open.ts', content: 'patched' });
    assert.deepEqual(applied, ['patched']);
  });

  it('writes the disk when the file is not open', async () => {
    const disk: string[] = [];
    bindPlatform(
      fakePlat({
        writeFile: async (_path, data) => {
          disk.push(Buffer.from(data).toString('utf8'));
        },
      }),
    );
    await writeWorkspaceFile({ path: '/tmp/b.ts', content: 'fresh' });
    assert.deepEqual(disk, ['fresh']);
  });
});

describe('workspace reads', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

  it('returns utf8 text without an encoding meta', async () => {
    bindPlatform(
      fakePlat({
        readFile: async () => new TextEncoder().encode('hello café'),
      }),
    );
    const result = await readWorkspaceFile({ path: '/tmp/a.ts' });
    assert.equal(result.content, 'hello café');
    assert.equal(result._meta, undefined);
  });

  it('base64-encodes png bytes so ACP JSON does not corrupt them', async () => {
    bindPlatform(
      fakePlat({
        openText: () => 'not the png',
        readFile: async () => png,
      }),
    );
    const result = await readWorkspaceFile({ path: '/tmp/shot.png' });
    assert.equal(result._meta?.encoding, 'base64');
    assert.deepEqual(Buffer.from(result.content, 'base64'), Buffer.from(png));
  });

  it('does not use the open editor buffer for image paths', async () => {
    bindPlatform(
      fakePlat({
        openText: () => 'garbage',
        readFile: async () => png,
      }),
    );
    const result = await readWorkspaceFile({ path: '/tmp/photo.PNG' });
    assert.equal(result._meta?.encoding, 'base64');
    assert.deepEqual(Buffer.from(result.content, 'base64'), Buffer.from(png));
  });

  it('skips the body on a limit-0 exists probe', async () => {
    let reads = 0;
    bindPlatform(
      fakePlat({
        fileExists: async () => true,
        readFile: async () => {
          reads += 1;
          return png;
        },
      }),
    );
    const result = await readWorkspaceFile({ path: '/tmp/shot.png', limit: 0 });
    assert.equal(result.content, '');
    assert.equal(result._meta, undefined);
    assert.equal(reads, 0);
  });

  it('detects png magic even without an image extension', () => {
    assert.equal(shouldSendBase64('/tmp/noext', png), true);
    assert.equal(shouldSendBase64('/tmp/a.ts', new TextEncoder().encode('fn')), false);
  });
});
