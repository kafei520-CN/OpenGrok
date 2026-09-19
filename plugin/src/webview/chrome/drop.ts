import { collectDropUris, dropFilePath } from '../../chat/prompt/clipboard';
import { post, root, tr } from '../app';

const IMAGE_MAX = 4 * 1024 * 1024;
const TEXT_MAX = 256_000;

let dragDepth = 0;
let picker: HTMLInputElement | undefined;

export function bindFileDrop(): void {
  syncDropHint();
  const target = document;
  target.addEventListener('dragenter', onDragEnter, true);
  target.addEventListener('dragover', onDragOver, true);
  target.addEventListener('dragleave', onDragLeave, true);
  target.addEventListener('drop', onDrop, true);
}

export function pickRemoteFiles(): void {
  const input = ensurePicker();
  input.value = '';
  input.click();
}

export function syncDropHint(): void {
  root.dataset.drop = tr('dropFiles');
}

export async function sendBrowserFiles(
  list: File[],
  extra?: { text?: string; uris?: string[] },
): Promise<void> {
  const images: Array<{ name: string; mimeType: string; data: string }> = [];
  const files: Array<{ name: string; mimeType?: string; text?: string; data?: string }> = [];
  for (const file of list) {
    const name = file.name || 'file';
    const mime = file.type || mimeFromName(name);
    if (file.type.startsWith('image/')) {
      if (file.size > IMAGE_MAX) {
        files.push({ name, mimeType: mime });
        continue;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      images.push({
        name: file.name || 'image.png',
        mimeType: file.type || 'image/png',
        data: bytesToBase64(buf),
      });
      continue;
    }
    let buf = new Uint8Array();
    try {
      buf = new Uint8Array(await file.arrayBuffer());
    } catch {
      files.push({ name, mimeType: mime });
      continue;
    }
    const textLike = buf.length > 0 && buf.length <= TEXT_MAX && !buf.includes(0);
    if (textLike) {
      files.push({
        name,
        mimeType: mime,
        text: new TextDecoder('utf-8', { fatal: false }).decode(buf),
      });
      continue;
    }
    files.push({
      name,
      mimeType: mime,
      data: buf.length > 0 && buf.length <= IMAGE_MAX ? bytesToBase64(buf) : undefined,
    });
  }
  if (images.length === 0 && files.length === 0 && !extra?.uris?.length && !extra?.text) {
    return;
  }
  post({ type: 'pasteClipboard', images, files, text: extra?.text, uris: extra?.uris });
}

function ensurePicker(): HTMLInputElement {
  if (picker?.isConnected) {
    return picker;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.className = 'remote-file-pick';
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.addEventListener('change', () => {
    const chosen = input.files ? [...input.files] : [];
    input.value = '';
    void sendBrowserFiles(chosen);
  });
  document.body.append(input);
  picker = input;
  return input;
}

function onDragEnter(event: DragEvent): void {
  if (!isFileDrag(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  acceptDropEffect(event.dataTransfer);
  dragDepth += 1;
  root.classList.add('drop');
}

function onDragOver(event: DragEvent): void {
  if (!isFileDrag(event.dataTransfer)) {
    return;
  }
  event.preventDefault();
  acceptDropEffect(event.dataTransfer);
  root.classList.add('drop');
}

/** Explorer drags default to "move". Rejecting that is why Shift was required. */
function acceptDropEffect(data: DataTransfer | null): void {
  if (!data) {
    return;
  }
  const allowed = data.effectAllowed;
  data.dropEffect = allowed === 'move' || allowed === 'linkMove' ? 'move' : 'copy';
}

function onDragLeave(event: DragEvent): void {
  if (!root.contains(event.relatedTarget as Node | null)) {
    dragDepth = 0;
    root.classList.remove('drop');
    return;
  }
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    root.classList.remove('drop');
  }
}

function onDrop(event: DragEvent): void {
  const data = event.dataTransfer;
  if (!data) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  acceptDropEffect(data);
  dragDepth = 0;
  root.classList.remove('drop');
  void sendDrop(data);
}

function isFileDrag(data: DataTransfer | null): boolean {
  if (!data) {
    return false;
  }
  if (data.files.length > 0) {
    return true;
  }
  const types = Array.from(data.types);
  if (types.length === 0 || types.includes('Files')) {
    return true;
  }
  return types.some((type) => {
    const name = type.toLowerCase();
    return (
      name === 'files' ||
      name.includes('uri') ||
      name.includes('resource') ||
      name.includes('code') ||
      name.includes('file')
    );
  });
}

async function sendDrop(data: DataTransfer): Promise<void> {
  const extra: string[] = [];
  const browser: File[] = [];
  const seen = new Set<string>();
  const take = (file: File | null | undefined) => {
    if (!file) {
      return;
    }
    const nativePath = dropFilePath(file as File & { path?: string }, hostFilePath(file));
    if (nativePath) {
      if (!seen.has(nativePath)) {
        seen.add(nativePath);
        extra.push(nativePath);
      }
      return;
    }
    const key = `name:${file.name}:${file.size}:${file.type}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    browser.push(file);
  };
  for (const file of [...data.files]) {
    take(file);
  }
  for (const item of [...data.items]) {
    if (item.kind === 'file') {
      take(item.getAsFile());
    }
  }
  extra.push(...(await readItemStrings(data)));
  const uris = collectDropUris(
    (type) => {
      try {
        return data.getData(type);
      } catch {
        return '';
      }
    },
    extra,
    Array.from(data.types),
  );
  await sendBrowserFiles(browser, { uris });
}

function hostFilePath(file: File): string {
  const api = (window as unknown as { opengrok?: { filePath?: (next: File) => string } }).opengrok;
  try {
    return api?.filePath?.(file)?.trim() ?? '';
  } catch {
    return '';
  }
}

function mimeFromName(name: string): string | undefined {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') {
    return 'application/pdf';
  }
  return undefined;
}

async function readItemStrings(data: DataTransfer): Promise<string[]> {
  const items = [...data.items];
  const out: string[] = [];
  for (const item of items) {
    if (item.kind !== 'string') {
      continue;
    }
    const text = await new Promise<string>((resolve) => {
      try {
        item.getAsString(resolve);
      } catch {
        resolve('');
      }
    });
    if (text.trim()) {
      out.push(text);
    }
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
