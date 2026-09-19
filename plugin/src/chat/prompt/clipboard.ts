import { looksLikeFilePath } from '../../edits/edits';

export function splitClipboardPaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && looksLikeFilePath(line));
}

/** Native OS drop path from Electron `webUtils` or the legacy File.path field. */
export function dropFilePath(
  file: { path?: string },
  hostPath?: string,
): string | undefined {
  const host = hostPath?.trim();
  if (host) {
    return host;
  }
  const native = typeof file.path === 'string' ? file.path.trim() : '';
  return native || undefined;
}

export function clipboardToPath(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('vscode-file://')) {
    const path = decodeURIComponent(trimmed.replace(/^vscode-file:\/\/[^/]*/, ''));
    return path.replace(/^\/([A-Za-z]:)/, '$1');
  }
  if (trimmed.includes('vscode-resource')) {
    try {
      const url = decodeURIComponent(trimmed.replace(/^https?:\/\/[^/]+/, ''));
      const path = url.replace(/^\/+/, '').replace(/^([A-Za-z])%3A/i, '$1:');
      if (looksLikeFilePath(path) || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/')) {
        return path.replace(/^\/([A-Za-z]:)/, '$1');
      }
    } catch {
      /* ignore */
    }
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return clipboardToPath(trimmed.slice(1, -1));
  }
  if (/^vscode:\/\/file/i.test(trimmed)) {
    const path = decodeURIComponent(trimmed.replace(/^vscode:\/\/file/i, ''));
    return path.replace(/^\/([A-Za-z]:)/, '$1');
  }
  if (trimmed.startsWith('file:')) {
    return decodeURIComponent(
      trimmed.replace(/^file:\/\//, '').replace(/^\/([A-Za-z]:)/, '$1'),
    );
  }
  if (looksLikeFilePath(trimmed)) {
    return trimmed;
  }
  return undefined;
}

const DROP_MIME = [
  'application/vnd.code.uri-list',
  'application/vnd.code.resourceurls',
  'text/uri-list',
  'text/plain',
  'codefiles',
  'CodeEditors',
  'resourceurls',
  'ResourceURLs',
];

/** Collect file URIs from a webview/OS drop, including VS Code explorer MIME types. */
export function collectDropUris(
  getData: (type: string) => string,
  extra: string[] = [],
  extraMime: string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const text = raw.trim();
    if (!text) {
      return;
    }
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string') {
              add(item);
            }
          }
          return;
        }
      } catch {
        /* fall through */
      }
    }
    for (const line of text.split(/\r?\n/)) {
      const item = line.trim();
      if (!item || item.startsWith('#')) {
        continue;
      }
      const path = clipboardToPath(item) ?? (looksLikeFilePath(item) ? item : undefined);
      if (path && !seen.has(path)) {
        seen.add(path);
        out.push(path);
      }
    }
  };
  const types = new Set([...DROP_MIME, ...extraMime]);
  for (const type of types) {
    try {
      add(getData(type));
    } catch {
      /* some hosts throw on unknown MIME */
    }
  }
  for (const item of extra) {
    add(item);
  }
  return out;
}
