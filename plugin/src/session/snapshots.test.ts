import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addSnapshot,
  alreadyCaptured,
  isFullFileBaseline,
  isProbablyText,
  normalizeFsPath,
  pickBeforeAfter,
  planRevert,
  type FileSnapshot,
} from './snapshots';

describe('snapshots', () => {
  it('normalizes windows paths', () => {
    assert.equal(normalizeFsPath('e:\\tmp\\a.ts'), 'E:/tmp/a.ts');
    assert.equal(normalizeFsPath('E:/tmp/a.ts'), 'E:/tmp/a.ts');
  });

  it('dedupes captures', () => {
    const first: FileSnapshot = {
      absPath: 'E:/tmp/a.ts',
      displayPath: 'a.ts',
      existed: true,
      previous: 'old',
    };
    const list = addSnapshot([], first);
    assert.equal(alreadyCaptured(list, 'e:\\tmp\\a.ts'), true);
    assert.equal(addSnapshot(list, { ...first, previous: 'other' }).length, 1);
  });

  it('plans restore, delete, and skip', () => {
    const plans = planRevert([
      { absPath: '/a.ts', displayPath: 'a.ts', existed: true, previous: 'keep' },
      { absPath: '/b.ts', displayPath: 'b.ts', existed: false },
      { absPath: '/c.bin', displayPath: 'c.bin', existed: true },
    ]);
    assert.deepEqual(
      plans.map((item) => item.action),
      ['restore', 'delete', 'skip'],
    );
  });

  it('reverts from the live disk capture instead of a session copy', () => {
    const plans = planRevert([
      {
        absPath: '/a.ts',
        displayPath: 'a.ts',
        existed: true,
        previous: 'session',
        source: 'session',
      },
      {
        absPath: '/a.ts',
        displayPath: 'a.ts',
        existed: true,
        previous: 'disk',
        source: 'disk',
      },
    ]);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.action === 'restore' && plans[0].previous, 'disk');
  });

  it('lets a disk snapshot replace a tool hunk snapshot', () => {
    const tool: FileSnapshot = {
      absPath: 'E:/tmp/a.ts',
      displayPath: 'a.ts',
      existed: true,
      previous: 'old line\n',
      source: 'tool',
    };
    const disk: FileSnapshot = {
      absPath: 'E:/tmp/a.ts',
      displayPath: 'a.ts',
      existed: true,
      previous: 'full file\ncontents\n',
      source: 'disk',
    };
    const list = addSnapshot(addSnapshot([], tool), disk);
    assert.equal(list.length, 1);
    assert.equal(list[0]?.source, 'disk');
    assert.equal(alreadyCaptured(list, 'E:/tmp/a.ts'), true);
  });

  it('does not let git HEAD replace a tool snapshot', () => {
    const tool: FileSnapshot = {
      absPath: 'E:/tmp/a.ts',
      displayPath: 'a.ts',
      existed: true,
      previous: 'old line\n',
      source: 'tool',
    };
    const git: FileSnapshot = {
      absPath: 'E:/tmp/a.ts',
      displayPath: 'a.ts',
      existed: true,
      previous: 'committed\n',
      source: 'git',
    };
    const list = addSnapshot(addSnapshot([], tool), git);
    assert.equal(list.some((item) => item.source === 'tool'), true);
    assert.equal(list.some((item) => item.source === 'git'), true);
    assert.equal(alreadyCaptured(list, 'E:/tmp/a.ts'), false);
  });

  it('rejects a short hunk as a full-file baseline', () => {
    const hunk = '    [\'menuSkills\', () => post({ type: \'openDrawer\' })],\n';
    const file = `${'line\n'.repeat(80)}${hunk}`;
    assert.equal(isFullFileBaseline(hunk, file), false);
    assert.equal(isFullFileBaseline(file, file.replace('line', 'LINE')), true);
    assert.equal(isFullFileBaseline('a\nb\n', 'a\nc\n'), false);
  });

  it('does not treat replay hunks as a whole-file diff', () => {
    const after = `${'keep\n'.repeat(80)}new\nextra\n`;
    const replay = pickBeforeAfter({
      snapshots: [],
      previous: 'old hunk\n',
      next: 'new hunk\n',
      afterDisk: after,
    });
    assert.equal(replay, undefined);
  });

  it('uses git HEAD against the working tree even when the file grew', () => {
    const after = `${'keep\n'.repeat(80)}new\nextra\n`;
    const pair = pickBeforeAfter({
      snapshots: [
        {
          absPath: '/a.ts',
          displayPath: 'a.ts',
          existed: true,
          previous: 'old\n',
          source: 'git',
        },
      ],
      afterDisk: after,
    });
    assert.equal(pair?.before, 'old\n');
    assert.equal(pair?.after, after);
  });

  it('rejects nul bytes as text', () => {
    assert.equal(isProbablyText(Buffer.from('hello')), true);
    assert.equal(isProbablyText(Buffer.from([1, 0, 2])), false);
  });
});
