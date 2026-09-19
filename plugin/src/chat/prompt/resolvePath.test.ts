import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { resolveChatPath, resolveExistingChatPath } from './resolvePath';

describe('resolveChatPath', () => {
  it('joins repo-relative paths onto the session cwd', () => {
    const cwd = 'C:\\Users\\dev\\OpenGrok';
    assert.equal(
      resolveChatPath('plugin\\src\\chat\\liveSessions.ts', cwd),
      path.resolve(cwd, 'plugin\\src\\chat\\liveSessions.ts'),
    );
  });

  it('keeps windows absolute paths', () => {
    assert.equal(
      resolveChatPath('C:\\Users\\dev\\OpenGrok\\plugin\\src\\chat\\liveSessions.ts'),
      path.normalize('C:\\Users\\dev\\OpenGrok\\plugin\\src\\chat\\liveSessions.ts'),
    );
  });

  it('picks the first existing candidate among roots', async () => {
    const found = await resolveExistingChatPath(
      'src/a.ts',
      ['C:\\missing', 'C:\\work'],
      async (next) => next.toLowerCase() === path.resolve('C:\\work', 'src/a.ts').toLowerCase(),
    );
    assert.equal(found, path.resolve('C:\\work', 'src/a.ts'));
  });
});
