import type { FileDiff } from '../../edits/diff';
import type { ThemeColors } from '../../core/types';
import { isDesktop, post, render, tr, ui } from '../app';
import { iconBack, iconSearch } from '../icons';
import { escapeHtml } from '../transcript/markdown';
import { mountDiffView } from '../editor/diffView';

export type ReviewPayload = {
  locale?: string;
  files?: unknown[];
  messageId?: string;
  theme?: unknown;
};

let reviewQuery = '';

export function openDesktopReview(payload: ReviewPayload): void {
  if (!isDesktop()) {
    return;
  }
  ui.review = {
    ...payload,
    files: Array.isArray(payload.files) ? payload.files : [],
    active: 'all',
  };
  reviewQuery = '';
  ui.state = { ...ui.state, settingsOpen: false, drawer: undefined };
  post({ type: 'closeSettings' });
  post({ type: 'closeDrawer' });
  render();
}

export function closeDesktopReview(): boolean {
  if (!ui.review) {
    return false;
  }
  ui.review = undefined;
  reviewQuery = '';
  render();
  return true;
}

export function reviewOpen(): boolean {
  return isDesktop() && Boolean(ui.review);
}

export function patchReviewStage(parent: HTMLElement): void {
  const on = reviewOpen();
  parent.classList.toggle('og-review-on', on);
  let el = document.getElementById('og-review');
  if (!on) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('section');
    el.id = 'og-review';
    parent.append(el);
  }
  const files = reviewFiles();
  const active = ui.review?.active ?? 'all';
  const key = `${ui.review?.messageId ?? ''}:${active}:${files.map((row) => row.path).join('|')}:${ui.state.locale ?? ''}`;
  if (el.dataset.key === key) {
    return;
  }
  el.dataset.key = key;
  el.replaceChildren();
  const pane = document.createElement('div');
  pane.className = 'og-set-pane';
  pane.append(reviewDeck(files, active));
  el.append(pane);
}

export function reviewBack(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'og-set-back';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Esc';
  btn.innerHTML = `${iconBack()}<span>${escapeHtml(tr('setBackApp'))}</span>`;
  btn.addEventListener('click', () => {
    closeDesktopReview();
  });
  row.append(btn);
  return row;
}

export function reviewSearch(): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'og-search-wrap';
  wrap.innerHTML = iconSearch();
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'og-search og-set-search';
  input.placeholder = tr('reviewSearch');
  input.value = reviewQuery;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    reviewQuery = input.value;
    applyReviewFilter();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      event.stopPropagation();
      reviewQuery = '';
      input.value = '';
      applyReviewFilter();
    }
  });
  wrap.append(input);
  return wrap;
}

export function reviewNav(): HTMLElement {
  const el = document.createElement('nav');
  el.className = 'og-nav og-set-rail-nav og-review-nav';
  const kicker = document.createElement('div');
  kicker.className = 'og-kicker';
  kicker.textContent = tr('reviewTitle');
  el.append(kicker);
  const files = reviewFiles();
  const active = ui.review?.active ?? 'all';
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const list = document.createElement('div');
  list.className = 'og-review-files';
  list.append(fileBtn('all', tr('reviewAll'), '', active === 'all', added, removed));
  for (const file of files) {
    const parts = splitReviewPath(file.path);
    list.append(fileBtn(file.path, parts.name, parts.dir, active === file.path, file.added, file.removed));
  }
  el.append(list);
  queueMicrotask(() => applyReviewFilter());
  return el;
}

function reviewDeck(files: FileDiff[], active: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'og-review-flat';
  wrap.append(reviewHead(files, active));
  const sheet = document.createElement('div');
  sheet.className = 'og-review-sheet';
  const body = document.createElement('div');
  body.className = 'og-diff';
  const shown = active === 'all' ? files : files.filter((row) => row.path === active);
  mountDiffView(body, {
    locale: ui.review?.locale,
    files: shown,
    messageId: ui.review?.messageId,
    theme: ui.review?.theme as ThemeColors | undefined,
  }, {
    embedded: true,
    onRevert: () => post({ type: 'undoEdits', messageId: ui.review?.messageId }),
    onOpenFile: (path) => post({ type: 'openFile', path }),
  });
  sheet.append(body);
  wrap.append(sheet);
  return wrap;
}

function reviewHead(files: FileDiff[], active: string): HTMLElement {
  const head = document.createElement('header');
  head.className = 'og-review-head';
  const title = document.createElement('strong');
  const hint = document.createElement('span');
  if (active === 'all') {
    title.textContent = tr('reviewAll');
    hint.textContent = tr('diffFiles', { n: files.length });
  } else {
    const parts = splitReviewPath(active);
    title.textContent = parts.name;
    hint.textContent = parts.dir;
  }
  head.append(title);
  if (hint.textContent) {
    head.append(hint);
  }
  return head;
}

function fileBtn(
  id: string,
  name: string,
  dir: string,
  on: boolean,
  added: number,
  removed: number,
): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = on ? 'og-nav-item on' : 'og-nav-item';
  btn.title = dir ? `${dir}/${name}` : name;
  btn.dataset.label = `${name} ${dir}`.trim();
  const copy = dir
    ? `<span class="og-review-file"><span class="og-review-name">${escapeHtml(name)}</span><span class="og-review-dir">${escapeHtml(dir)}</span></span>`
    : `<span class="og-review-name">${escapeHtml(name)}</span>`;
  const stats = `<em class="og-review-stat"><span class="add">+${added}</span><span class="del">−${removed}</span></em>`;
  btn.innerHTML = `${copy}${stats}`;
  btn.addEventListener('click', () => selectReview(id));
  return btn;
}

function splitReviewPath(path: string): { name: string; dir: string } {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  if (i < 0) {
    return { name: norm, dir: '' };
  }
  return { name: norm.slice(i + 1), dir: norm.slice(0, i) };
}

function selectReview(id: string): void {
  if (!ui.review || ui.review.active === id) {
    return;
  }
  ui.review = { ...ui.review, active: id };
  render();
}

function applyReviewFilter(): void {
  const q = reviewQuery.trim().toLowerCase();
  const list = document.querySelector('#og-rail .og-review-files');
  if (!list) {
    return;
  }
  for (const child of Array.from(list.children) as HTMLElement[]) {
    child.hidden = Boolean(q) && !(child.dataset.label ?? '').toLowerCase().includes(q);
  }
}

function reviewFiles(): FileDiff[] {
  const rows = ui.review?.files;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.filter((row): row is FileDiff => {
    return Boolean(row && typeof row === 'object' && typeof (row as FileDiff).path === 'string');
  });
}
