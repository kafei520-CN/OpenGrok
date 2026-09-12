import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRosterList, parseSubagentList, rosterFromHistory } from './roster';

describe('roster parse', () => {
  it('unwraps the result envelope used by x.ai/sessions/list', () => {
    const rows = parseRosterList({
      result: {
        sessions: [
          {
            sessionId: 'sess-1',
            title: 'Fix roster',
            cwd: '/repo/wt',
            isWorktree: true,
            modelId: 'grok-4',
            activity: 'working',
            lastTurnSummary: 'merged',
            resident: true,
          },
        ],
      },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'sess-1');
    assert.equal(rows[0].isWorktree, true);
    assert.equal(rows[0].activity, 'working');
  });

  it('does not treat a wrapped body as an empty roster', () => {
    assert.equal(parseRosterList({ result: { sessions: [] } }).length, 0);
    assert.equal(parseRosterList({ sessions: [{ sessionId: 'a', cwd: '/', activity: 'idle' }] }).length, 1);
  });

  it('parses running subagents', () => {
    const rows = parseSubagentList({
      result: {
        subagents: [
          {
            subagentId: 'sa-1',
            parentSessionId: 'p',
            childSessionId: 'c',
            subagentType: 'explore',
            description: 'find files',
            durationMs: 5000,
            contextUsagePct: 12,
          },
        ],
      },
    });
    assert.equal(rows[0].id, 'sa-1');
    assert.equal(rows[0].type, 'explore');
    assert.equal(rows[0].durationMs, 5000);
  });

  it('builds a dashboard roster from session history when the live list is empty', () => {
    const rows = rosterFromHistory(
      [
        { id: 'a', title: 'Now', cwd: '/repo', sessionKind: 'worktree' },
        { id: 'b', title: 'Old', cwd: '/repo' },
      ],
      'a',
      true,
    );
    assert.equal(rows[0].activity, 'working');
    assert.equal(rows[0].isWorktree, true);
    assert.equal(rows[1].activity, 'dormant');
  });
});
