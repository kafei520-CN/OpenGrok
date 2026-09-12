import { latestPlan } from '../hosts/memory/memoryHost';
import {
  STAY_IN_ASK_ID,
  SWITCH_TO_AGENT_ID,
  askModeBlocksMutation,
  askModeGateOptions,
  cancelledPermission,
  pickAllowOption,
  selectedPermission,
  settlePending,
  shouldAutoApprove,
} from '../core/permissions';
import {
  PLAN_DECLINE,
  PLAN_DECLINE_FEEDBACK,
  PLAN_EXECUTE,
  PLAN_SUPPLEMENT,
  acceptedAskResponse,
  askCardForPlan,
  askCardForQuestion,
  cancelledAskResponse,
  collectAskAnswer,
  exitPlanResponse,
  parseAskQuestions,
  parseExitPlan,
  type AskQuestion,
} from '../core/permissions/planAsk';
import { parsePermissionOptions } from './incoming';
import { readGrokSettings } from '../settings/settings';
import { tr } from '../core/i18n/locale';
import type { AskCard, ChatMessage, PermissionPrompt } from '../core/types';

export interface PendingPermission {
  resolve: (value: unknown) => void;
}

export interface PendingAsk {
  resolve: (value: unknown) => void;
  kind: 'question' | 'plan';
  questions: AskQuestion[];
  index: number;
  answers: Record<string, string[]>;
  annotations: Record<string, { notes?: string }>;
}

export interface ReverseHost {
  permission?: PermissionPrompt;
  pendingPermissions: Map<string, PendingPermission>;
  ask?: AskCard;
  askPending?: PendingAsk;
  turn: number;
  modeId: string;
  messages: ChatMessage[];
  emit(): void;
  fail(message: string, error?: unknown): void;
  applySessionMode(modeId: string): Promise<void>;
}

export async function choosePermission(host: ReverseHost, optionId: string): Promise<void> {
  const current = host.permission;
  if (!current) {
    return;
  }
  const pending = host.pendingPermissions.get(current.requestId);
  host.pendingPermissions.delete(current.requestId);
  host.permission = undefined;
  if (optionId === SWITCH_TO_AGENT_ID) {
    try {
      await host.applySessionMode('default');
    } catch (error) {
      pending?.resolve(cancelledPermission());
      host.emit();
      host.fail('Could not change mode', error);
      return;
    }
    const allowId = current.allowOptionId;
    pending?.resolve(allowId ? selectedPermission(allowId) : cancelledPermission());
    host.emit();
    return;
  }
  if (optionId === STAY_IN_ASK_ID) {
    pending?.resolve(cancelledPermission());
    host.emit();
    return;
  }
  pending?.resolve(selectedPermission(optionId));
  host.emit();
}

export function cancelPermission(host: ReverseHost): void {
  const current = host.permission;
  if (!current) {
    return;
  }
  const pending = host.pendingPermissions.get(current.requestId);
  pending?.resolve(cancelledPermission());
  host.pendingPermissions.delete(current.requestId);
  host.permission = undefined;
  host.emit();
}

export async function askUserQuestion(host: ReverseHost, params: unknown): Promise<unknown> {
  const questions = parseAskQuestions(params);
  if (!questions.length) {
    return cancelledAskResponse();
  }
  dismissAsk(host, 'replace');
  const requestId = `ask-${++host.turn}`;
  host.ask = askCardForQuestion(requestId, questions, 0);
  host.emit();
  return new Promise((resolve) => {
    host.askPending = {
      resolve,
      kind: 'question',
      questions,
      index: 0,
      answers: {},
      annotations: {},
    };
  });
}

export async function reviewPlan(host: ReverseHost, params: unknown): Promise<unknown> {
  const parsed = parseExitPlan(params);
  const plan = parsed.plan?.trim() || latestPlan(host.messages);
  dismissAsk(host, 'replace');
  const requestId = `plan-${++host.turn}`;
  host.ask = askCardForPlan(requestId, plan);
  host.emit();
  return new Promise((resolve) => {
    host.askPending = {
      resolve,
      kind: 'plan',
      questions: [],
      index: 0,
      answers: {},
      annotations: {},
    };
  });
}

export function answerAsk(host: ReverseHost, choiceIds: string[], notes?: string): void {
  const pending = host.askPending;
  const card = host.ask;
  if (!pending || !card) {
    return;
  }
  if (pending.kind === 'plan') {
    finishPlanAsk(host, choiceIds[0] ?? '', notes);
    return;
  }
  const question = pending.questions[pending.index];
  if (!question) {
    finishAsk(host, cancelledAskResponse());
    return;
  }
  const collected = collectAskAnswer(question, choiceIds, notes);
  if (!collected) {
    return;
  }
  pending.answers[question.text] = collected.labels;
  if (collected.annotation) {
    pending.annotations[question.text] = collected.annotation;
  }
  pending.index += 1;
  if (pending.index >= pending.questions.length) {
    finishAsk(host, acceptedAskResponse(pending.answers, pending.annotations));
    return;
  }
  host.ask = askCardForQuestion(card.requestId, pending.questions, pending.index);
  host.emit();
}

export function cancelAsk(host: ReverseHost): void {
  dismissAsk(host, 'cancel');
  host.emit();
}

export function abortClientRpcs(host: ReverseHost, reason: 'cancel' | 'replace'): void {
  dismissAsk(host, reason);
  dismissPermissions(host);
}

export async function requestToolPermission(host: ReverseHost, params: unknown): Promise<unknown> {
  const parsed = parsePermissionOptions(params);
  const settings = readGrokSettings();
  if (shouldAutoApprove(settings, parsed.toolKind, host.modeId)) {
    const allow = pickAllowOption(parsed.options);
    if (allow) {
      return selectedPermission(allow.optionId);
    }
  }
  dismissPermissions(host);
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const askGate = askModeBlocksMutation(host.modeId, parsed.toolKind);
  host.permission = {
    requestId,
    title: askGate ? tr('askModeBlocked') : parsed.title,
    details: parsed.details,
    toolKind: parsed.toolKind,
    options: askGate ? askModeGateOptions() : parsed.options,
    allowOptionId: askGate ? pickAllowOption(parsed.options)?.optionId : undefined,
  };
  host.emit();
  return new Promise((resolve) => {
    host.pendingPermissions.set(requestId, { resolve });
  });
}

function finishPlanAsk(host: ReverseHost, choiceId: string, notes?: string): void {
  if (choiceId === PLAN_EXECUTE) {
    finishAsk(host, exitPlanResponse('approved'));
    return;
  }
  if (choiceId === PLAN_SUPPLEMENT) {
    const note = notes?.trim();
    if (!note) {
      return;
    }
    finishAsk(host, exitPlanResponse('cancelled', note));
    return;
  }
  if (choiceId === PLAN_DECLINE) {
    finishAsk(host, exitPlanResponse('cancelled', PLAN_DECLINE_FEEDBACK));
  }
}

function finishAsk(host: ReverseHost, value: unknown): void {
  const pending = host.askPending;
  host.askPending = undefined;
  host.ask = undefined;
  pending?.resolve(value);
  host.emit();
}

function dismissAsk(host: ReverseHost, reason: 'cancel' | 'replace'): void {
  const pending = host.askPending;
  if (!pending) {
    host.ask = undefined;
    return;
  }
  host.askPending = undefined;
  host.ask = undefined;
  pending.resolve(
    pending.kind === 'plan'
      ? exitPlanResponse('cancelled', reason === 'cancel' ? PLAN_DECLINE_FEEDBACK : undefined)
      : cancelledAskResponse(),
  );
}

function dismissPermissions(host: ReverseHost): void {
  settlePending(host.pendingPermissions, cancelledPermission());
  host.permission = undefined;
}
