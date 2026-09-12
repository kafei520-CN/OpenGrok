import type { StringKey } from '../../core/i18n';
import { formatRelativeTime } from '../../core/i18n';
import { isBooting, isDesktop, isRemoteWeb, loc, persistUi, post, render, tr, ui } from '../app';
import { button, iconButton } from '../dom';
import { findPinned, pinFloating, releaseFloating } from './popover';
import {
  iconBug,
  iconClock,
  iconClose,
  iconEdit,
  iconGrid,
  iconMore,
  iconSearch,
  iconStar,
  iconWrench,
} from '../icons';
import { escapeHtml } from '../transcript/markdown';
import { mountDashboard } from '../shell/dashboard';
import { listedSessions, mountSessionsDrawer } from '../shell/sessions';
import { superGrokKind, superGrokMark } from '../shell/superGrokMark';
import { mountTasks } from '../shell/tasks';

let headerLocale: string | undefined;

export function patchHeader(parent: HTMLElement): void {
  let el = document.getElementById('grok-header');
  if (isBooting()) {
    el?.remove();
    headerLocale = undefined;
    const menu = findPinned('.more-menu');
    if (menu) {
      releaseFloating(menu);
    }
    return;
  }
  const locale = ui.state.locale ?? 'en';
  if (!el || headerLocale !== locale) {
    const next = renderHeader();
    next.id = 'grok-header';
    if (el) {
      el.replaceWith(next);
    } else {
      parent.prepend(next);
    }
    headerLocale = locale;
    syncMoreMenu(next);
    return;
  }
  const mark = el.querySelector('.brand .mark');
  if (mark) {
    mark.className = ui.state.status === 'streaming' ? 'mark pulse' : 'mark';
  }
  const more = el.querySelector('[data-act="more"]');
  more?.classList.toggle('open', ui.moreOpen);
  const sessionTitle = el.querySelector('.og-session-title');
  if (sessionTitle) {
    sessionTitle.textContent = desktopHeaderTitle();
  }
  el.querySelector('[data-act="files"]')?.classList.toggle('on', ui.remoteView === 'workspace');
  if (isRemoteWeb()) {
    for (const btn of el.querySelectorAll('.ws-mode button')) {
      btn.classList.toggle('on', (btn as HTMLElement).dataset.view === ui.remoteView);
    }
  }
  syncMoreMenu(el);
  if (isRemoteWeb()) {
    ensureRttLoop();
  }
}

function rttBadge(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'rtt';
  el.id = 'conn-rtt';
  el.title = tr('connRttHint');
  el.textContent = '—';
  return el;
}

let rttTimer: number | undefined;
let rttBusy = false;

function ensureRttLoop(): void {
  if (rttTimer !== undefined) {
    return;
  }
  void tickRtt();
  rttTimer = window.setInterval(() => {
    void tickRtt();
  }, 4000);
}

async function tickRtt(): Promise<void> {
  if (rttBusy || document.hidden) {
    return;
  }
  const el = document.getElementById('conn-rtt');
  if (!el) {
    return;
  }
  rttBusy = true;
  const t0 = performance.now();
  try {
    const res = await fetch('/ping', { method: 'HEAD', cache: 'no-store' });
    const ms = Math.max(0, Math.round(performance.now() - t0));
    if (!res.ok && res.status !== 204) {
      throw new Error('ping');
    }
    el.textContent = `${ms}ms`;
    el.classList.toggle('ok', ms < 120);
    el.classList.toggle('slow', ms >= 120 && ms < 320);
    el.classList.toggle('bad', ms >= 320);
  } catch {
    el.textContent = '—';
    el.classList.remove('ok', 'slow');
    el.classList.add('bad');
  } finally {
    rttBusy = false;
  }
}

export function renderHeader(): HTMLElement {
  const el = document.createElement('header');
  el.className = isDesktop() ? 'topbar og-topbar' : 'topbar';
  const brand = document.createElement('div');
  brand.className = 'brand';
  if (isDesktop()) {
    const title = document.createElement('span');
    title.className = 'og-session-title';
    title.textContent = desktopHeaderTitle();
    brand.append(title);
  } else {
    const mark = document.createElement('span');
    mark.className = ui.state.status === 'streaming' ? 'mark pulse' : 'mark';
    mark.innerHTML = iconStar();
    const name = document.createElement('span');
    name.textContent = tr('grok');
    brand.append(mark, name);
  }
  if (isRemoteWeb()) {
    brand.append(rttBadge());
    ensureRttLoop();
  }
  if (isDesktop()) {
    el.addEventListener('dblclick', () => {
      const host = (window as unknown as { opengrok?: { window?: (action: 'min' | 'max' | 'close') => void } })
        .opengrok;
      host?.window?.('max');
    });
    el.append(brand);
    return el;
  }
  const actions = document.createElement('div');
  actions.className = 'header-actions';
  const sessions = iconButton(tr('sessions'), iconClock(), () =>
    post({ type: 'openDrawer', drawer: 'sessions' }),
  );
  sessions.dataset.act = 'sessions';
  const dash = iconButton(tr('menuDashboard'), iconGrid(), () =>
    post({ type: 'openDrawer', drawer: 'dashboard' }),
  );
  dash.dataset.act = 'dashboard';
  actions.append(sessions, dash);
  const more = iconButton(tr('more'), iconMore(), () => {
    ui.moreOpen = !ui.moreOpen;
    ui.picker = undefined;
    render();
  });
  more.dataset.act = 'more';
  more.addEventListener('click', (event) => event.stopPropagation());
  if (ui.moreOpen) {
    more.classList.add('open');
  }
  actions.append(more);
  const fresh = iconButton(tr('newSession'), iconEdit(), () => post({ type: 'newSession' }));
  fresh.dataset.act = 'new';
  actions.append(fresh);
  if (isRemoteWeb()) {
    el.append(brand, remoteViewSeg(), actions);
  } else {
    el.append(brand, actions);
  }
  return el;
}

function remoteViewSeg(): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'seg ws-mode';
  for (const [id, label] of [
    ['sidebar', isDesktop() ? tr('railChat') : tr('remoteViewSidebar')],
    ['workspace', tr('remoteViewWorkspace')],
  ] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.view = id;
    btn.textContent = label;
    if (ui.remoteView === id) {
      btn.classList.add('on');
    }
    btn.addEventListener('click', () => {
      if (ui.remoteView === id) {
        return;
      }
      ui.remoteView = id;
      ui.moreOpen = false;
      persistAndSwitch();
    });
    seg.append(btn);
  }
  return seg;
}

function desktopHeaderTitle(): string {
  if (ui.review) {
    return tr('reviewTitle');
  }
  if (ui.state.settingsOpen) {
    return tr('settingsTitle');
  }
  const current = (ui.state.sessions ?? []).find((row) => row.id === ui.state.currentSessionId);
  return current?.title?.trim() || tr('newSession');
}

function persistAndSwitch(): void {
  persistUi();
  post({ type: 'setRemoteView', view: ui.remoteView });
  if (ui.remoteView === 'workspace') {
    post({ type: 'listWorkspace' });
  }
  render();
}

function syncMoreMenu(header: HTMLElement): void {
  const more = header.querySelector('[data-act="more"]');
  const menu = findPinned('.more-menu');
  if (!ui.moreOpen || !(more instanceof HTMLElement)) {
    if (menu) {
      releaseFloating(menu);
    }
    return;
  }
  pinFloating(menu ?? moreMenu(), more, { prefer: 'below', align: 'end' });
}

function moreMenu(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'more-menu';
  el.addEventListener('click', (event) => event.stopPropagation());
  const items: Array<[StringKey, () => void]> = [
    ['drawerTasks', () => post({ type: 'openDrawer', drawer: 'tasks' })],
    ['menuCompact', () => post({ type: 'runSlash', command: 'compact' })],
    ['menuRewind', () => post({ type: 'runSlash', command: 'rewind' })],
    ['menuFork', () => post({ type: 'runSlash', command: 'fork' })],
    ['menuExport', () => post({ type: 'exportChat' })],
    ['menuRestart', () => post({ type: 'restart' })],
  ];
  if (!isDesktop()) {
    items.unshift(['menuDashboard', () => post({ type: 'openDrawer', drawer: 'dashboard' })]);
    items.splice(items.length - 1, 0, [
      'menuSettings',
      () => {
        ui.deskTab = 'account';
        post({ type: 'openSettings' });
      },
    ]);
  }
  for (const [key, fn] of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tr(key);
    btn.addEventListener('click', () => {
      ui.moreOpen = false;
      fn();
    });
    el.append(btn);
  }
  return el;
}

export function renderDrawer(): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'drawer-layer';
  const scrim = document.createElement('div');
  scrim.className = 'drawer-scrim';
  scrim.title = tr('drawerClose');
  scrim.addEventListener('click', () => post({ type: 'closeDrawer' }));
  const el = document.createElement('aside');
  el.className = 'drawer';
  const head = document.createElement('div');
  head.className = 'drawer-head';
  const title = document.createElement('strong');
  title.textContent =
    ui.state.drawer === 'sessions'
      ? tr('drawerSessions')
      : ui.state.drawer === 'dashboard'
        ? tr('drawerDashboard')
        : ui.state.drawer === 'tasks'
          ? tr('drawerTasks')
          : ui.state.drawer === 'plan'
            ? tr('drawerPlan')
            : ui.state.drawer === 'history'
              ? tr('drawerHistory')
              : ui.state.drawerTab ?? 'Extensions';
  const close = iconButton(tr('drawerClose'), iconClose(), () => post({ type: 'closeDrawer' }));
  head.append(title, close);
  el.append(head);
  if (ui.state.drawer === 'sessions') {
    mountSessionsDrawer(el);
  } else {
    const scroll = document.createElement('div');
    scroll.className = 'drawer-scroll';
    if (ui.state.drawer === 'dashboard') {
      mountDashboard(scroll);
    } else if (ui.state.drawer === 'tasks') {
      mountTasks(scroll);
    } else if (ui.state.drawer === 'plan') {
      const pre = document.createElement('pre');
      pre.className = 'code';
      pre.textContent = ui.state.drawerBody ?? '';
      scroll.append(pre);
    } else if (ui.state.drawer === 'history') {
      for (const prompt of ui.state.history ?? []) {
        const item = button(prompt.slice(0, 80), () => {
          ui.draft = prompt;
          ui.wantFocus = true;
          post({ type: 'closeDrawer' });
        });
        item.className = 'idea';
        scroll.append(item);
      }
    } else {
      const pre = document.createElement('pre');
      pre.className = 'code';
      pre.textContent = ui.state.drawerBody ?? '';
      scroll.append(pre);
    }
    el.append(scroll);
  }
  layer.append(scrim, el);
  return layer;
}

export function renderLightbox(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.title = tr('closePreview');
  el.addEventListener('click', () => {
    ui.lightboxSrc = undefined;
    render();
  });
  const img = document.createElement('img');
  img.alt = tr('previewImage');
  img.src = ui.lightboxSrc ?? '';
  img.addEventListener('click', (event) => event.stopPropagation());
  el.append(img);
  return el;
}

export function panel(title: string, body: string): HTMLElement {
  const el = document.createElement('section');
  el.className = 'card';
  const h = document.createElement('h1');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  el.append(h, p);
  return el;
}

export function setupCard(): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card';
  const mark = document.createElement('div');
  mark.className = 'mark';
  mark.style.width = '36px';
  mark.style.height = '36px';
  mark.style.margin = '0 auto 12px';
  mark.style.color = 'inherit';
  mark.innerHTML = iconStar();
  const title = document.createElement('h1');
  title.textContent = tr('cliTitle');
  const copy = document.createElement('p');
  copy.textContent = tr('cliBody');
  card.append(mark, title, copy);
  const pre = document.createElement('pre');
  pre.className = 'code';
  pre.textContent = ui.state.cliInstallHint ?? '';
  const row = document.createElement('div');
  row.className = 'row';
  row.append(
    button(tr('cliInstall'), () => post({ type: 'installCli' }), true),
    button(tr('cliReady'), () => post({ type: 'restart' })),
  );
  card.append(pre, row);
  return card;
}

export function loginCard(): HTMLElement {
  const card = document.createElement('section');
  card.className = isDesktop() ? 'card og-login' : 'card';
  const authenticating = ui.state.status === 'authenticating';
  const mark = document.createElement(isDesktop() ? 'img' : 'div');
  if (isDesktop()) {
    const logo = mark as HTMLImageElement;
    logo.className = 'og-login-logo';
    logo.src = '../resources/logo.png';
    logo.alt = '';
  } else {
    mark.className = 'mark';
    mark.style.width = '36px';
    mark.style.height = '36px';
    mark.style.margin = '0 auto 12px';
    mark.innerHTML = iconStar();
  }
  const title = document.createElement('h1');
  title.textContent = authenticating
    ? tr('loginWaitTitle')
    : isDesktop()
      ? tr('loginTitleDesk')
      : tr('loginTitle');
  const copy = document.createElement('p');
  copy.textContent = authenticating
    ? tr('loginWaitBody')
    : isDesktop()
      ? tr('loginBodyDesk')
      : tr('loginBody');
  card.append(mark, title, copy);
  if (ui.state.login?.url) {
    const url = document.createElement('div');
    url.className = 'login-url';
    url.textContent = ui.state.login.url;
    card.append(url);
    if (ui.state.login.mode === 'device') {
      const note = document.createElement('p');
      note.textContent = tr('loginDevice');
      card.append(note);
    }
  }
  const row = document.createElement('div');
  row.className = 'row';
  const skip = button(tr('loginSkip'), () => post({ type: 'skipLogin' }));
  if (authenticating) {
    row.append(
      button(tr('loginReopen'), () => post({ type: 'openLoginUrl' }), true),
      button(tr('cancel'), () => post({ type: 'cancelLogin' })),
      skip,
    );
  } else {
    row.append(
      button(
        ui.state.login?.label
          ? tr('loginWith', { label: ui.state.login.label })
          : tr('loginGrok'),
        () => post({ type: 'login' }),
        true,
      ),
      skip,
    );
  }
  card.append(row);
  if (authenticating && ui.state.login?.mode !== 'device') {
    const paste = document.createElement('form');
    paste.className = 'paste';
    paste.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = paste.querySelector('input') as HTMLInputElement | null;
      if (input?.value.trim()) {
        post({ type: 'submitAuthCode', code: input.value });
      }
    });
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.placeholder = tr('pasteCode');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = tr('submit');
    paste.append(codeInput, submit);
    card.append(paste);
  }
  const api = document.createElement('button');
  api.className = 'linkish';
  api.type = 'button';
  api.textContent = tr('useApiKey');
  api.addEventListener('click', () => post({ type: 'useApiLogin' }));
  card.append(api);
  return card;
}

export function bootStar(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'boot';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', tr('startingTitle'));
  const mark = document.createElement('div');
  mark.className = 'mark pulse';
  mark.innerHTML = iconStar();
  el.append(mark);
  return el;
}

export function errorCard(): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card';
  const title = document.createElement('h1');
  title.textContent = tr('errorTitle');
  const copy = document.createElement('p');
  copy.textContent = ui.state.error ?? '';
  card.append(title, copy, button(tr('retry'), () => post({ type: 'restart' }), true));
  return card;
}

function homeBrand(): HTMLElement {
  const kind = superGrokKind(ui.state.account, ui.state.billing);
  if (!kind) {
    const logo = document.createElement('img');
    logo.className = 'og-home-logo';
    logo.src = '../resources/logo.png';
    logo.alt = tr('appName');
    return logo;
  }
  return superGrokMark(kind);
}

function desktopCards(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-cards';
  const cards: Array<{ tone: string; icon: string; text: string }> = [
    { tone: 'explore', icon: iconSearch(), text: tr('cardExplore') },
    { tone: 'build', icon: iconWrench(), text: tr('cardBuild') },
    { tone: 'review', icon: iconEdit(), text: tr('cardReview') },
    { tone: 'fix', icon: iconBug(), text: tr('cardFix') },
  ];
  for (const card of cards) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `og-card tone-${card.tone}`;
    btn.innerHTML = `<span class="og-card-icon">${card.icon}</span><span class="og-card-copy">${escapeHtml(card.text)}</span>`;
    btn.title = card.text;
    btn.addEventListener('click', () => {
      ui.draft = card.text;
      ui.wantFocus = true;
      render();
    });
    el.append(btn);
  }
  return el;
}

export function home(): HTMLElement {
  const el = document.createElement('section');
  el.className = isDesktop() ? 'home og-home' : 'home';
  if (isDesktop()) {
    const title = document.createElement('h1');
    title.textContent = tr('homeTitle');
    const hint = document.createElement('p');
    hint.className = 'og-home-hint';
    hint.textContent = tr('homeHintDesk');
    el.append(homeBrand(), title, hint, desktopCards());
    return el;
  }
  const halo = document.createElement('div');
  halo.className = 'home-star';
  const mark = document.createElement('div');
  mark.className = 'mark';
  mark.innerHTML = iconStar();
  halo.append(mark);
  const title = document.createElement('h1');
  title.textContent = tr('homeTitle');
  const blurb = document.createElement('p');
  blurb.textContent = tr('homeBody');
  el.append(halo, title, blurb);
  const starters = document.createElement('div');
  starters.className = 'starters';
  for (const idea of [tr('starter1'), tr('starter2'), tr('starter3')]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'starter';
    btn.textContent = idea;
    btn.addEventListener('click', () => {
      ui.stickToBottom = true;
      post({ type: 'send', text: idea });
    });
    starters.append(btn);
  }
  el.append(starters);
  if (ui.state.hideSessionPreview) {
    return el;
  }
  const preview = listedSessions().slice(0, 4);
  if (preview.length > 0) {
    const recent = document.createElement('div');
    recent.className = 'recent';
    const label = document.createElement('div');
    label.className = 'recent-label';
    label.textContent = tr('recent');
    recent.append(label);
    for (const row of preview) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        row.id === ui.state.currentSessionId ? 'recent-card active' : 'recent-card';
      btn.innerHTML = `<span class="session-title">${escapeHtml(row.title)}</span><span class="session-time">${escapeHtml(formatRelativeTime(loc(), row.updatedAt))}</span>`;
      btn.addEventListener('click', () =>
        post({ type: 'loadSession', sessionId: row.id, cwd: row.cwd }),
      );
      recent.append(btn);
    }
    el.append(recent);
  }
  return el;
}


