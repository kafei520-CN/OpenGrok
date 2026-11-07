import { toolKindLabel, type UiLocale } from '../../core/i18n';

export type ToolLabelInput = {
  kind?: string;
  title?: string;
  detail?: string;
};

const HINT_MAX = 72;

/** Timeline label. Always starts with a tool name, then the file or query. */
export function toolRowLabel(tool: ToolLabelInput, locale: UiLocale): string {
  const kindKey = displayKind(tool.kind, tool.title);
  const kind = toolKindLabel(locale, kindKey);
  if (isNameOnly(kindKey)) {
    return kind;
  }
  const hint = rowHint(tool, kind);
  return hint ? `${kind} · ${hint}` : kind;
}

function displayKind(kind: string | undefined, title: string | undefined): string | undefined {
  const normalized = normalizeKind(kind);
  if (normalized && normalized !== 'other' && normalized !== 'unknown') {
    return normalized;
  }
  return kindFromTitle(title) ?? normalized;
}

function normalizeKind(kind: string | undefined): string | undefined {
  const text = (kind ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!text) {
    return undefined;
  }
  switch (text) {
    case 'grep':
    case 'websearch':
    case 'web_search':
      return 'search';
    case 'read_file':
    case 'readfile':
      return 'read';
    case 'bash':
    case 'shell':
    case 'run_terminal_command':
      return 'execute';
    case 'listdir':
    case 'list_dir':
    case 'ls':
      return 'list';
    case 'webfetch':
    case 'web_fetch':
      return 'fetch';
    case 'image_gen':
    case 'imagine':
      return 'image';
    default:
      return text;
  }
}

function kindFromTitle(title: string | undefined): string | undefined {
  const text = (title ?? '').trim().toLowerCase();
  if (!text) {
    return undefined;
  }
  if (/^(imagine|image-to-video|reference-to-video)\b/.test(text)) {
    return 'image';
  }
  if (text.startsWith('skill:') || text.startsWith('skill ')) {
    return 'skill';
  }
  if (text.startsWith('memory ')) {
    return 'memory';
  }
  if (text.startsWith('web search') || text.startsWith('grep')) {
    return 'search';
  }
  if (text.startsWith('fetch:') || text.startsWith('fetch ')) {
    return 'fetch';
  }
  if (text.startsWith('list ') || text.startsWith('list_dir')) {
    return 'list';
  }
  return undefined;
}

function isNameOnly(kind: string | undefined): boolean {
  const key = (kind ?? '').toLowerCase();
  return key === 'execute' || key === 'terminal' || key === 'compact';
}

function rowHint(tool: ToolLabelInput, kindLabel: string): string {
  if (tool.detail?.trim()) {
    return clip(fileName(tool.detail));
  }
  const title = (tool.title ?? '').trim();
  if (!title || title === kindLabel) {
    return '';
  }
  const stripped = title
    .replace(
      /^(?:read|edit|write|search|grep|web search|fetch|skill|memory search|memory read|imagine(?:-edit)?|image-to-video|reference-to-video|list)\b[:\s`"]*/i,
      '',
    )
    .replace(/^`+|`+$/g, '')
    .trim();
  const hint = stripped || title;
  if (hint === kindLabel) {
    return '';
  }
  return clip(hint);
}

function fileName(path: string): string {
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : path;
}

function clip(value: string): string {
  const text = value.trim();
  if (text.length <= HINT_MAX) {
    return text;
  }
  return `${text.slice(0, HINT_MAX - 1)}…`;
}
