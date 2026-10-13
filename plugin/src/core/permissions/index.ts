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

const EDIT_NAMES = ['search_replace', 'hashline_edit', 'apply_patch', 'multiedit'];

export function isEditToolKind(kind?: string, title?: string): boolean {
  const value = (kind ?? '').toLowerCase();
  if (value === 'edit' || value === 'write' || value === 'delete' || value === 'move') {
    return true;
  }
  const text = (title ?? '').toLowerCase();
  return EDIT_NAMES.some((name) => text.includes(name));
}

/** File edits and shell — the mutations Ask mode must not run. */
export function isTerminalToolKind(kind?: string, title?: string): boolean {
  const value = (kind ?? '').toLowerCase();
  if (value === 'execute' || value === 'terminal' || value === 'shell' || value === 'bash') {
    return true;
  }
  const text = `${value} ${title ?? ''}`.toLowerCase();
  return text.includes('run_terminal') || /\bbash\b/.test(text);
}

export function isMutatingToolKind(kind?: string, title?: string): boolean {
  return isEditToolKind(kind, title) || isTerminalToolKind(kind, title);
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

export function askModeBlocksMutation(modeId: string | undefined, toolKind?: string, title?: string): boolean {
  return isAskSessionMode(modeId) && isMutatingToolKind(toolKind, title);
}

export function askModeGateOptions(): PermissionOption[] {
  return [
    { optionId: SWITCH_TO_AGENT_ID, name: 'Switch to Agent', kind: 'allow_once' },
    { optionId: STAY_IN_ASK_ID, name: 'Stay in Ask', kind: 'reject_once' },
  ];
}

function permissionRank(kind: string, once: string, always: string, prefix: string): number | undefined {
  const value = normalizePermissionKind(kind);
  if (value === once) {
    return 0;
  }
  if (value === always) {
    return 1;
  }
  if (value.startsWith(prefix)) {
    return 2;
  }
  return undefined;
}

function pickRankedOption(
  options: PermissionOption[],
  once: string,
  always: string,
  prefix: string,
): PermissionOption | undefined {
  let best: PermissionOption | undefined;
  let bestRank = 3;
  for (const option of options) {
    const rank = permissionRank(option.kind, once, always, prefix);
    if (rank === undefined || rank >= bestRank) {
      continue;
    }
    best = option;
    bestRank = rank;
  }
  return best;
}

export function pickAllowOption(options: PermissionOption[]): PermissionOption | undefined {
  return pickRankedOption(options, 'allow_once', 'allow_always', 'allow');
}

export function pickRejectOption(options: PermissionOption[]): PermissionOption | undefined {
  return pickRankedOption(options, 'reject_once', 'reject_always', 'reject');
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
  if (askModeBlocksMutation(modeId, toolKind, title)) {
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
