import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bindPlatform, type Platform } from '../platform';
import {
  BROWSER_MCP_SERVER_ID,
  BROWSER_MCP_SERVER_NAME,
  browserAction,
  browserMcpServersMeta,
  handleBrowserMcpMessage,
} from './browserTool';

function fakePlat(over: Partial<Platform> = {}): Platform {
  return {
    cwd: () => '/tmp',
    workspaceFolders: () => ['/tmp'],
    homeDir: () => '/tmp',
    isTrusted: () => true,
    extensionVersion: () => '0.5.5',
    pathEnv: () => '',
    os: () => 'win32',
    language: () => 'zh-CN',
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
    readFile: async () => new Uint8Array(),
    writeFile: async () => {},
    deleteFile: async () => {},
    fileExists: async () => false,
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

describe('browser tool', () => {
  it('advertises the side browser MCP server', () => {
    const rows = browserMcpServersMeta();
    assert.equal(rows[0]?.name, BROWSER_MCP_SERVER_NAME);
    assert.equal(rows[0]?.serverId, BROWSER_MCP_SERVER_ID);
  });

  it('lists eyes and hands', async () => {
    bindPlatform(fakePlat());
    const listed = await handleBrowserMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (listed.result as { tools: Array<{ name: string; title: string }> }).tools;
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['browser_open', 'browser_look', 'browser_click', 'browser_drag', 'browser_type', 'browser_press', 'browser_scroll'],
    );
    assert.equal(tools[1]?.title, '看网页');
  });

  it('returns the screenshot from browser_look', async () => {
    bindPlatform(
      fakePlat({
        browserDock: async (payload) => {
          assert.equal(payload['action'], 'look');
          return {
            ok: true,
            summary: '这是侧边栏浏览器现在的画面。',
            url: 'https://example.com',
            title: 'Example',
            viewport: { width: 800, height: 600 },
            image: { width: 800, height: 600, mimeType: 'image/jpeg', data: 'abc' },
            text: 'Hello',
            elements: [],
          };
        },
      }),
    );
    const result = await handleBrowserMcpMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'browser_look', arguments: {} },
    });
    const content = (result.result as { content: Array<{ type: string; data?: string }> }).content;
    assert.equal(content[0]?.type, 'text');
    assert.equal(content[1]?.type, 'image');
    assert.equal(content[1]?.data, 'abc');
  });

  it('accepts the server-prefixed name browser_browser_open', async () => {
    let action = '';
    bindPlatform(
      fakePlat({
        browserDock: async (payload) => {
          action = String(payload['action'] ?? '');
          return { ok: true, summary: '已打开', url: payload['url'] };
        },
      }),
    );
    const result = await handleBrowserMcpMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'browser_browser_open', arguments: { url: 'http://127.0.0.1:8765/' } },
    });
    assert.equal(action, 'open');
    assert.equal((result.result as { isError?: boolean }).isError, undefined);
    assert.equal(browserAction('browser_browser_look'), 'look');
    assert.equal(browserAction('browser_drag'), 'drag');
  });

  it('keeps the platform this when the host method reads opts', async () => {
    const platform = fakePlat();
    const opts = {
      request: async (_method: string, params: Record<string, unknown>) => ({
        ok: true,
        summary: '已打开',
        url: params['url'],
      }),
    };
    const bound = platform as Platform & { opts: typeof opts };
    bound.opts = opts;
    bound.browserDock = function (payload: Record<string, unknown>) {
      return this.opts.request('browserDock', payload);
    };
    bindPlatform(bound);
    const result = await handleBrowserMcpMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'browser_open', arguments: { url: 'http://127.0.0.1:8765/' } },
    });
    const text = (result.result as { content: Array<{ text?: string }>; isError?: boolean }).content[0]?.text ?? '';
    assert.equal((result.result as { isError?: boolean }).isError, undefined);
    assert.match(text, /127\.0\.0\.1:8765/);
  });

  it('says the browser is desktop-only when the host has no hands', async () => {
    bindPlatform(fakePlat());
    const result = await handleBrowserMcpMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'browser_open', arguments: { url: 'https://example.com' } },
    });
    const content = (result.result as { content: Array<{ text: string }>; isError?: boolean }).content;
    assert.equal((result.result as { isError?: boolean }).isError, true);
    assert.match(content[0]?.text ?? '', /桌面版/);
  });
});
