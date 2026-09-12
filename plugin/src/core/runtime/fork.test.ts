import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  forkSessionPayload,
  gitProbePaths,
  parseForkNewSessionId,
  parseWorktreeResume,
  worktreeResumePayload,
} from './fork';

describe('fork wire', () => {
  it('sends sourceSessionId/sourceCwd/newCwd as the CLI requires', () => {
    assert.deepEqual(
      forkSessionPayload({
        sourceSessionId: 'abc',
        sourceCwd: '/repo',
        newCwd: '/repo',
      }),
      {
        sourceSessionId: 'abc',
        sourceCwd: '/repo',
        newCwd: '/repo',
        sessionKind: 'fork',
      },
    );
  });

  it('marks worktree forks and keeps the original workspace dir', () => {
    const payload = forkSessionPayload({
      sourceSessionId: 'abc',
      sourceCwd: '/repo',
      newCwd: '/tmp/wt',
      sessionKind: 'worktree',
      sourceWorkspaceDir: '/repo',
    });
    assert.equal(payload.sessionKind, 'worktree');
    assert.equal(payload.sourceWorkspaceDir, '/repo');
    assert.equal(payload.newCwd, '/tmp/wt');
  });

  it('reads newSessionId from a result envelope', () => {
    assert.equal(
      parseForkNewSessionId({ result: { newSessionId: 'fork-1' } }),
      'fork-1',
    );
    assert.equal(parseForkNewSessionId({ sessionId: 'legacy' }), 'legacy');
  });

  it('parses worktree resume cwd from effectiveCwd', () => {
    assert.deepEqual(
      parseWorktreeResume({
        result: { sessionId: 'wt-1', worktreePath: '/wt', effectiveCwd: '/wt/src' },
      }),
      { sessionId: 'wt-1', cwd: '/wt/src' },
    );
    assert.deepEqual(worktreeResumePayload('sid', '/repo'), {
      sessionId: 'sid',
      sourceCwd: '/repo',
      copyMode: 'dirty',
    });
  });

  it('walks ancestors when probing for .git', () => {
    const cwd = path.join('work', 'app', 'crates', 'cli');
    const probes = gitProbePaths(cwd);
    assert.equal(probes[0], path.join(path.resolve(cwd), '.git'));
    assert.ok(probes.length >= 4);
    assert.ok(probes.some((item) => item.endsWith(path.join('app', '.git'))));
  });
});
