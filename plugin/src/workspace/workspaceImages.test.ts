import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cacheKey, failedBinaryImagePath, imageFromBase64 } from './workspaceImages';

describe('workspace image rescue', () => {
  it('reads the path out of a binary-file tool error', () => {
    const path = failedBinaryImagePath({
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      title: 'shot.png',
      content: {
        type: 'content',
        content: {
          type: 'text',
          text: 'Cannot read binary file: E:\\shots\\block.png',
        },
      },
    });
    assert.equal(path, 'E:\\shots\\block.png');
  });

  it('falls back to rawInput target_file', () => {
    const path = failedBinaryImagePath({
      sessionUpdate: 'tool_call_update',
      content: { type: 'text', text: 'Cannot read binary file' },
      rawInput: { target_file: 'docs/hero.jpg' },
    });
    assert.equal(path, 'docs/hero.jpg');
  });

  it('ignores non-image binary errors', () => {
    assert.equal(
      failedBinaryImagePath({
        content: { type: 'text', text: 'Cannot read binary file: archive.zip' },
      }),
      undefined,
    );
  });

  it('normalizes cache keys', () => {
    assert.equal(cacheKey('E:\\a\\B.PNG'), cacheKey('e:/a/b.png'));
  });

  it('fills mime from the path', () => {
    assert.equal(imageFromBase64('a.jpeg', 'AAAA')?.mimeType, 'image/jpeg');
  });
});
