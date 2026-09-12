import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  groupSessionsByWorkspace,
  normalizeWorkspacePath,
  workspaceFolderLabel,
} from './sessionGroups';
import type { SessionRow } from '../core/types';

function row(over: Partial<SessionRow> & Pick<SessionRow, 'id' | 'title'>): SessionRow {
  return over;
}

describe('session workspace groups', () => {
  it('normalizes windows paths for grouping', () => {
    assert.equal(normalizeWorkspacePath('E:\\Project\\grok-build\\'), 'e:/project/grok-build');
    assert.equal(workspaceFolderLabel('E:\\Project\\grok-build'), 'grok-build');
  });

  it('groups by folder and marks the current workspace first', () => {
    const groups = groupSessionsByWorkspace(
      [
        row({
          id: 'a',
          title: 'Other chat',
          cwd: 'D:\\other\\app',
          updatedAt: '2026-08-28T10:00:00Z',
        }),
        row({
          id: 'b',
          title: 'Plugin',
          cwd: 'E:\\Project\\grok-build',
          updatedAt: '2026-08-28T12:00:00Z',
        }),
        row({
          id: 'c',
          title: 'More plugin',
          cwd: 'e:/Project/grok-build/',
          updatedAt: '2026-08-28T11:00:00Z',
        }),
        row({ id: 'd', title: 'No folder', updatedAt: '2026-08-28T13:00:00Z' }),
      ],
      'E:\\Project\\grok-build',
    );
    assert.equal(groups.length, 3);
    assert.equal(groups[0]?.current, true);
    assert.equal(groups[0]?.label, 'grok-build');
    assert.equal(groups[0]?.sessions.length, 2);
    assert.equal(groups[1]?.label, 'app');
    assert.equal(groups[1]?.current, false);
    assert.equal(groups[2]?.key, '');
    assert.equal(groups[2]?.sessions[0]?.id, 'd');
  });
});
