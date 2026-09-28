import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import { formatAxTree } from '../../core/runtime/browserAx';
import type { PagePicture, SnapControl } from '../../core/runtime/browserSnap';
import {
  buildSnapView,
  CLEAR_STAMP_JS,
  clickTargetScript,
  controlByRef,
  cropRect,
  ENSURE_WATCH_JS,
  focusTargetScript,
  needsShot,
  PAGE_SNAPSHOT_JS,
  parsePicture,
  CLEAR_FIELD_JS,
  NAV_SETTLE_JS,
  SETTLE_JS,
  shouldClearBeforeType,
  stampScript,
} from '../../core/runtime/browserSnap';
import { copyText, isDesktop, persistUi, post, tr, ui } from '../app';

type LabShell = { id: string; label: string };

type HostApi = {
  termShells?: () => Promise<LabShell[]>;
  termStart?: (opts: { shellId: string; cwd?: string; cols?: number; rows?: number }) => Promise<{ ok: boolean; error?: string }>;
  termWrite?: (data: string) => void;
  termResize?: (opts: { cols: number; rows: number }) => void;
  termKill?: () => void;
  onTerm?: (handler: (data: string) => void) => void;
};

type PageKind = 'terminal' | 'browser';

type PageTab = {
  id: string;
  kind: PageKind;
  title: string;
  url: string;
  openedAt: number;
};

type ClosedTab = {
  kind: PageKind;
  title: string;
  url: string;
  closedAt: number;
};

let menuOpen = false;
let menuAnchor: HTMLElement | undefined;
let menuCloser: ((event: Event) => void) | undefined;
let menuTimer: number | undefined;
let dockOpen = false;
let mode: PageKind = 'terminal';
let shells: LabShell[] = [];
let shellId = '';
let termHooked = false;
let shellLive = false;
let booting: Promise<boolean> | undefined;
let xterm: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let termObserver: ResizeObserver | undefined;
let termCols = 0;
let termRows = 0;
let pages: PageTab[] = [];
let closedTabs: ClosedTab[] = [];
let activePage = '';
let pageSeq = 0;

function hostApi(): HostApi | undefined {
  return (window as unknown as { opengrok?: HostApi }).opengrok;
}

export function toolsMenuButton(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'og-tools';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `og-tools-btn${dockOpen ? ' on' : ''}`;
  btn.title = tr('dockTools');
  btn.setAttribute('aria-pressed', dockOpen ? 'true' : 'false');
  btn.innerHTML = panelIcon();
  const swallowDblClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  wrap.addEventListener('dblclick', swallowDblClick);
  btn.addEventListener('dblclick', swallowDblClick);
  btn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dockOpen = !dockOpen;
    closeToolsMenu();
    btn.classList.toggle('on', dockOpen);
    btn.setAttribute('aria-pressed', dockOpen ? 'true' : 'false');
    const root = document.getElementById('app');
    if (root) {
      patchToolsDock(root);
    }
  });
  wrap.append(btn);
  return wrap;
}

function closeToolsMenu(): void {
  menuOpen = false;
  menuAnchor = undefined;
  document.querySelector('.og-tools-menu')?.remove();
  if (menuTimer !== undefined) {
    window.clearTimeout(menuTimer);
    menuTimer = undefined;
  }
  if (menuCloser) {
    document.removeEventListener('pointerdown', menuCloser, true);
    menuCloser = undefined;
  }
}

function showMenu(
  anchor: HTMLElement,
  items: Array<{ label: string; icon: string; run: () => void }>,
  point?: { x: number; y: number },
  className?: string,
): void {
  const menu = document.createElement('div');
  menu.className = className ? `menu og-tools-menu ${className}` : 'menu og-tools-menu';
  for (const item of items) {
    menu.append(menuButton(item.label, item.icon, item.run));
  }
  openAnchoredMenu(anchor, menu, point);
}

function openAnchoredMenu(anchor: HTMLElement, menu: HTMLElement, point?: { x: number; y: number }): void {
  if (menuOpen && menuAnchor === anchor) {
    closeToolsMenu();
    return;
  }
  closeToolsMenu();
  menuOpen = true;
  menuAnchor = anchor;
  if (!menu.classList.contains('menu')) {
    menu.classList.add('menu', 'og-tools-menu');
  }
  document.body.append(menu);
  const width = menu.offsetWidth || 220;
  const height = menu.offsetHeight || 40;
  const box = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(point?.x ?? box.left, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(point?.y ?? box.bottom + 6, window.innerHeight - height - 8));
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menuCloser = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node) || menu.contains(target)) {
      return;
    }
    if (target instanceof Element && target.closest('[data-og-menu]')) {
      return;
    }
    closeToolsMenu();
  };
  menuTimer = window.setTimeout(() => {
    menuTimer = undefined;
    if (menuCloser) {
      document.addEventListener('pointerdown', menuCloser, true);
    }
  }, 0);
}

function menuButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'menu-item og-tools-item';
  item.innerHTML = `${icon}<span>${label}</span>`;
  item.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeToolsMenu();
    onClick();
  });
  return item;
}

function kindItems(): Array<{ label: string; icon: string; run: () => void }> {
  const kinds: PageKind[] = ['terminal', 'browser'];
  return kinds.map((kind) => ({
    label: kindLabel(kind),
    icon: pageIcon(kind),
    run: () => openDock(kind),
  }));
}

function kindLabel(kind: PageKind): string {
  return kind === 'terminal' ? tr('dockTerminal') : tr('dockBrowser');
}

function workspaceName(): string {
  const path = ui.state.workspacePath?.replace(/[\\/]+$/, '') ?? '';
  const name = path.split(/[\\/]/).pop()?.trim();
  return name || tr('dockTerminal');
}

function terminalIcon(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M4.5 6.2 6.6 8 4.5 9.8M8 10.2h3.2"/></svg>';
}

function browserIcon(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.4"/><path d="M2.7 8h10.6M8 2.6c1.6 1.7 2.4 3.5 2.4 5.4S9.6 11.7 8 13.4C6.4 11.7 5.6 9.9 5.6 8S6.4 4.3 8 2.6z"/></svg>';
}

function ensureKindPage(kind: Exclude<PageKind, 'browser'>): string {
  const existing = pages.find((page) => page.kind === kind);
  if (existing) {
    return existing.id;
  }
  const id = `page-${++pageSeq}`;
  const title = workspaceName();
  pages.push({ id, kind, title, url: '', openedAt: Date.now() });
  return id;
}

function addBrowserPage(): string {
  const id = `page-${++pageSeq}`;
  pages.push({ id, kind: 'browser', title: tr('dockBrowser'), url: 'about:blank', openedAt: Date.now() });
  return id;
}

export function openDock(next: PageKind, nextShell?: string): void {
  mode = next;
  if (nextShell) {
    shellId = nextShell;
  }
  const had = next !== 'browser' && pages.some((page) => page.kind === next);
  activePage = next === 'browser' ? addBrowserPage() : ensureKindPage(next);
  const active = pages.find((page) => page.id === activePage);
  if (active) {
    mode = active.kind;
  }
  dockOpen = true;
  closeToolsMenu();
  const root = document.getElementById('app');
  if (root) {
    patchToolsDock(root);
  }
  if (mode === 'terminal' && (!had || !shellLive)) {
    focusTerm();
    void ensureShell();
  } else if (mode === 'terminal') {
    focusTerm();
  }
}

export async function runInDockTerminal(command: string): Promise<void> {
  const fresh = !shellLive;
  openDock('terminal');
  const ok = await ensureShell();
  if (!ok) {
    return;
  }
  if (fresh) {
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  }
  const line = command.replace(/[\r\n]+$/g, '');
  if (!line) {
    return;
  }
  hostApi()?.termWrite?.(`${line}\r\n`);
  focusTerm();
}

function ensureShell(): Promise<boolean> {
  if (shellLive) {
    return Promise.resolve(true);
  }
  if (!booting) {
    booting = bootShell().finally(() => {
      booting = undefined;
    });
  }
  return booting;
}

async function bootShell(): Promise<boolean> {
  try {
    if (!shells.length) {
      shells = (await hostApi()?.termShells?.()) ?? [];
      shellId = shellId || shells[0]?.id || '';
    }
  } catch (error) {
    ensureTerm().write(`\r\n${error instanceof Error ? error.message : String(error)}\r\n`);
  }
  const ok = await startShell();
  shellLive = ok;
  return ok;
}

const DOCK_MIN = 320;
let dockResizeHooked = false;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dockMax(app: HTMLElement): number {
  const rail = document.getElementById('og-rail')?.getBoundingClientRect().width ?? 0;
  return Math.max(DOCK_MIN, app.clientWidth - rail - 280);
}

function applyDockWidth(app: HTMLElement): void {
  const width = clamp(ui.dockPx, DOCK_MIN, dockMax(app));
  app.style.setProperty('--og-dock-w', `${Math.round(width)}px`);
}

function hookDockResize(): void {
  if (dockResizeHooked) {
    return;
  }
  dockResizeHooked = true;
  window.addEventListener('resize', () => {
    const app = document.getElementById('app');
    if (app?.classList.contains('og-dock-on')) {
      applyDockWidth(app);
    }
  });
}

function dockSash(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-dock-sash';
  el.title = tr('dockResize');
  el.addEventListener('pointerdown', (event) => startDockSash(event, el));
  return el;
}

function startDockSash(event: PointerEvent, el: HTMLElement): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const app = document.getElementById('app');
  if (!app) {
    return;
  }
  el.classList.add('drag');
  document.documentElement.classList.add('og-dock-dragging');
  const mask = document.createElement('div');
  mask.className = 'og-dock-drag-mask';
  document.body.append(mask);
  const startX = event.clientX;
  const startW = clamp(ui.dockPx, DOCK_MIN, dockMax(app));
  ui.dockPx = startW;
  let raf = 0;
  const paint = () => {
    raf = 0;
    applyDockWidth(app);
  };
  const onMove = (move: PointerEvent) => {
    ui.dockPx = clamp(startW - (move.clientX - startX), DOCK_MIN, dockMax(app));
    if (!raf) {
      raf = requestAnimationFrame(paint);
    }
  };
  const onUp = () => {
    if (raf) {
      cancelAnimationFrame(raf);
    }
    paint();
    el.classList.remove('drag');
    document.documentElement.classList.remove('og-dock-dragging');
    mask.remove();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    persistUi();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

export function patchToolsDock(root: HTMLElement): void {
  if (!isDesktop()) {
    return;
  }
  hookDockResize();
  root.classList.toggle('og-dock-on', dockOpen);
  if (dockOpen) {
    applyDockWidth(root);
  }
  document.querySelector('.og-tools-btn')?.classList.toggle('on', dockOpen);
  let dock = document.getElementById('og-dock');
  if (!dockOpen) {
    dock?.remove();
    return;
  }
  if (!dock) {
    dock = renderDock();
    root.append(dock);
    requestAnimationFrame(() => {
      if (xterm) {
        xterm.options.theme = termTheme();
      }
      fitTerm();
    });
  }
  syncDock(dock);
}

function renderDock(): HTMLElement {
  const dock = document.createElement('aside');
  dock.id = 'og-dock';
  dock.className = 'og-dock';
  const head = document.createElement('div');
  head.className = 'og-dock-head';
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'og-dock-chevron';
  chevron.dataset.ogMenu = 'tabs';
  chevron.title = tr('dockOpenTabs');
  chevron.innerHTML = chevronIcon();
  chevron.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showTabList(chevron);
  });
  const tabs = document.createElement('div');
  tabs.className = 'og-dock-tabs';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'og-dock-add';
  add.dataset.ogMenu = 'add';
  add.title = tr('dockNewTab');
  add.textContent = '+';
  add.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showMenu(add, kindItems());
  });
  head.append(chevron, tabs, add);
  const frames = document.createElement('div');
  frames.className = 'og-dock-frames';
  frames.append(pickerPane(), terminalPane());
  dock.append(dockSash(), head, frames);
  hookTerm();
  return dock;
}

function syncDock(dock: HTMLElement): void {
  const head = dock.querySelector('.og-dock-head');
  if (head instanceof HTMLElement) {
    head.hidden = pages.length === 0;
  }
  const strip = dock.querySelector('.og-dock-tabs');
  if (strip) {
    strip.replaceChildren(...pages.map((page) => tabButton(page)));
  }
  const frames = dock.querySelector('.og-dock-frames');
  if (!frames) {
    return;
  }
  for (const page of pages) {
    if (page.kind === 'browser' && !frames.querySelector(`[data-page="${page.id}"]`)) {
      frames.append(browserPane(page));
    }
  }
  const active = pages.find((page) => page.id === activePage);
  const picker = frames.querySelector<HTMLElement>('[data-pane="picker"]');
  if (picker) {
    picker.hidden = pages.length > 0;
  }
  frames.querySelectorAll<HTMLElement>('[data-page], [data-pane="terminal"]').forEach((node) => {
    const id = node.dataset.page;
    const pane = node.dataset.pane;
    if (id) {
      node.hidden = id !== activePage;
      return;
    }
    node.hidden = !active || pane !== active.kind;
  });
}

function tabButton(page: PageTab): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.id = page.id;
  btn.className = `og-dock-tab${page.id === activePage ? ' on' : ''}`;
  btn.innerHTML = pageIcon(page.kind);
  const label = document.createElement('span');
  label.textContent = page.kind === 'terminal' ? workspaceName() : page.title;
  const close = document.createElement('span');
  close.className = 'og-dock-tab-x';
  close.textContent = '×';
  close.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closePage(page.id);
  });
  btn.append(label, close);
  btn.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showMenu(
      btn,
      [
        { label: tr('dockCloseTab'), icon: '', run: () => closePage(page.id) },
        { label: tr('dockCloseOthers'), icon: '', run: () => closeOtherPages(page.id) },
        { label: tr('dockCloseAll'), icon: '', run: () => closeAllPages() },
      ],
      { x: event.clientX, y: event.clientY },
      'og-dock-context',
    );
  });
  btn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('.og-dock-tab-x')) {
      return;
    }
    event.preventDefault();
    activePage = page.id;
    mode = page.kind;
    const dock = document.getElementById('og-dock');
    if (dock) {
      syncDock(dock);
    }
    if (page.kind === 'terminal') {
      focusTerm();
    }
  });
  return btn;
}

function closeOtherPages(keep: string): void {
  for (const id of pages.filter((page) => page.id !== keep).map((page) => page.id)) {
    closePage(id, false);
  }
  const dock = document.getElementById('og-dock');
  if (dock) {
    syncDock(dock);
  }
  refreshTabList();
}

function closeAllPages(): void {
  for (const id of pages.map((page) => page.id)) {
    closePage(id, false);
  }
  const dock = document.getElementById('og-dock');
  if (dock) {
    syncDock(dock);
  }
  closeToolsMenu();
}

function closePage(id: string, sync = true): void {
  const index = pages.findIndex((page) => page.id === id);
  if (index < 0) {
    return;
  }
  const page = pages[index];
  if (page) {
    rememberClosed(page);
  }
  pages.splice(index, 1);
  document.querySelector(`[data-page="${id}"]`)?.remove();
  if (page?.kind === 'terminal') {
    hostApi()?.termKill?.();
    xterm?.reset();
    shellLive = false;
  }
  if (!pages.length) {
    activePage = '';
  } else if (activePage === id) {
    activePage = pages[Math.max(0, index - 1)]?.id ?? pages[0]?.id ?? '';
    mode = pages.find((item) => item.id === activePage)?.kind ?? 'terminal';
  }
  if (!sync) {
    return;
  }
  const dock = document.getElementById('og-dock');
  if (dock) {
    syncDock(dock);
  }
  refreshTabList();
}

function pageLabel(page: PageTab): string {
  return page.kind === 'terminal' ? workspaceName() : page.title;
}

function rememberClosed(page: PageTab): void {
  closedTabs.unshift({
    kind: page.kind,
    title: pageLabel(page),
    url: page.url,
    closedAt: Date.now(),
  });
  closedTabs = closedTabs.slice(0, 20);
}

function tabAge(at: number): string {
  const min = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (min < 1) {
    return tr('timeJustNow');
  }
  if (min < 60) {
    return tr('dockAgeMin', { n: min });
  }
  const hours = Math.round(min / 60);
  if (hours < 24) {
    return tr('dockAgeHour', { n: hours });
  }
  return tr('dockAgeDay', { n: Math.max(1, Math.round(hours / 24)) });
}

function showTabList(anchor: HTMLElement): void {
  if (menuOpen && menuAnchor === anchor) {
    closeToolsMenu();
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'menu og-tools-menu og-tab-menu';
  const search = document.createElement('label');
  search.className = 'og-tab-search';
  search.innerHTML = searchIcon();
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = tr('dockSearchTabs');
  input.spellcheck = false;
  const body = document.createElement('div');
  body.className = 'og-tab-menu-body';
  search.append(input);
  menu.append(search, body);
  input.addEventListener('input', () => paintTabMenu(body, input.value));
  input.addEventListener('keydown', (event) => event.stopPropagation());
  paintTabMenu(body, '');
  openAnchoredMenu(anchor, menu);
  window.setTimeout(() => input.focus(), 0);
}

function refreshTabList(): void {
  const body = document.querySelector('.og-tab-menu-body');
  const input = document.querySelector('.og-tab-search input');
  if (!(body instanceof HTMLElement)) {
    return;
  }
  paintTabMenu(body, input instanceof HTMLInputElement ? input.value : '');
}

function paintTabMenu(body: HTMLElement, query: string): void {
  const needle = query.trim().toLowerCase();
  body.replaceChildren();
  const open = pages.filter((page) => pageLabel(page).toLowerCase().includes(needle));
  const recent = closedTabs.filter((page) => page.title.toLowerCase().includes(needle));
  if (open.length) {
    body.append(sectionLabel(tr('dockOpenTabs')));
    const rows = document.createElement('div');
    rows.className = 'og-tab-rows';
    for (const page of open) {
      rows.append(openTabRow(page));
    }
    body.append(rows);
  }
  if (recent.length) {
    body.append(sectionLabel(tr('dockRecentTabs')));
    const rows = document.createElement('div');
    rows.className = 'og-tab-rows';
    for (const page of recent) {
      rows.append(closedTabRow(page));
    }
    body.append(rows);
  }
}

function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-tab-section';
  el.textContent = text;
  return el;
}

function openTabRow(page: PageTab): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `og-tab-row${page.id === activePage ? ' on' : ''}`;
  row.innerHTML = pageIcon(page.kind);
  const name = document.createElement('span');
  name.textContent = pageLabel(page);
  const when = document.createElement('time');
  when.textContent = tabAge(page.openedAt);
  const close = document.createElement('span');
  close.className = 'og-dock-tab-x';
  close.textContent = '×';
  close.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closePage(page.id);
  });
  row.append(name, when, close);
  row.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('.og-dock-tab-x')) {
      return;
    }
    event.preventDefault();
    activePage = page.id;
    mode = page.kind;
    const dock = document.getElementById('og-dock');
    if (dock) {
      syncDock(dock);
    }
    if (page.kind === 'terminal') {
      focusTerm();
    }
    closeToolsMenu();
  });
  return row;
}

function closedTabRow(item: ClosedTab): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'og-tab-row';
  row.innerHTML = pageIcon(item.kind);
  const name = document.createElement('span');
  name.textContent = item.title;
  const when = document.createElement('time');
  when.textContent = tabAge(item.closedAt);
  row.append(name, when);
  row.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    reopenClosed(item);
  });
  return row;
}

function reopenClosed(item: ClosedTab): void {
  closedTabs = closedTabs.filter((tab) => tab !== item);
  closeToolsMenu();
  if (item.kind === 'terminal') {
    openDock('terminal');
    return;
  }
  const id = addBrowserPage();
  const page = pages.find((tab) => tab.id === id);
  if (page) {
    page.title = item.title || tr('dockBrowser');
    page.url = item.url || 'about:blank';
    page.openedAt = Date.now();
  }
  activePage = id;
  mode = 'browser';
  dockOpen = true;
  const root = document.getElementById('app');
  if (root) {
    patchToolsDock(root);
  }
}

function searchIcon(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 13 13"/></svg>';
}

function pickerPane(): HTMLElement {
  const pane = document.createElement('section');
  pane.className = 'og-dock-pane og-dock-pick';
  pane.dataset.pane = 'picker';
  const title = document.createElement('h2');
  title.textContent = tr('dockOpenTab');
  const hint = document.createElement('p');
  hint.textContent = tr('dockOpenTabHint');
  const cards = document.createElement('div');
  cards.className = 'og-dock-cards';
  const items: PageKind[] = ['terminal', 'browser'];
  for (const kind of items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'og-dock-card';
    card.innerHTML = `${pageIcon(kind)}<span>${kindLabel(kind)}</span>`;
    card.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDock(kind);
    });
    cards.append(card);
  }
  pane.append(title, hint, cards);
  return pane;
}

function pageIcon(kind: PageKind): string {
  return kind === 'terminal' ? terminalIcon() : browserIcon();
}

function panelIcon(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M9 3v10"/></svg>';
}

function chevronIcon(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.2 8 10.2 12 6.2"/></svg>';
}

function terminalPane(): HTMLElement {
  const pane = document.createElement('section');
  pane.className = 'og-dock-pane';
  pane.dataset.pane = 'terminal';
  pane.hidden = mode !== 'terminal';
  const host = document.createElement('div');
  host.className = 'og-dock-xterm';
  pane.append(host);
  mountTerm(host);
  return pane;
}

function termTheme(): ITheme {
  const app = document.getElementById('app');
  const dock = document.getElementById('og-dock');
  const appStyle = getComputedStyle(app ?? document.body);
  const dockStyle = getComputedStyle(dock ?? app ?? document.body);
  const fg = paintColor(dockStyle.color) || paintColor(appStyle.color) || '#e8e8e8';
  const bg =
    paintColor(dockStyle.backgroundColor) ||
    paintColor(appStyle.backgroundColor) ||
    paintColor(appStyle.getPropertyValue('--bg')) ||
    '#1c1c1c';
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: 'rgba(128, 128, 128, 0.35)',
  };
}

function paintColor(value: string): string {
  const text = value.trim();
  if (!text || text === 'transparent' || text === 'rgba(0, 0, 0, 0)') {
    return '';
  }
  return text;
}

function ensureTerm(): Terminal {
  if (xterm && fitAddon) {
    return xterm;
  }
  fitAddon = new FitAddon();
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, Consolas, "Cascadia Mono", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: termTheme(),
    windowsPty: navigator.userAgent.includes('Windows') ? { backend: 'conpty' } : undefined,
  });
  term.loadAddon(fitAddon);
  term.onData((data) => hostApi()?.termWrite?.(data));
  term.attachCustomKeyEventHandler((event) => {
    if (event.type === 'keydown' && event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v') {
      void navigator.clipboard.readText().then((text) => term.paste(text)).catch(() => undefined);
      return false;
    }
    return true;
  });
  xterm = term;
  return term;
}

function mountTerm(host: HTMLElement): void {
  const term = ensureTerm();
  if (term.element) {
    host.append(term.element);
  } else {
    term.open(host);
  }
  term.options.theme = termTheme();
  termObserver?.disconnect();
  termObserver = new ResizeObserver(() => fitTerm());
  termObserver.observe(host);
}

function fitTerm(): void {
  const term = xterm;
  if (!term || !fitAddon || !term.element?.isConnected) {
    return;
  }
  fitAddon.fit();
  if (term.cols < 2 || term.rows < 1 || (term.cols === termCols && term.rows === termRows)) {
    return;
  }
  termCols = term.cols;
  termRows = term.rows;
  hostApi()?.termResize?.({ cols: term.cols, rows: term.rows });
}

function browserPane(page: PageTab): HTMLElement {
  const pane = document.createElement('section');
  pane.className = 'og-dock-pane';
  pane.dataset.page = page.id;
  pane.hidden = page.id !== activePage;
  const bar = document.createElement('form');
  bar.className = 'og-dock-bar';
  const url = document.createElement('input');
  url.type = 'text';
  url.className = 'og-dock-url';
  url.placeholder = tr('dockUrlPlaceholder');
  url.spellcheck = false;
  const back = iconButton(chevronLeftIcon(), () => guest()?.goBack());
  const forward = iconButton(chevronRightIcon(), () => guest()?.goForward());
  const reload = iconButton(reloadIcon(), () => guest()?.reload());
  const external = iconButton(externalIcon(), () => {
    const href = browserHref(url.value);
    if (href) {
      post({ type: 'openUrl', url: href });
    }
  });
  external.title = tr('dockOpenExternal');
  const devtools = iconButton(sparkIcon(), () => toggleDevTools());
  devtools.title = tr('dockF12');
  const more = iconButton(moreIcon(), () => {
    showMenu(more, [
      {
        label: tr('dockCopyUrl'),
        icon: '',
        run: () => {
          const href = browserHref(url.value);
          if (href) {
            copyText(href);
          }
        },
      },
      { label: tr('dockF12'), icon: '', run: () => toggleDevTools() },
    ]);
  });
  more.dataset.ogMenu = 'more';
  bar.append(back, forward, reload, url, external, devtools, more);
  bar.addEventListener('submit', (event) => {
    event.preventDefault();
    navigate(url.value);
  });
  const frame = document.createElement('div');
  frame.className = 'og-dock-frame';
  const blank = document.createElement('div');
  blank.className = 'og-dock-blank';
  const heading = document.createElement('h2');
  heading.textContent = tr('dockBrowser');
  const hint = document.createElement('p');
  hint.textContent = tr('dockBrowserEmpty');
  blank.innerHTML = globeMark();
  blank.append(heading, hint);
  const view = document.createElement('webview') as WebViewEl;
  view.className = 'og-dock-webview';
  view.hidden = true;
  view.setAttribute('partition', 'persist:og-browser');
  view.setAttribute('allowpopups', '');
  const startUrl = page.url && page.url !== 'about:blank' ? page.url : '';
  view.src = startUrl || 'about:blank';
  const showBlank = (blankPage: boolean) => {
    blank.hidden = !blankPage;
    view.hidden = blankPage;
  };
  if (startUrl) {
    url.value = startUrl;
    showBlank(false);
  }
  const retitle = () => {
    const href = view.getURL?.() || page.url;
    const blankPage = !href || href === 'about:blank';
    url.value = blankPage ? '' : href;
    page.url = href;
    showBlank(blankPage);
    if (blankPage) {
      page.title = tr('dockBrowser');
    }
    const title = view.getAttribute('data-title') || pageTitle(href);
    if (!blankPage) {
      page.title = title;
    }
    const label = document.querySelector(`.og-dock-tab[data-id="${page.id}"] span`);
    if (label) {
      label.textContent = page.title;
    }
  };
  view.addEventListener('did-navigate', retitle);
  view.addEventListener('did-navigate-in-page', retitle);
  view.addEventListener('page-title-updated', (event) => {
    const title = (event as Event & { title?: string }).title?.trim();
    if (!title || title === 'about:blank') {
      return;
    }
    view.setAttribute('data-title', title);
    page.title = title;
    const label = document.querySelector(`.og-dock-tab[data-id="${page.id}"] span`);
    if (label) {
      label.textContent = title;
    }
  });
  frame.append(blank, view);
  pane.append(bar, frame);
  pane.addEventListener('keydown', (event) => {
    if (event.key === 'F12') {
      event.preventDefault();
      toggleDevTools();
    }
  });
  return pane;
}

type WebImage = {
  getSize(): { width: number; height: number };
  resize(opts: { width: number; height?: number }): WebImage;
  toJPEG(quality: number): Uint8Array;
};

type WebViewEl = HTMLElement & {
  src: string;
  hidden: boolean;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  getTitle(): string;
  getWebContentsId?(): number;
  capturePage(rect?: { x: number; y: number; width: number; height: number }): Promise<WebImage>;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  sendInputEvent(event: Record<string, unknown>): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

type BrowserReq = {
  id: number;
  action?: string;
  url?: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  selector?: string;
  text?: string;
  key?: string;
  ref?: string;
  image?: boolean;
  dx?: number;
  dy?: number;
  append?: boolean;
};

let lastShot = { width: 1, height: 1, cssX: 0, cssY: 0, cssW: 1, cssH: 1 };
let lastPicture: PagePicture | undefined;
const backendRefs = new Map<number, string>();
const lastBackends = new Map<string, number>();
let backendSeq = 0;
let axUrl = '';

export function bindDockBrowser(): void {
  const api = (window as unknown as {
    opengrok?: {
      onBrowser?: (handler: (req: BrowserReq) => void) => void;
      browserDone?: (id: number, result: unknown) => void;
    };
    __ogBrowser?: boolean;
  });
  if (!api.opengrok?.onBrowser || api.__ogBrowser) {
    return;
  }
  api.__ogBrowser = true;
  api.opengrok.onBrowser((req) => {
    void controlDockBrowser(req)
      .then((result) => api.opengrok?.browserDone?.(req.id, result))
      .catch((error: unknown) => {
        api.opengrok?.browserDone?.(req.id, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
}

export async function controlDockBrowser(req: BrowserReq): Promise<Record<string, unknown>> {
  const action = req.action || '';
  try {
    if (action === 'open') {
      const href = browserHref(String(req.url ?? ''));
      if (!href) {
        return { ok: false, error: '缺少网址' };
      }
      const view = await openAndGo(href);
      lastPicture = undefined;
      return observe(view, false);
    }
    if (action === 'look') {
      return observe(await ensureVisibleBrowser(), wantImage(req.image));
    }
    if (action === 'click') {
      const view = await ensureVisibleBrowser();
      await ensureWatch(view);
      const before = guestUrl(view);
      const clicked = await clickBrowser(view, req);
      const observed = await finishAction(view, '已点击。', before);
      if (clicked && (clicked.role === 'textbox' || clicked.role === 'searchbox') && String(observed['url'] ?? '') === before) {
        observed['summary'] = `已点中输入框 ${clicked.ref}。用 browser_type 写入文字，然后 browser_press Enter。不要再点这个框。`;
      }
      return observed;
    }
    if (action === 'drag') {
      const view = await ensureVisibleBrowser();
      await ensureWatch(view);
      await dragBrowser(view, req);
      return finishAction(view, '已拖拽。');
    }
    if (action === 'type') {
      const view = await ensureVisibleBrowser();
      await ensureWatch(view);
      await typeBrowser(view, String(req.text ?? ''), req.selector, req.ref, req.append === true);
      return finishAction(view, '已输入。');
    }
    if (action === 'press') {
      const view = await ensureVisibleBrowser();
      await ensureWatch(view);
      pressBrowser(view, String(req.key ?? ''));
      return finishAction(view, `已按 ${req.key ?? ''}。`);
    }
    if (action === 'scroll') {
      const view = await ensureVisibleBrowser();
      await ensureWatch(view);
      scrollBrowser(view, Number(req.dx) || 0, Number(req.dy) || 0);
      return finishAction(view, '已滚动。');
    }
    return { ok: false, error: `未知操作 ${action}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function showBrowserPage(): string {
  const current = pages.find((page) => page.id === activePage && page.kind === 'browser');
  const found = current ?? [...pages].reverse().find((page) => page.kind === 'browser');
  if (found) {
    activePage = found.id;
    mode = 'browser';
    dockOpen = true;
    closeToolsMenu();
    const root = document.getElementById('app');
    if (root) {
      patchToolsDock(root);
    }
    return found.id;
  }
  openDock('browser');
  return activePage;
}

async function openAndGo(href: string): Promise<WebViewEl> {
  const id = showBrowserPage();
  const view = viewFor(id);
  if (!view) {
    throw new Error('浏览器还没准备好');
  }
  const page = pages.find((item) => item.id === id);
  if (page) {
    page.url = href;
  }
  await loadView(view, href);
  return view;
}

async function ensureVisibleBrowser(): Promise<WebViewEl> {
  const id = showBrowserPage();
  const view = viewFor(id);
  if (!view) {
    throw new Error('浏览器还没准备好');
  }
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
  return view;
}

function viewFor(id: string): WebViewEl | undefined {
  const node = document.querySelector(`[data-page="${CSS.escape(id)}"] .og-dock-webview`);
  return node instanceof HTMLElement ? (node as WebViewEl) : undefined;
}

function loadView(view: WebViewEl, href: string): Promise<void> {
  showGuest(view);
  if (guestUrl(view) === href) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('dom-ready', onStop);
      void navSettle(view).finally(() => resolve());
    };
    const onStop = () => {
      const url = guestUrl(view);
      if (!url || url === 'about:blank') {
        return;
      }
      finish();
    };
    const timer = window.setTimeout(finish, 4_000);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('dom-ready', onStop);
    view.src = href;
  });
}

function guestUrl(view: WebViewEl): string {
  try {
    return view.getURL?.() || '';
  } catch {
    return '';
  }
}

function showGuest(view: WebViewEl): void {
  view.hidden = false;
  const blank = view.closest('.og-dock-frame')?.querySelector('.og-dock-blank');
  if (blank instanceof HTMLElement) {
    blank.hidden = true;
  }
}

async function finishAction(
  view: WebViewEl,
  summary: string,
  previousUrl?: string,
): Promise<Record<string, unknown>> {
  const started = guestUrl(view);
  await settleView(view);
  const after = guestUrl(view);
  if ((previousUrl && after && after !== previousUrl) || (after && after !== started)) {
    await navSettle(view);
  }
  const observed = await observe(view, false);
  return { ...observed, summary };
}

async function navSettle(view: WebViewEl): Promise<void> {
  try {
    await view.executeJavaScript(NAV_SETTLE_JS, true);
  } catch {
    await wait(200);
  }
}

async function observe(view: WebViewEl, forceImage: boolean): Promise<Record<string, unknown>> {
  const url = guestUrl(view);
  let title = '';
  try {
    title = view.getTitle?.() || '';
  } catch {
    title = '';
  }
  if (!url || url === 'about:blank') {
    lastPicture = undefined;
    return { ok: true, summary: '浏览器还是空白页。先用打开网页。', url, title };
  }
  const read = await readPicture(view, url);
  const picture = read.picture;
  const snap = buildSnapView(lastPicture, picture);
  if (snap.mode === 'full' && read.hierarchy?.length) {
    snap.lines = read.hierarchy;
  }
  lastPicture = picture;
  const tree = snap.lines.join('\n');
  const base = {
    ok: true,
    summary: snap.mode === 'diff' ? '这是页面变化。用编号点击。' : '这是页面结构。用编号点击。',
    url,
    title,
    viewport: { width: view.clientWidth, height: view.clientHeight },
    tree,
  };
  if (!needsShot(picture, forceImage)) {
    return base;
  }
  const changed = picture.canvas || snap.mode === 'full' ? [] : snap.changed;
  const image = await shoot(view, picture, changed);
  if (!image) {
    return { ...base, summary: '结构不足以判断，画面也没有截下来。' };
  }
  return { ...base, summary: '结构不足以判断，附上画面。编号印在画面上。', image };
}

async function readPicture(view: WebViewEl, url: string): Promise<{ picture: PagePicture; hierarchy?: string[] }> {
  const fast = await readFastPicture(view, url);
  if (pictureHasMeaning(fast)) {
    lastBackends.clear();
    return { picture: fast };
  }
  const ax = await readAxTree(view, url);
  if (ax && ax.nodes.length) {
    lastBackends.clear();
    for (const node of ax.nodes) {
      if (node.backend) {
        lastBackends.set(node.ref, node.backend);
      }
    }
    return {
      picture: {
        url,
        nodes: ax.nodes,
        rows: fast.rows,
        canvas: false,
        flashes: fast.flashes,
        truncated: false,
        note: ax.note,
      },
      hierarchy: ax.lines,
    };
  }
  lastBackends.clear();
  return { picture: fast };
}

function pictureHasMeaning(picture: PagePicture): boolean {
  return picture.nodes.some((node) => node.role !== 'heading' && (node.name.trim() !== '' || node.hint.trim() !== ''));
}

async function readFastPicture(view: WebViewEl, url: string): Promise<PagePicture> {
  try {
    return parsePicture(url, await view.executeJavaScript(PAGE_SNAPSHOT_JS, true));
  } catch {
    return parsePicture(url, {});
  }
}

function refForBackend(url: string, backend: number): string {
  if (axUrl !== url) {
    axUrl = url;
    backendRefs.clear();
    backendSeq = 0;
  }
  const existing = backendRefs.get(backend);
  if (existing) {
    return existing;
  }
  backendSeq += 1;
  const ref = `e${backendSeq}`;
  backendRefs.set(backend, ref);
  return ref;
}

async function readAxTree(view: WebViewEl, url: string): Promise<{ nodes: SnapControl[]; lines: string[]; note: string } | undefined> {
  const guestId = view.getWebContentsId?.();
  const cdp = dockCdp();
  if (!cdp || typeof guestId !== 'number') {
    return undefined;
  }
  try {
    await cdp(guestId, 'Accessibility.enable', {});
    let raw = await cdp(guestId, 'Accessibility.getFullAXTree', { depth: 14 });
    if (cdpFailed(raw)) {
      raw = await cdp(guestId, 'Accessibility.getFullAXTree', {});
    }
    if (cdpFailed(raw)) {
      return undefined;
    }
    const tree = formatAxTree(raw, (backend) => refForBackend(url, backend));
    return tree.nodes.length ? tree : undefined;
  } catch {
    return undefined;
  }
}

function cdpFailed(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && 'error' in raw && !('nodes' in raw);
}

function dockCdp(): ((webContentsId: number, method: string, params?: unknown) => Promise<unknown>) | undefined {
  const api = (window as unknown as {
    opengrok?: { cdp?: (webContentsId: number, method: string, params?: unknown) => Promise<unknown> };
  }).opengrok;
  return api?.cdp;
}

const AX_CLICK_JS = `function() {
  this.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = this.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const owns = (node, target) => !!node && !!target && (node === target || node.contains(target) || target.contains(node));
  if (hit && !owns(this, hit)) {
    const label = (hit.getAttribute && (hit.getAttribute('aria-label') || hit.getAttribute('title'))) || '';
    const text = label || (hit.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    return { ok: false, covered: text || hit.tagName };
  }
  try { this.focus(); } catch (e) {}
  if (typeof this.click === 'function') this.click();
  return { ok: true };
}`;

async function actOnBackend(view: WebViewEl, backend: number, kind: 'click' | 'focus'): Promise<'done' | 'fallback' | string> {
  const guestId = view.getWebContentsId?.();
  const cdp = dockCdp();
  if (!cdp || typeof guestId !== 'number') {
    return 'fallback';
  }
  try {
    const resolved = (await cdp(guestId, 'DOM.resolveNode', { backendNodeId: backend })) as {
      object?: { objectId?: string };
    };
    const objectId = resolved?.object?.objectId;
    if (!objectId) {
      return '找不到这个控件了。重新看一次页面。';
    }
    const called = (await cdp(guestId, 'Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      userGesture: true,
      functionDeclaration: kind === 'click' ? AX_CLICK_JS : 'function() { try { this.focus(); } catch (e) {} return { ok: true }; }',
    })) as { result?: { value?: { ok?: boolean; covered?: string } } };
    const value = called?.result?.value;
    if (value?.ok === true) {
      return 'done';
    }
    if (value?.covered) {
      return `这个控件被「${value.covered}」挡住了。先处理挡住它的那一层。`;
    }
    return '点下去没有生效。重新看一次页面。';
  } catch {
    return 'fallback';
  }
}

async function shoot(
  view: WebViewEl,
  picture: PagePicture,
  changed: SnapControl[],
): Promise<Record<string, unknown> | undefined> {
  const viewport = { width: view.clientWidth || 1, height: view.clientHeight || 1 };
  const crop = cropRect(changed, viewport);
  const marks = crop ? picture.nodes.filter((node) => intersects(node, crop)) : picture.nodes;
  try {
    if (marks.some((node) => node.role !== 'heading')) {
      await view.executeJavaScript(stampScript(marks), true);
    }
    const image = crop ? await view.capturePage(crop) : await view.capturePage();
    const size = image.getSize();
    const long = Math.max(size.width, size.height);
    const scaled = long > 640 ? image.resize(size.width >= size.height ? { width: 640 } : { height: 640 }) : image;
    const out = scaled.getSize();
    lastShot = {
      width: out.width || 1,
      height: out.height || 1,
      cssX: crop?.x ?? 0,
      cssY: crop?.y ?? 0,
      cssW: crop?.width ?? viewport.width,
      cssH: crop?.height ?? viewport.height,
    };
    return {
      width: out.width,
      height: out.height,
      mimeType: 'image/jpeg',
      data: bytesToBase64(scaled.toJPEG(60)),
    };
  } catch {
    return undefined;
  } finally {
    try {
      await view.executeJavaScript(CLEAR_STAMP_JS, true);
    } catch {
      // The overlay has pointer-events:none. The next stamp removes it.
    }
  }
}

function intersects(node: SnapControl, rect: { x: number; y: number; width: number; height: number }): boolean {
  return node.x < rect.x + rect.width && node.x + node.w > rect.x && node.y < rect.y + rect.height && node.y + node.h > rect.y;
}

async function ensureWatch(view: WebViewEl): Promise<void> {
  try {
    await view.executeJavaScript(ENSURE_WATCH_JS, true);
  } catch {
    // The next snapshot installs the same watcher.
  }
}

async function settleView(view: WebViewEl): Promise<void> {
  try {
    await view.executeJavaScript(SETTLE_JS, true);
  } catch {
    await wait(150);
  }
}

async function clickBrowser(view: WebViewEl, req: BrowserReq): Promise<{ ref: string; role: string } | undefined> {
  view.focus();
  const ref = req.ref?.trim();
  if (ref) {
    const known = controlByRef(lastPicture, ref);
    await activateRef(view, ref, 'click');
    return { ref, role: known?.role ?? '' };
  }
  if (req.selector) {
    const point = (await view.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(req.selector)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      true,
    )) as { x?: number; y?: number } | null;
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
      throw new Error(`找不到 ${req.selector}`);
    }
    await pointerPath(view, [point as { x: number; y: number }]);
    return undefined;
  }
  if (typeof req.x !== 'number' || typeof req.y !== 'number') {
    throw new Error('点击需要编号 ref。没有编号时用截图上的 x、y，或一个 selector');
  }
  await pointerPath(view, [toCss(view, req.x, req.y)]);
  return undefined;
}

async function activateRef(view: WebViewEl, ref: string, kind: 'click' | 'focus'): Promise<void> {
  const backend = lastBackends.get(ref);
  if (backend) {
    const acted = await actOnBackend(view, backend, kind);
    if (acted === 'done') {
      return;
    }
    if (acted !== 'fallback') {
      throw new Error(acted);
    }
  }
  const known = controlByRef(lastPicture, ref);
  const script = kind === 'click'
    ? clickTargetScript(ref, known?.role ?? '', known?.name ?? '')
    : focusTargetScript(ref, known?.role ?? '', known?.name ?? '');
  let hit = { ok: false, ambiguous: false };
  try {
    hit = asHit(await view.executeJavaScript(script, true));
  } catch {
    // A navigation can destroy the guest before the script result comes back.
    return;
  }
  if (hit.ambiguous) {
    const label = known?.name ? `「${known.name}」` : ref;
    throw new Error(`有多个${label}，编号 ${ref} 已失效。重新看一次页面。`);
  }
  if (!hit.ok) {
    throw new Error(`找不到 ${ref}。重新看一次页面。`);
  }
}

function asHit(raw: unknown): { ok: boolean; ambiguous: boolean } {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, ambiguous: false };
  }
  const obj = raw as Record<string, unknown>;
  return { ok: obj['ok'] === true, ambiguous: obj['ambiguous'] === true };
}

function toCss(view: WebViewEl, x: number, y: number): { x: number; y: number } {
  const cssW = lastShot.cssW || view.clientWidth || 1;
  const cssH = lastShot.cssH || view.clientHeight || 1;
  return {
    x: Math.round(lastShot.cssX + (x / lastShot.width) * cssW),
    y: Math.round(lastShot.cssY + (y / lastShot.height) * cssH),
  };
}

function wantImage(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function mouseClick(view: WebViewEl, x: number, y: number): void {
  view.sendInputEvent({ type: 'mouseMove', x, y, movementX: 0, movementY: 0 });
  view.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  view.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

async function dragBrowser(view: WebViewEl, req: BrowserReq): Promise<void> {
  const x1 = num(req.x1);
  const y1 = num(req.y1);
  const x2 = num(req.x2);
  const y2 = num(req.y2);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    throw new Error('拖拽需要截图上的 x1,y1 和 x2,y2');
  }
  const from = toCss(view, x1, y1);
  const to = toCss(view, x2, y2);
  const steps = 10;
  const points = [from];
  for (let i = 1; i <= steps; i += 1) {
    points.push({
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
    });
  }
  await pointerPath(view, points);
}

async function pointerPath(view: WebViewEl, points: Array<{ x: number; y: number }>): Promise<void> {
  view.focus();
  const script = `(() => {
    const pts = ${JSON.stringify(points)};
    const first = pts[0];
    const target = document.querySelector('canvas') || document.elementFromPoint(first.x, first.y) || document.body;
    const fire = (type, p, buttons) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: p.x, clientY: p.y, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true
      }));
    };
    return new Promise((resolve) => {
      fire('pointerdown', first, 1);
      let i = 1;
      const step = () => {
        if (i >= pts.length) {
          fire('pointerup', pts[pts.length - 1], 0);
          resolve(true);
          return;
        }
        fire('pointermove', pts[i], 1);
        i += 1;
        requestAnimationFrame(step);
      };
      if (pts.length === 1) {
        fire('pointerup', first, 0);
        resolve(true);
        return;
      }
      requestAnimationFrame(step);
    });
  })()`;
  try {
    await view.executeJavaScript(script, true);
  } catch {
    const last = points[points.length - 1] ?? points[0];
    if (!last || !points[0]) {
      return;
    }
    mouseClick(view, last.x, last.y);
  }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function typeBrowser(
  view: WebViewEl,
  text: string,
  selector?: string,
  ref?: string,
  append = false,
): Promise<void> {
  view.focus();
  const target = ref?.trim();
  const role = target ? (controlByRef(lastPicture, target)?.role ?? '') : '';
  if (target) {
    await activateRef(view, target, 'focus');
  } else if (selector) {
    const found = await view.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return true; })()`,
      true,
    );
    if (!found) {
      throw new Error(`找不到 ${selector}`);
    }
  }
  if (shouldClearBeforeType(role, append) || (!append && !role)) {
    try {
      await view.executeJavaScript(CLEAR_FIELD_JS, true);
    } catch {
      // A field that cannot be cleared still receives the keystrokes.
    }
  }
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') {
      pressBrowser(view, 'Enter');
      continue;
    }
    const keyCode = ch.toUpperCase();
    view.sendInputEvent({ type: 'keyDown', keyCode });
    view.sendInputEvent({ type: 'char', keyCode: ch });
    view.sendInputEvent({ type: 'keyUp', keyCode });
  }
}

function pressBrowser(view: WebViewEl, key: string): void {
  const keyCode = electronKey(key);
  if (!keyCode) {
    throw new Error('缺少键名');
  }
  view.focus();
  view.sendInputEvent({ type: 'keyDown', keyCode });
  if (keyCode.length === 1) {
    view.sendInputEvent({ type: 'char', keyCode: key.trim() });
  }
  view.sendInputEvent({ type: 'keyUp', keyCode });
}

function electronKey(key: string): string {
  const raw = key.trim();
  const mapped: Record<string, string> = {
    enter: 'Return',
    return: 'Return',
    space: 'Space',
    ' ': 'Space',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    backspace: 'Backspace',
    up: 'Up',
    arrowup: 'Up',
    down: 'Down',
    arrowdown: 'Down',
    left: 'Left',
    arrowleft: 'Left',
    right: 'Right',
    arrowright: 'Right',
  };
  return mapped[raw.toLowerCase()] ?? (raw.length === 1 ? raw.toUpperCase() : raw);
}

function scrollBrowser(view: WebViewEl, dx: number, dy: number): void {
  view.sendInputEvent({
    type: 'mouseWheel',
    x: Math.round(view.clientWidth / 2),
    y: Math.round(view.clientHeight / 2),
    deltaX: Math.round(dx),
    deltaY: Math.round(dy || 240),
    canScroll: true,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(text);
}

function guest(): WebViewEl | undefined {
  const node = document.querySelector('.og-dock-pane:not([hidden]) .og-dock-webview');
  return node instanceof HTMLElement ? (node as WebViewEl) : undefined;
}

function toggleDevTools(): void {
  const view = guest();
  if (!view) {
    return;
  }
  if (view.isDevToolsOpened()) {
    view.closeDevTools();
  } else {
    view.openDevTools();
  }
}

function pageTitle(href: string): string {
  if (!href || href === 'about:blank') {
    return tr('dockBrowser');
  }
  try {
    return new URL(href).hostname || href;
  } catch {
    return href;
  }
}

function browserHref(raw: string): string {
  const text = raw.trim();
  if (!text || text === 'about:blank') {
    return '';
  }
  return /^[a-z]+:/i.test(text) ? text : `https://${text}`;
}

function navigate(raw: string): void {
  const view = guest();
  const href = browserHref(raw);
  if (!view || !href) {
    return;
  }
  view.hidden = false;
  view.closest('.og-dock-frame')?.querySelector<HTMLElement>('.og-dock-blank')?.setAttribute('hidden', '');
  view.src = href;
}

function iconButton(icon: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'og-dock-mini';
  btn.innerHTML = icon;
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return btn;
}

function chevronLeftIcon(): string {
  return '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8 10 12.5"/></svg>';
}

function chevronRightIcon(): string {
  return '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>';
}

function reloadIcon(): string {
  return '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M12.8 2.6V5.4H10"/></svg>';
}

function externalIcon(): string {
  return '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 3.6H3.8A1.2 1.2 0 0 0 2.6 4.8v7.4a1.2 1.2 0 0 0 1.2 1.2h7.4a1.2 1.2 0 0 0 1.2-1.2V9.8"/><path d="M8.6 2.6h4.8V7.4"/><path d="M13.1 2.9 7.4 8.6"/></svg>';
}

function sparkIcon(): string {
  return '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 1.8 9.1 6.1 13.4 8 9.1 9.9 8 14.2 6.9 9.9 2.6 8 6.9 6.1z"/></svg>';
}

function moreIcon(): string {
  return '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor"><circle cx="3.4" cy="8" r="1.15"/><circle cx="8" cy="8" r="1.15"/><circle cx="12.6" cy="8" r="1.15"/></svg>';
}

function globeMark(): string {
  return '<svg viewBox="0 0 16 16" width="46" height="46" fill="none" stroke="currentColor" stroke-width="1.05"><circle cx="8" cy="8" r="5.7"/><path d="M2.4 8h11.2M8 2.3c1.7 1.8 2.6 3.7 2.6 5.7s-.9 3.9-2.6 5.7c-1.7-1.8-2.6-3.7-2.6-5.7s.9-3.9 2.6-5.7z"/></svg>';
}

function focusTerm(): void {
  window.requestAnimationFrame(() => {
    fitTerm();
    xterm?.focus();
  });
}

function hookTerm(): void {
  if (termHooked) {
    return;
  }
  termHooked = true;
  hostApi()?.onTerm?.((data) => ensureTerm().write(data));
}

async function startShell(): Promise<void> {
  const term = ensureTerm();
  term.reset();
  termCols = 0;
  termRows = 0;
  fitTerm();
  const cwd = ui.state.workspacePath;
  const result = await hostApi()?.termStart?.({
    shellId,
    cwd,
    cols: term.cols || 80,
    rows: term.rows || 24,
  });
  if (result && !result.ok) {
    term.write(`\r\n${result.error ?? '无法启动命令行'}\r\n`);
    return false;
  }
  return true;
}
