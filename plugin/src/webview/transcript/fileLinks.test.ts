import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileLinkHtml, linkInlineFilePaths, looksLikeInlinePath } from './fileLinks';

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

  it('stashes prose paths and leaves surrounding text', () => {
    const slots: string[] = [];
    const stash = (html: string) => {
      slots.push(html);
      return `\u0000${slots.length - 1}\u0000`;
    };
    const next = linkInlineFilePaths('see plugin/src/foo.ts please', stash);
    assert.equal(next, `see \u00000\u0000 please`);
    assert.match(slots[0] ?? '', /foo\.ts/);
  });
});
