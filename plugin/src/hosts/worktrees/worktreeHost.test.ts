import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWorktreeApply, parseWorktreeList } from './worktreeHost';

describe('worktree list/apply', () => {
  it('reads snake_case records from x.ai/git/worktree/list', () => {
    const rows = parseWorktreeList({
      result: [
        {
          id: 'wt-1',
          path: '/tmp/wt',
          source_repo: '/repo',
          repo_name: 'app',
          kind: 'session',
          status: 'alive',
          session_id: 'sess-1',
          metadata: { label: 'fix-login' },
        },
      ],
    });
    assert.equal(rows[0].id, 'wt-1');
    assert.equal(rows[0].path, '/tmp/wt');
    assert.equal(rows[0].sessionId, 'sess-1');
    assert.equal(rows[0].label, 'fix-login');
    assert.equal(rows[0].status, 'alive');
  });

  it('treats apply conflicts as a failed merge', () => {
    const ok = parseWorktreeApply({ status: 'success', files: [{ path: 'a.ts' }], gitRoot: '/repo' });
    assert.equal(ok.ok, true);
    assert.equal(ok.files, 1);
    const bad = parseWorktreeApply({
      result: { status: 'conflicts', conflicts: [{ path: 'a.ts' }], files: [] },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.conflicts, 1);
  });
});
