import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { candidateCliPaths, isVersionAtLeast } from './cli';

describe('cli lookup', () => {
  it('puts a configured path first', () => {
    const candidates = candidateCliPaths({
      configuredPath: 'C:\\tools\\grok.exe',
      preferWorkspaceBinary: false,
      workspaceFolders: [],
      homeDir: 'C:\\Users\\dev',
      pathEnv: 'C:\\Windows',
      platform: 'win32',
    });
    assert.equal(candidates[0], path.resolve('C:\\tools\\grok.exe'));
    assert.ok(candidates.some((c) => c.endsWith(path.join('.grok', 'bin', 'grok.exe'))));
  });

  it('includes workspace release binaries when enabled', () => {
    const candidates = candidateCliPaths({
      preferWorkspaceBinary: true,
      workspaceFolders: ['E:\\Project\\grok-build'],
      homeDir: '/home/dev',
      pathEnv: '/usr/bin',
      platform: 'linux',
    });
    assert.ok(
      candidates.some((c) => c.includes(path.join('target', 'release', 'xai-grok-pager'))),
    );
  });

  it('ignores workspace target binaries on PATH unless enabled', () => {
    const hidden = candidateCliPaths({
      preferWorkspaceBinary: false,
      workspaceFolders: ['E:\\Project\\grok-build'],
      homeDir: 'C:\\Users\\dev',
      pathEnv: 'E:\\Project\\grok-build\\target\\release',
      platform: 'win32',
    });
    assert.equal(
      hidden.some((c) => c.toLowerCase().includes(path.join('target', 'release'))),
      false,
    );
  });

  it('compares versions', () => {
    assert.equal(isVersionAtLeast('1.0.5', '0.1.0'), true);
    assert.equal(isVersionAtLeast('0.0.9', '0.1.0'), false);
  });
});
