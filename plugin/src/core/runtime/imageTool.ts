import * as path from 'node:path';
import { isImagePath, looksLikeImage, mimeFromImagePath } from '../../agent/clientHandlers';
import { plat } from '../platform';
import { asObject, asString } from '../wire';

/** session/new `_meta["x.ai/mcp/servers"]` 里的工具命名空间。 */
export const IMAGE_MCP_SERVER_NAME = 'images';
/** Agent 在 `x.ai/mcp/sdk_call` 里回传的 serverId。 */
export const IMAGE_MCP_SERVER_ID = 'grok-plugin-images';
/** 插件内置图片工具的 MCP 名。 */
export const IMAGE_TOOL_NAME = 'read_image';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function imageMcpServersMeta(): Array<{ name: string; serverId: string }> {
  return [{ name: IMAGE_MCP_SERVER_NAME, serverId: IMAGE_MCP_SERVER_ID }];
}

/** 处理 Agent 反向 `x.ai/mcp/sdk_call`，返回完整 JSON-RPC 响应。 */
export async function handleMcpSdkCall(
  params: unknown,
  remember?: (filePath: string, data: string) => void,
): Promise<Record<string, unknown>> {
  const obj = asObject(params);
  const serverId = asString(obj['serverId']) ?? asString(obj['server_id']);
  const message = obj['message'];
  const id = jsonRpcId(message);
  if (serverId !== IMAGE_MCP_SERVER_ID) {
    return rpcError(id, -32000, `unknown MCP server ${serverId ?? ''}`);
  }
  return handleImageMcpMessage(message, remember);
}

export async function handleImageMcpMessage(
  message: unknown,
  remember?: (filePath: string, data: string) => void,
): Promise<Record<string, unknown>> {
  const obj = asObject(message);
  const id = jsonRpcId(message);
  const method = asString(obj['method']) ?? '';
  if (method === 'initialize') {
    const requested = asString(asObject(obj['params'])['protocolVersion']);
    return rpcResult(id, {
      protocolVersion: requested || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: IMAGE_MCP_SERVER_NAME, version: plat().extensionVersion() },
    });
  }
  if (method === 'ping' || method === 'notifications/initialized') {
    return rpcResult(id, {});
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: [imageToolDescriptor()] });
  }
  if (method === 'resources/list') {
    return rpcResult(id, { resources: [] });
  }
  if (method === 'prompts/list') {
    return rpcResult(id, { prompts: [] });
  }
  if (method === 'tools/call') {
    return rpcResult(id, await callImageTool(obj['params'], remember));
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function imageToolDescriptor(): Record<string, unknown> {
  return {
    name: IMAGE_TOOL_NAME,
    title: '图片工具',
    description:
      '图片工具. Read a workspace image (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF, TIFF) as visual content the model can see. Always use this instead of read_file for image files. Do not call read_file on images: that path treats them as binary text and fails.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'The path of the image to read. Relative to the workspace or an absolute path.',
        },
      },
      required: ['path'],
    },
  };
}

async function callImageTool(
  raw: unknown,
  remember?: (filePath: string, data: string) => void,
): Promise<Record<string, unknown>> {
  const params = asObject(raw);
  const name = asString(params['name']) ?? '';
  if (name !== IMAGE_TOOL_NAME && name !== `${IMAGE_MCP_SERVER_NAME}__${IMAGE_TOOL_NAME}`) {
    return toolError(`Unknown tool: ${name || '(missing)'}`);
  }
  const args = toolArgs(params['arguments']);
  const requested =
    asString(args['path']) ??
    asString(args['target_file']) ??
    asString(args['file_path']) ??
    asString(args['filePath']);
  if (!requested) {
    return toolError('read_image missing path');
  }
  const filePath = resolveImagePath(requested);
  try {
    const image = await readImageBytes(filePath);
    remember?.(filePath, image.data);
    return {
      content: [
        {
          type: 'text',
          text: `Read image: ${path.basename(filePath)} (${image.mimeType})`,
        },
        {
          type: 'image',
          data: image.data,
          mimeType: image.mimeType,
        },
      ],
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

export async function readImageBytes(filePath: string): Promise<{ mimeType: string; data: string }> {
  if (!(await plat().fileExists(filePath))) {
    throw new Error(`file not found: ${filePath}`);
  }
  const bytes = Buffer.from(await plat().readFile(filePath));
  if (bytes.length === 0) {
    throw new Error(`empty file: ${filePath}`);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`image too large (${bytes.length} bytes, max ${MAX_IMAGE_BYTES}): ${filePath}`);
  }
  const mime = mimeFromImageBytes(filePath, bytes);
  if (!mime) {
    throw new Error(`not an image file: ${filePath}. Use read_file for text.`);
  }
  return { mimeType: mime, data: bytes.toString('base64') };
}

export function mimeFromImageBytes(filePath: string, bytes: Uint8Array): string | undefined {
  if (looksLikeImage(bytes)) {
    return mimeFromImagePath(filePath) ?? mimeFromMagic(bytes) ?? 'image/png';
  }
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  if (ext === 'pdf' || !isImagePath(filePath)) {
    return undefined;
  }
  return mimeFromImagePath(filePath);
}

export function resolveImagePath(filePath: string): string {
  const trimmed = filePath.trim().replace(/^['"]|['"]$/g, '');
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(plat().cwd(), trimmed);
}

function mimeFromMagic(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49) {
    return 'image/webp';
  }
  return undefined;
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
