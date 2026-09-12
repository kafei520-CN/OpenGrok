import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { parseSkillMeta, safeSkillDirName, zipEntryUnsafe } from './skillsHost';

describe('skills files', () => {
  it('reads name and description from frontmatter', () => {
    const meta = parseSkillMeta(
      '---\nname: commit\ndescription: Make a conventional commit.\n---\n\n# Body\n',
    );
    assert.equal(meta.name, 'commit');
    assert.equal(meta.description, 'Make a conventional commit.');
  });

  it('returns empty meta without a frontmatter block', () => {
    assert.deepEqual(parseSkillMeta('# just markdown\n'), {});
  });

  it('sanitizes skill directory names', () => {
    assert.equal(safeSkillDirName('Review PR'), 'Review-PR');
    assert.equal(safeSkillDirName('foo:bar'), 'foo-bar');
  });

  it('rejects zip members that escape the extract root', () => {
    const dest = path.join(os.tmpdir(), 'grok-skill-safe');
    assert.equal(zipEntryUnsafe(dest, 'skill/SKILL.md'), false);
    assert.equal(zipEntryUnsafe(dest, './skill/SKILL.md'), false);
    assert.equal(zipEntryUnsafe(dest, '../evil.md'), true);
    assert.equal(zipEntryUnsafe(dest, 'skill/../../outside.md'), true);
    assert.equal(zipEntryUnsafe(dest, '/tmp/evil.md'), true);
    assert.equal(zipEntryUnsafe(dest, 'C:\\Windows\\evil.md'), true);
  });
});
