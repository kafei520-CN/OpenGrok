import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileLinkHtml, linkInlineFilePaths, looksLikeInlinePath, parseCodeRef } from './fileLinks';

describe('inline file links', () => {
  it('accepts windows, unix, and repo-relative paths', () => {
    assert.equal(looksLikeInlinePath('C:\\Users\\a\\b.ts'), true);
    assert.equal(looksLikeInlinePath('file:///C:/work/a.ts'), true);
    assert.equal(looksLikeInlinePath('/tmp/note.md'), true);
    assert.equal(looksLikeInlinePath('plugin/src/chat/controller.ts'), true);
    assert.equal(looksLikeInlinePath('./foo.json'), true);
    assert.equal(looksLikeInlinePath('README.md'), true);
  });

  it('rejects urls, prose, and unknown extensions', () => {
    assert.equal(looksLikeInlinePath('https://example.com/a.ts'), false);
    assert.equal(looksLikeInlinePath('hello world'), false);
    assert.equal(looksLikeInlinePath('this.value'), false);
    assert.equal(looksLikeInlinePath('e.g.'), false);
  });

  it('renders a blue filename chip with the full path on the button', () => {
    const html = fileLinkHtml('plugin/src/foo.ts');
    assert.match(html, /class="md-file"/);
    assert.match(html, /data-path="plugin\/src\/foo.ts"/);
    assert.match(html, />foo\.ts<\/span>/);
    assert.match(html, /md-file-icon/);
  });

  it('parses file and method refs with line numbers', () => {
    assert.deepEqual(parseCodeRef('RopePhysics.java (line 268)'), {
      kind: 'file',
      name: 'RopePhysics.java',
      path: 'RopePhysics.java',
      line: 268,
    });
    assert.deepEqual(parseCodeRef('updateTargetSegmentLengths (line 200)'), {
      kind: 'symbol',
      name: 'updateTargetSegmentLengths',
      line: 200,
    });
    assert.equal(parseCodeRef('DAMPING = 0.965'), undefined);
  });

  it('renders a line suffix and a language file icon', () => {
    const html = fileLinkHtml('RopePhysics.java (line 268)');
    assert.match(html, /data-line="268"/);
    assert.match(html, /\(line 268\)/);
    assert.match(html, /class="md-file-icon"/);
  });

  it('renders folder paths with the folder icon', () => {
    const ref = parseCodeRef('plugin/media/file-icons/');
    assert.equal(ref?.kind, 'folder');
    assert.equal(ref?.name, 'file-icons');
    const html = fileLinkHtml('plugin/media/file-icons/');
    assert.match(html, /md-dir/);
    assert.match(html, /file-icons/);
  });

  it('stashes only @-marked paths and leaves surrounding text', () => {
    const slots: string[] = [];
    const stash = (html: string) => {
      slots.push(html);
      return `\u0000${slots.length - 1}\u0000`;
    };
    const next = linkInlineFilePaths('see @plugin/src/foo.ts please', stash);
    assert.equal(next, `see \u00000\u0000 please`);
    assert.match(slots[0] ?? '', /foo\.ts/);
  });

  it('does not treat fractions or unmarked paths as files', () => {
    const slots: string[] = [];
    const stash = (html: string) => {
      slots.push(html);
      return `\u0000${slots.length - 1}\u0000`;
    };
    assert.equal(parseCodeRef('1/5'), undefined);
    assert.equal(parseCodeRef('2026/09/20'), undefined);
    assert.equal(linkInlineFilePaths('正确率都是 1/5。平均 plugin/src/foo.ts', stash), '正确率都是 1/5。平均 plugin/src/foo.ts');
    assert.equal(slots.length, 0);
    assert.equal(looksLikeInlinePath('1/5'), false);
  });

  it('parses a leading @ marker then strips it from the chip path', () => {
    const ref = parseCodeRef('@plugin/src/foo.ts');
    assert.equal(ref?.kind, 'file');
    assert.equal(ref?.path, 'plugin/src/foo.ts');
    const html = fileLinkHtml('@RopePhysics.java (line 268)');
    assert.match(html, /data-path="RopePhysics.java"/);
    assert.doesNotMatch(html, /@RopePhysics/);
  });
});
