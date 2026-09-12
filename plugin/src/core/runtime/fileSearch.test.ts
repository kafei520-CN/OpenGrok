import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileSearchGlob, sanitizeGlobFragment, shouldSearchFiles } from './fileSearch';

describe('file search', () => {
  it('does not scan until two safe characters', () => {
    assert.equal(shouldSearchFiles(''), false);
    assert.equal(shouldSearchFiles('a'), false);
    assert.equal(shouldSearchFiles('ab'), true);
    assert.equal(shouldSearchFiles('**'), false);
  });

  it('strips glob metacharacters from the query', () => {
    assert.equal(sanitizeGlobFragment('foo*bar'), 'foobar');
    assert.equal(fileSearchGlob('App'), '**/*App*');
  });
});
