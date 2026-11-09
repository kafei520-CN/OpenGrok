import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterSkills, insertSkillToken, skillPromptText, skillToken, type SkillRefSource } from './skillRef';

const commit: SkillRefSource = {
  name: 'Commit',
  dirPath: 'C:\\Users\\dev\\.grok\\skills\\commit',
  enabled: true,
  description: 'Create a commit',
  scope: 'global',
};

const review: SkillRefSource = {
  name: 'review',
  dirPath: '/home/dev/.grok/skills/review',
  enabled: true,
  description: 'Review a diff',
};

describe('skill citations', () => {
  it('uses a lowercase slash token', () => {
    assert.equal(skillToken(commit), 'commit');
    assert.equal(skillToken({ name: 'My Skill', dirPath: '/skills/my-skill' }), 'my-skill');
    assert.equal(skillToken({ name: '..', dirPath: '/skills/..' }), undefined);
  });

  it('filters enabled skills by name or description', () => {
    const off: SkillRefSource = { ...review, name: 'lint', enabled: false, description: 'lint' };
    assert.deepEqual(
      filterSkills([commit, review, off], 'com').map((hit) => hit.token),
      ['commit'],
    );
    assert.deepEqual(
      filterSkills([commit, review], 'diff').map((hit) => hit.token),
      ['review'],
    );
  });

  it('inserts a trailing citation', () => {
    assert.equal(insertSkillToken('please ', 'commit'), 'please #commit ');
    assert.equal(insertSkillToken('use #co', 'commit'), 'use #commit ');
    assert.equal(insertSkillToken('', 'commit'), '#commit ');
  });

  it('rewrites a cited skill to the slash form the CLI expands', () => {
    assert.equal(skillPromptText('#Commit fix typo', [commit]), '/commit fix typo');
    assert.equal(
      skillPromptText('please #review the diff', [commit, review]),
      '/review\nplease #review the diff',
    );
    assert.equal(
      skillPromptText('use #commit and #review', [commit, review]),
      '/commit /review\nuse #commit and #review',
    );
    assert.equal(skillPromptText('/goal #commit', [commit]), '/goal /commit');
    assert.equal(skillPromptText('#commit.', [commit]), '#commit.');
    assert.equal(skillPromptText('C#commit', [commit]), 'C#commit');
    assert.equal(skillPromptText('#missing', [commit]), '#missing');
    assert.equal(skillPromptText('#commit', [{ ...commit, enabled: false }]), '#commit');
  });
});
