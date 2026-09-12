import type { FileDiff } from '../../edits/diff';
import { isDesktop, post, render, tr, ui } from '../app';
import { iconBack } from '../icons';
import { escapeHtml } from '../transcript/markdown';

export type ReviewPayload = {
  locale?: string;
  files?: unknown[];
  messageId?: string;
  theme?: unknown;
};

let hooked = false;

export function openDesktopReview(payload: ReviewPayload): void {
  if (!isDesktop()) {
    return;
  }
  ui.review = {
    ...payload,
    files: Array.isArray(payload.files) ? payload.files : [],
    active: 'all',
  };
  post({ type: 'closeSettings' });
  post({ type: 'closeDrawer' });
  render();
}

export function closeDesktopReview(): boolean {
  if (!ui.review) {
    return false;
  }
  ui.review = undefined;
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
  const key = `${ui.review?.messageId ?? ''}:${active}:${files.map((row) => row.path).join('|')}`;
  if (el.dataset.key === key) {
    return;
  }
  el.dataset.key = key;
  el.replaceChildren();
  hookFrame();
  const frame = document.createElement('iframe');
  frame.className = 'og-review-frame';
  frame.title = tr('reviewTitle');
  frame.src = '../plugin/media/diff.html';
  frame.addEventListener('load', () => pushDiff(frame));
  el.append(frame);
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

export function reviewNav(): HTMLElement {
  const el = document.createElement('nav');
  el.className = 'og-nav';
  const active = ui.review?.active ?? 'all';
  el.append(fileBtn('all', tr('reviewAll'), active === 'all', 0, 0));
  for (const file of reviewFiles()) {
    const name = file.path.replace(/\\/g, '/').split('/').pop() ?? file.path;
    el.append(fileBtn(file.path, name, active === file.path, file.added, file.removed));
  }
  return el;
}

function fileBtn(id: string, label: string, on: boolean, added: number, removed: number): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = on ? 'og-nav-item on' : 'og-nav-item';
  btn.title = label;
  const stats =
    id === 'all'
      ? ''
      : `<em class="og-review-stat"><span class="add">+${added}</span><span class="del">−${removed}</span></em>`;
  btn.innerHTML = `<span>${escapeHtml(label)}</span>${stats}`;
  btn.addEventListener('click', () => {
    if (!ui.review || ui.review.active === id) {
      return;
    }
    ui.review = { ...ui.review, active: id };
    render();
  });
  return btn;
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

function hookFrame(): void {
  if (hooked) {
    return;
  }
  hooked = true;
  window.addEventListener('message', onFrameMessage);
}

function pushDiff(frame: HTMLIFrameElement): void {
  const payload = ui.review;
  if (!payload || !frame.contentWindow) {
    return;
  }
  const files = reviewFiles();
  const active = payload.active ?? 'all';
  const shown = active === 'all' ? files : files.filter((row) => row.path === active);
  frame.contentWindow.postMessage(
    {
      type: 'diff',
      payload: {
        locale: payload.locale,
        files: shown,
        messageId: payload.messageId,
        theme: payload.theme,
      },
    },
    '*',
  );
}

function onFrameMessage(
  event: MessageEvent<{ source?: string; message?: { type?: string; path?: string } }>,
): void {
  if (event.data?.source !== 'grok-diff' || !event.data.message) {
    return;
  }
  const msg = event.data.message;
  if (msg.type === 'ready') {
    const frame = document.querySelector('#og-review iframe.og-review-frame');
    if (frame instanceof HTMLIFrameElement) {
      pushDiff(frame);
    }
    return;
  }
  if (msg.type === 'revert') {
    post({ type: 'undoEdits', messageId: ui.review?.messageId });
    return;
  }
  if (msg.type === 'openFile' && msg.path) {
    post({ type: 'openFile', path: msg.path });
    return;
  }
}
