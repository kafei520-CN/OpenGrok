import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  editTurnIndex,
  findTurn,
  parseSessionDiffs,
  safeSessionFile,
  storedFileMatches,
  removeTurn,
  trimTurns,
  upsertTurn,
} from './sessionDiffs';

describe('session diffs', () => {
  it('indexes assistant turns that have edits', () => {
    const messages = [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant', edits: [{ path: 'a.ts' }] },
      { id: 'u2', role: 'user' },
      { id: 'a2', role: 'assistant' },
      { id: 'a3', role: 'assistant', edits: [{ path: 'b.ts' }] },
    ];
    assert.equal(editTurnIndex(messages, 'a1'), 0);
    assert.equal(editTurnIndex(messages, 'a3'), 1);
    assert.equal(editTurnIndex(messages, 'a2'), -1);
  });

  it('replaces a turn by ordinal without shifting neighbors', () => {
    let turns = upsertTurn([], 1, [
      { path: 'b.ts', absPath: '/b.ts', before: 'old', after: 'new' },
    ]);
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.files.length, 0);
    turns = upsertTurn(turns, 0, [
      { path: 'a.ts', absPath: '/a.ts', before: '', after: 'x' },
    ]);
    assert.equal(turns[0]?.files[0]?.path, 'a.ts');
    assert.equal(turns[1]?.files[0]?.path, 'b.ts');
    assert.equal(findTurn(turns, 1)?.files[0]?.path, 'b.ts');
    assert.equal(findTurn(turns, 0)?.files[0]?.path, 'a.ts');
    assert.equal(findTurn(turns, 2), undefined);
  });

  it('removes a reverted turn without shifting earlier ones', () => {
    const turns = removeTurn(
      [
        { files: [{ path: 'a.ts', absPath: '/a.ts', before: 'a', after: 'A' }] },
        { files: [{ path: 'b.ts', absPath: '/b.ts', before: 'b', after: 'B' }] },
      ],
      0,
    );
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.files[0]?.path, 'b.ts');
  });

  it('trims extra turns after rewind', () => {
    const turns = trimTurns(
      [
        { files: [{ path: 'a.ts', absPath: '/a.ts', before: 'a', after: 'A' }] },
        { files: [{ path: 'b.ts', absPath: '/b.ts', before: 'b', after: 'B' }] },
      ],
      1,
    );
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.files[0]?.path, 'a.ts');
  });

  it('parses persisted turns and ignores junk files', () => {
    const turns = parseSessionDiffs({
      v: 1,
      sessionId: 'abc',
      turns: [
        {
          files: [
            { path: 'a.ts', absPath: '/a.ts', before: 'old', after: 'new' },
            { path: 1 },
            null,
          ],
        },
      ],
    });
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.files.length, 1);
    assert.equal(turns[0]?.files[0]?.after, 'new');
  });

  it('matches a stored file by display or absolute path', () => {
    const file = { path: 'src/a.ts', absPath: 'E:/proj/src/a.ts', before: '', after: 'x' };
    assert.equal(storedFileMatches(file, 'src/a.ts'), true);
    assert.equal(storedFileMatches(file, 'e:/proj/src/a.ts'), true);
    assert.equal(storedFileMatches(file, 'src/b.ts'), false);
  });

  it('sanitizes session ids for filenames', () => {
    assert.equal(safeSessionFile('a/b:c'), 'a_b_c');
    assert.equal(safeSessionFile('  '), 'session');
  });
});
