import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clipboardToPath, collectDropUris, dropFilePath, splitClipboardPaths } from './clipboard';

describe('clipboard paths', () => {
  it('splits file paths from pasted text', () => {
    assert.deepEqual(splitClipboardPaths('E:\\tmp\\a.txt\nnot a path\n/tmp/b.ts'), [
      'E:\\tmp\\a.txt',
      '/tmp/b.ts',
    ]);
  });

  it('decodes file URIs', () => {
    assert.equal(clipboardToPath('file:///C:/Users/a/b.txt'), 'C:/Users/a/b.txt');
    assert.equal(clipboardToPath('C:\\Users\\a\\b.txt'), 'C:\\Users\\a\\b.txt');
    assert.equal(clipboardToPath('"C:\\Users\\a\\b.txt"'), 'C:\\Users\\a\\b.txt');
    assert.equal(clipboardToPath('vscode://file/C:/Users/a/b.txt'), 'C:/Users/a/b.txt');
    assert.equal(clipboardToPath('hello'), undefined);
  });

  it('reads VS Code explorer and multi-file drops', () => {
    assert.equal(
      clipboardToPath('vscode-file://vscode-app/C:/work/a.ts'),
      'C:/work/a.ts',
    );
    const bag: Record<string, string> = {
      'application/vnd.code.uri-list': 'file:///C:/work/a.ts\nfile:///C:/work/b.ts',
    };
    const paths = collectDropUris((type) => bag[type] ?? '');
    assert.deepEqual(paths, ['C:/work/a.ts', 'C:/work/b.ts']);
    const codefiles = collectDropUris((type) =>
      type === 'codefiles' ? 'file:///C:/work/z.ts' : '',
    );
    assert.deepEqual(codefiles, ['C:/work/z.ts']);
  });

  it('merges native drop paths and JSON resource URLs', () => {
    const bag: Record<string, string> = {
      resourceurls: JSON.stringify(['file:///C:/work/c.ts']),
      'text/uri-list': 'vscode-file://vscode-app/C:/work/c.ts',
    };
    const paths = collectDropUris((type) => bag[type] ?? '', ['E:\\work\\d.ts', 'E:\\work\\d.ts']);
    assert.deepEqual(paths, ['C:/work/c.ts', 'E:\\work\\d.ts']);
  });

  it('prefers the host native path for dropped files', () => {
    assert.equal(dropFilePath({ path: 'C:\\work\\a.ts' }), 'C:\\work\\a.ts');
    assert.equal(dropFilePath({ path: 'C:\\work\\a.ts' }, 'E:\\shots\\a.pdf'), 'E:\\shots\\a.pdf');
    assert.equal(dropFilePath({}), undefined);
  });

  it('reads explorer uri-list blobs passed as extra strings', () => {
    const paths = collectDropUris(
      () => '',
      ['file:///C:/work/a.ts\nfile:///C:/work/b.ts'],
      ['application/vnd.code.uri-list'],
    );
    assert.deepEqual(paths, ['C:/work/a.ts', 'C:/work/b.ts']);
  });
});
