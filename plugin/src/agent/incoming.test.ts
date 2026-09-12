import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleIncoming, METHOD_NOT_FOUND, type IncomingHost } from './incoming';
import { RpcError } from './rpc';

function host(over: Partial<IncomingHost> = {}): IncomingHost {
  return {
    applyIncomingUpdate() {},
    async requestToolPermission() {
      return {};
    },
    journal: { remember: async () => {} },
    ...over,
  };
}

describe('handleIncoming', () => {
  it('applies x.ai/models/update with or without the ext underscore', async () => {
    const payloads: unknown[] = [];
    const controller = host({
      applyModelsUpdate(params) {
        payloads.push(params);
      },
    });
    const params = {
      currentModelId: 'openai-gpt',
      availableModels: [{ modelId: 'openai-gpt', name: 'GPT' }],
    };
    await handleIncoming(controller, '_x.ai/models/update', params, 1);
    await handleIncoming(controller, 'x.ai/models/update', params, '');
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[0], params);
  });

  it('rejects unknown client requests instead of acking them', async () => {
    await assert.rejects(
      () => handleIncoming(host(), 'session/foo', {}, 7),
      (error: unknown) =>
        error instanceof RpcError &&
        error.code === METHOD_NOT_FOUND &&
        error.message.includes('session/foo'),
    );
  });

  it('ignores unknown notifications', async () => {
    const result = await handleIncoming(host(), 'x.ai/fs/index', {}, '');
    assert.deepEqual(result, {});
  });

  it('refreshes MCP rows on catalog notifications', async () => {
    let n = 0;
    await handleIncoming(host({ refreshMcps: () => { n += 1; } }), 'x.ai/mcp/servers_updated', {}, '');
    assert.equal(n, 1);
  });

  it('refreshes the dashboard on roster broadcasts', async () => {
    let n = 0;
    await handleIncoming(host({ refreshDashboard: () => { n += 1; } }), 'x.ai/sessions/changed', {}, '');
    assert.equal(n, 1);
  });

  it('routes plan-mode reverse requests to the host', async () => {
    const asks: unknown[] = [];
    const plans: unknown[] = [];
    const controller = host({
      async askUserQuestion(params) {
        asks.push(params);
        return { outcome: 'cancelled' };
      },
      async reviewPlan(params) {
        plans.push(params);
        return { outcome: 'approved' };
      },
    });
    await handleIncoming(controller, '_x.ai/ask_user_question', { questions: [] }, 1);
    await handleIncoming(controller, 'x.ai/exit_plan_mode', { planContent: '# p' }, 2);
    assert.equal(asks.length, 1);
    assert.equal(plans.length, 1);
  });

  it('refuses workspace writes while Ask mode is on', async () => {
    await assert.rejects(
      () =>
        handleIncoming(
          host({ allowsFileWrites: () => false }),
          'fs/write_text_file',
          { path: '/tmp/a.ts', content: 'x' },
          3,
        ),
      /Ask mode is read-only/,
    );
  });

  it('routes in-process image MCP calls', async () => {
    const result = await handleIncoming(
      host(),
      '_x.ai/mcp/sdk_call',
      {
        serverId: 'grok-plugin-images',
        message: { jsonrpc: '2.0', id: 4, method: 'tools/list' },
      },
      4,
    );
    const tools = (result as { result: { tools: Array<{ name: string; title: string }> } }).result.tools;
    assert.equal(tools[0]?.name, 'read_image');
    assert.equal(tools[0]?.title, '图片工具');
  });

  it('answers mcp elicit with a typed cancel', async () => {
    const result = await handleIncoming(host(), 'x.ai/mcp/elicit', { message: 'Need email' }, 9);
    assert.deepEqual(result, { outcome: 'cancel' });
    const done = await handleIncoming(host(), '_x.ai/mcp/elicit_complete', {}, '');
    assert.deepEqual(done, {});
  });
});
