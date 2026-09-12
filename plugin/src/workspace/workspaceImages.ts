import { isImagePath, mimeFromImagePath } from '../agent/clientHandlers';
import { asObject, asString } from '../core/wire';
import type { SessionUpdate } from '../core/types';

export interface WorkspaceImage {
  mimeType: string;
  data: string;
}

/** Grok's read_file error when ACP image bytes are treated as binary. */
const BINARY_READ = /cannot read binary file:\s*(.+)/i;

export function failedBinaryImagePath(update: SessionUpdate): string | undefined {
  const text = collectText(update);
  const fromError = text.match(BINARY_READ)?.[1]?.trim();
  const fromInput = pathFromRaw(update.rawInput);
  const candidate =
    fromError ||
    fromInput ||
    update.locations?.[0]?.path ||
    (isImagePath(update.title ?? '') ? update.title : undefined);
  if (!candidate || !isImagePath(candidate)) {
    return undefined;
  }
  return candidate.replace(/^['"]|['"]$/g, '');
}

export function cacheKey(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').toLowerCase();
}

function pathFromRaw(raw: unknown): string | undefined {
  const obj = asObject(raw);
  return (
    asString(obj['path']) ??
    asString(obj['target_file']) ??
    asString(obj['file_path']) ??
    asString(obj['filePath'])
  );
}

function collectText(update: SessionUpdate): string {
  const chunks: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      chunks.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    const obj = asObject(value);
    const text = asString(obj['text']);
    if (text) {
      chunks.push(text);
    }
    if (obj['content'] !== undefined) {
      walk(obj['content']);
    }
  };
  walk(update.content);
  if (update.message) {
    chunks.push(update.message);
  }
  if (update.error) {
    chunks.push(update.error);
  }
  return chunks.join('\n');
}

export function imageFromBase64(filePath: string, data: string): WorkspaceImage | undefined {
  if (!data) {
    return undefined;
  }
  return {
    mimeType: mimeFromImagePath(filePath) ?? 'image/png',
    data,
  };
}
