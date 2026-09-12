import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { languageFromPath } from './monaco';

describe('languageFromPath', () => {
  it('maps common extensions', () => {
    assert.equal(languageFromPath('src/app.ts'), 'typescript');
    assert.equal(languageFromPath('src/app.tsx'), 'tsx');
    assert.equal(languageFromPath('lib/index.js'), 'javascript');
    assert.equal(languageFromPath('ui.jsx'), 'jsx');
    assert.equal(languageFromPath('setup.sh'), 'bash');
    assert.equal(languageFromPath('main.py'), 'python');
    assert.equal(languageFromPath('crates/foo/src/lib.rs'), 'rust');
    assert.equal(languageFromPath('go.mod'), 'plaintext');
    assert.equal(languageFromPath('Dockerfile'), 'dockerfile');
    assert.equal(languageFromPath('a.yml'), 'yaml');
    assert.equal(languageFromPath('C:\\proj\\Main.kt'), 'kotlin');
  });

  it('falls back to plaintext', () => {
    assert.equal(languageFromPath('README'), 'plaintext');
    assert.equal(languageFromPath('file.unknownext'), 'plaintext');
  });
});
