import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAY_IN_ASK_ID, SWITCH_TO_AGENT_ID, askModeGateOptions } from './index';
import {
  permissionActions,
  permissionNeedsCancel,
  permissionTarget,
} from './permissionView';
import type { PermissionPrompt } from '../types';

describe('permission bar view', () => {
  it('reads the file name from a tick-quoted title', () => {
    const perm: PermissionPrompt = {
      requestId: '1',
      title: 'Edit `src/app.ts`',
      toolKind: 'edit',
      options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }],
    };
    assert.equal(permissionTarget(perm), 'app.ts');
    assert.equal(permissionNeedsCancel(perm), false);
    assert.equal(permissionActions(perm)[0].optionId, 'yes');
    assert.equal(permissionActions(perm)[0].labelKey, 'permAllowOnce');
  });

  it('renders the Ask-mode switch gate instead of a bare allow', () => {
    const perm: PermissionPrompt = {
      requestId: '2',
      title: 'Ask mode cannot edit files',
      toolKind: 'edit',
      options: askModeGateOptions(),
      allowOptionId: 'yes',
    };
    const actions = permissionActions(perm);
    assert.deepEqual(
      actions.map((row) => row.optionId),
      [SWITCH_TO_AGENT_ID, STAY_IN_ASK_ID],
    );
    assert.equal(actions[0].labelKey, 'askModeSwitch');
    assert.equal(actions[1].labelKey, 'askModeStay');
    assert.equal(permissionNeedsCancel(perm), false);
  });

  it('asks for cancel when the agent sent no options', () => {
    const perm: PermissionPrompt = {
      requestId: '3',
      title: 'run',
      options: [],
    };
    assert.equal(permissionNeedsCancel(perm), true);
    assert.equal(permissionActions(perm).length, 0);
  });
});
