import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { JsonRpcConnection, RpcError } from './rpc';

describe('JsonRpcConnection', () => {
  it('matches responses to request ids', async () => {
    const stdin = new PassThrough();
    const conn = new JsonRpcConnection(stdin);
    const pending = conn.request('initialize', { protocolVersion: 1 });
    conn.feed(Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n'));
    const result = await pending;
    assert.deepEqual(result, { ok: true });
  });

  it('rejects error responses', async () => {
    const stdin = new PassThrough();
    const conn = new JsonRpcConnection(stdin);
    const pending = conn.request('authenticate', {});
    conn.feed(
      Buffer.from(
        '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"auth required"}}\n',
      ),
    );
    await assert.rejects(pending, (error: unknown) => {
      assert.ok(error instanceof RpcError);
      assert.equal(error.message, 'auth required');
      return true;
    });
  });

  it('emits incoming requests and notifications', async () => {
    const stdin = new PassThrough();
    const conn = new JsonRpcConnection(stdin);
    const requests: string[] = [];
    const notes: string[] = [];
    conn.on('request', (method: string) => requests.push(method));
    conn.on('notification', (method: string) => notes.push(method));
    conn.feed(
      Buffer.from(
        '{"jsonrpc":"2.0","id":9,"method":"session/request_permission","params":{}}\n{"jsonrpc":"2.0","method":"session/update","params":{}}\n',
      ),
    );
    assert.deepEqual(requests, ['session/request_permission']);
    assert.deepEqual(notes, ['session/update']);
  });

  it('matches string response ids to numeric requests', async () => {
    const stdin = new PassThrough();
    const conn = new JsonRpcConnection(stdin);
    const pending = conn.request('initialize', {});
    conn.feed(Buffer.from('{"jsonrpc":"2.0","id":"1","result":{"ok":true}}\n'));
    assert.deepEqual(await pending, { ok: true });
  });

  it('skips an oversized line and keeps the following response', async () => {
    const stdin = new PassThrough();
    const conn = new JsonRpcConnection(stdin, 80);
    const notes: string[] = [];
    const logs: string[] = [];
    conn.on('notification', (method: string) => notes.push(method));
    conn.on('log', (message: string) => logs.push(message));
    const pending = conn.request('initialize', {});
    conn.feed(
      Buffer.from(
        `{"jsonrpc":"2.0","method":"session/update","params":{}}\n${'x'.repeat(120)}\n{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n`,
      ),
    );
    assert.deepEqual(notes, ['session/update']);
    assert.deepEqual(await pending, { ok: true });
    assert.equal(conn.isClosed, false);
    assert.equal(logs.length, 1);
  });

  it('discards a line that exceeds the cap before its newline', async () => {
    const stdin = new PassThrough();
    const conn = new JsonRpcConnection(stdin, 80);
    const pending = conn.request('initialize', {});
    conn.feed(Buffer.from('x'.repeat(120)));
    assert.equal(conn.isClosed, false);
    conn.feed(Buffer.from(`yyyy\n{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n`));
    assert.deepEqual(await pending, { ok: true });
  });

  it('rejects a request that exceeds its timeout without blocking later calls', async () => {
    const stdin = new PassThrough();
    const conn = new JsonRpcConnection(stdin);
    const pending = conn.request('_x.ai/internal/reload_models', {}, 20);
    await assert.rejects(pending, /timed out after 20ms/);
    const next = conn.request('initialize', {});
    conn.feed(Buffer.from('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n'));
    assert.deepEqual(await next, { ok: true });
  });

  it('keeps a chinese character that arrives split across stdout chunks', () => {
    const stdin = new PassThrough();
    const line = Buffer.from(
      '{"jsonrpc":"2.0","id":7,"method":"fs/write_text_file","params":{"path":"a.md","content":"避免跨维度缓存误显示。Mixin 会复制列表"}}\n',
    );
    const token = Buffer.from('缓存', 'utf8');
    const at = line.indexOf(token);
    assert.ok(at > 0);
    for (let cut = 1; cut < token.length; cut += 1) {
      const fresh = new JsonRpcConnection(stdin);
      const got: string[] = [];
      fresh.on('request', (_method: string, params: { content?: string }) => {
        got.push(params.content ?? '');
      });
      fresh.feed(line.subarray(0, at + cut));
      assert.equal(got.length, 0);
      fresh.feed(line.subarray(at + cut));
      assert.equal(got.length, 1);
      assert.equal(got[0].includes('\uFFFD'), false);
      assert.equal(got[0], '避免跨维度缓存误显示。Mixin 会复制列表');
    }
  });
});
