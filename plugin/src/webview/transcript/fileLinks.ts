import { fileIconSvg } from './fileIcons';

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
  'markdown',
  'css',
  'html',
  'htm',
  'rs',
  'py',
  'go',
  'java',
  'jar',
  'kt',
  'kts',
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
  'bash',
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
  'gradle',
]);

const METHOD_ICON =
  '<svg class="md-file-icon md-sym-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1.15 9.55 6.05 14.85 7.5 9.55 8.95 8 13.85 6.45 8.95 1.15 7.5 6.45 6.05z"/></svg>';

export type CodeRef = {
  kind: 'file' | 'folder' | 'symbol';
  name: string;
  path?: string;
  line?: number;
};

const LINE_TAIL = /(?:\s*\(\s*line\s+(\d+)\s*\))$/i;

/** Paths that should become clickable chips in conversation markdown, not tool rows. */
export function looksLikeInlinePath(raw: string): boolean {
  const parsed = parseCodeRef(raw);
  return parsed?.kind === 'file' || parsed?.kind === 'folder';
}

export function parseCodeRef(raw: string): CodeRef | undefined {
  let text = stripPathWrap(raw);
  if (!text || text.length > 320) {
    return undefined;
  }
  if (/^(https?:|mailto:|data:)/i.test(text)) {
    return undefined;
  }
  let line: number | undefined;
  const lined = text.match(LINE_TAIL);
  if (lined) {
    line = Number(lined[1]);
    text = text.slice(0, lined.index).trim();
  }
  if (!text || /\s/.test(text)) {
    return undefined;
  }
  if (looksLikeFileToken(text)) {
    return { kind: 'file', name: fileName(text), path: text, line };
  }
  if (looksLikeFolderToken(text)) {
    const path = text.replace(/[/\\]+$/, '').replace(/\\/g, '/');
    return { kind: 'folder', name: fileName(path), path: `${path}/` };
  }
  if (line && /^[A-Za-z_][\w]*$/.test(text)) {
    return { kind: 'symbol', name: text, line };
  }
  return undefined;
}

export function fileLinkHtml(pathOrRef: string | CodeRef, label?: string): string {
  const ref = typeof pathOrRef === 'string' ? parseCodeRef(pathOrRef) : pathOrRef;
  if (!ref) {
    return escapeHtml(String(pathOrRef));
  }
  const name = label?.trim() || ref.name;
  const icon =
    ref.kind === 'symbol'
      ? METHOD_ICON
      : ref.kind === 'folder'
        ? fileIconSvg('folder')
        : fileIconSvg(extOf(ref.path ?? ref.name));
  const cls =
    ref.kind === 'symbol' ? 'md-file md-sym' : ref.kind === 'folder' ? 'md-file md-dir' : 'md-file';
  const pathAttr = ref.path ? ` data-path="${escapeHtml(ref.path)}"` : '';
  const lineAttr = ref.line ? ` data-line="${ref.line}"` : '';
  const kindAttr = ` data-kind="${ref.kind}"`;
  const title = [ref.path ?? ref.name, ref.line ? `line ${ref.line}` : ''].filter(Boolean).join(' · ');
  const lineHtml = ref.line
    ? `<span class="md-file-line">(line ${ref.line})</span>`
    : '';
  return `<button type="button" class="${cls}"${pathAttr}${lineAttr}${kindAttr} title="${escapeHtml(title)}">${icon}<span class="md-file-name">${escapeHtml(name)}</span>${lineHtml}</button>`;
}

export function linkInlineFilePaths(text: string, stash: (html: string) => string): string {
  return text.replace(MARKED_RE, (full, prefix: string, token: string) => {
    const ref = parseCodeRef(token);
    if (!ref) {
      return full;
    }
    return `${prefix}${stash(fileLinkHtml(ref))}`;
  });
}

/** True when the token was explicitly marked with a leading @. */
export function isMarkedFileRef(raw: string): boolean {
  return raw.trim().startsWith('@');
}

function looksLikeFolderToken(text: string): boolean {
  const trimmed = text.replace(/[/\\]+$/, '');
  if (!trimmed || trimmed.length > 320) {
    return false;
  }
  if (!/[\\/]/.test(text)) {
    return false;
  }
  if (looksLikeFileToken(trimmed)) {
    return false;
  }
  const norm = trimmed.replace(/\\/g, '/');
  if (/^https?:/i.test(norm)) {
    return false;
  }
  if (isNumericPath(norm)) {
    return false;
  }
  return (
    /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(norm) ||
    /^[A-Za-z]:\//.test(norm) ||
    (norm.startsWith('/') && /[A-Za-z]/.test(norm)) ||
    /^\.\.?\//.test(norm)
  );
}

/** Fractions and dates like 1/5 or 2026/09/20 are not folders. */
function isNumericPath(path: string): boolean {
  const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  return segments.length > 0 && segments.every((part) => /^\d+$/.test(part));
}

function looksLikeFileToken(text: string): boolean {
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

function stripPathWrap(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('@')) {
    text = text.slice(1).trim();
  }
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith('file:')) {
    text = decodeURIComponent(text.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'));
  }
  text = text.replace(/[。，、；：！？.,;:]+$/u, '');
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

/** Only `@path`, `@name.ext`, and `@name (line N)` become chips in prose. */
const MARKED_RE =
  /(^|[\s([{（【])@([^\s<>"'`()]+(?:\s*\(\s*line\s+\d+\s*\))?)/g;
