import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { isHeavyWorkspace, workspaceStartupHints } from './startup';

describe('workspace startup', () => {
  it('skips git status and layout when a heavy marker is at the root', () => {
    const big = path.resolve('/big');
    const small = path.resolve('/small');
    const files = new Set([path.join(big, 'node_modules')]);
    const exists = (filePath: string) => files.has(filePath);
    assert.equal(isHeavyWorkspace([big], exists), true);
    assert.deepEqual(workspaceStartupHints([big], exists), {
      skipGitStatus: true,
      skipProjectLayout: true,
    });
    assert.equal(isHeavyWorkspace([small], exists), false);
    assert.equal(workspaceStartupHints([small], exists), undefined);
  });

  it('only stats top-level marker names', () => {
    const root = path.resolve('/proj');
    const seen: string[] = [];
    isHeavyWorkspace([root], (filePath) => {
      seen.push(filePath);
      return false;
    });
    assert.ok(seen.length > 0 && seen.length <= 16);
    assert.ok(seen.every((filePath) => path.dirname(filePath) === root));
  });
});
