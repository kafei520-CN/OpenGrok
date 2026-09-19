/** Claude Code-style compact: prefire near the window, keep the live tail, structured handoff. */

export const DEFAULT_COMPACT_AT = 85;
/** Re-arm only after usage falls this far below the trigger. */
export const COMPACT_HYSTERESIS = 8;
export const COMPACT_COOLDOWN_MS = 20_000;
export const COMPACT_MIN_MESSAGES = 8;

export type CompactGate = {
  armed: boolean;
  lastAt?: number;
};

export function emptyCompactGate(): CompactGate {
  return { armed: true };
}

export function observeCompactUsage(
  gate: CompactGate,
  percent: number,
  compactAt = DEFAULT_COMPACT_AT,
): CompactGate {
  if (percent <= compactAt - COMPACT_HYSTERESIS) {
    return { ...gate, armed: true };
  }
  return gate;
}

export function markCompacted(gate: CompactGate, now = Date.now()): CompactGate {
  return { armed: false, lastAt: now };
}

export function shouldPrefireCompact(input: {
  percent?: number;
  compactAt?: number;
  messageCount: number;
  busy: boolean;
  now?: number;
  gate?: CompactGate;
}): boolean {
  if (input.busy) {
    return false;
  }
  if (input.messageCount < COMPACT_MIN_MESSAGES) {
    return false;
  }
  const percent = input.percent ?? 0;
  const at = input.compactAt ?? DEFAULT_COMPACT_AT;
  if (percent < at) {
    return false;
  }
  const gate = input.gate ?? emptyCompactGate();
  if (!gate.armed) {
    return false;
  }
  const now = input.now ?? Date.now();
  if (gate.lastAt !== undefined && now - gate.lastAt < COMPACT_COOLDOWN_MS) {
    return false;
  }
  return true;
}

export function buildCompactNote(input: {
  userNote?: string;
  files?: string[];
  errors?: string[];
  auto?: boolean;
}): string {
  const lines: string[] = [];
  if (input.auto) {
    lines.push('Auto-compact: the context window is near its threshold.');
  }
  lines.push(
    'Compact older history into a structured handoff. Keep recent turns at full fidelity (the latest user request, the latest assistant reply, and their tool calls).',
    'Preserve: current goal, key decisions, open files/paths, errors/failing tests, unfinished TODOs, and the next concrete step.',
    'Compress: verbose tool dumps, repeated file reads, and finished exploration.',
  );
  const files = unique(input.files ?? []).slice(0, 12);
  if (files.length) {
    lines.push(`Files in play: ${files.join(', ')}`);
  }
  const errors = (input.errors ?? []).filter(Boolean).slice(0, 3);
  if (errors.length) {
    lines.push(`Recent errors: ${errors.join(' | ')}`);
  }
  const focus = input.userNote?.trim();
  if (focus) {
    lines.push(`Focus: ${focus}`);
  }
  return lines.join('\n');
}

export function collectCompactHints(
  messages: Array<{
    error?: { message?: string } | null;
    edits?: Array<{ path: string }>;
    tools?: Array<{ detail?: string }>;
  }>,
): { files: string[]; errors: string[] } {
  const files: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  const pushFile = (raw?: string) => {
    const name = fileHint(raw);
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    files.push(name);
  };
  for (const msg of messages) {
    for (const edit of msg.edits ?? []) {
      pushFile(edit.path);
    }
    for (const tool of msg.tools ?? []) {
      pushFile(tool.detail);
    }
    const err = msg.error?.message?.replace(/\s+/g, ' ').trim();
    if (err) {
      errors.push(err.slice(0, 160));
    }
  }
  return { files: files.slice(-12), errors: errors.slice(-3) };
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const value = item.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function fileHint(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const text = raw.trim().replace(/\\/g, '/');
  if (!text || text.length > 180) {
    return undefined;
  }
  if (!/[\\/]|\.\w{1,8}$/.test(text)) {
    return undefined;
  }
  const base = text.split('/').pop();
  return base || text;
}
