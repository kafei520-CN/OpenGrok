import * as path from 'node:path';
import { isArchivePath, looksLikeZip, readArchiveText, splitArchivePath } from './archives';
import { logError, logInfo } from '../core/logger';
import { plat } from '../core/platform';
import { asObject, asString } from '../core/wire';

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'tif',
  'tiff',
  'pdf',
]);

export async function readWorkspaceFile(
  params: unknown,
): Promise<{ content: string; _meta?: { encoding: 'base64' } }> {
  const obj = asObject(params);
  const filePath = asString(obj['path']);
  if (!filePath) {
    throw new Error('fs/read_text_file missing path');
  }
  const limit = typeof obj['limit'] === 'number' ? obj['limit'] : undefined;
  if (limit === 0) {
    const exists = await plat().fileExists(filePath);
    if (!exists) {
      throw new Error(`file not found: ${filePath}`);
    }
    return { content: '' };
  }
  const archivePath = splitArchivePath(filePath).archive;
  if (isArchivePath(archivePath) || isArchivePath(filePath)) {
    try {
      return sliceContent(await readArchiveText(filePath), obj);
    } catch (error) {
      throw new Error(
        `cannot read archive ${path.basename(archivePath)}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  if (!isImagePath(filePath)) {
    const open = await openBuffer(filePath);
    if (open !== undefined) {
      return sliceContent(open, obj);
    }
  }
  const bytes = Buffer.from(await plat().readFile(filePath));
  if (looksLikeZip(bytes)) {
    try {
      return sliceContent(await readArchiveText(filePath), obj);
    } catch {
      /* fall through to base64 */
    }
  }
  if (shouldSendBase64(filePath, bytes)) {
    return {
      content: bytes.toString('base64'),
      _meta: { encoding: 'base64' },
    };
  }
  return sliceContent(bytes.toString('utf8'), obj);
}

export function shouldSendBase64(filePath: string, bytes: Uint8Array): boolean {
  if (isImagePath(filePath) || looksLikeImage(bytes)) {
    return true;
  }
  return !isUtf8Text(bytes);
}

async function openBuffer(filePath: string): Promise<string | undefined> {
  const sync = plat().openText?.(filePath);
  if (sync !== undefined) {
    return sync;
  }
  return plat().readOpenText?.(filePath);
}

export function isImagePath(filePath: string): boolean {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return IMAGE_EXTS.has(ext);
}

export function mimeFromImagePath(filePath: string): string | undefined {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    case 'avif':
      return 'image/avif';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    default:
      return undefined;
  }
}

export function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return true;
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return true;
  }
  return false;
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) {
    return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function sliceContent(
  text: string,
  obj: Record<string, unknown>,
): { content: string } {
  const line = typeof obj['line'] === 'number' ? obj['line'] : undefined;
  const limit = typeof obj['limit'] === 'number' ? obj['limit'] : undefined;
  if (line === undefined && limit === undefined) {
    return { content: text };
  }
  const lines = text.split('\n');
  const start = Math.max(0, (line ?? 1) - 1);
  const end = limit !== undefined ? start + limit : lines.length;
  return { content: lines.slice(start, end).join('\n') };
}

export async function writeWorkspaceFile(
  params: unknown,
): Promise<Record<string, never>> {
  const obj = asObject(params);
  const filePath = asString(obj['path']);
  const content = asString(obj['content']);
  if (!filePath || content === undefined) {
    throw new Error('fs/write_text_file missing path or content');
  }
  const open = await openBuffer(filePath);
  if (open !== undefined) {
    const applied = await plat().applyText?.(filePath, content);
    if (!applied) {
      throw new Error(`could not apply edit to open file ${filePath}`);
    }
    logInfo(`applied ${filePath}`);
    return {};
  }
  await plat().writeFile(filePath, Buffer.from(content, 'utf8'));
  logInfo(`wrote ${filePath}`);
  return {};
}

export async function openPath(filePath: string): Promise<void> {
  try {
    await plat().openFile(filePath, true);
  } catch (error) {
    logError(`failed to open ${filePath}`, error);
  }
}

export function dirnameOf(filePath: string): string {
  return path.dirname(filePath);
}
