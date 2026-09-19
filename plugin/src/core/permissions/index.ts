import type { GrokSettings, PermissionOption } from '../types';

export function sessionPermissionMeta(settings: Pick<GrokSettings, 'alwaysApprove' | 'permissionMode'>): {
  yoloMode: boolean;
  autoMode: boolean;
} {
  const yoloMode = Boolean(settings.alwaysApprove);
  return {
    yoloMode,
    autoMode: !yoloMode && settings.permissionMode === 'auto',
  };
}

export const SWITCH_TO_AGENT_ID = 'switch_to_agent';
export const STAY_IN_ASK_ID = 'stay_in_ask';

export function isAskSessionMode(modeId?: string): boolean {
  return modeId === 'ask';
}

export function isEditToolKind(kind?: string): boolean {
  const value = (kind ?? '').toLowerCase();
  return value === 'edit' || value === 'write' || value === 'delete' || value === 'move';
}

/** File edits and shell — the mutations Ask mode must not run. */
export function isTerminalToolKind(kind?: string, title?: string): boolean {
  const value = (kind ?? '').toLowerCase();
  const text = `${value} ${title ?? ''}`.toLowerCase();
  return (
    value === 'execute' ||
    value === 'terminal' ||
    value === 'shell' ||
    value === 'bash' ||
    text.includes('terminal') ||
    text.includes('run_terminal') ||
    /\bbash\b/.test(text)
  );
}

export function isMutatingToolKind(kind?: string, title?: string): boolean {
  return isEditToolKind(kind) || isTerminalToolKind(kind, title);
}

export function terminalToolsEnabled(settings: { useTerminal?: boolean }): boolean {
  return settings.useTerminal === true;
}

export function shouldDenyTerminal(
  settings: { useTerminal?: boolean },
  toolKind?: string,
  title?: string,
): boolean {
  return !terminalToolsEnabled(settings) && isTerminalToolKind(toolKind, title);
}

export function askModeBlocksMutation(modeId: string | undefined, toolKind?: string): boolean {
  return isAskSessionMode(modeId) && isMutatingToolKind(toolKind);
}

export function askModeGateOptions(): PermissionOption[] {
  return [
    { optionId: SWITCH_TO_AGENT_ID, name: 'Switch to Agent', kind: 'allow_once' },
    { optionId: STAY_IN_ASK_ID, name: 'Stay in Ask', kind: 'reject_once' },
  ];
}

export function pickAllowOption(options: PermissionOption[]): PermissionOption | undefined {
  return (
    options.find((option) => option.kind === 'allow_once') ??
    options.find((option) => option.kind === 'allow_always') ??
    options.find((option) => option.kind.startsWith('allow')) ??
    options[0]
  );
}

export function pickRejectOption(options: PermissionOption[]): PermissionOption | undefined {
  return (
    options.find((option) => option.kind === 'reject_once') ??
    options.find((option) => option.kind === 'reject_always') ??
    options.find((option) => option.kind.startsWith('reject'))
  );
}

export function denyTerminalPermission(
  settings: { useTerminal?: boolean },
  parsed: { toolKind?: string; title?: string; options: PermissionOption[] },
): unknown | undefined {
  if (!shouldDenyTerminal(settings, parsed.toolKind, parsed.title)) {
    return undefined;
  }
  const reject = pickRejectOption(parsed.options);
  return reject ? selectedPermission(reject.optionId) : cancelledPermission();
}

export function shouldAutoApprove(
  settings: Pick<GrokSettings, 'alwaysApprove' | 'permissionMode'> & { useTerminal?: boolean },
  toolKind?: string,
  modeId?: string,
  title?: string,
): boolean {
  if (askModeBlocksMutation(modeId, toolKind)) {
    return false;
  }
  if (shouldDenyTerminal(settings, toolKind, title)) {
    return false;
  }
  if (settings.alwaysApprove || settings.permissionMode === 'auto') {
    return true;
  }
  return settings.permissionMode === 'acceptEdits' && isEditToolKind(toolKind);
}

export function selectedPermission(optionId: string): unknown {
  return { outcome: { outcome: 'selected', optionId } };
}

/** ACP `RequestPermissionOutcome::Cancelled` — session gone or the user stopped. */
export function cancelledPermission(): unknown {
  return { outcome: { outcome: 'cancelled' } };
}

export function settlePending<T>(
  pending: Map<string, { resolve: (value: T) => void }>,
  value: T,
): void {
  for (const item of pending.values()) {
    item.resolve(value);
  }
  pending.clear();
}

export type PermLabelKey =
  | 'permAllowOnce'
  | 'permAllowAlways'
  | 'permAllowEditsSession'
  | 'permReject'
  | 'permRejectTell'
  | 'askModeSwitch'
  | 'askModeStay';

export function normalizePermissionKind(kind: string): string {
  return kind
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

export function permissionLabelKey(
  option: Pick<PermissionOption, 'kind' | 'name'> & { optionId?: string },
  toolKind?: string,
): PermLabelKey {
  if (option.optionId === SWITCH_TO_AGENT_ID) {
    return 'askModeSwitch';
  }
  if (option.optionId === STAY_IN_ASK_ID) {
    return 'askModeStay';
  }
  const kind = normalizePermissionKind(option.kind);
  if (kind === 'allow_always') {
    return isEditToolKind(toolKind) ? 'permAllowEditsSession' : 'permAllowAlways';
  }
  if (kind === 'allow_once' || kind.startsWith('allow')) {
    return 'permAllowOnce';
  }
  const name = (option.name ?? '').toLowerCase();
  if (name.includes('tell') || name.includes('differently')) {
    return 'permRejectTell';
  }
  return kind === 'reject_always' ? 'permReject' : 'permRejectTell';
}

export function permissionButtonClass(kind: string): string {
  const value = normalizePermissionKind(kind);
  if (value === 'allow_once') {
    return 'btn primary';
  }
  if (value.startsWith('allow')) {
    return 'btn allow';
  }
  return 'btn reject';
}
