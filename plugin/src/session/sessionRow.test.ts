import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSessionRow, sessionHasHistory } from './sessionRow';

describe('session list', () => {
  it('drops empty sessions that only have an id', () => {
    const row = parseSessionRow({
      info: { id: '01a042ce-4c79-7243-a585-145fb389f852' },
      generated_title: null,
      session_summary: '',
      num_chat_messages: 2,
      num_messages: 0,
    });
    assert.ok(row);
    assert.equal(row.title, '');
    assert.equal(sessionHasHistory(row), false);
  });

  it('keeps sessions with a generated title and chat messages', () => {
    const row = parseSessionRow({
      id: '01a042ce-4c79-7243-a585-145fb389f852',
      generated_title: 'Grok Build VS Code 插件与网页登录',
      num_chat_messages: 4,
      updated_at: '2026-08-27T12:00:00Z',
    });
    assert.ok(row);
    assert.equal(row.title, 'Grok Build VS Code 插件与网页登录');
    assert.equal(sessionHasHistory(row), true);
  });

  it('does not treat the session id as a title', () => {
    const id = '01a042d8-11ad-7072-9e7e-f7021c6588c6';
    const row = parseSessionRow({
      id,
      title: id,
      num_chat_messages: 2,
      num_messages: 0,
    });
    assert.ok(row);
    assert.equal(row.title, '');
    assert.equal(sessionHasHistory(row), false);
  });

  it('drops uuid-titled rows even when chat counters are non-zero', () => {
    const id = '01a042ce-4c79-7243-a585-145fb389f852';
    const row = parseSessionRow({
      info: { id },
      session_summary: '',
      num_chat_messages: 2,
      num_messages: 0,
    });
    assert.equal(sessionHasHistory(row!), false);
  });

  it('drops titled rows that still have zero user messages', () => {
    const row = parseSessionRow({
      info: { id: '01a042ce-4c79-7243-a585-145fb389f852' },
      generated_title: 'Stale title',
      num_chat_messages: 2,
      num_messages: 0,
    });
    assert.equal(sessionHasHistory(row!), false);
  });

  it('drops init-only chat counters when num_messages is omitted', () => {
    const row = parseSessionRow({
      info: { id: '01a042ce-4c79-7243-a585-145fb389f852' },
      generated_title: 'Maybe leftover',
      num_chat_messages: 2,
    });
    assert.equal(sessionHasHistory(row!), false);
  });

  it('keeps last-turn titled sessions that have real messages', () => {
    const row = parseSessionRow({
      info: { id: '01a042ce-4c79-7243-a585-145fb389f852' },
      last_turn_summary: 'Wrote test.txt',
      num_messages: 4,
      num_chat_messages: 7,
    });
    assert.ok(row);
    assert.equal(row.title, 'Wrote test.txt');
    assert.equal(sessionHasHistory(row), true);
  });

  it('hides subagent and hidden rows', () => {
    const hidden = parseSessionRow({
      id: 'a',
      generated_title: 'Sub',
      num_chat_messages: 2,
      session_kind: 'subagent',
    });
    const flagged = parseSessionRow({
      id: 'b',
      generated_title: 'Secret',
      num_chat_messages: 2,
      hidden: true,
    });
    assert.equal(sessionHasHistory(hidden!), false);
    assert.equal(sessionHasHistory(flagged!), false);
  });
});
