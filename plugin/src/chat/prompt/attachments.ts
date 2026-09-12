import * as path from 'node:path';
import { clipboardToPath, splitClipboardPaths } from './clipboard';
import { isImagePath, looksLikeImage, mimeFromImagePath } from '../../agent/clientHandlers';
import { plat } from '../../core/platform';
import type { Attachment } from '../../core/types';

/** Inline file text above this size is dropped; the chip stays path-only. */
export const ATTACH_TEXT_MAX = 256_000;

export interface AttachmentHost {
  attachments: Attachment[];
  fileHits?: Array<{ path: string; label: string }>;
  emit(): void;
}

export function quoteText(host: AttachmentHost, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const compact = trimmed.replace(/\s+/g, ' ');
  const label = compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
  upsert(host, {
    id: `quote-${Date.now()}-${host.attachments.length}`,
    label,
    text: trimmed,
  });
  plat().focusChat();
}

export function addSelection(host: AttachmentHost): void {
  const selection = plat().getActiveSelection();
  if (!selection) {
    plat().info('Select some code first.');
    return;
  }
  const label = `${path.basename(selection.path)}:${selection.startLine}-${selection.endLine}`;
  upsert(host, {
    id: label,
    label,
    path: selection.path,
    text: selection.text,
  });
  plat().focusChat();
}

export function addActiveFile(host: AttachmentHost): void {
  const file = plat().getActiveFile();
  if (!file) {
    return;
  }
  if (isImagePath(file.path)) {
    void attachPath(host, file.path);
    plat().focusChat();
    return;
  }
  upsert(host, {
    id: file.path,
    label: path.basename(file.path),
    path: file.path,
    text: Buffer.byteLength(file.text, 'utf8') < ATTACH_TEXT_MAX ? file.text : undefined,
  });
  plat().focusChat();
}

export function removeAttachment(host: AttachmentHost, id: string): void {
  host.attachments = host.attachments.filter((item) => item.id !== id);
  host.emit();
}

export async function attachFromUi(host: AttachmentHost): Promise<void> {
  const picked = await plat().openFiles();
  if (!picked?.length) {
    addActiveFile(host);
    return;
  }
  for (const filePath of picked) {
    await attachPath(host, filePath);
  }
}

const IMAGE_ATTACH_MAX = 8 * 1024 * 1024;

export async function attachPath(host: AttachmentHost, filePath: string): Promise<void> {
  let text: string | undefined;
  let mimeType: string | undefined;
  let data: string | undefined;
  try {
    const bytes = await plat().readFile(filePath);
    if (isImagePath(filePath) || looksLikeImage(bytes)) {
      mimeType = mimeFromImagePath(filePath) ?? mimeFromMagic(bytes) ?? 'image/png';
      if (bytes.byteLength <= IMAGE_ATTACH_MAX) {
        data = Buffer.from(bytes).toString('base64');
      }
    } else if (bytes.byteLength < ATTACH_TEXT_MAX) {
      text = Buffer.from(bytes).toString('utf8');
    }
  } catch {
    /* path-only chip */
  }
  host.attachments = [
    ...host.attachments.filter((item) => item.id !== filePath),
    {
      id: filePath,
      label: path.basename(filePath),
      path: filePath,
      text,
      mimeType,
      data,
    },
  ];
  host.fileHits = undefined;
  host.emit();
}

function mimeFromMagic(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return 'image/webp';
  }
  return undefined;
}

export async function pasteClipboard(
  host: AttachmentHost,
  payload: {
    text?: string;
    uris?: string[];
    images?: Array<{ name: string; mimeType: string; data: string }>;
    files?: Array<{ name: string; mimeType?: string; text?: string }>;
  },
): Promise<void> {
  for (const image of payload.images ?? []) {
    const id = `img-${Date.now()}-${image.name}`;
    upsert(
      host,
      {
        id,
        label: image.name || 'image',
        mimeType: image.mimeType,
        data: image.data,
      },
      false,
    );
  }
  for (const file of payload.files ?? []) {
    const text = file.text;
    if (!text) {
      continue;
    }
    const name = file.name.trim() || 'file.txt';
    upsert(
      host,
      {
        id: `upload:${Date.now()}:${name}:${host.attachments.length}`,
        label: name,
        mimeType: file.mimeType,
        text: Buffer.byteLength(text, 'utf8') < ATTACH_TEXT_MAX ? text : undefined,
      },
      false,
    );
  }
  const uris = [...(payload.uris ?? []), ...splitClipboardPaths(payload.text ?? '')];
  for (const uri of uris) {
    const filePath = clipboardToPath(uri);
    if (filePath) {
      await attachPath(host, filePath);
    }
  }
  host.emit();
}

function upsert(host: AttachmentHost, next: Attachment, emit = true): void {
  host.attachments = [...host.attachments.filter((item) => item.id !== next.id), next];
  if (emit) {
    host.emit();
  }
}
