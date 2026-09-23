import { plat } from '../platform';
import { asObject, asString } from '../wire';

export const BROWSER_MCP_SERVER_NAME = 'browser';
export const BROWSER_MCP_SERVER_ID = 'grok-plugin-browser';

const ACTIONS = ['open', 'look', 'click', 'drag', 'type', 'press', 'scroll'] as const;

export function browserServerIds(): string[] {
  return [BROWSER_MCP_SERVER_ID, BROWSER_MCP_SERVER_NAME];
}

export function browserAction(name: string): (typeof ACTIONS)[number] | undefined {
  const trimmed = name.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^browser__/, ''),
    trimmed.replace(/^browser_/, ''),
  ];
  for (const candidate of candidates) {
    if ((ACTIONS as readonly string[]).includes(candidate)) {
      return candidate as (typeof ACTIONS)[number];
    }
    if (candidate.startsWith('browser_')) {
      const action = candidate.slice('browser_'.length);
      if ((ACTIONS as readonly string[]).includes(action)) {
        return action as (typeof ACTIONS)[number];
      }
    }
  }
  return undefined;
}

const TOOLS = [
  'browser_open',
  'browser_look',
  'browser_click',
  'browser_drag',
  'browser_type',
  'browser_press',
  'browser_scroll',
] as const;

export function browserMcpServersMeta(): Array<{ name: string; serverId: string }> {
  return [{ name: BROWSER_MCP_SERVER_NAME, serverId: BROWSER_MCP_SERVER_ID }];
}

export async function handleBrowserMcpMessage(message: unknown): Promise<Record<string, unknown>> {
  const obj = asObject(message);
  const id = jsonRpcId(message);
  const method = asString(obj['method']) ?? '';
  if (method === 'initialize') {
    const requested = asString(asObject(obj['params'])['protocolVersion']);
    return rpcResult(id, {
      protocolVersion: requested || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: BROWSER_MCP_SERVER_NAME, version: plat().extensionVersion() },
    });
  }
  if (method === 'ping' || method === 'notifications/initialized') {
    return rpcResult(id, {});
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS.map((name) => toolDescriptor(name)) });
  }
  if (method === 'resources/list') {
    return rpcResult(id, { resources: [] });
  }
  if (method === 'prompts/list') {
    return rpcResult(id, { prompts: [] });
  }
  if (method === 'tools/call') {
    return rpcResult(id, await callBrowserTool(obj['params']));
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function toolDescriptor(name: (typeof TOOLS)[number]): Record<string, unknown> {
  if (name === 'browser_open') {
    return {
      name,
      title: '打开网页',
      description:
        '手脚。在 OpenGrok 右侧边栏的浏览器里打开网址，并返回当前画面。用来开始网页测试或网页游戏测试。url 可以是 https://example.com，也可以只写域名。',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要打开的网址。' },
        },
        required: ['url'],
      },
    };
  }
  if (name === 'browser_look') {
    return {
      name,
      title: '看网页',
      description:
        'look。截下侧边栏浏览器现在的画面。点击和拖拽的坐标用这张截图的像素，原点在左上角。操作一次后再看一次，不要反复搜索工具名。',
      inputSchema: { type: 'object', properties: {} },
    };
  }
  if (name === 'browser_click') {
    return {
      name,
      title: '点击网页',
      description:
        'click。在侧边栏浏览器里点一下。x 和 y 是 browser_look 截图像素。也可以传 selector。拖拽用 browser_drag，不要搜代码。',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '截图像素，距左边。' },
          y: { type: 'number', description: '截图像素，距上边。' },
          selector: { type: 'string', description: '可选。要点的元素的 CSS 选择器。' },
        },
      },
    };
  }
  if (name === 'browser_drag') {
    return {
      name,
      title: '拖拽',
      description:
        'drag pointer mousemove mouse hold。按住鼠标从截图坐标 (x1,y1) 拖到 (x2,y2)。弹弓、滑动、画线直接用这个，不要搜索仓库或文档。',
      inputSchema: {
        type: 'object',
        properties: {
          x1: { type: 'number', description: '起点，截图像素，距左边。' },
          y1: { type: 'number', description: '起点，截图像素，距上边。' },
          x2: { type: 'number', description: '终点，截图像素，距左边。' },
          y2: { type: 'number', description: '终点，截图像素，距上边。' },
        },
        required: ['x1', 'y1', 'x2', 'y2'],
      },
    };
  }
  if (name === 'browser_type') {
    return {
      name,
      title: '输入文字',
      description:
        '手脚。把文字输入侧边栏浏览器当前焦点。传 selector 时先点中那个输入框。游戏里的单次按键用 browser_press，不要用这个。',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要输入的文字。' },
          selector: { type: 'string', description: '可选。先聚焦的 CSS 选择器。' },
        },
        required: ['text'],
      },
    };
  }
  if (name === 'browser_press') {
    return {
      name,
      title: '按键',
      description:
        '手脚。在侧边栏浏览器里按一次键。适合网页游戏。key 可以是 Enter、Space、ArrowLeft、ArrowRight、ArrowUp、ArrowDown、Escape，或单个字母如 w、a、d。',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '键名。' },
        },
        required: ['key'],
      },
    };
  }
  return {
    name,
    title: '滚动网页',
    description: '手脚。滚动侧边栏浏览器。dy 大于 0 向下，小于 0 向上。dx 左右滚动。',
    inputSchema: {
      type: 'object',
      properties: {
        dy: { type: 'number', description: '垂直滚动量，正数向下。' },
        dx: { type: 'number', description: '水平滚动量，正数向右。' },
      },
    },
  };
}

async function callBrowserTool(raw: unknown): Promise<Record<string, unknown>> {
  const params = asObject(raw);
  const name = asString(params['name']) ?? asString(params['tool']) ?? '';
  const action = browserAction(name);
  if (!action) {
    return toolError(`Unknown tool: ${name || '(missing)'}`);
  }
  const host = plat();
  if (!host.browserDock) {
    return toolError('侧边栏浏览器只在 OpenGrok 桌面版里。');
  }
  const args = toolArgs(params['arguments'] ?? params['args']);
  try {
    const result = asObject(await host.browserDock({ action, ...args }));
    if (result['ok'] === false) {
      return toolError(asString(result['error']) ?? '浏览器操作失败');
    }
    return toolContent(result);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

function toolContent(result: Record<string, unknown>): Record<string, unknown> {
  const image = asObject(result['image']);
  const data = asString(image['data']);
  const mimeType = asString(image['mimeType']) ?? 'image/jpeg';
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: describe(result) }];
  if (data) {
    content.push({ type: 'image', data, mimeType });
  }
  return { content };
}

function describe(result: Record<string, unknown>): string {
  const lines = [asString(result['summary']) ?? '完成'];
  const url = asString(result['url']);
  const title = asString(result['title']);
  if (title) {
    lines.push(`标题: ${title}`);
  }
  if (url) {
    lines.push(`网址: ${url}`);
  }
  const viewport = asObject(result['viewport']);
  const image = asObject(result['image']);
  if (typeof image['width'] === 'number') {
    lines.push(
      `截图 ${image['width']}×${image['height']} 像素，对应页面视口 ${viewport['width'] ?? '?'}×${viewport['height'] ?? '?'}。点击时用截图像素。`,
    );
  }
  const text = asString(result['text']);
  if (text) {
    lines.push(text);
  }
  const elements = Array.isArray(result['elements']) ? result['elements'] : [];
  if (elements.length) {
    lines.push('可点元素（下面的坐标是页面视口像素。点击请用截图像素或 selector）:');
    for (const item of elements.slice(0, 30)) {
      const row = asObject(item);
      lines.push(
        `- ${asString(row['tag']) ?? ''} ${asString(row['text']) ?? ''} @ ${row['x']},${row['y']}`,
      );
    }
  }
  return lines.join('\n');
}

function toolArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return asObject(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  return asObject(raw);
}

function toolError(text: string): Record<string, unknown> {
  return { content: [{ type: 'text', text }], isError: true };
}

function jsonRpcId(message: unknown): string | number | null {
  const id = asObject(message)['id'];
  if (typeof id === 'string' || typeof id === 'number') {
    return id;
  }
  return null;
}

function rpcResult(id: string | number | null, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: string | number | null, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
