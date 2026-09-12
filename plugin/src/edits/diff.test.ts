import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFileDiff,
  collapseRows,
  countChange,
  diffOps,
  opsToRows,
  pairReplacements,
  slimFileDiffs,
  splitLines,
} from './diff';

describe('diff', () => {
  it('replaces a middle line', () => {
    const ops = diffOps(['a', 'b', 'c'], ['a', 'x', 'c']);
    assert.deepEqual(
      ops.map((op) => op.type),
      ['equal', 'del', 'add', 'equal'],
    );
  });

  it('handles create and delete', () => {
    assert.equal(diffOps([], ['n']).every((op) => op.type === 'add'), true);
    assert.equal(diffOps(['o'], []).every((op) => op.type === 'del'), true);
  });

  it('numbers side-by-side rows', () => {
    const rows = opsToRows(diffOps(['keep', 'old'], ['keep', 'new']));
    assert.equal(rows[0]?.beforeNo, 1);
    assert.equal(rows[1]?.type, 'del');
    assert.equal(rows[1]?.beforeNo, 2);
    assert.equal(rows[2]?.type, 'add');
    assert.equal(rows[2]?.afterNo, 2);
  });

  it('collapses unchanged runs', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const after = ['a', 'b', 'c', 'X', 'e', 'f', 'g'];
    const hunks = collapseRows(opsToRows(diffOps(before, after)), 1);
    assert.equal(hunks[0]?.kind, 'gap');
    assert.equal(hunks.some((hunk) => hunk.kind === 'block'), true);
  });

  it('pairs a replacement onto one split row', () => {
    const rows = pairReplacements(opsToRows(diffOps(['keep', 'old'], ['keep', 'new'])));
    assert.equal(rows[1]?.type, 'replace');
    assert.equal(rows[1]?.beforeText, 'old');
    assert.equal(rows[1]?.afterText, 'new');
  });

  it('normalizes crlf before counting', () => {
    const file = buildFileDiff({
      path: 'a.ts',
      absPath: '/a.ts',
      before: 'a\r\nb\r\n',
      after: 'a\nb\n',
    });
    assert.equal(file.added, 0);
    assert.equal(file.removed, 0);
    assert.deepEqual(splitLines('a\r\nb'), ['a', 'b']);
  });

  it('does not treat a small append as a full rewrite', () => {
    const before = Array.from({ length: 3_000 }, (_, i) => `line-${i}`).join('\n');
    const after = `${before}\nnew`;
    const file = buildFileDiff({
      path: 'a.css',
      absPath: '/a.css',
      before,
      after,
    });
    assert.equal(file.added, 1);
    assert.equal(file.removed, 0);
  });

  it('counts a few edits in a large file instead of rewriting it', () => {
    const before = Array.from({ length: 1700 }, (_, i) => `line-${i}`);
    const after = before.slice();
    after[10] = 'changed-10';
    after.splice(100, 0, 'inserted');
    const file = buildFileDiff({
      path: 'big.css',
      absPath: '/big.css',
      before: before.join('\n'),
      after: after.join('\n'),
    });
    assert.equal(file.added, 2);
    assert.equal(file.removed, 1);
  });

  it('keeps a few dozen edits among duplicated CSS tokens', () => {
    const before: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      before.push(`.c${i} {`);
      before.push('  color: red;');
      before.push('}');
      before.push('');
    }
    const after = before.slice();
    for (let i = 0; i < 40; i += 1) {
      after[i * 16 + 1] = '  color: blue;';
    }
    const file = buildFileDiff({
      path: 'chat.css',
      absPath: '/chat.css',
      before: before.join('\n'),
      after: after.join('\n'),
    });
    assert.equal(file.added, 40);
    assert.equal(file.removed, 40);
    const changed = file.hunks.reduce((sum, hunk) => {
      if (hunk.kind !== 'block') {
        return sum;
      }
      return sum + hunk.rows.filter((row) => row.type !== 'equal').length;
    }, 0);
    assert.ok(changed <= 80, `expected local hunks, got ${changed} changed rows`);
  });

  it('keeps a few dozen edits in an 800-line file instead of rewriting it', () => {
    const before = Array.from({ length: 800 }, (_, i) => `line-${i}`);
    const after = before.slice();
    for (let i = 0; i < 40; i += 1) {
      after[10 + i * 18] = `changed-${i}`;
    }
    const file = buildFileDiff({
      path: 'chat.css',
      absPath: '/chat.css',
      before: before.join('\n'),
      after: after.join('\n'),
    });
    assert.equal(file.added, 40);
    assert.equal(file.removed, 40);
    const changed = file.hunks.reduce((sum, hunk) => {
      if (hunk.kind !== 'block') {
        return sum;
      }
      return sum + hunk.rows.filter((row) => row.type !== 'equal').length;
    }, 0);
    assert.ok(changed <= 80, `expected local hunks, got ${changed} changed rows`);
  });

  it('keeps a few hundred edits in a large file instead of rewriting it', () => {
    const before = Array.from({ length: 4_000 }, (_, i) => `line-${i}`);
    const after = before.slice();
    for (let i = 0; i < 250; i += 1) {
      after[i * 15 + 3] = `changed-${i}`;
    }
    const file = buildFileDiff({
      path: 'big.css',
      absPath: '/big.css',
      before: before.join('\n'),
      after: after.join('\n'),
    });
    assert.equal(file.added, 250);
    assert.equal(file.removed, 250);
  });

  it('trims a shared prefix and suffix before walking the middle', () => {
    const before = Array.from({ length: 400 }, (_, i) => `line-${i}`);
    const after = before.slice();
    after[200] = 'changed';
    const ops = diffOps(before, after);
    const changed = ops.filter((op) => op.type !== 'equal');
    assert.equal(changed.length, 2);
    assert.equal(ops[200]?.type, 'del');
    assert.equal(ops[201]?.type, 'add');
  });

  it('does not hang on a huge rewrite', () => {
    const before = Array.from({ length: 1_200 }, (_, i) => `old-${i}`);
    const after = Array.from({ length: 1_200 }, (_, i) => `new-${i}`);
    const started = Date.now();
    const ops = diffOps(before, after);
    assert.ok(Date.now() - started < 2_000);
    assert.equal(ops.filter((op) => op.type === 'del').length, 1_200);
    assert.equal(ops.filter((op) => op.type === 'add').length, 1_200);
  });

  it('counts a small append in a large file as a few lines', () => {
    const before = Array.from({ length: 3_000 }, (_, i) => `line-${i}`).join('\n');
    const after = `${before}\nnew-1\nnew-2`;
    const stats = countChange(before, after);
    assert.equal(stats.added, 2);
    assert.equal(stats.removed, 0);
  });

  it('drops quiet gap bodies when slimming a review', () => {
    const file = buildFileDiff({
      path: 'a.ts',
      absPath: '/a.ts',
      before: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n'),
      after: ['a', 'b', 'c', 'X', 'e', 'f', 'g'].join('\n'),
    });
    const slim = slimFileDiffs([file]);
    const gap = slim[0]?.hunks.find((hunk) => hunk.kind === 'gap');
    assert.equal(gap?.kind, 'gap');
    assert.equal(gap && gap.kind === 'gap' ? gap.rows.length : -1, 0);
    assert.ok((gap && gap.kind === 'gap' ? gap.count : 0) > 0);
    assert.equal(slim[0]?.added, file.added);
    assert.equal(slim[0]?.removed, file.removed);
  });

  it('builds file stats', () => {
    const file = buildFileDiff({
      path: 'a.ts',
      absPath: '/a.ts',
      before: 'one\ntwo\n',
      after: 'one\nTWO\nthree\n',
    });
    assert.equal(file.added > 0, true);
    assert.equal(file.removed > 0, true);
    assert.equal(file.created, false);
  });
});
