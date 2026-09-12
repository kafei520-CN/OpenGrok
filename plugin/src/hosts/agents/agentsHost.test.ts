import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAgentFileName,
  parseAgentFrontmatter,
  safeAgentStem,
  wrapAgentMarkdown,
} from './agentsHost';

describe('agent definitions', () => {
  it('reads name and description from YAML frontmatter', () => {
    const meta = parseAgentFrontmatter(
      '---\nname: reviewer\ndescription: Review a pull request.\n---\n\nBe strict.\n',
    );
    assert.equal(meta.name, 'reviewer');
    assert.equal(meta.description, 'Review a pull request.');
  });

  it('wraps plain markdown so the CLI can parse it', () => {
    const wrapped = wrapAgentMarkdown('notes', '# Hello\n');
    assert.match(wrapped, /^---\nname: notes\n/);
    assert.equal(wrapAgentMarkdown('x', '---\nname: x\n---\n'), '---\nname: x\n---\n');
  });

  it('treats .md.disabled as a toggled-off agent file', () => {
    assert.deepEqual(parseAgentFileName('reviewer.md'), { stem: 'reviewer', enabled: true });
    assert.deepEqual(parseAgentFileName('reviewer.md.disabled'), {
      stem: 'reviewer',
      enabled: false,
    });
    assert.equal(parseAgentFileName('notes.txt'), undefined);
  });

  it('sanitizes import stems', () => {
    assert.equal(safeAgentStem('C:\\\\tmp\\\\foo:bar.md'), 'foo-bar');
  });
});
