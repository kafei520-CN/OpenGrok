import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTaskList } from './tasksHost';
import { latestPlan } from '../memory/memoryHost';

describe('tasks and plan', () => {
  it('reads task snapshots', () => {
    const rows = parseTaskList({
      result: {
        tasks: [
          {
            task_id: 't1',
            display_command: 'cargo test',
            command: '/bin/bash -lc cargo test',
            cwd: '/repo',
            completed: false,
            kind: 'bash',
          },
        ],
      },
    });
    assert.equal(rows[0].id, 't1');
    assert.equal(rows[0].command, 'cargo test');
    assert.equal(rows[0].completed, false);
  });

  it('picks the latest non-empty plan', () => {
    assert.equal(latestPlan([{ plan: 'first' }, { plan: '' }, { plan: 'last' }]), 'last');
    assert.equal(latestPlan([]), '');
  });
});
