import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ATTACH_TEXT_MAX,
  addActiveFile,
  pasteClipboard,
  quoteText,
  type AttachmentHost,
} from './attachments';
import { bindPlatform, type Platform } from '../../core/platform';

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

describe('attachments', () => {
  it('keeps small active files inline', () => {
    bindPlatform(
      fakePlat({
        getActiveFile: () => ({ path: '/work/app/small.ts', text: 'export const n = 1;\n' }),
      }),
    );
    const host: AttachmentHost = { attachments: [], emit() {} };
    addActiveFile(host);
    assert.equal(host.attachments[0]?.text, 'export const n = 1;\n');
  });

  it('drops inline text when the active file is too large', () => {
    bindPlatform(
      fakePlat({
        getActiveFile: () => ({
          path: '/work/app/huge.ts',
          text: 'x'.repeat(ATTACH_TEXT_MAX),
        }),
      }),
    );
    const host: AttachmentHost = { attachments: [], emit() {} };
    addActiveFile(host);
    assert.equal(host.attachments[0]?.path, '/work/app/huge.ts');
    assert.equal(host.attachments[0]?.text, undefined);
  });

  it('quotes selected chat text as an attachment chip', () => {
    bindPlatform(fakePlat());
    const host: AttachmentHost = { attachments: [], emit() {} };
    quoteText(host, '  hello from a bubble  ');
    assert.equal(host.attachments.length, 1);
    assert.equal(host.attachments[0]?.text, 'hello from a bubble');
    assert.equal(host.attachments[0]?.label, 'hello from a bubble');
  });

  it('attaches dropped file URIs as chips', async () => {
    bindPlatform(
      fakePlat({
        readFile: async () => new TextEncoder().encode('export const n = 1;\n'),
      }),
    );
    const host: AttachmentHost = { attachments: [], emit() {} };
    await pasteClipboard(host, { uris: ['file:///C:/work/a.ts', 'file:///C:/work/a.ts'] });
    assert.equal(host.attachments.length, 1);
    assert.equal(host.attachments[0]?.path, 'C:/work/a.ts');
    assert.equal(host.attachments[0]?.label, 'a.ts');
    assert.equal(host.attachments[0]?.text, 'export const n = 1;\n');
  });

  it('attaches a workspace png as image data, not utf8 text', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    bindPlatform(
      fakePlat({
        readFile: async () => png,
      }),
    );
    const host: AttachmentHost = { attachments: [], emit() {} };
    await pasteClipboard(host, { uris: ['file:///E:/shots/block.png'] });
    assert.equal(host.attachments.length, 1);
    assert.equal(host.attachments[0]?.mimeType, 'image/png');
    assert.equal(host.attachments[0]?.data, Buffer.from(png).toString('base64'));
    assert.equal(host.attachments[0]?.text, undefined);
  });

  it('attaches browser-picked text files without a workspace path', async () => {
    bindPlatform(fakePlat());
    const host: AttachmentHost = { attachments: [], emit() {} };
    await pasteClipboard(host, {
      files: [{ name: 'note.md', mimeType: 'text/markdown', text: '# hi\n' }],
    });
    assert.equal(host.attachments.length, 1);
    assert.equal(host.attachments[0]?.label, 'note.md');
    assert.equal(host.attachments[0]?.path, undefined);
    assert.equal(host.attachments[0]?.text, '# hi\n');
  });
});
