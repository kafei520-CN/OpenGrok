import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { pathInside, pathInsideAny, resolveProjectGrokDir, sameFsPath } from './grokDirs';

describe('grok dirs', () => {
  it('accepts descendants and rejects parent escapes', () => {
    assert.equal(pathInside('/work/app', '/work/app/notes.md', 'linux'), true);
    assert.equal(pathInside('/work/app', '/work/app', 'linux'), true);
    assert.equal(pathInside('/work/app', '/work/other/notes.md', 'linux'), false);
    assert.equal(pathInside('/work/app', '/etc/passwd', 'linux'), false);
    assert.equal(
      pathInside('E:\\Project\\app', 'E:\\Project\\app\\out.md', 'win32'),
      true,
    );
    assert.equal(
      pathInside('E:\\Project\\app', 'C:\\Windows\\notes.md', 'win32'),
      false,
    );
    assert.equal(
      pathInsideAny(['E:\\Project\\app', 'D:\\other'], 'D:\\other\\a.md', 'win32'),
      true,
    );
  });

  it('treats the same path as equal on windows regardless of case', () => {
    assert.equal(
      sameFsPath('C:\\Users\\dev\\.grok\\skills', 'c:\\users\\dev\\.grok\\skills', 'win32'),
      true,
    );
    assert.equal(sameFsPath('/home/dev/.grok/skills', '/home/dev/.grok/rules', 'linux'), false);
  });

  it('does not invent a project dir without a workspace folder', () => {
    assert.equal(
      resolveProjectGrokDir([], 'C:\\Users\\dev', 'skills', 'win32'),
      undefined,
    );
  });

  it('skips project dir when the workspace is the home folder', () => {
    assert.equal(
      resolveProjectGrokDir(['C:\\Users\\dev'], 'C:\\Users\\dev', 'skills', 'win32'),
      undefined,
    );
    assert.equal(
      resolveProjectGrokDir(['/home/dev'], '/home/dev', 'rules', 'linux'),
      undefined,
    );
  });

  it('only uses the workspace .grok folder when it is a real project', () => {
    assert.equal(
      resolveProjectGrokDir(['E:\\Project\\app'], 'C:\\Users\\dev', 'skills', 'win32'),
      path.join('E:\\Project\\app', '.grok', 'skills'),
    );
    assert.equal(
      resolveProjectGrokDir(['/work/app'], '/home/dev', 'rules', 'linux'),
      path.join('/work/app', '.grok', 'rules'),
    );
    assert.equal(
      resolveProjectGrokDir(['/work/app'], '/home/dev', 'agents', 'linux'),
      path.join('/work/app', '.grok', 'agents'),
    );
    assert.equal(
      resolveProjectGrokDir(['/work/app'], '/home/dev', 'personas', 'linux'),
      path.join('/work/app', '.grok', 'personas'),
    );
  });
});
