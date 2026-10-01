import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatMessage, PlanStep } from '../../core/types';
import { latestStepMessage, stepTurnToOpen } from './stepsReveal';

function assistant(
  id: string,
  steps: PlanStep[] | undefined,
  streaming: boolean,
): ChatMessage {
  return { id, role: 'assistant', text: '', tools: [], steps, streaming };
}

function user(id: string): ChatMessage {
  return { id, role: 'user', text: 'hi', tools: [] };
}

const plan: PlanStep[] = [
  { content: 'Read the dock', status: 'completed' },
  { content: 'Open the steps tool', status: 'in_progress' },
];

describe('steps dock reveal', () => {
  it('keeps history quiet and opens only the first live plan', () => {
    const finished = [user('u1'), assistant('a1', plan, false)];
    assert.equal(latestStepMessage(finished)?.id, 'a1');
    assert.equal(stepTurnToOpen(finished, new Set()), undefined);

    const live = [user('u2'), assistant('a2', plan, true)];
    assert.equal(stepTurnToOpen(live, new Set()), 'a2');
    assert.equal(stepTurnToOpen(live, new Set(['a2'])), undefined);
  });

  it('ignores a live turn until it actually has steps', () => {
    const pending = [user('u'), assistant('a', undefined, true)];
    assert.equal(latestStepMessage(pending), undefined);
    assert.equal(stepTurnToOpen(pending, new Set()), undefined);

    const older = [assistant('old', plan, false), user('u2'), assistant('new', [], true)];
    assert.equal(latestStepMessage(older)?.id, 'old');
    assert.equal(stepTurnToOpen(older, new Set()), undefined);
  });
});
