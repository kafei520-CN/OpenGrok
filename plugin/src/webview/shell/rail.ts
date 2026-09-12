import { displayUsagePercent } from '../../billing/billing';
import type { SessionRow } from '../../core/types';
import { post, tr, ui } from '../app';
import {
  iconBack,
  iconChevron,
  iconEdit,
  iconFolder,
  iconGear,
  iconGrid,
  iconPlug,
  iconSearch,
  iconSun,
} from '../icons';
import { listedSessions, sessionButton } from './sessions';
import { closeDesktopReview, reviewBack, reviewNav, reviewOpen } from './reviewStage';
import { openDeskTab, settingsNavItems } from './settingsStage';
import { escapeHtml } from '../transcript/markdown';

type RailPage = 'chat' | 'dashboard' | 'plugins' | 'config';

let railQuery = '';

export function patchRail(parent: HTMLElement): void {
  const next = railKey();
  let el = document.getElementById('og-rail');
  if (!el) {
    el = document.createElement('aside');
    el.id = 'og-rail';
    parent.prepend(el);
  }
  const active = document.activeElement;
  const keepSearch =
    active instanceof HTMLInputElement &&
    (active.classList.contains('og-search') || active.classList.contains('og-set-search'));
  const caret = keepSearch ? active.selectionStart : null;
  if (el.dataset.key === next) {
    return;
  }
  el.dataset.key = next;
  el.replaceChildren();
  el.classList.remove('og-rail-dash');
  if (ui.state.settingsOpen) {
    el.append(settingsBack(), settingsSearch(), settingsNav());
  } else if (reviewOpen()) {
    el.append(reviewBack(), reviewNav());
  } else {
    el.append(brand(), newChat(), nav(), projects(), recents(), footer());
    applyRailFilter();
  }
  if (keepSearch) {
    const input = el.querySelector<HTMLInputElement>('.og-search, .og-set-search');
    input?.focus();
    if (input && caret != null) {
      input.setSelectionRange(caret, caret);
    }
  }
}

function railKey(): string {
  const sessions = listedSessions()
    .slice(0, 24)
    .map((row) => `${row.id}:${row.title}:${row.updatedAt}`)
    .join('|');
  return [
    ui.state.locale ?? 'en',
    ui.state.status ?? '',
    ui.state.settingsOpen ? `set:${ui.deskTab}:${ui.state.settingsPage ?? 'main'}` : 'chat',
    ui.review ? `rev:${ui.review.active ?? 'all'}:${(ui.review.files ?? []).length}` : '',
    ui.state.drawer ?? '',
    (ui.state.roster ?? []).map((row) => `${row.id}:${row.activity}:${row.title}`).join('|'),
    (ui.state.subagents ?? []).map((row) => row.id).join('|'),
    ui.state.currentSessionId ?? '',
    ui.state.workspacePath ?? '',
    ui.state.account?.email ?? '',
    String(ui.state.billing?.usagePercent ?? ''),
    ui.state.billing?.periodEnd ?? '',
    sessions,
  ].join('~');
}

function brand(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-brand';
  const mark = document.createElement('img');
  mark.className = ui.state.status === 'streaming' ? 'og-logo pulse' : 'og-logo';
  mark.src = '../resources/logo.png';
  mark.alt = '';
  const copy = document.createElement('div');
  copy.className = 'og-brand-copy';
  const name = document.createElement('strong');
  name.textContent = tr('appName');
  copy.append(name);
  el.append(mark, copy);
  if (ui.state.settingsOpen) {
    el.classList.add('og-brand-back');
    el.title = tr('settingsTitle');
    el.addEventListener('click', () => post({ type: 'closeSettings' }));
  }
  return el;
}

let setQuery = '';

function settingsBack(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'og-set-back';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Esc';
  btn.innerHTML = `${iconBack()}<span>${escapeHtml(tr('setBackApp'))}</span>`;
  btn.addEventListener('click', () => post({ type: 'closeSettings' }));
  const chord = document.createElement('span');
  chord.className = 'og-set-chord';
  chord.textContent = 'Ctrl ,';
  row.append(btn, chord);
  return row;
}

function settingsSearch(): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'og-search-wrap';
  wrap.innerHTML = iconSearch();
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'og-search og-set-search';
  input.placeholder = tr('setSearch');
  input.value = setQuery;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    setQuery = input.value;
    applySettingsFilter();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      event.stopPropagation();
      setQuery = '';
      input.value = '';
      applySettingsFilter();
    }
  });
  wrap.append(input);
  return wrap;
}

function settingsNav(): HTMLElement {
  const el = document.createElement('nav');
  el.className = 'og-nav og-set-rail-nav';
  const current = ui.deskTab === 'models' ? 'account' : ui.deskTab;
  const groups: Array<{ id: 'person' | 'system'; label: string }> = [
    { id: 'person', label: tr('setGroupPerson') },
    { id: 'system', label: tr('setGroupSystem') },
  ];
  for (const group of groups) {
    const kicker = document.createElement('div');
    kicker.className = 'og-kicker';
    kicker.dataset.group = group.id;
    kicker.textContent = group.label;
    el.append(kicker);
    for (const item of settingsNavItems().filter((row) => row.group === group.id)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = item.id === current ? 'og-nav-item on' : 'og-nav-item';
      btn.dataset.label = item.label;
      btn.innerHTML = `${item.icon}<span>${escapeHtml(item.label)}</span>`;
      btn.addEventListener('click', () => openDeskTab(item.id));
      el.append(btn);
    }
  }
  queueMicrotask(() => applySettingsFilter());
  return el;
}

function applySettingsFilter(): void {
  const q = setQuery.trim().toLowerCase();
  const nav = document.querySelector('#og-rail .og-set-rail-nav');
  if (!nav) {
    return;
  }
  let kicker: HTMLElement | undefined;
  let shown = false;
  const flush = () => {
    if (kicker) {
      kicker.hidden = Boolean(q) && !shown;
    }
  };
  for (const child of Array.from(nav.children) as HTMLElement[]) {
    if (child.classList.contains('og-kicker')) {
      flush();
      kicker = child;
      shown = false;
      continue;
    }
    const hide = Boolean(q) && !(child.dataset.label ?? '').toLowerCase().includes(q);
    child.hidden = hide;
    if (!hide) {
      shown = true;
    }
  }
  flush();
}

function newChat(): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'og-new';
  btn.title = tr('shortcutNew');
  btn.innerHTML = `${iconEdit()}<span>${escapeHtml(tr('newSession'))}</span>`;
  btn.addEventListener('click', () => {
    post({ type: 'closeSettings' });
    post({ type: 'closeDrawer' });
    ui.wantFocus = true;
    post({ type: 'newSession' });
  });
  return btn;
}

function nav(): HTMLElement {
  const el = document.createElement('nav');
  el.className = 'og-nav';
  const page = activePage();
  const items: Array<{ id: RailPage; label: string; icon: string; run: () => void }> = [
    {
      id: 'plugins',
      label: tr('railPlugins'),
      icon: iconPlug(),
      run: () => {
        ui.deskTab = 'extensions';
        post({ type: 'openExt' });
      },
    },
    {
      id: 'dashboard',
      label: tr('menuDashboard'),
      icon: iconGrid(),
      run: () => {
        if (ui.state.drawer === 'dashboard') {
          post({ type: 'closeDrawer' });
        } else {
          post({ type: 'openDrawer', drawer: 'dashboard' });
        }
      },
    },
  ];
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = item.id === page ? 'og-nav-item on' : 'og-nav-item';
    btn.title = item.label;
    btn.innerHTML = `${item.icon}<span>${escapeHtml(item.label)}</span>`;
    btn.addEventListener('click', item.run);
    el.append(btn);
  }
  return el;
}

function projects(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-section';
  const label = document.createElement('div');
  label.className = 'og-kicker';
  label.textContent = tr('railProject');
  el.append(label);
  const project = document.createElement('button');
  project.type = 'button';
  const folder = ui.state.workspacePath?.trim();
  project.className = folder ? 'og-project on' : 'og-project';
  const name = folder ? folder.replace(/\\/g, '/').split('/').filter(Boolean).pop() : '';
  project.innerHTML = `${iconFolder()}<span>${escapeHtml(name || tr('railNoProject'))}</span>`;
  project.title = folder || tr('railPickProject');
  project.addEventListener('click', () => post({ type: 'pickProject' }));
  el.append(project);
  return el;
}

function recents(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-recents';
  const label = document.createElement('div');
  label.className = 'og-kicker';
  label.textContent = tr('recent');
  el.append(label, searchField());
  const rows = listedSessions().slice(0, 24);
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'og-empty';
    empty.textContent = tr('sessionsEmpty');
    el.append(empty);
    return el;
  }
  const list = document.createElement('div');
  list.className = 'og-session-list';
  for (const row of rows) {
    list.append(compactSession(row));
  }
  const miss = document.createElement('p');
  miss.id = 'og-search-empty';
  miss.className = 'og-empty';
  miss.hidden = true;
  miss.textContent = tr('railSearchEmpty');
  el.append(list, miss);
  return el;
}

function searchField(): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'og-search-wrap';
  wrap.innerHTML = iconSearch();
  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'og-search';
  input.placeholder = tr('railSearch');
  input.title = tr('shortcutFind');
  input.value = railQuery;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    railQuery = input.value;
    applyRailFilter();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && input.value) {
      event.stopPropagation();
      railQuery = '';
      input.value = '';
      applyRailFilter();
    }
  });
  wrap.append(input);
  return wrap;
}

function applyRailFilter(): void {
  const q = railQuery.trim().toLowerCase();
  let visible = 0;
  for (const row of document.querySelectorAll<HTMLElement>('#og-rail .og-session')) {
    const title = row.querySelector('.session-title')?.textContent?.toLowerCase() ?? '';
    const hide = Boolean(q) && !title.includes(q);
    row.hidden = hide;
    if (!hide) {
      visible += 1;
    }
  }
  const empty = document.getElementById('og-search-empty');
  if (empty) {
    empty.hidden = !q || visible > 0;
  }
}

function compactSession(row: SessionRow): HTMLElement {
  const item = sessionButton(row);
  item.classList.add('og-session');
  return item;
}

let accountMenuOpen = false;
let accountMenuBound = false;

function bindAccountMenuDismiss(): void {
  if (accountMenuBound) {
    return;
  }
  accountMenuBound = true;
  document.addEventListener('click', () => {
    if (!accountMenuOpen) {
      return;
    }
    accountMenuOpen = false;
    document.getElementById('og-account-menu')?.remove();
  });
}

function footer(): HTMLElement {
  bindAccountMenuDismiss();
  const el = document.createElement('div');
  el.className = 'og-footer';
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = accountMenuOpen ? 'og-account on' : 'og-account';
  chip.title = tr('setAccount');
  const avatar = document.createElement('img');
  avatar.className = 'og-account-avatar';
  avatar.src = '../resources/logo.png';
  avatar.alt = '';
  const name = document.createElement('span');
  name.className = 'og-account-name';
  name.textContent = accountLabel();
  chip.append(avatar, name);
  const left = quotaLeft();
  if (left !== undefined) {
    const meter = document.createElement('span');
    meter.className = 'og-quota';
    meter.textContent = `${left}%`;
    chip.append(meter);
  }
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    accountMenuOpen = !accountMenuOpen;
    document.getElementById('og-account-menu')?.remove();
    if (accountMenuOpen) {
      post({ type: 'refreshBilling' });
      el.append(accountMenu());
    }
  });
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'og-gear';
  gear.title = tr('shortcutSettings');
  gear.setAttribute('aria-label', tr('menuSettings'));
  gear.innerHTML = iconGear();
  gear.addEventListener('click', (event) => {
    event.stopPropagation();
    accountMenuOpen = false;
    openDeskTab('agent');
  });
  el.append(chip, gear);
  if (accountMenuOpen) {
    el.append(accountMenu());
  }
  return el;
}

function accountLabel(): string {
  const first = ui.state.account?.firstName?.trim();
  const last = ui.state.account?.lastName?.trim();
  const joined = [first, last].filter(Boolean).join(' ');
  if (joined) {
    return joined;
  }
  const email = ui.state.account?.email?.trim();
  if (email) {
    return email.split('@')[0] ?? email;
  }
  return tr('loginGrok');
}

function quotaLeft(): number | undefined {
  const used = ui.state.billing?.usagePercent;
  if (typeof used !== 'number' || !Number.isFinite(used)) {
    return undefined;
  }
  return Math.max(0, 100 - displayUsagePercent(used));
}

function shortReset(iso?: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function accountMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.id = 'og-account-menu';
  menu.className = 'og-account-menu';
  menu.addEventListener('click', (event) => event.stopPropagation());
  const quota = ui.state.billing;
  if (quota && Number.isFinite(quota.usagePercent)) {
    const used = displayUsagePercent(quota.usagePercent);
    const left = Math.max(0, 100 - used);
    const block = document.createElement('div');
    block.className = 'og-account-quota';
    const head = document.createElement('div');
    head.className = 'og-account-quota-head';
    const title = document.createElement('strong');
    title.textContent = quota.subscriptionTier?.trim() || tr('setQuota');
    const when = shortReset(quota.periodEnd);
    if (when) {
      const time = document.createElement('span');
      time.textContent = when;
      head.append(title, time);
    } else {
      head.append(title);
    }
    const row = document.createElement('div');
    row.className = 'og-account-quota-row';
    const bar = document.createElement('div');
    bar.className = 'og-quota-bar';
    const fill = document.createElement('i');
    fill.style.width = `${used}%`;
    bar.append(fill);
    const pct = document.createElement('span');
    pct.textContent = `${left}%`;
    row.append(bar, pct);
    block.append(head, row);
    menu.append(block);
  }
  menu.append(menuItem(iconSun(), tr('setThemeMenu'), () => openDeskTab('appearance'), true));
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'og-account-logout';
  logout.textContent = tr('settingsLogout');
  logout.addEventListener('click', () => {
    accountMenuOpen = false;
    post({ type: 'logout' });
  });
  menu.append(logout);
  return menu;
}

function menuItem(icon: string, label: string, run: () => void, chevron = false): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'og-account-item';
  btn.innerHTML = `${icon}<span>${escapeHtml(label)}</span>${chevron ? iconChevron() : ''}`;
  btn.addEventListener('click', () => {
    accountMenuOpen = false;
    run();
  });
  return btn;
}

function activePage(): RailPage {
  if (ui.state.drawer === 'dashboard') {
    return 'dashboard';
  }
  if (!ui.state.settingsOpen) {
    return 'chat';
  }
  if (ui.state.settingsPage === 'extensions') {
    return 'plugins';
  }
  return 'config';
}
