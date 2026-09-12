import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OTHER_LABEL,
  PLAN_DECLINE,
  PLAN_EXECUTE,
  acceptedAskResponse,
  askCardForPlan,
  askCardForQuestion,
  cancelledAskResponse,
  collectAskAnswer,
  exitPlanResponse,
  parseAskQuestions,
  parseExitPlan,
  withOtherOption,
} from './planAsk';

describe('plan ask wire', () => {
  it('caps model options at 3 and appends Other', () => {
    const options = withOtherOption([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
      { id: 'other', label: 'Other' },
    ]);
    assert.equal(options.length, 4);
    assert.equal(options[3].label, OTHER_LABEL);
    assert.equal(options[3].other, true);
    assert.equal(options[0].label, 'A');
    assert.equal(options.some((row) => row.label === 'D'), false);
  });

  it('parses ask_user_question questions from camelCase params', () => {
    const questions = parseAskQuestions({
      sessionId: 's',
      toolCallId: 't',
      mode: 'plan',
      questions: [
        {
          question: 'Which store?',
          options: [
            { label: 'Redis', description: 'In-memory' },
            { label: 'SQLite' },
          ],
        },
      ],
    });
    assert.equal(questions[0].text, 'Which store?');
    assert.equal(questions[0].options.length, 3);
    assert.equal(questions[0].options.at(-1)?.other, true);
  });

  it('builds accepted answers with Other notes', () => {
    const payload = acceptedAskResponse(
      { 'Which store?': ['Other'] },
      { 'Which store?': { notes: 'Use Valkey' } },
    );
    assert.equal(payload.outcome, 'accepted');
    assert.deepEqual((payload.answers as Record<string, string[]>)['Which store?'], ['Other']);
  });

  it('parses exit_plan_mode and maps Codex-style outcomes', () => {
    const parsed = parseExitPlan({
      sessionId: 's',
      toolCallId: 't',
      planContent: '# Plan\n\nDo the thing.',
    });
    assert.equal(parsed.plan, '# Plan\n\nDo the thing.');
    assert.deepEqual(exitPlanResponse('approved'), { outcome: 'approved' });
    const cancelled = exitPlanResponse('cancelled', 'add tests');
    assert.equal(cancelled.outcome, 'cancelled');
    assert.equal(cancelled.feedback, 'add tests');
    assert.equal(cancelledAskResponse().outcome, 'cancelled');
    const card = askCardForPlan('r1', parsed.plan ?? '');
    assert.deepEqual(
      card.choices.map((row) => row.id),
      [PLAN_EXECUTE, PLAN_DECLINE, 'supplement'],
    );
    const q = askCardForQuestion('r2', parseAskQuestions({ questions: [{ question: 'Go?' }] }), 0);
    assert.equal(q.total, 1);
    assert.equal(q.choices.at(-1)?.other, true);
    assert.equal(q.multiSelect, false);
  });

  it('keeps multiSelect answers as a label list', () => {
    const questions = parseAskQuestions({
      questions: [
        {
          question: 'Pick stores',
          multiSelect: true,
          options: [{ label: 'Redis' }, { label: 'SQLite' }],
        },
      ],
    });
    assert.equal(questions[0].multiSelect, true);
    const card = askCardForQuestion('r3', questions, 0);
    assert.equal(card.multiSelect, true);
    const collected = collectAskAnswer(questions[0], ['Redis', 'SQLite']);
    assert.deepEqual(collected?.labels, ['Redis', 'SQLite']);
    assert.equal(collectAskAnswer(questions[0], ['Other']), undefined);
    const other = collectAskAnswer(questions[0], ['Redis', 'Other'], 'Valkey');
    assert.deepEqual(other?.labels, ['Redis', 'Other']);
    assert.equal(other?.annotation?.notes, 'Valkey');
  });
});
