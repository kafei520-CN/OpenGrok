import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ATTACH_TEXT_MAX,
  addActiveFile,
  applyStoredUserMedia,
  cloneQueuedPrompt,
  makeQueuedPrompt,
  packUserMedia,
  pasteClipboard,
  quoteText,
  userMediaStamps,
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

  it('keeps a pdf as a path chip, not image or utf8 text', async () => {
    const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0x01]);
    bindPlatform(
      fakePlat({
        readFile: async () => pdf,
      }),
    );
    const host: AttachmentHost = { attachments: [], emit() {} };
    await pasteClipboard(host, { uris: ['file:///E:/docs/spec.pdf'] });
    assert.equal(host.attachments.length, 1);
    assert.equal(host.attachments[0]?.path, 'E:/docs/spec.pdf');
    assert.equal(host.attachments[0]?.mimeType, 'application/pdf');
    assert.equal(host.attachments[0]?.data, undefined);
    assert.equal(host.attachments[0]?.text, undefined);
  });

  it('attaches a zip as a file chip, not a folder', async () => {
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    bindPlatform(
      fakePlat({
        readFile: async () => zip,
      }),
    );
    const host: AttachmentHost = { attachments: [], emit() {} };
    await pasteClipboard(host, { uris: ['file:///E:/mods/pack.zip'] });
    assert.equal(host.attachments.length, 1);
    assert.equal(host.attachments[0]?.path, 'E:/mods/pack.zip');
    assert.equal(host.attachments[0]?.mimeType, 'application/zip');
    assert.equal(host.attachments[0]?.folder, false);
    assert.equal(host.attachments[0]?.data, undefined);
  });

  it('attaches a folder path when readFile fails', async () => {
    bindPlatform(
      fakePlat({
        readFile: async () => {
          throw new Error('EISDIR');
        },
      }),
    );
    const host: AttachmentHost = { attachments: [], emit() {} };
    await pasteClipboard(host, { uris: ['file:///E:/work/src'] });
    assert.equal(host.attachments.length, 1);
    assert.equal(host.attachments[0]?.path, 'E:/work/src');
    assert.equal(host.attachments[0]?.label, 'src');
    assert.equal(host.attachments[0]?.text, undefined);
    assert.equal(host.attachments[0]?.folder, true);
  });

  it('keeps queued images on their own prompt instead of mixing the next one', () => {
    const first = makeQueuedPrompt(
      'one',
      [{ id: 'a', label: 'a.png', mimeType: 'image/png', data: 'aaa' }],
      'q1',
    );
    const second = makeQueuedPrompt(
      'two',
      [{ id: 'b', label: 'b.png', mimeType: 'image/png', data: 'bbb' }],
      'q2',
    );
    assert.equal(first.attachments[0]?.data, 'aaa');
    assert.equal(second.attachments[0]?.data, 'bbb');
    const copy = cloneQueuedPrompt(first);
    copy.attachments[0] = { ...copy.attachments[0]!, data: 'zzz' };
    assert.equal(first.attachments[0]?.data, 'aaa');
    assert.deepEqual(
      packUserMedia(first.attachments).images?.map((item) => item.data),
      ['aaa'],
    );
    assert.deepEqual(
      packUserMedia(second.attachments).images?.map((item) => item.data),
      ['bbb'],
    );
  });

  it('copies referenced files and images onto the user message', () => {
    const packed = packUserMedia([
      {
        id: 'img',
        label: 'shot.png',
        mimeType: 'image/png',
        data: 'aaaa',
      },
      {
        id: 'pdf',
        label: 'spec.pdf',
        path: 'E:/docs/spec.pdf',
        mimeType: 'application/pdf',
      },
      {
        id: 'dir',
        label: 'src',
        path: 'E:/work/src',
        folder: true,
      },
    ]);
    assert.equal(packed.images?.length, 1);
    assert.equal(packed.images?.[0]?.data, 'aaaa');
    assert.equal(packed.files?.length, 2);
    assert.equal(packed.files?.[0]?.label, 'spec.pdf');
    assert.equal(packed.files?.[0]?.path, 'E:/docs/spec.pdf');
    assert.equal(packed.files?.[1]?.folder, true);
  });

  it('restores stored user files onto replayed text-only turns', () => {
    const stamps = userMediaStamps([
      {
        id: 'u',
        role: 'user',
        text: 'look at this',
        tools: [],
        files: [{ label: 'spec.pdf', path: 'E:/docs/spec.pdf', mimeType: 'application/pdf' }],
        images: [{ mimeType: 'image/png', data: 'aaaa' }],
      },
    ]);
    const messages = [
      { id: 'u', role: 'user' as const, text: 'look at this', tools: [] },
    ];
    applyStoredUserMedia(messages, stamps);
    assert.equal(messages[0]?.files?.[0]?.label, 'spec.pdf');
    assert.equal(messages[0]?.images?.[0]?.data, 'aaaa');
  });

  it('attaches nameless binary uploads without inline text', async () => {
    bindPlatform(fakePlat());
    const host: AttachmentHost = { attachments: [], emit() {} };
    await pasteClipboard(host, {
      files: [{ name: 'scan.pdf', mimeType: 'application/pdf' }],
    });
    assert.equal(host.attachments.length, 1);
    assert.equal(host.attachments[0]?.label, 'scan.pdf');
    assert.equal(host.attachments[0]?.mimeType, 'application/pdf');
    assert.equal(host.attachments[0]?.text, undefined);
  });
});
