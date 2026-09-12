import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { settingNeedsRestart } from '../core/types';

describe('settings', () => {
  it('marks spawn-time keys as needing a restart', () => {
    assert.equal(settingNeedsRestart('alwaysApprove'), false);
    assert.equal(settingNeedsRestart('notifySound'), false);
    assert.equal(settingNeedsRestart('cliPath'), true);
    assert.equal(settingNeedsRestart('locale'), false);
    assert.equal(settingNeedsRestart('permissionMode'), false);
    assert.equal(settingNeedsRestart('termEncoding'), false);
  });
});
