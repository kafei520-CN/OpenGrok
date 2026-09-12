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
  el.className = 'og-nav og-set-rail-nav';
  const kicker = document.createElement('div');
  kicker.className = 'og-kicker';
  kicker.textContent = tr('reviewTitle');
  el.append(kicker);
  const active = ui.review?.active ?? 'all';
  el.append(fileBtn('all', tr('reviewAll'), active === 'all', 0, 0));
  for (const file of reviewFiles()) {
    const name = file.path.replace(/\\/g, '/').split('/').pop() ?? file.path;
    el.append(fileBtn(file.path, name, active === file.path, file.added, file.removed));
  }
  queueMicrotask(() => applyReviewFilter());
  return el;
}

function reviewDeck(files: FileDiff[], active: string): HTMLElement {
  const pages = [
    { id: 'all', label: tr('reviewAll') },
    ...files.map((file) => ({
      id: file.path,
      label: file.path.replace(/\\/g, '/').split('/').pop() ?? file.path,
    })),
  ];
  const front = pages.find((row) => row.id === active) ?? pages[0];
  const deck = document.createElement('div');
  deck.className = 'og-deck';
  deck.style.setProperty('--og-stack', String(Math.max(0, pages.length - 1)));
  const tabs = document.createElement('div');
  tabs.className = 'og-deck-tabs';
  for (const page of pages) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = page.id === front.id ? 'og-deck-tab on' : 'og-deck-tab';
    btn.textContent = page.label;
    btn.title = page.label;
    btn.addEventListener('click', () => selectReview(page.id));
    tabs.append(btn);
  }
  const layers = document.createElement('div');
  layers.className = 'og-deck-layers';
  layers.setAttribute('aria-hidden', 'true');
  for (let i = pages.length - 1; i >= 1; i -= 1) {
    const layer = document.createElement('span');
    layer.style.setProperty('--i', String(i));
    layers.append(layer);
  }
  const sheet = document.createElement('div');
  sheet.className = 'og-deck-sheet og-review-sheet';
  const body = document.createElement('div');
  body.className = 'og-diff';
  const shown = front.id === 'all' ? files : files.filter((row) => row.path === front.id);
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
  deck.append(tabs, layers, sheet);
  return deck;
}

function fileBtn(id: string, label: string, on: boolean, added: number, removed: number): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = on ? 'og-nav-item on' : 'og-nav-item';
  btn.title = label;
  btn.dataset.label = label;
  const stats =
    id === 'all'
      ? ''
      : `<em class="og-review-stat"><span class="add">+${added}</span><span class="del">−${removed}</span></em>`;
  btn.innerHTML = `<span>${escapeHtml(label)}</span>${stats}`;
  btn.addEventListener('click', () => selectReview(id));
  return btn;
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
  const nav = document.querySelector('#og-rail .og-set-rail-nav');
  if (!nav) {
    return;
  }
  for (const child of Array.from(nav.children) as HTMLElement[]) {
    if (child.classList.contains('og-kicker')) {
      continue;
    }
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
