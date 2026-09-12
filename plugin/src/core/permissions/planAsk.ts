import type { AskCard, AskChoice } from '../types';
import { asObject, asString } from '../wire';

export const OTHER_LABEL = 'Other';
export const MAX_ASK_OPTIONS = 4;
export const PLAN_EXECUTE = 'execute';
export const PLAN_DECLINE = 'decline';
export const PLAN_SUPPLEMENT = 'supplement';

export const PLAN_DECLINE_FEEDBACK =
  'Do not implement this plan. End the current turn and wait for my next message. Keep the current plan as-is.';

export interface AskQuestion {
  text: string;
  options: AskChoice[];
  multiSelect: boolean;
}

export function parseAskQuestions(params: unknown): AskQuestion[] {
  const obj = asObject(params);
  const raw = Array.isArray(obj['questions']) ? obj['questions'] : [];
  return raw
    .map((item) => {
      const q = asObject(item);
      const text = asString(q['question']) ?? asString(q['text']) ?? '';
      if (!text.trim()) {
        return undefined;
      }
      const options = Array.isArray(q['options'])
        ? (q['options'] as unknown[]).map(parseChoice).filter((row): row is AskChoice => Boolean(row))
        : [];
      return {
        text: text.trim(),
        options: withOtherOption(options),
        multiSelect: Boolean(q['multiSelect'] ?? q['multi_select']),
      } satisfies AskQuestion;
    })
    .filter((row): row is AskQuestion => Boolean(row));
}

export function parseChoice(item: unknown): AskChoice | undefined {
  const obj = asObject(item);
  const label = asString(obj['label']) ?? asString(obj['name']);
  if (!label?.trim()) {
    return undefined;
  }
  return {
    id: asString(obj['id']) ?? label,
    label: label.trim(),
    description: asString(obj['description']),
    other: isOtherLabel(label),
  };
}

export function isOtherLabel(label: string): boolean {
  const value = label.trim().toLowerCase();
  return value === 'other' || value === '其他';
}

/** At most 3 model options, then a trailing Other. */
export function withOtherOption(options: AskChoice[]): AskChoice[] {
  const filtered = options.filter((row) => !isOtherLabel(row.label)).slice(0, MAX_ASK_OPTIONS - 1);
  filtered.push({
    id: OTHER_LABEL,
    label: OTHER_LABEL,
    other: true,
  });
  return filtered;
}

export function parseExitPlan(params: unknown): { sessionId?: string; toolCallId?: string; plan?: string } {
  const obj = asObject(params);
  return {
    sessionId: asString(obj['sessionId']) ?? asString(obj['session_id']),
    toolCallId: asString(obj['toolCallId']) ?? asString(obj['tool_call_id']),
    plan: asString(obj['planContent']) ?? asString(obj['plan_content']),
  };
}

export function askCardForQuestion(
  requestId: string,
  questions: AskQuestion[],
  index: number,
): AskCard {
  const question = questions[index];
  return {
    requestId,
    kind: 'question',
    title: question?.text ?? '',
    choices: question?.options ?? withOtherOption([]),
    index,
    total: questions.length,
    multiSelect: Boolean(question?.multiSelect),
  };
}

/** Labels + Other notes for one ask_user_question answer. */
export function collectAskAnswer(
  question: AskQuestion,
  choiceIds: string[],
  notes?: string,
): { labels: string[]; annotation?: { notes: string } } | undefined {
  const ids = uniqueChoiceIds(choiceIds);
  if (!ids.length) {
    return undefined;
  }
  const picked = question.multiSelect ? ids : ids.slice(0, 1);
  const labels: string[] = [];
  let other = false;
  for (const id of picked) {
    const choice = question.options.find((row) => row.id === id || row.label === id);
    const isOther = Boolean(choice?.other) || id === OTHER_LABEL;
    if (isOther) {
      other = true;
      labels.push(OTHER_LABEL);
    } else {
      labels.push(choice?.label ?? id);
    }
  }
  const note = notes?.trim();
  if (other && !note) {
    return undefined;
  }
  return {
    labels,
    annotation: other && note ? { notes: note } : undefined,
  };
}

function uniqueChoiceIds(choiceIds: string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of choiceIds) {
    const key = id.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    ids.push(key);
  }
  return ids;
}

export function askCardForPlan(requestId: string, plan: string): AskCard {
  return {
    requestId,
    kind: 'plan',
    title: '',
    body: plan.trim(),
    choices: [
      { id: PLAN_EXECUTE, label: PLAN_EXECUTE },
      { id: PLAN_DECLINE, label: PLAN_DECLINE },
      { id: PLAN_SUPPLEMENT, label: PLAN_SUPPLEMENT, other: true },
    ],
  };
}

export function acceptedAskResponse(
  answers: Record<string, string[]>,
  annotations?: Record<string, { notes?: string }>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    outcome: 'accepted',
    answers,
  };
  if (annotations && Object.keys(annotations).length) {
    payload.annotations = annotations;
  }
  return payload;
}

export function cancelledAskResponse(): Record<string, unknown> {
  return { outcome: 'cancelled' };
}

export function exitPlanResponse(outcome: 'approved' | 'cancelled' | 'abandoned', feedback?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = { outcome };
  const note = feedback?.trim();
  if (outcome === 'cancelled' && note) {
    payload.feedback = note;
  }
  return payload;
}
