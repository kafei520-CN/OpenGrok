import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePersonaFileName, parsePersonaToml, safePersonaStem } from './personasHost';

describe('personas', () => {
  it('reads quoted and triple-quoted TOML fields', () => {
    const quoted = parsePersonaToml('description = "Deep investigator."\ninstructions = "Cite paths."\n');
    assert.equal(quoted.description, 'Deep investigator.');
    assert.equal(quoted.instructions, 'Cite paths.');
    const triple = parsePersonaToml('instructions = """\nLine one\nLine two\n"""\n');
    assert.equal(triple.instructions, 'Line one\nLine two');
  });

  it('treats .toml.disabled as toggled off', () => {
    assert.deepEqual(parsePersonaFileName('researcher.toml'), {
      stem: 'researcher',
      enabled: true,
    });
    assert.deepEqual(parsePersonaFileName('researcher.toml.disabled'), {
      stem: 'researcher',
      enabled: false,
    });
  });

  it('sanitizes import stems', () => {
    assert.equal(safePersonaStem('/tmp/concise.toml'), 'concise');
  });
});
