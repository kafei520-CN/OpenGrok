import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  fileHash,
  listWorkspaceDir,
  renameWorkspaceEntry,
  resolveWorkspacePath,
  safeEntryName,
  smallEditLimit,
} from './workspaceIndex';

describe('workspace index', () => {
  it('rejects paths that escape the workspace root', () => {
    const root = path.resolve('/work/app');
    assert.equal(resolveWorkspacePath(root, '../secret'), undefined);
    assert.ok(resolveWorkspacePath(root, 'src/a.ts')?.endsWith(`src${path.sep}a.ts`));
  });

  it('hashes file text stably', () => {
    assert.equal(fileHash('hello'), fileHash('hello'));
    assert.notEqual(fileHash('hello'), fileHash('hello!'));
  });

  it('allows large line edits and rejects oversized files', () => {
    const before = ['a', 'b', 'c', 'd'].join('\n');
    assert.equal(smallEditLimit(before, ['a', 'B', 'c', 'd'].join('\n')), 'ok');
    const after = Array.from({ length: 120 }, (_, i) => `line-${i}`).join('\n');
    assert.equal(smallEditLimit(before, after), 'ok');
    assert.equal(smallEditLimit('', 'x'.repeat(3 * 1024 * 1024)), 'tooBig');
  });

  it('creates, renames, and deletes workspace entries', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-ws-'));
    assert.equal(safeEntryName('../x'), undefined);
    assert.equal(safeEntryName('a/b'), undefined);
    const file = await createWorkspaceEntry(dir, '', 'notes.md', 'file');
    assert.equal(file?.rel, 'notes.md');
    assert.equal(fs.existsSync(path.join(dir, 'notes.md')), true);
    const folder = await createWorkspaceEntry(dir, '', 'src', 'dir');
    assert.equal(folder?.rel, 'src');
    const nested = await createWorkspaceEntry(dir, 'src', 'a.ts', 'file');
    assert.equal(nested?.rel, 'src/a.ts');
    const moved = await renameWorkspaceEntry(dir, 'notes.md', 'readme.md');
    assert.equal(moved?.rel, 'readme.md');
    assert.equal(fs.existsSync(path.join(dir, 'readme.md')), true);
    const gone = await deleteWorkspaceEntry(dir, 'src');
    assert.equal(gone?.rel, 'src');
    assert.equal(fs.existsSync(path.join(dir, 'src')), false);
    assert.equal(await deleteWorkspaceEntry(dir, dir), undefined);
  });

  it('indexes only the current folder until that folder is opened', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-ws-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export {}\n');
    fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'index.js'), 'module.exports=1\n');
    const top = await listWorkspaceDir(dir);
    assert.deepEqual(
      top.entries.map((row) => `${row.kind}:${row.name}`),
      ['dir:src', 'file:README.md'],
    );
    const inner = await listWorkspaceDir(dir, 'src');
    assert.equal(inner.dir, 'src');
    assert.equal(inner.entries.length, 1);
    assert.equal(inner.entries[0]?.name, 'a.ts');
  });
});
