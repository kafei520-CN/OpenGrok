import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseActionOutcome,
  parseHookList,
  parseMarketplaceList,
  parsePluginList,
  parseWorkflowList,
} from './extensionsHost';

describe('extensions parse', () => {
  it('reads plugins and hooks from result envelopes', () => {
    const plugins = parsePluginList({
      result: { plugins: [{ id: 'user/aa/demo', name: 'demo', enabled: false, skillCount: 2 }] },
    });
    assert.equal(plugins[0].id, 'user/aa/demo');
    assert.equal(plugins[0].enabled, false);
    const hooks = parseHookList({
      result: { hooks: [{ name: 'global/pre', event: 'pre_tool_use', disabled: true }] },
    });
    assert.equal(hooks[0].enabled, false);
    assert.equal(hooks[0].event, 'pre_tool_use');
  });

  it('flattens marketplace sources into installable rows', () => {
    const rows = parseMarketplaceList({
      result: {
        sources: [
          {
            sourceName: 'team',
            sourceUrlOrPath: 'https://git/x',
            plugins: [
              {
                name: 'reviewer',
                relativePath: 'reviewer',
                installStatus: 'available',
                description: 'PR review',
              },
            ],
          },
        ],
      },
    });
    assert.equal(rows[0].sourceUrl, 'https://git/x');
    assert.equal(rows[0].relativePath, 'reviewer');
  });

  it('reads workflow catalog names', () => {
    const rows = parseWorkflowList({
      result: { workflows: [{ name: 'review-changes', description: 'Review', source: 'user' }] },
    });
    assert.equal(rows[0].name, 'review-changes');
    assert.equal(parseActionOutcome({ status: 'success', message: 'ok' }).ok, true);
  });
});
