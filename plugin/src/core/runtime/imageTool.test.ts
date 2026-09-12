import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  IMAGE_MCP_SERVER_ID,
  IMAGE_MCP_SERVER_NAME,
  IMAGE_TOOL_NAME,
  handleImageMcpMessage,
  handleMcpSdkCall,
  imageMcpServersMeta,
  mimeFromImageBytes,
} from './imageTool';
import { bindPlatform, type Platform } from '../platform';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);

function fakePlat(over: Partial<Platform> = {}): Platform {
  return {
    cwd: () => '/tmp',
    workspaceFolders: () => ['/tmp'],
    homeDir: () => '/tmp',
    isTrusted: () => true,
    extensionVersion: () => '0.2.44',
    pathEnv: () => '',
    os: () => 'linux',
    language: () => 'en',
    getConfig: (_key, fallback) => fallback,
    setConfig: async () => {},
    getState: (_key, fallback) => fallback,
    setState: async () => {},
    log() {},
    showLog() {},
    info() {},
    warn() {},
    input: async () => undefined,
    confirm: async () => false,
    pick: async () => undefined,
    saveFile: async () => undefined,
    openFiles: async () => undefined,
    openFolders: async () => undefined,
    readDir: async () => [],
    openExternal: async () => {},
    openFile: async () => {},
    clipboardWrite: async () => {},
    findFiles: async () => [],
    relativePath: (filePath) => filePath,
    readFile: async () => PNG,
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async () => true,
    createTerminal() {},
    closeSidebar: async () => {},
    focusChat() {},
    getActiveSelection: () => undefined,
    getActiveFile: () => undefined,
    onTrustChange: () => ({ dispose() {} }),
    onConfigChange: () => ({ dispose() {} }),
    ...over,
  };
}

describe('image tool', () => {
  it('advertises the in-process MCP server for session/new', () => {
    const rows = imageMcpServersMeta();
    assert.equal(rows[0]?.name, IMAGE_MCP_SERVER_NAME);
    assert.equal(rows[0]?.serverId, IMAGE_MCP_SERVER_ID);
  });

  it('lists 图片工具 on tools/list', async () => {
    bindPlatform(fakePlat());
    const listed = await handleImageMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (listed.result as { tools: Array<{ name: string; title: string }> }).tools;
    assert.equal(tools[0]?.name, IMAGE_TOOL_NAME);
    assert.equal(tools[0]?.title, '图片工具');
  });

  it('returns image content as MCP image, not utf8 text', async () => {
    bindPlatform(fakePlat());
    const remembered: Array<[string, string]> = [];
    const result = await handleMcpSdkCall(
      {
        serverId: IMAGE_MCP_SERVER_ID,
        message: {
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name: IMAGE_TOOL_NAME, arguments: { path: 'shot.png' } },
        },
      },
      (filePath, data) => remembered.push([filePath, data]),
    );
    const body = result.result as {
      isError?: boolean;
      content: Array<{ type: string; mimeType?: string; data?: string; text?: string }>;
    };
    assert.equal(body.isError, undefined);
    const image = body.content.find((row) => row.type === 'image');
    assert.equal(image?.mimeType, 'image/png');
    assert.equal(image?.data, Buffer.from(PNG).toString('base64'));
    assert.equal(remembered.length, 1);
  });

  it('rejects a text file instead of decoding it as latin-1', async () => {
    bindPlatform(
      fakePlat({
        readFile: async () => new TextEncoder().encode('hello'),
      }),
    );
    const result = await handleImageMcpMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: IMAGE_TOOL_NAME, arguments: { path: 'readme.md' } },
    });
    const body = result.result as { isError?: boolean; content: Array<{ text?: string }> };
    assert.equal(body.isError, true);
    assert.match(body.content[0]?.text ?? '', /not an image/i);
  });

  it('sniffs png magic even without a matching extension', () => {
    assert.equal(mimeFromImageBytes('mystery.bin', PNG), 'image/png');
  });

  it('rejects unknown sdk_call servers', async () => {
    const result = await handleMcpSdkCall({
      serverId: 'other',
      message: { jsonrpc: '2.0', id: 3, method: 'ping' },
    });
    assert.equal((result.error as { code: number }).code, -32000);
  });
});
