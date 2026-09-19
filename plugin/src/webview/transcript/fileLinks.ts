import { iconFile } from '../icons';

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fileName(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : path;
}

const FILE_EXTS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'md',
  'css',
  'html',
  'htm',
  'rs',
  'py',
  'go',
  'java',
  'kt',
  'toml',
  'yml',
  'yaml',
  'xml',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'txt',
  'sh',
  'ps1',
  'bat',
  'cmd',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'vue',
  'svelte',
  'scss',
  'less',
  'sql',
  'lock',
  'map',
  'ini',
  'cfg',
  'wasm',
]);

/** Paths that should become clickable chips in conversation markdown, not tool rows. */
export function looksLikeInlinePath(raw: string): boolean {
  const text = stripPathWrap(raw);
  if (!text || text.length > 320 || /\s/.test(text)) {
    return false;
  }
  if (/^(https?:|mailto:|data:)/i.test(text)) {
    return false;
  }
  if (/^[A-Za-z]:[\\/]/.test(text) || text.startsWith('file:')) {
    return true;
  }
  if (text.startsWith('/') && text.includes('.') && !text.startsWith('//')) {
    return true;
  }
  if (/^\.\.?[\\/]/.test(text) && hasFileExt(text)) {
    return true;
  }
  if (/[\\/]/.test(text) && hasFileExt(text)) {
    return true;
  }
  return !/[\\/]/.test(text) && hasFileExt(text) && FILE_EXTS.has(extOf(text));
}

export function fileLinkHtml(path: string, label?: string): string {
  const clean = stripPathWrap(path);
  const name = label?.trim() || fileName(clean);
  return `<button type="button" class="md-file" data-path="${escapeHtml(clean)}" title="${escapeHtml(clean)}">${iconFile()}<span class="md-file-name">${escapeHtml(name)}</span></button>`;
}

export function linkInlineFilePaths(text: string, stash: (html: string) => string): string {
  return text.replace(PATH_RE, (full, prefix: string, path: string) => {
    const trimmed = trimPathPunct(path);
    if (!looksLikeInlinePath(trimmed)) {
      return full;
    }
    const extra = path.slice(trimmed.length);
    return `${prefix}${stash(fileLinkHtml(trimmed))}${extra}`;
  });
}

function stripPathWrap(raw: string): string {
  let text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith('file:')) {
    text = decodeURIComponent(text.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
  }
  return text;
}

function hasFileExt(path: string): boolean {
  return FILE_EXTS.has(extOf(path));
}

function extOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
}

function trimPathPunct(path: string): string {
  return path.replace(/[),.;:!?]+$/g, '');
}

const PATH_RE =
  /(^|[\s([{])((?:[A-Za-z]:[\\/]|file:\/\/\/?|\.\.?[\\/]|\/)[^\s<>"'`]+|[A-Za-z0-9._-]+(?:[\\/][A-Za-z0-9._-]+)+\.[A-Za-z0-9]{1,10})/g;
