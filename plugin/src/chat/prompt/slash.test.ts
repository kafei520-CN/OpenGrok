import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifySlash, filterCommands, parseSlash, promptModeMeta, resolveAlias } from './slash';

describe('slash routing', () => {
  it('parses command and args', () => {
    assert.deepEqual(parseSlash('/compact keep auth'), {
      command: 'compact',
      args: 'keep auth',
    });
  });

  it('routes aliases to host actions', () => {
    assert.equal(resolveAlias('clear'), 'new');
    assert.equal(classifySlash('/clear').kind, 'newSession');
    assert.equal(classifySlash('/undo').kind, 'rewind');
    assert.equal(classifySlash('/cost manage').kind, 'usage');
    assert.equal(classifySlash('/mcps').kind, 'mcpSettings');
    assert.equal(classifySlash('/dashboard').kind, 'dashboard');
    assert.equal(classifySlash('/sessions').kind, 'dashboard');
    assert.equal(classifySlash('/agents').kind, 'agents');
    assert.equal(classifySlash('/personas').kind, 'agents');
    assert.equal(classifySlash('/resume').kind, 'resume');
    assert.equal(classifySlash('/worktrees').kind, 'worktrees');
    assert.equal(classifySlash('/tasks').kind, 'tasks');
    assert.equal(classifySlash('/memory').kind, 'memory');
    assert.equal(classifySlash('/view-plan').kind, 'viewPlan');
    assert.equal(classifySlash('/plugins').kind, 'extensions');
  });

  it('passes agent-owned commands through', () => {
    assert.equal(classifySlash('/imagine a cat').kind, 'pass');
    assert.equal(classifySlash('/workflow review-changes').kind, 'pass');
    assert.equal(classifySlash('/goal status').kind, 'pass');
    assert.equal(classifySlash('hello').kind, 'pass');
  });

  it('filters the command menu', () => {
    const hits = filterCommands(
      [
        { name: 'compact', description: 'Compress history' },
        { name: 'plan', description: 'Enter plan mode' },
      ],
      'pla',
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0].name, 'plan');
  });

  it('maps session modes onto prompt _meta.mode', () => {
    assert.equal(promptModeMeta('ask'), 'ask');
    assert.equal(promptModeMeta('plan'), 'plan');
    assert.equal(promptModeMeta('default'), 'agent');
  });
});
