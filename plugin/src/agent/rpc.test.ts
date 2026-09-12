import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { JsonRpcConnection, MAX_RPC_BUFFER, RpcError } from './rpc';

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

  it('parses complete lines then closes on leftover overflow', async () => {
    const stdin = new PassThrough();
    const conn = new JsonRpcConnection(stdin);
    const notes: string[] = [];
    let overflow = false;
    conn.on('notification', (method: string) => notes.push(method));
    conn.on('overflow', () => {
      overflow = true;
    });
    const pending = conn.request('initialize', {});
    conn.feed(
      Buffer.from(`{"jsonrpc":"2.0","method":"session/update","params":{}}\n${'x'.repeat(MAX_RPC_BUFFER + 1)}`),
    );
    assert.deepEqual(notes, ['session/update']);
    assert.equal(overflow, true);
    assert.equal(conn.isClosed, true);
    await assert.rejects(pending);
    conn.feed(Buffer.from('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n'));
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
});
