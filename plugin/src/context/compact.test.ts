import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCompactNote,
  collectCompactHints,
  COMPACT_COOLDOWN_MS,
  COMPACT_MIN_MESSAGES,
  emptyCompactGate,
  markCompacted,
  observeCompactUsage,
  shouldPrefireCompact,
} from './compact';

describe('shouldPrefireCompact', () => {
  const base = {
    percent: 90,
    compactAt: 85,
    messageCount: COMPACT_MIN_MESSAGES,
    busy: false,
    gate: emptyCompactGate(),
    now: 100_000,
  };

  it('fires at the compact threshold', () => {
    assert.equal(shouldPrefireCompact(base), true);
    assert.equal(shouldPrefireCompact({ ...base, percent: 85 }), true);
  });

  it('waits below the threshold', () => {
    assert.equal(shouldPrefireCompact({ ...base, percent: 84 }), false);
  });

  it('skips short transcripts and in-flight turns', () => {
    assert.equal(shouldPrefireCompact({ ...base, messageCount: 3 }), false);
    assert.equal(shouldPrefireCompact({ ...base, busy: true }), false);
  });

  it('stays disarmed until usage drops, then fires again', () => {
    const spent = markCompacted(emptyCompactGate(), 100_000);
    assert.equal(shouldPrefireCompact({ ...base, gate: spent, now: 200_000 }), false);
    const armed = observeCompactUsage(spent, 70, 85);
    assert.equal(armed.armed, true);
    assert.equal(shouldPrefireCompact({ ...base, gate: armed, now: 200_000 }), true);
  });

  it('respects cooldown after a compact', () => {
    const spent = markCompacted(emptyCompactGate(), 100_000);
    const armed = { ...spent, armed: true };
    assert.equal(
      shouldPrefireCompact({ ...base, gate: armed, now: 100_000 + COMPACT_COOLDOWN_MS - 1 }),
      false,
    );
    assert.equal(
      shouldPrefireCompact({ ...base, gate: armed, now: 100_000 + COMPACT_COOLDOWN_MS }),
      true,
    );
  });
});

describe('buildCompactNote', () => {
  it('asks to keep the live tail and lists files', () => {
    const note = buildCompactNote({
      auto: true,
      files: ['controller.ts', 'app.ts'],
      errors: ['ENOENT dist/main.js'],
      userNote: 'keep the auth bug',
    });
    assert.match(note, /Auto-compact/);
    assert.match(note, /full fidelity/);
    assert.match(note, /controller\.ts/);
    assert.match(note, /ENOENT/);
    assert.match(note, /Focus: keep the auth bug/);
  });
});

describe('collectCompactHints', () => {
  it('keeps recent file names and errors', () => {
    const hints = collectCompactHints([
      {
        edits: [{ path: 'plugin/src/chat/controller.ts' }],
        tools: [{ detail: 'C:\\repo\\plugin\\src\\context\\compact.ts' }],
        error: { message: '  compact failed\nretry  ' },
      },
    ]);
    assert.deepEqual(hints.files, ['controller.ts', 'compact.ts']);
    assert.equal(hints.errors[0], 'compact failed retry');
  });
});
