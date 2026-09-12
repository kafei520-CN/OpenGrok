import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMcpList } from './mcpHost';

describe('mcp list', () => {
  it('reads catalog and session enabled flags', () => {
    const rows = parseMcpList({
      servers: [
        {
          name: 'linear',
          displayName: 'Linear',
          source: 'managed',
          session: { enabled: false, status: 'ready', tools: [{ name: 'list' }] },
        },
        {
          name: 'filesystem',
          source: 'local',
          sourceLabel: 'config.toml',
          enabled: true,
          tools: [{ name: 'read' }, { name: 'write' }],
        },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'filesystem');
    assert.equal(rows[0].toolCount, 2);
    assert.equal(rows[1].name, 'Linear');
    assert.equal(rows[1].enabled, false);
    assert.equal(rows[1].source, 'managed');
  });

  it('unwraps ext-method result envelopes', () => {
    const rows = parseMcpList({
      result: { servers: [{ name: 'slack', source: 'local', session: { enabled: true, tools: [] } }] },
    });
    assert.equal(rows[0]?.id, 'slack');
    assert.equal(rows[0]?.enabled, true);
  });
});
