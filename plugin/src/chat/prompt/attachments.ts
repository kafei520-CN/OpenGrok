import * as path from 'node:path';
import { clipboardToPath, splitClipboardPaths } from './clipboard';
import { isImagePath, looksLikeImage, mimeFromImagePath } from '../../agent/clientHandlers';
import { plat } from '../../core/platform';
import type { Attachment, ChatMessage, MediaItem, MessageFile, QueuedPrompt } from '../../core/types';
import { stripWrapUpText } from './wrapUp';

/** Inline file text above this size is dropped; the chip stays path-only. */
export const ATTACH_TEXT_MAX = 256_000;

export interface AttachmentHost {
  attachments: Attachment[];
  fileHits?: Array<{ path: string; label: string }>;
  emit(): void;
}

const USER_MEDIA_KEY = 'session.userMedia';
const USER_MEDIA_IMAGE_MAX = 1_500_000;

export type UserMediaStamp = {
  text: string;
  files?: MessageFile[];
  images?: MediaItem[];
};

export function packUserMedia(attachments: Attachment[]): {
  images?: MediaItem[];
  files?: MessageFile[];
} {
  const images = attachments
    .filter((item) => item.data && item.mimeType?.startsWith('image/'))
    .map((item) => ({
      mimeType: item.mimeType ?? 'image/png',
      data: item.data,
    }));
  const files = attachments
    .filter((item) => !(item.data && item.mimeType?.startsWith('image/')))
    .map((item) => ({
      label: item.label,
      path: item.path,
      mimeType: item.mimeType,
      folder: item.folder,
    }));
  return {
    images: images.length ? images : undefined,
    files: files.length ? files : undefined,
  };
}

export function cloneAttachment(item: Attachment): Attachment {
  return { ...item };
}

export function cloneQueuedPrompt(item: QueuedPrompt): QueuedPrompt {
  return {
    id: item.id,
    text: item.text,
    attachments: item.attachments.map(cloneAttachment),
  };
}

export function makeQueuedPrompt(text: string, attachments: Attachment[], id: string): QueuedPrompt {
  return {
    id,
    text,
    attachments: attachments.map(cloneAttachment),
  };
}

export function queueTexts(queue: QueuedPrompt[]): string[] {
  return queue.map((item) => item.text);
}

export function attachmentsFromMessage(message: ChatMessage): Attachment[] {
  const out: Attachment[] = [];
  for (const image of message.images ?? []) {
    out.push({
      id: `img-${out.length}`,
      label: 'image',
      mimeType: image.mimeType,
      data: image.data,
    });
  }
  for (const file of message.files ?? []) {
    out.push({
      id: file.path ?? file.label,
      label: file.label,
      path: file.path,
      mimeType: file.mimeType,
      folder: file.folder,
    });
  }
  return out;
}

export function userMediaStamps(messages: ChatMessage[]): UserMediaStamp[] {
  const budget = { left: USER_MEDIA_IMAGE_MAX };
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => slimUserMedia(message, budget))
    .filter((stamp) => Boolean(stamp.files?.length || stamp.images?.length));
}

export function applyStoredUserMedia(
  messages: ChatMessage[],
  stamps: UserMediaStamp[] | undefined,
): void {
  if (!stamps?.length) {
    return;
  }
  const unused = [...stamps];
  for (const message of messages) {
    if (message.role !== 'user') {
      continue;
    }
    if (message.files?.length || message.images?.length) {
      continue;
    }
    const matched = unused.findIndex(
      (stamp) => stamp.text === stripWrapUpText(message.text),
    );
    if (matched < 0) {
      continue;
    }
    const stamp = unused.splice(matched, 1)[0];
    if (!stamp) {
      continue;
    }
    if (stamp.files?.length) {
      message.files = stamp.files.map((file) => ({ ...file }));
    }
    if (stamp.images?.length) {
      message.images = stamp.images.map((image) => ({ ...image }));
    }
  }
}

export function readStoredUserMedia(sessionId: string | undefined): UserMediaStamp[] {
  if (!sessionId) {
    return [];
  }
  return readUserMediaStore()[sessionId] ?? [];
}

export async function persistUserMedia(
  sessionId: string | undefined,
  messages: ChatMessage[],
): Promise<void> {
  if (!sessionId) {
    return;
  }
  const stamps = userMediaStamps(messages);
  const store = { ...readUserMediaStore() };
  if (!stamps.length) {
    if (!store[sessionId]) {
      return;
    }
    delete store[sessionId];
  } else {
    store[sessionId] = stamps;
  }
  await plat().setState(USER_MEDIA_KEY, trimUserMediaStore(store));
}

function slimUserMedia(message: ChatMessage, budget: { left: number }): UserMediaStamp {
  const stamp: UserMediaStamp = { text: stripWrapUpText(message.text) };
  if (message.files?.length) {
    stamp.files = message.files.map((file) => ({ ...file }));
  }
  if (message.images?.length) {
    const images: MediaItem[] = [];
    for (const image of message.images) {
      const size = image.data?.length ?? 0;
      if (size > budget.left) {
        break;
      }
      budget.left -= size;
      images.push({ ...image });
    }
    if (images.length) {
      stamp.images = images;
    }
  }
  return stamp;
}

function readUserMediaStore(): Record<string, UserMediaStamp[]> {
  const raw = plat().getState<Record<string, UserMediaStamp[]>>(USER_MEDIA_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function trimUserMediaStore(store: Record<string, UserMediaStamp[]>): Record<string, UserMediaStamp[]> {
  const ids = Object.keys(store);
  if (ids.length <= 80) {
    return store;
  }
  const keep = new Set(ids.slice(-80));
  const next: Record<string, UserMediaStamp[]> = {};
  for (const id of ids) {
    if (keep.has(id)) {
      next[id] = store[id];
    }
  }
  return next;
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
    if (isPdfPath(filePath) || looksLikePdf(bytes)) {
      mimeType = 'application/pdf';
    } else if ((isImagePath(filePath) && !isPdfPath(filePath)) || looksLikeImage(bytes)) {
      mimeType = mimeFromImagePath(filePath) ?? mimeFromMagic(bytes) ?? 'image/png';
      if (bytes.byteLength <= IMAGE_ATTACH_MAX) {
        data = Buffer.from(bytes).toString('base64');
      }
    } else if (bytes.byteLength < ATTACH_TEXT_MAX && isUtf8Payload(bytes)) {
      text = Buffer.from(bytes).toString('utf8');
    } else {
      mimeType = mimeFromFileName(filePath);
    }
  } catch {
    /* folder or unreadable path — keep a path-only chip */
    mimeType = mimeFromFileName(filePath);
  }
  const folder = !data && !text && !mimeType;
  host.attachments = [
    ...host.attachments.filter((item) => item.id !== filePath),
    {
      id: filePath,
      label: path.basename(filePath),
      path: filePath,
      text,
      mimeType,
      data,
      folder,
    },
  ];
  host.fileHits = undefined;
  host.emit();
}

function isPdfPath(filePath: string): boolean {
  return path.extname(filePath).replace(/^\./, '').toLowerCase() === 'pdf';
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function isUtf8Payload(bytes: Uint8Array): boolean {
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

function mimeFromFileName(filePath: string): string | undefined {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  if (ext === 'pdf') {
    return 'application/pdf';
  }
  return undefined;
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
    files?: Array<{ name: string; mimeType?: string; text?: string; data?: string }>;
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
    const name = file.name.trim() || 'file';
    const text = file.text;
    upsert(
      host,
      {
        id: `upload:${Date.now()}:${name}:${host.attachments.length}`,
        label: name,
        mimeType: file.mimeType ?? mimeFromFileName(name),
        text:
          text && Buffer.byteLength(text, 'utf8') < ATTACH_TEXT_MAX ? text : undefined,
        data: file.data,
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
