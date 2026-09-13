import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findInteractiveAuthMethod,
  isSessionAuthMethod,
  needsInteractiveLogin,
  resolveSessionAuthMethodId,
  selectEagerAuthMethod,
  selectNonInteractiveAuthMethod,
} from './authMethods';

describe('authMethods', () => {
  it('requires login when grok.com is first', () => {
    const methods = [{ id: 'grok.com', name: 'Grok' }];
    assert.equal(needsInteractiveLogin(methods), true);
    assert.equal(findInteractiveAuthMethod(methods)?.id, 'grok.com');
  });

  it('does not require login when a cached token is first', () => {
    const methods = [
      { id: 'cached_token', name: 'cached_token' },
      { id: 'grok.com', name: 'Grok' },
    ];
    assert.equal(needsInteractiveLogin(methods), false);
    assert.equal(selectEagerAuthMethod(methods, 'cached_token'), 'cached_token');
  });

  it('prefers the agent default when it is advertised', () => {
    const methods = [
      { id: 'xai.api_key', name: 'API key' },
      { id: 'cached_token', name: 'cached_token' },
    ];
    assert.equal(selectEagerAuthMethod(methods, 'cached_token'), 'cached_token');
  });

  it('falls back to the first method', () => {
    const methods = [{ id: 'xai.api_key', name: 'API key' }];
    assert.equal(selectEagerAuthMethod(methods), 'xai.api_key');
  });

  it('skip login prefers cached token over grok.com', () => {
    const methods = [
      { id: 'grok.com', name: 'Grok' },
      { id: 'cached_token', name: 'cached_token' },
      { id: 'xai.api_key', name: 'API key' },
    ];
    assert.equal(selectNonInteractiveAuthMethod(methods), 'cached_token');
  });

  it('skip login has no method when only the browser is advertised', () => {
    const methods = [{ id: 'grok.com', name: 'Grok' }];
    assert.equal(selectNonInteractiveAuthMethod(methods), undefined);
  });

  it('treats grok.com login methods as session auth', () => {
    assert.equal(isSessionAuthMethod('cached_token'), true);
    assert.equal(isSessionAuthMethod('grok.com'), true);
    assert.equal(isSessionAuthMethod('oidc'), true);
    assert.equal(isSessionAuthMethod('xai.api_key'), false);
  });

  it('session/new uses the signed-in method when present', () => {
    assert.equal(
      resolveSessionAuthMethodId({
        accountMethodId: 'cached_token',
        methods: [{ id: 'grok.com', name: 'Grok' }],
      }),
      'cached_token',
    );
  });

  it('skip login can open a session with the API key and no grok.com method', () => {
    assert.equal(
      resolveSessionAuthMethodId({
        skipInteractive: true,
        methods: [{ id: 'grok.com', name: 'Grok' }],
      }),
      'xai.api_key',
    );
  });
});
