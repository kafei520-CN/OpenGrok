import type { ChatMessage, PlanStep, TurnBeat } from '../core/types';

/** Append a thought chunk onto the open think slice, or start a new one after a tool. */
export function noteThink(message: ChatMessage, text: string): void {
  if (!text) {
    return;
  }
  message.thinking = (message.thinking ?? '') + text;
  const beats = message.beats ?? [];
  const last = beats.at(-1);
  if (last?.kind === 'think') {
    last.text += text;
  } else {
    beats.push({ kind: 'think', text });
  }
  message.beats = beats;
}

/** Record a tool the first time it appears. Status updates do not add another slice. */
export function noteToolBeat(message: ChatMessage, id: string): void {
  const beats = message.beats ?? [];
  if (beats.some((beat) => beat.kind === 'tool' && beat.id === id)) {
    message.beats = beats;
    return;
  }
  beats.push({ kind: 'tool', id });
  message.beats = beats;
}

/** A step that just finished, or the one that just became current, becomes its own row. */
export function noteTaskBeats(message: ChatMessage, prev: PlanStep[] | undefined, next: PlanStep[]): void {
  const beats = message.beats ?? [];
  let added = false;
  next.forEach((step, index) => {
    const before = earlierStep(prev, step, index, next.length);
    const text = step.content || before?.content || '';
    if (!text) {
      return;
    }
    const id = step.id || before?.id || String(index);
    if (step.status === 'completed' && before?.status !== 'completed') {
      beats.push({ kind: 'task', phase: 'completed', text, id });
      added = true;
      return;
    }
    if (step.status === 'in_progress' && before?.status !== 'in_progress') {
      beats.push({ kind: 'task', phase: 'started', text, id });
      added = true;
    }
  });
  if (added) {
    message.beats = beats;
  }
}

function earlierStep(
  prev: PlanStep[] | undefined,
  step: PlanStep,
  index: number,
  nextLength: number,
): PlanStep | undefined {
  if (!prev?.length) {
    return undefined;
  }
  if (step.id) {
    const byId = prev.find((item) => item.id === step.id);
    if (byId) {
      return byId;
    }
  }
  if (step.content) {
    const byText = prev.find((item) => item.content === step.content);
    if (byText) {
      return byText;
    }
  }
  if (prev.length === nextLength) {
    return prev[index];
  }
  return undefined;
}

/** Saved order, or the legacy pile of one think block followed by every tool. */
export function traceBeats(message: ChatMessage): TurnBeat[] {
  if (message.beats?.length) {
    return message.beats;
  }
  const beats: TurnBeat[] = [];
  if (message.thinking) {
    beats.push({ kind: 'think', text: message.thinking });
  }
  for (const tool of message.tools) {
    beats.push({ kind: 'tool', id: tool.id });
  }
  return beats;
}
