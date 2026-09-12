import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatAgentError,
  formatErrorLine,
  formatRetryUpdate,
  extractFromText,
  isCancelError,
} from './errors';
import { RpcError } from '../agent/rpc';

describe('agent errors', () => {
  it('pulls HTTP status and body out of ACP error data', () => {
    const error = formatAgentError(
      new RpcError('Internal error', -32603, {
        message: 'invalid JSON request body',
        http_status: 400,
      }),
    );
    assert.equal(error.code, 'HTTP 400');
    assert.equal(error.message, 'invalid JSON request body');
    assert.equal(formatErrorLine(error), '[HTTP 400] invalid JSON request body');
  });

  it('keeps provider error codes from nested envelopes', () => {
    const error = formatAgentError(
      new RpcError('Internal error', -32603, {
        error: { code: 'model_not_found', message: 'unknown model', type: 'new_api_error' },
      }),
    );
    assert.equal(error.code, 'model_not_found');
    assert.equal(error.message, 'unknown model');
  });

  it('labels empty-response reasons as the error code', () => {
    const error = extractFromText(
      'empty response from model (no_visible_content): model=gpt-5.6-terra, had_reasoning=false, finish_reason=',
    );
    assert.equal(error.code, 'no_visible_content');
    assert.match(error.message, /empty response/);
  });

  it('strips the SamplingError API prefix down to HTTP + body', () => {
    const error = extractFromText(
      'API error (status 429 Too Many Requests): You are sending requests too quickly.',
    );
    assert.equal(error.code, 'HTTP 429');
    assert.equal(error.message, 'You are sending requests too quickly.');
  });

  it('pulls the provider message out of a JSON API body', () => {
    const error = extractFromText(
      'API error (status 429 Too Many Requests): {"error":{"code":"rate_limited","message":"You have exceeded your quota."}}',
    );
    assert.equal(error.code, 'rate_limited');
    assert.equal(error.message, 'You have exceeded your quota.');
  });

  it('marks grok.com login copy as HTTP 401 so the UI can hint API keys', () => {
    const error = extractFromText(
      'Authentication required: your session has expired or your credentials were rejected. Run /login to re-authenticate, then resend your message.',
    );
    assert.equal(error.code, 'HTTP 401');
  });

  it('keeps the hidden reqwest cause on connection failures', () => {
    const error = extractFromText(
      'request error: error sending request for url (https://api.example.com:51000/v1/chat/completions): invalid peer certificate: UnknownIssuer',
    );
    assert.equal(error.code, 'connection');
    assert.match(error.message, /UnknownIssuer/);
    assert.match(error.message, /api\.example\.com:51000/);
  });

  it('unwraps failed-after-retries prefixes', () => {
    const error = extractFromText(
      'failed after 3 retries: empty response from model (no_visible_content): model=grok-4, finish_reason=',
    );
    assert.equal(error.code, 'no_visible_content');
    assert.match(error.message, /model=grok-4/);
  });

  it('formats in-flight retry_state updates', () => {
    const error = formatRetryUpdate({
      sessionUpdate: 'retry_state',
      type: 'retrying',
      attempt: 2,
      maxRetries: 15,
      reason: 'empty response from model (no_visible_content)',
    });
    assert.equal(error.retrying, true);
    assert.equal(error.attempt, 2);
    assert.equal(error.maxAttempts, 15);
    assert.equal(error.code, 'no_visible_content');
  });

  it('treats cancelled ACP errors as cancel', () => {
    assert.equal(isCancelError(new RpcError('Request cancelled', -32000)), true);
    assert.equal(isCancelError(new RpcError('Internal error', -32603, 'cancelled by user')), true);
    assert.equal(isCancelError(new RpcError('Internal error', -32603, { message: 'ok' })), false);
  });

  it('formats terminal retry_state failures with error_type', () => {
    const error = formatRetryUpdate({
      sessionUpdate: 'retry_state',
      type: 'failed',
      errorType: 'auth',
      message: 'Unauthorized (401)',
    });
    assert.equal(error.retrying, undefined);
    assert.equal(error.code, 'HTTP 401');
    assert.match(error.message, /Unauthorized/);
  });
});
