import { extractMath, renderKatex } from './markdownMath';
import { fileLinkHtml, isMarkedFileRef, linkInlineFilePaths, parseCodeRef } from './fileLinks';

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fileName(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : path;
}

/** Codex-style path: keep the start and the filename, ellipsis in the middle. */
export function shortenPath(path: string, max = 44): string {
  const norm = path.replace(/\\/g, '/');
  if (norm.length <= max) {
    return norm;
  }
  const name = fileName(norm);
  if (name.length >= max - 1) {
    return `…${name.slice(-(max - 1))}`;
  }
  const head = max - name.length - 1;
  return `${norm.slice(0, Math.max(1, head))}…${name}`;
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').replace(/\t/g, '    ').split('\n');
  return renderBlocks(lines).join('');
}

function renderBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }
    const fence = fenceOpen(lines[i]);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !fenceClose(lines[i], fence.marker)) {
        const nested = fenceOpen(lines[i]);
        if (nested?.info) {
          break;
        }
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && fenceClose(lines[i], fence.marker)) {
        i += 1;
      }
      if (isMathFence(fence.lang)) {
        out.push(renderKatex(body.join('\n'), true));
        continue;
      }
      const lang = fence.lang ? ` data-lang="${escapeHtml(fence.lang)}"` : '';
      out.push(`<pre class="code"${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const mathBlock = takeMathBlock(lines, i);
    if (mathBlock) {
      out.push(renderKatex(mathBlock.body, true));
      i = mathBlock.next;
      continue;
    }
    const heading = lines[i].match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const n = heading[1].length;
      const title = heading[2].replace(/\s+#+\s*$/, '');
      out.push(`<h${n}>${inlineMarkdown(title)}</h${n}>`);
      i += 1;
      continue;
    }
    if (isHr(lines[i])) {
      out.push('<hr />');
      i += 1;
      continue;
    }
    if (/^ {0,3}>/.test(lines[i])) {
      const quoted: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^ {0,3}>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(quoted).join('')}</blockquote>`);
      continue;
    }
    if (isTableHeader(lines, i)) {
      const table = renderTable(lines, i);
      out.push(table.html);
      i = table.next;
      continue;
    }
    if (parseListItem(lines[i])) {
      const list = renderList(lines, i, 0);
      out.push(list.html);
      i = list.next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inlineMarkdown(para.join('\n')).replace(/\n/g, '<br />')}</p>`);
  }
  return out;
}

function isMathFence(lang: string): boolean {
  return lang === 'math' || lang === 'latex' || lang === 'tex' || lang === 'katex';
}

function takeMathBlock(
  lines: string[],
  start: number,
): { body: string; next: number } | undefined {
  const line = lines[start]?.trim() ?? '';
  const one = line.match(/^\$\$(.+)\$\$$/) || line.match(/^\\\[(.+)\\\]$/);
  if (one) {
    return { body: one[1], next: start + 1 };
  }
  const open = line === '$$' || line === '\\[';
  if (!open) {
    return undefined;
  }
  const close = line === '\\[' ? '\\]' : '$$';
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && lines[i].trim() !== close && lines[i].trim() !== '$$') {
    body.push(lines[i]);
    i += 1;
  }
  if (i < lines.length) {
    i += 1;
  }
  return { body: body.join('\n'), next: i };
}

function fenceOpen(line: string): { marker: string; lang: string; info: string } | undefined {
  const match = line.match(/^ {0,3}(```+|~~~+)(.*)$/);
  if (!match) {
    return undefined;
  }
  const info = match[2].trim();
  return { marker: match[1].slice(0, 3), lang: fenceLang(info), info };
}

function fenceLang(info: string): string {
  const github = /^(\d+):(\d+):(.+)$/.exec(info);
  if (github) {
    return fileName(github[3]);
  }
  const token = info.split(/\s+/)[0] ?? '';
  return /^[\w.+#-]+$/.test(token) ? token : '';
}

function fenceClose(line: string, marker: string): boolean {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  return Boolean(match && match[1][0] === marker[0] && match[1].length >= marker.length);
}

/** Live tail kept as plain text so a giant open paragraph does not reparse. */
export const STREAM_LIVE_KEEP = 4_000;
/** Force-commit a long unfenced tail so split() does not rescan the whole body. */
export const STREAM_FORCE_COMMIT = 12_000;

/** Commit finished blocks; keep the open paragraph/fence as a cheap live tail. */
export function splitStreamingMarkdown(
  src: string,
  prevCommitted = '',
): { committed: string; rest: string } {
  const prefix = prevCommitted && src.startsWith(prevCommitted) ? prevCommitted : '';
  const working = prefix ? src.slice(prefix.length) : src;
  const split = splitStreamingTail(working);
  let committed = prefix + split.committed;
  let rest = split.rest;
  if (!split.openFence && rest.length > STREAM_FORCE_COMMIT) {
    const cut = rest.length - STREAM_LIVE_KEEP;
    committed += rest.slice(0, cut);
    rest = rest.slice(cut);
  }
  return { committed, rest };
}

function splitStreamingTail(src: string): { committed: string; rest: string; openFence: boolean } {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let fence: string | undefined;
  let fenceStart = -1;
  let committedLines = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence) {
      if (fenceClose(line, fence)) {
        fence = undefined;
        fenceStart = -1;
        committedLines = i + 1;
      }
      continue;
    }
    const open = fenceOpen(line);
    if (open) {
      fence = open.marker;
      fenceStart = i;
      continue;
    }
    if (!line.trim()) {
      committedLines = i + 1;
    }
  }
  if (fence && fenceStart >= 0) {
    committedLines = Math.min(committedLines, fenceStart);
  }
  if (committedLines >= lines.length) {
    committedLines = Math.max(0, lines.length - 1);
  }
  return {
    committed: lines.slice(0, committedLines).join('\n'),
    rest: lines.slice(committedLines).join('\n'),
    openFence: Boolean(fence),
  };
}

/** Append-only patch so streaming does not reparse the whole committed prefix. */
export function streamingMarkdownPatch(
  prevCommitted: string,
  committed: string,
): { replace?: string; append?: string } {
  if (committed === prevCommitted) {
    return {};
  }
  if (committed.startsWith(prevCommitted)) {
    return { append: committed.slice(prevCommitted.length) };
  }
  return { replace: committed };
}

function isHr(line: string): boolean {
  const trimmed = line.trim();
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed);
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  if (fenceOpen(line) || isHr(line) || /^ {0,3}#{1,6}\s/.test(line) || /^ {0,3}>/.test(line)) {
    return true;
  }
  if (line.trim() === '$$' || line.trim() === '\\[' || /^\$\$.+\$\$$/.test(line.trim())) {
    return true;
  }
  if (parseListItem(line)) {
    return true;
  }
  return isTableHeader(lines, i);
}

function isTableHeader(lines: string[], i: number): boolean {
  return Boolean(lines[i]?.includes('|') && lines[i + 1] && isTableSep(lines[i + 1]));
}

function isTableSep(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) {
    value = value.slice(1);
  }
  if (value.endsWith('|')) {
    value = value.slice(0, -1);
  }
  return value.split('|').map((cell) => cell.trim());
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const heads = splitRow(lines[start]);
  const aligns = splitRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) {
      return 'center';
    }
    if (right) {
      return 'right';
    }
    return 'left';
  });
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].includes('|') && !isTableSep(lines[i])) {
    rows.push(splitRow(lines[i]));
    i += 1;
  }
  const th = heads
    .map((cell, index) => `<th style="text-align:${aligns[index] ?? 'left'}">${inlineMarkdown(cell)}</th>`)
    .join('');
  const body = rows
    .map((row) => {
      const tds = heads
        .map((_, index) => `<td style="text-align:${aligns[index] ?? 'left'}">${inlineMarkdown(row[index] ?? '')}</td>`)
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return {
    html: `<div class="md-table"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: i,
  };
}

interface ListItem {
  indent: number;
  ordered: boolean;
  start?: number;
  task: boolean;
  checked: boolean;
  rest: string;
}

function parseListItem(line: string): ListItem | undefined {
  const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
  if (!match) {
    return undefined;
  }
  const marker = match[2];
  const ordered = /^\d/.test(marker);
  if (isHr(line) && !ordered) {
    return undefined;
  }
  return {
    indent: match[1].length,
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : undefined,
    task: match[3] !== undefined,
    checked: match[3] ? /x/i.test(match[3]) : false,
    rest: match[4],
  };
}

function renderList(lines: string[], start: number, minIndent: number): { html: string; next: number } {
  const first = parseListItem(lines[start]);
  if (!first || first.indent < minIndent) {
    return { html: '', next: start };
  }
  const indent = first.indent;
  const ordered = first.ordered;
  const items: string[] = [];
  let tasks = false;
  let i = start;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      const peek = i + 1 < lines.length ? parseListItem(lines[i + 1]) : undefined;
      if (peek && peek.indent >= indent) {
        i += 1;
        continue;
      }
      break;
    }
    const item = parseListItem(lines[i]);
    if (!item || item.indent < indent || item.ordered !== ordered) {
      break;
    }
    if (item.indent > indent) {
      const nested = renderList(lines, i, indent + 1);
      if (items.length > 0) {
        items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `${nested.html}</li>`);
      }
      i = nested.next;
      continue;
    }
    i += 1;
    const chunks = [item.rest];
    while (i < lines.length && lines[i].trim() && !parseListItem(lines[i]) && !startsBlock(lines, i)) {
      chunks.push(lines[i].trim());
      i += 1;
    }
    let inner = inlineMarkdown(chunks.join('\n')).replace(/\n/g, '<br />');
    if (item.task) {
      tasks = true;
      inner = `<span class="task${item.checked ? ' on' : ''}"></span>${inner}`;
    }
    const nested = i < lines.length ? parseListItem(lines[i]) : undefined;
    if (nested && nested.indent > indent) {
      const child = renderList(lines, i, indent + 1);
      inner += child.html;
      i = child.next;
    }
    items.push(`<li>${inner}</li>`);
  }
  const tag = ordered ? 'ol' : 'ul';
  const cls = tasks ? ' class="tasks"' : '';
  const startAt =
    ordered && first.start && first.start !== 1 ? ` start="${first.start}"` : '';
  return { html: `<${tag}${cls}${startAt}>${items.join('')}</${tag}>`, next: i };
}

export function inlineMarkdown(src: string): string {
  const slots: string[] = [];
  const stash = (html: string): string => {
    slots.push(html);
    return `\u0000${slots.length - 1}\u0000`;
  };
  let text = src.replace(/`([^`]+)`/g, (_all, code: string) => {
    const ref = isMarkedFileRef(code) ? parseCodeRef(code) : undefined;
    return ref
      ? stash(fileLinkHtml(ref))
      : stash(`<code>${escapeHtml(code)}</code>`);
  });
  text = extractMath(text, stash);
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_all, alt: string, url: string) => {
    const href = safeUrl(url);
    return href
      ? stash(`<img alt="${escapeHtml(alt)}" src="${escapeHtml(href)}" />`)
      : alt;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, label: string, url: string) => {
    const ref = parseCodeRef(url);
    if (ref) {
      return stash(fileLinkHtml(ref, label));
    }
    const href = safeUrl(url);
    if (!href) {
      return label;
    }
    return stash(
      `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${formatMarks(escapeHtml(label))}</a>`,
    );
  });
  text = text.replace(/\bhttps?:\/\/[^\s<]+/g, (raw) => {
    const trimmed = trimUrl(raw);
    const href = safeUrl(trimmed);
    if (!href) {
      return raw;
    }
    const suffix = raw.slice(trimmed.length);
    return `${stash(`<a href="${escapeHtml(href)}" rel="noreferrer noopener">${escapeHtml(href)}</a>`)}${suffix}`;
  });
  text = linkInlineFilePaths(text, stash);
  text = formatMarks(escapeHtml(text));
  return text.replace(/\u0000(\d+)\u0000/g, (_all, index: string) => slots[Number(index)] ?? '');
}

function formatMarks(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<em>$2</em>');
}

function trimUrl(raw: string): string {
  return raw.replace(/[),.;:!?]+$/g, (tail) => {
    if (tail.includes(')') && raw.includes('(')) {
      return tail;
    }
    return '';
  });
}

export function safeUrl(raw: string): string | undefined {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url) || /^data:image\//i.test(url)) {
    return url;
  }
  return undefined;
}
