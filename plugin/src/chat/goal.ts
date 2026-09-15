export type GoalStatus = 'running' | 'paused';

export type GoalState = {
  text: string;
  status: GoalStatus;
  startedAt: number;
  elapsedMs: number;
};

export function goalElapsedMs(goal: GoalState, now = Date.now()): number {
  return goal.status === 'running' ? goal.elapsedMs + Math.max(0, now - goal.startedAt) : goal.elapsedMs;
}

export function formatGoalClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatGoalChip(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) {
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function truncateGoal(text: string, max = 42): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, max - 1))}…`;
}

export function pauseGoalClock(goal: GoalState, now = Date.now()): GoalState {
  if (goal.status !== 'running') {
    return goal;
  }
  return {
    ...goal,
    status: 'paused',
    elapsedMs: goalElapsedMs(goal, now),
    startedAt: now,
  };
}

export function resumeGoalClock(goal: GoalState, now = Date.now()): GoalState {
  return { ...goal, status: 'running', startedAt: now };
}

/** Map a `goal_updated` wire status to local UX. */
export function parseGoalWireStatus(
  raw: string | undefined,
): 'running' | 'paused' | 'done' | undefined {
  const status = (raw ?? '').trim().toLowerCase().replace(/-/g, '_');
  if (!status) {
    return undefined;
  }
  if (status === 'active' || status === 'running') {
    return 'running';
  }
  if (
    status === 'complete' ||
    status === 'completed' ||
    status === 'done' ||
    status === 'cleared' ||
    status === 'failed' ||
    status === 'interrupted' ||
    status === 'budget_limited'
  ) {
    return 'done';
  }
  if (status === 'paused' || status.endsWith('_paused') || status === 'blocked') {
    return 'paused';
  }
  return undefined;
}

/** True when the visible goal work is finished (all todos done, a reply exists). */
export function goalDelivered(
  steps: Array<{ status: string }> | undefined,
  text: string | undefined,
): boolean {
  if (!text?.trim() || !steps?.length) {
    return false;
  }
  return steps.every((step) => step.status === 'completed');
}
