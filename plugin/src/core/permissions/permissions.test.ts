import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  STAY_IN_ASK_ID,
  SWITCH_TO_AGENT_ID,
  askModeBlocksMutation,
  cancelledPermission,
  denyTerminalPermission,
  isEditToolKind,
  isTerminalToolKind,
  permissionLabelKey,
  pickAllowOption,
  selectedPermission,
  sessionPermissionMeta,
  settlePending,
  shouldAutoApprove,
  shouldDenyTerminal,
} from './index';

describe('permissions', () => {
  it('puts yolo/auto on session meta without a process restart', () => {
    assert.deepEqual(sessionPermissionMeta({ alwaysApprove: true, permissionMode: 'ask' }), {
      yoloMode: true,
      autoMode: false,
    });
    assert.deepEqual(sessionPermissionMeta({ alwaysApprove: false, permissionMode: 'auto' }), {
      yoloMode: false,
      autoMode: true,
    });
    assert.deepEqual(sessionPermissionMeta({ alwaysApprove: false, permissionMode: 'acceptEdits' }), {
      yoloMode: false,
      autoMode: false,
    });
  });

  it('auto-approves edits in acceptEdits and everything in auto/yolo', () => {
    const ask = { alwaysApprove: false, permissionMode: 'ask' as const };
    const edits = { alwaysApprove: false, permissionMode: 'acceptEdits' as const };
    const auto = { alwaysApprove: false, permissionMode: 'auto' as const, useTerminal: true };
    const yolo = { alwaysApprove: true, permissionMode: 'ask' as const, useTerminal: true };
    assert.equal(shouldAutoApprove(ask, 'edit'), false);
    assert.equal(shouldAutoApprove(edits, 'edit'), true);
    assert.equal(shouldAutoApprove(edits, 'execute'), false);
    assert.equal(shouldAutoApprove(auto, 'execute'), true);
    assert.equal(shouldAutoApprove(yolo, 'execute'), true);
    assert.equal(shouldAutoApprove({ ...auto, useTerminal: false }, 'execute'), false);
    assert.equal(shouldAutoApprove({ ...auto, useTerminal: false }, 'read'), true);
    assert.equal(shouldAutoApprove(yolo, 'edit', 'ask'), false);
    assert.equal(shouldAutoApprove(auto, 'execute', 'ask'), false);
    assert.equal(shouldAutoApprove(yolo, 'read', 'ask'), true);
    assert.equal(isEditToolKind('write'), true);
    assert.equal(isEditToolKind('terminal'), false);
    assert.equal(askModeBlocksMutation('ask', 'edit'), true);
    assert.equal(askModeBlocksMutation('ask', 'execute'), true);
    assert.equal(askModeBlocksMutation('ask', 'read'), false);
    assert.equal(askModeBlocksMutation('default', 'edit'), false);
  });

  it('denies terminal tools when the switch is off', () => {
    assert.equal(isTerminalToolKind('execute'), true);
    assert.equal(isTerminalToolKind('read', 'run_terminal_cmd'), true);
    assert.equal(shouldDenyTerminal({ useTerminal: false }, 'execute'), true);
    assert.equal(shouldDenyTerminal({ useTerminal: true }, 'execute'), false);
    const denied = denyTerminalPermission(
      { useTerminal: false },
      {
        toolKind: 'execute',
        title: 'bash',
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      },
    );
    assert.deepEqual(denied, selectedPermission('no'));
    assert.equal(
      denyTerminalPermission({ useTerminal: true }, { toolKind: 'execute', options: [] }),
      undefined,
    );
  });

  it('settles every waiter with a cancelled outcome', () => {
    const pending = new Map<string, { resolve: (value: unknown) => void }>();
    const seen: unknown[] = [];
    pending.set('a', { resolve: (value) => seen.push(value) });
    pending.set('b', { resolve: (value) => seen.push(value) });
    settlePending(pending, cancelledPermission());
    assert.equal(pending.size, 0);
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0], { outcome: { outcome: 'cancelled' } });
    assert.notDeepEqual(selectedPermission('yes'), cancelledPermission());
  });

  it('prefers allow_once over later options', () => {
    const picked = pickAllowOption([
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
      { optionId: 'always', name: 'Always', kind: 'allow_always' },
    ]);
    assert.equal(picked?.optionId, 'yes');
  });

  it('maps ACP option kinds to short i18n keys', () => {
    assert.equal(
      permissionLabelKey({ kind: 'allow_always', name: 'Yes, allow all edits during this session' }, 'write'),
      'permAllowEditsSession',
    );
    assert.equal(permissionLabelKey({ kind: 'AllowOnce', name: 'Yes' }, 'execute'), 'permAllowOnce');
    assert.equal(
      permissionLabelKey({ kind: 'reject_once', name: 'No, and tell Grok what to do differently' }, 'write'),
      'permRejectTell',
    );
    assert.equal(
      permissionLabelKey({ kind: 'allow_once', name: 'x', optionId: SWITCH_TO_AGENT_ID }),
      'askModeSwitch',
    );
    assert.equal(
      permissionLabelKey({ kind: 'reject_once', name: 'x', optionId: STAY_IN_ASK_ID }),
      'askModeStay',
    );
  });
});
