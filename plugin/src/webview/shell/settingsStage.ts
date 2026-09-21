import { displayUsagePercent } from '../../billing/billing';
import {
  formatCompactCount,
  formatDurationLong,
  groupHeatmapWeeks,
  heatmapLevel,
  parseYmd,
  summarizeHeatmap,
  type HeatmapDay,
} from '../../billing/heatmapStats';
import { DEFAULT_SETTINGS, type SettingsPage } from '../../core/types';
import {
  applyThemeTo,
  contrastFg,
  DEFAULT_DESKTOP_THEME,
  lockContrastEnabled,
  parseHex,
} from '../../settings/theme';
import {
  DEFAULT_CHROME_BLUR,
  DEFAULT_GLASS_BLUR,
  DEFAULT_GLASS_OPACITY,
  DEFAULT_WALLPAPER_OPACITY,
  MAX_GLASS_BLUR,
} from '../../settings/wallpaper';
import { SURFACES, getSurface, surfaceKind, type SurfaceId } from '../../settings/surfaces';
import { isDesktop, loc, type DeskTab, post, render, tr, ui } from '../app';
import { applyAvatar } from './avatar';
import { button } from '../dom';
import { escapeHtml } from '../transcript/markdown';
import {
  iconChat,
  iconChip,
  iconClock,
  iconEdit,
  iconGear,
  iconInfo,
  iconPerson,
  iconPet,
  iconPlug,
} from '../icons';
import { mountCronBody } from '../settings/cron';
import { mountApiFormBody, mountApisBody } from '../settings/api';
import { mountAgentsBody } from '../settings/agents';
import { mountExtBody } from '../settings/ext';
import { mountOgPluginsBody } from '../settings/ogPlugins';
import { mountMcpsBody } from '../settings/mcps';
import { mountMemoryBody } from '../settings/memory';
import { mountRemoteBody } from '../settings/remote';
import { mountRulesBody } from '../settings/rules';
import { mountSkillsBody } from '../settings/skills';
import { mountThemePreview } from '../settings/themePreview';
import { mountWorktreesBody } from '../settings/worktrees';
import {
  PET_COLORS,
  PET_COLOR_SWATCH,
  PET_FACES,
  PET_SHAPES,
  PET_SIZES,
} from '../../../../desktop/pet/identity';
import { petMarkPreview } from '../pet/preview';

export function patchSettingsStage(parent: HTMLElement): void {
  const existing = document.getElementById('og-settings');
  if (!ui.state.settingsOpen) {
    existing?.remove();
    return;
  }
  const tab = syncTab();
  const key = stageKey(tab);
  if (existing?.dataset.key === key) {
    return;
  }
  const next = mountStage(tab);
  next.dataset.key = key;
  if (existing) {
    existing.replaceWith(next);
  } else {
    parent.append(next);
  }
}

function syncTab(): DeskTab {
  if (ui.deskTab === 'models' || ui.deskTab === 'extensions' || ui.deskTab === 'remote') {
    const fromPage = tabFromPage(ui.state.settingsPage);
    if (fromPage) {
      ui.deskTab = fromPage;
    }
  }
  return ui.deskTab;
}

function tabFromPage(page?: SettingsPage): DeskTab | undefined {
  switch (page) {
    case 'theme':
    case 'theme-preview':
      return 'appearance';
    case 'apis':
    case 'api-form':
      return 'models';
    case 'remote':
      return 'remote';
    case 'cron':
      return 'cron';
    case 'og-plugins':
    case 'extensions':
    case 'mcps':
    case 'skills':
    case 'rules':
    case 'memory':
    case 'worktrees':
    case 'agents':
      return 'extensions';
    default:
      return undefined;
  }
}

function stageKey(tab: DeskTab): string {
  return [
    tab,
    ui.state.locale ?? 'en',
    ui.state.settingsPage ?? 'main',
    ui.state.status ?? '',
    ui.state.account?.email ?? '',
    String(ui.state.billing?.usagePercent ?? ''),
    ui.state.billing?.subscriptionTier ?? '',
    ui.state.billing?.periodEnd ?? '',
    String(ui.state.heatmap?.length ?? 0),
    String(ui.state.heatmapLoading ?? false),
    ui.heatGranularity,
    ui.state.apiEditId ?? '',
    ui.state.extTab ?? '',
    (ui.state.plugins ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.ogPlugins ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.apis ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.models?.available ?? []).map((row) => row.id).join('|'),
    ui.state.models?.currentId ?? '',
    (ui.state.mcps ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    ui.state.theme?.background ?? '',
    ui.state.theme?.primary ?? '',
    ui.state.theme?.surface ?? '',
    ui.state.theme?.fontColor ?? '',
    String(ui.state.theme?.lockContrast ?? ''),
    ui.state.theme?.wallpaper ?? '',
    ui.state.theme?.wallpaperUrl ?? '',
    String(ui.state.theme?.wallpaperOpacity ?? ''),
    JSON.stringify(ui.state.settings ?? {}),
    String(ui.state.compactMode),
    String(ui.state.timestamps),
    String(ui.pet.enabled),
    ui.pet.color,
    ui.pet.shape,
    ui.pet.eyeColor,
    ui.pet.expression,
    String(ui.pet.bubbles),
    String(ui.pet.size),
    ui.petTab,
    (ui.state.cronJobs ?? []).map((job) => `${job.id}:${job.enabled}:${job.nextRunAt ?? ''}`).join('|'),
    remoteKey(ui.state.remote),
  ].join('~');
}

function remoteKey(remote: typeof ui.state.remote): string {
  if (!remote) {
    return '';
  }
  return [
    remote.running,
    remote.local,
    remote.public,
    remote.codeMode,
    remote.relayKind,
    remote.port,
    remote.bind,
    remote.clients,
    remote.tunnel,
    remote.publicUrl ?? '',
    remote.code,
    remote.error ?? '',
    remote.hasRelayKey,
  ].join('|');
}

function mountStage(tab: DeskTab): HTMLElement {
  const el = document.createElement('section');
  el.id = 'og-settings';
  if (ui.state.settingsPage === 'theme-preview') {
    el.className = 'og-settings wp-editor';
    el.append(mountThemePreview());
    return el;
  }
  el.append(pane(tab));
  return el;
}

export type SettingsNavItem = {
  id: DeskTab;
  label: string;
  icon: string;
  group: 'person' | 'system';
};

export function settingsNavItems(): SettingsNavItem[] {
  return [
    { id: 'agent', label: tr('setGeneral'), icon: iconGear(), group: 'person' },
    { id: 'cron', label: tr('cronTitle'), icon: iconClock(), group: 'person' },
    { id: 'appearance', label: tr('setAppearance'), icon: iconEdit(), group: 'person' },
    { id: 'pet', label: tr('petTitle'), icon: iconPet(), group: 'person' },
    { id: 'account', label: tr('setAccount'), icon: iconPerson(), group: 'person' },
    { id: 'extensions', label: tr('setExt'), icon: iconPlug(), group: 'system' },
    { id: 'cli', label: tr('setCli'), icon: iconChip(), group: 'system' },
    { id: 'remote', label: tr('setRemote'), icon: iconChat(), group: 'system' },
    { id: 'about', label: tr('setAbout'), icon: iconInfo(), group: 'system' },
  ];
}

export function settingsTabs(): Array<{ id: DeskTab; label: string }> {
  return settingsNavItems().map(({ id, label }) => ({ id, label }));
}

export function openDeskTab(tab: DeskTab): void {
  ui.deskTab = tab;
  ui.review = undefined;
  if (tab === 'models') {
    post({ type: 'openApis' });
    return;
  }
  if (tab === 'extensions') {
    post({ type: 'openOgPlugins' });
    return;
  }
  if (tab === 'remote') {
    post({ type: 'openRemote' });
    return;
  }
  if (!ui.state.settingsOpen) {
    post({ type: 'openSettings' });
    return;
  }
  render();
}

function pane(tab: DeskTab): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-pane';
  el.append(stackedDeck(tab));
  return el;
}

type DeckPage = {
  id: string;
  label: string;
  body: () => HTMLElement;
  open?: () => void;
};

function stackedDeck(tab: DeskTab): HTMLElement {
  const pages = deckPages(tab);
  const activeId = activeDeckId(tab, pages);
  const front = pages.find((row) => row.id === activeId) ?? pages[0];
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
    btn.addEventListener('click', () => {
      if (page.id === front.id) {
        return;
      }
      if (page.open) {
        page.open();
        return;
      }
      render();
    });
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
  sheet.className = 'og-deck-sheet';
  const body = document.createElement('div');
  body.className = 'og-set-body';
  body.append(front.body());
  sheet.append(body);
  const stack = document.createElement('div');
  stack.className = 'og-deck-stack';
  stack.append(layers, sheet);
  deck.append(tabs, stack);
  return deck;
}

function activeDeckId(tab: DeskTab, pages: DeckPage[]): string {
  if (tab === 'models') {
    return 'providers';
  }
  if (tab === 'extensions') {
    const page = ui.state.settingsPage;
    if (!page || page === 'main') {
      return 'og-plugins';
    }
    return page;
  }
  if (tab === 'pet') {
    return ui.petTab;
  }
  return pages[0]?.id ?? '';
}

function deckPages(tab: DeskTab): DeckPage[] {
  switch (tab) {
    case 'account':
    case 'models':
      return [
        {
          id: 'official',
          label: tr('setOfficial'),
          body: () => officialAccountBody(),
          open: () => openDeskTab('account'),
        },
        {
          id: 'providers',
          label: tr('setProviders'),
          body: () =>
            wrapBody(ui.state.settingsPage === 'api-form' ? mountApiFormBody() : mountApisBody()),
          open: () => openDeskTab('models'),
        },
      ];
    case 'extensions':
      return extensionPages();
    case 'appearance':
      return [{ id: 'appearance', label: tr('setAppearance'), body: () => appearancePane() }];
    case 'pet':
      return [
        { id: 'look', label: tr('petLook'), body: () => petLookPane(), open: () => { ui.petTab = 'look'; render(); } },
        { id: 'bubbles', label: tr('petBubbles'), body: () => petBubblesPane(), open: () => { ui.petTab = 'bubbles'; render(); } },
      ];
    case 'agent':
      return [{ id: 'agent', label: tr('setGeneral'), body: () => generalPane() }];
    case 'cron':
      return [{ id: 'cron', label: tr('cronTitle'), body: () => wrapBody(mountCronBody()) }];
    case 'cli':
      return [{ id: 'cli', label: tr('setCli'), body: () => cliPane() }];
    case 'remote':
      return [{ id: 'remote', label: tr('setRemote'), body: () => wrapBody(mountRemoteBody()) }];
    default:
      return [{ id: 'about', label: tr('setAbout'), body: () => aboutPane() }];
  }
}

function extensionPages(): DeckPage[] {
  const items: Array<{ id: string; label: string; open: () => void }> = [
    { id: 'og-plugins', label: tr('ogPlugins'), open: () => post({ type: 'openOgPlugins' }) },
    { id: 'extensions', label: tr('settingsPlugins'), open: () => post({ type: 'openExt' }) },
    { id: 'mcps', label: tr('railMcps'), open: () => post({ type: 'openMcps' }) },
    { id: 'skills', label: tr('settingsSkills'), open: () => post({ type: 'openSkills' }) },
    { id: 'rules', label: tr('settingsRules'), open: () => post({ type: 'openRules' }) },
    { id: 'memory', label: tr('railMemory'), open: () => post({ type: 'openMemory' }) },
    { id: 'worktrees', label: tr('railWorktrees'), open: () => post({ type: 'openWorktrees' }) },
    { id: 'agents', label: tr('settingsAgents'), open: () => post({ type: 'openAgents' }) },
  ];
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    open: item.open,
    body: () => wrapBody(extensionBody(item.id as SettingsPage)),
  }));
}

function officialAccountBody(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-stack';
  el.append(p(tr('setAccountHint')), profileCard());
  const quota = quotaCard();
  if (quota) {
    el.append(quota);
  }
  el.append(heatmapCard());
  return el;
}

function heatmapCard(): HTMLElement {
  const zh = loc() === 'zh-CN';
  const days = ui.state.heatmap ?? [];
  const wrap = document.createElement('div');
  wrap.className = 'og-heat';
  const head = document.createElement('div');
  head.className = 'og-heat-head';
  const title = document.createElement('strong');
  title.textContent = tr('heatTitle');
  head.append(title, heatSeg());
  wrap.append(head);
  if (ui.state.heatmapLoading && !days.some((row) => row.tokens > 0 || row.requests > 0)) {
    wrap.append(p(tr('heatLoading')));
    return wrap;
  }
  const stats = summarizeHeatmap(days, ui.state.heatmapLongestSecs ?? 0);
  wrap.append(heatStats(stats, zh));
  const cells = heatCells(days, ui.heatGranularity);
  if (!cells.some((row) => row.value > 0)) {
    wrap.append(p(tr('heatEmpty')));
    return wrap;
  }
  wrap.append(heatGrid(cells, zh));
  return wrap;
}

function heatSeg(): HTMLElement {
  const current = ui.heatGranularity;
  return seg(
    [
      ['day', tr('heatDay')],
      ['week', tr('heatWeek')],
      ['cumul', tr('heatCumul')],
    ],
    current,
    (value) => {
      ui.heatGranularity = value as 'day' | 'week' | 'cumul';
      render();
    },
  );
}

function heatStats(
  stats: ReturnType<typeof summarizeHeatmap>,
  zh: boolean,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'og-heat-stats';
  const items: Array<[string, string]> = [
    [tr('heatTotal'), formatCompactCount(stats.totalTokens, zh)],
    [tr('heatPeak'), formatCompactCount(stats.peakTokens, zh)],
    [tr('heatLongest'), formatDurationLong(stats.longestSecs, zh)],
    [tr('heatStreak'), tr('heatDays', { n: stats.currentStreak })],
    [tr('heatLongestStreak'), tr('heatDays', { n: stats.longestStreak })],
  ];
  for (const [label, value] of items) {
    const cell = document.createElement('div');
    cell.className = 'og-heat-stat';
    const num = document.createElement('strong');
    num.textContent = value;
    const name = document.createElement('span');
    name.textContent = label;
    cell.append(num, name);
    row.append(cell);
  }
  return row;
}

type HeatCell = { date: string; label: string; value: number; requests: number };

function heatCells(days: HeatmapDay[], mode: 'day' | 'week' | 'cumul'): HeatCell[] {
  if (mode === 'week') {
    return groupHeatmapWeeks(days).map((week) => ({
      date: week.start,
      label: `${week.start} – ${week.end}`,
      value: week.tokens,
      requests: week.requests,
    }));
  }
  let run = 0;
  return days.map((row) => {
    run += row.tokens;
    return {
      date: row.date,
      label: row.date,
      value: mode === 'cumul' ? run : row.tokens,
      requests: row.requests,
    };
  });
}

function heatGrid(cells: HeatCell[], zh: boolean): HTMLElement {
  const max = Math.max(1, ...cells.map((row) => row.value));
  const box = document.createElement('div');
  box.className = 'og-heat-board';
  const months = document.createElement('div');
  months.className = 'og-heat-months';
  const grid = document.createElement('div');
  grid.className = ui.heatGranularity === 'week' ? 'og-heat-grid week' : 'og-heat-grid';
  const first = parseYmd(cells[0]?.date ?? '');
  if (ui.heatGranularity !== 'week' && first) {
    for (let i = 0; i < first.getDay(); i += 1) {
      const pad = document.createElement('span');
      pad.className = 'og-heat-cell lv0';
      grid.append(pad);
    }
  }
  let lastMonth = '';
  for (const cell of cells) {
    const date = parseYmd(cell.date);
    const month = date ? `${date.getMonth() + 1}` : '';
    if (month && month !== lastMonth) {
      const tag = document.createElement('span');
      tag.textContent = zh ? `${month}月` : cell.date.slice(5, 7);
      months.append(tag);
      lastMonth = month;
    }
    const btn = document.createElement('span');
    btn.className = `og-heat-cell lv${heatmapLevel(cell.value, max)}`;
    btn.title = tr('heatTip', {
      date: cell.label,
      tokens: formatCompactCount(cell.value, zh),
      sessions: cell.requests,
    });
    grid.append(btn);
  }
  const legend = document.createElement('div');
  legend.className = 'og-heat-legend';
  const less = document.createElement('span');
  less.textContent = tr('heatLess');
  const more = document.createElement('span');
  more.textContent = tr('heatMore');
  legend.append(less);
  for (const level of [0, 1, 2, 3, 4]) {
    const swatch = document.createElement('i');
    swatch.className = `lv${level}`;
    legend.append(swatch);
  }
  legend.append(more);
  box.append(months, grid, legend);
  return box;
}

function profileCard(): HTMLElement {
  const email = ui.state.account?.email?.trim();
  const name = displayName(email);
  const top = document.createElement('div');
  top.className = 'og-profile';
  const avatar = document.createElement('img');
  avatar.className = 'og-avatar';
  avatar.alt = '';
  applyAvatar(avatar, ui.state.account?.avatarUrl);
  const copy = document.createElement('div');
  copy.className = 'og-profile-copy';
  const who = document.createElement('strong');
  who.textContent = name;
  copy.append(who);
  if (email) {
    const mail = document.createElement('span');
    mail.textContent = email;
    copy.append(mail);
  }
  const tools = document.createElement('div');
  tools.className = 'og-profile-actions';
  if (email) {
    tools.append(
      button(tr('setSwitchAccount'), () => post({ type: 'login' })),
      button(tr('settingsLogout'), () => post({ type: 'logout' })),
    );
  } else {
    tools.append(button(tr('loginGrok'), () => post({ type: 'login' }), true));
  }
  top.append(avatar, copy, tools);
  return card('', [top]);
}

function displayName(email?: string): string {
  const first = ui.state.account?.firstName?.trim();
  const last = ui.state.account?.lastName?.trim();
  const joined = [first, last].filter(Boolean).join(' ');
  if (joined) {
    return joined;
  }
  if (email) {
    return email.split('@')[0] ?? email;
  }
  return tr('setSignedOut');
}

function quotaCard(): HTMLElement | undefined {
  const quota = ui.state.billing;
  if (!quota || !Number.isFinite(quota.usagePercent)) {
    return undefined;
  }
  const used = displayUsagePercent(quota.usagePercent);
  const left = Math.max(0, 100 - used);
  const box = document.createElement('div');
  box.className = 'og-quota-block';
  const head = document.createElement('div');
  head.className = 'og-quota-head';
  const title = document.createElement('strong');
  title.textContent = quota.subscriptionTier?.trim() || tr('setQuota');
  const remain = document.createElement('span');
  remain.textContent = tr('setQuotaLeft', { n: left });
  head.append(title, remain);
  const bar = document.createElement('div');
  bar.className = 'og-quota-bar';
  const fill = document.createElement('i');
  fill.style.width = `${used}%`;
  bar.append(fill);
  const meta = document.createElement('div');
  meta.className = 'og-quota-meta';
  const bits = [tr('setQuotaUsed', { n: used })];
  const when = shortReset(quota.periodEnd);
  if (when) {
    bits.push(tr('setQuotaReset', { when }));
  }
  const info = document.createElement('span');
  info.textContent = bits.join(' · ');
  meta.append(info);
  const product = quota.products[0];
  if (product) {
    const chip = document.createElement('span');
    chip.className = 'og-quota-chip';
    chip.textContent = `${product.label} ${displayUsagePercent(product.usagePercent)}%`;
    meta.append(chip);
  }
  const links = document.createElement('div');
  links.className = 'og-quota-links';
  links.append(
    linkBtn(tr('setQuotaWeb'), 'https://grok.com/?_s=usage'),
    linkBtn(tr('setQuotaManage'), 'https://grok.com/supergrok'),
  );
  box.append(head, bar, meta, links);
  return card('', [box]);
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

function linkBtn(label: string, url: string): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'og-text-link';
  btn.textContent = label;
  btn.addEventListener('click', () => post({ type: 'openUrl', url }));
  return btn;
}

function appearancePane(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-stack';
  const glass = currentSurface() === 'glass';
  const theme = ui.state.theme;
  el.append(
    card(tr('setStyle'), [
      styleTiles(),
      rangeRow(
        tr('themeGlassOpacity'),
        0,
        100,
        theme?.glassOpacity ?? DEFAULT_GLASS_OPACITY,
        '%',
        !glass,
        (n, persist) => {
          if (persist) {
            commitAppearance({ glassOpacity: n });
          } else {
            previewGlass({ glassOpacity: n });
          }
        },
      ),
      rangeRow(
        tr('themeGlassBlur'),
        0,
        MAX_GLASS_BLUR,
        theme?.glassBlur ?? DEFAULT_GLASS_BLUR,
        '%',
        !glass,
        (n, persist) => {
          if (persist) {
            commitAppearance({ glassBlur: n });
          } else {
            previewGlass({ glassBlur: n });
          }
        },
      ),
      rangeRow(
        tr('themeChromeBlur'),
        0,
        MAX_GLASS_BLUR,
        theme?.chromeBlur ?? DEFAULT_CHROME_BLUR,
        '%',
        !glass,
        (n, persist) => {
          if (persist) {
            commitAppearance({ chromeBlur: n });
          } else {
            previewGlass({ chromeBlur: n });
          }
        },
      ),
    ]),
    card(tr('setColors'), [
      p(tr('setMainColorHint')),
      colorRow(tr('setMainColor'), themeBg(), (hex, persist) => {
        if (persist) {
          commitAppearance({ background: hex });
        } else {
          previewAppearance(hex, followPrimary(hex));
        }
      }),
      colorRow(tr('setAccent'), themePrimary(), (hex, persist) => {
        if (persist) {
          commitAppearance({ primary: hex });
        } else {
          previewAppearance(themeBg(), hex);
        }
      }),
      colorRow(tr('themeFontColor'), themeFont(), (hex, persist) => {
        if (persist) {
          commitAppearance({ fontColor: hex, lockContrast: false });
        } else {
          previewGlass({ fontColor: hex, lockContrast: false });
        }
      }),
      toggle(
        tr('themeLockContrast'),
        tr('themeLockContrastHint'),
        lockContrastEnabled(theme ?? {}),
        () =>
          commitAppearance({
            lockContrast: !lockContrastEnabled(theme ?? {}),
          }),
      ),
      swatches(themeBg()),
      actions([button(tr('themeResetDefault'), () => resetAppearance())]),
    ]),
    card(tr('themeWallpaper'), [
      p(tr('themeWallpaperHint')),
      actions([
        button(tr('themeWallpaperPick'), () => post({ type: 'pickThemeWallpaper' })),
        button(tr('themeWallpaperClear'), () => commitAppearance({ wallpaper: '' })),
        (() => {
          const preview = button(tr('themePreviewOpen'), () => post({ type: 'openThemePreview' }));
          preview.disabled = !theme?.wallpaper;
          return preview;
        })(),
      ]),
      rangeRow(
        tr('themeWallpaperOpacity'),
        0,
        100,
        theme?.wallpaperOpacity ?? DEFAULT_WALLPAPER_OPACITY,
        '%',
        !theme?.wallpaper,
        (n, persist) => {
          if (persist) {
            commitAppearance({ wallpaperOpacity: n });
          } else {
            previewGlass({ wallpaperOpacity: n });
          }
        },
      ),
    ]),
  );
  return el;
}

function petLookPane(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pet-look';
  const bar = document.createElement('div');
  bar.className = 'pet-look__toolbar';
  bar.append(
    toggle(tr('petEnable'), tr('petHint'), ui.pet.enabled, () => {
      ui.pet = { ...ui.pet, enabled: !ui.pet.enabled };
      post({ type: 'petConfig', enabled: ui.pet.enabled });
    }),
  );
  const sizes = document.createElement('div');
  sizes.className = 'pet-look__toolbar-item';
  sizes.append(
    seg(
      PET_SIZES.map((n) => [String(n), n === 96 ? tr('petSizeSm') : n === 160 ? tr('petSizeLg') : tr('petSizeMd')]),
      String(ui.pet.size),
      (value) => {
        ui.pet = { ...ui.pet, size: Number(value) };
        post({ type: 'petConfig', size: Number(value) });
      },
    ),
  );
  bar.append(sizes);
  const body = document.createElement('div');
  body.className = 'pet-look__body';
  const preview = document.createElement('div');
  preview.className = 'pet-look__preview';
  preview.append(petMarkPreview({ shape: ui.pet.shape, color: ui.pet.color, size: 96 }));
  const fields = document.createElement('div');
  fields.className = 'pet-look__fields';
  fields.append(
    petGrid(
      tr('petShape'),
      PET_SHAPES,
      ui.pet.shape,
      (shape) => {
        ui.pet = { ...ui.pet, shape };
        post({ type: 'petConfig', shape });
      },
      (shape) => petMarkPreview({ shape, color: ui.pet.color, size: 26 }),
    ),
    petGrid(
      tr('petExpression'),
      PET_FACES,
      ui.pet.expression,
      (expression) => {
        ui.pet = { ...ui.pet, expression };
        post({ type: 'petConfig', expression });
      },
      (expression) => petMarkPreview({ shape: ui.pet.shape, color: ui.pet.color, size: 26 }),
    ),
    petColorGrid(),
  );
  body.append(preview, fields);
  el.append(bar, body);
  return el;
}

function petBubblesPane(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-stack';
  el.append(
    card(tr('petBubbles'), [
      toggle(tr('petBubblesOn'), tr('petBubblesHint'), ui.pet.bubbles, () => {
        ui.pet = { ...ui.pet, bubbles: !ui.pet.bubbles };
        post({ type: 'petConfig', bubbles: ui.pet.bubbles });
      }),
    ]),
  );
  return el;
}

function petGrid(
  label: string,
  ids: readonly string[],
  current: string,
  pick: (id: string) => void,
  thumb: (id: string) => HTMLElement,
): HTMLElement {
  const field = document.createElement('div');
  field.className = 'pet-look__field';
  const name = document.createElement('div');
  name.className = 'pet-look__field-label';
  name.textContent = label;
  const grid = document.createElement('div');
  grid.className = 'pet-settings-grid';
  for (const id of ids) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = id === current ? 'pet-settings-grid__btn is-on' : 'pet-settings-grid__btn';
    btn.title =
      id === 'star'
        ? tr('petShapeStar')
        : id === 'mark'
          ? tr('petShapeMark')
          : id === 'orb'
            ? tr('petShapeOrb')
            : id === 'anime'
              ? tr('petShapeAnime')
              : id === 'pixel'
                ? tr('petShapePixel')
                : id === 'adult'
                  ? tr('petShapeAdult')
                  : id;
    btn.append(thumb(id));
    btn.addEventListener('click', () => pick(id));
    grid.append(btn);
  }
  field.append(name, grid);
  return field;
}

function petColorGrid(): HTMLElement {
  const field = document.createElement('div');
  field.className = 'pet-look__field';
  const name = document.createElement('div');
  name.className = 'pet-look__field-label';
  name.textContent = tr('petColor');
  const grid = document.createElement('div');
  grid.className = 'pet-settings-grid';
  for (const id of PET_COLORS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = id === ui.pet.color ? 'pet-settings-grid__btn is-on' : 'pet-settings-grid__btn';
    const sw = document.createElement('span');
    sw.className = id === 'paper' ? 'pet-settings-swatch pet-settings-swatch--light' : 'pet-settings-swatch';
    sw.style.background = PET_COLOR_SWATCH[id].value;
    btn.append(sw);
    btn.addEventListener('click', () => {
      ui.pet = { ...ui.pet, color: id };
      post({ type: 'petConfig', color: id });
    });
    grid.append(btn);
  }
  field.append(name, grid);
  return field;
}



function generalPane(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-stack';
  el.append(
    card(tr('settingsUi'), [
      toggle(tr('settingsCompact'), tr('settingsCompactHint'), Boolean(ui.state.compactMode), () =>
        post({ type: 'toggleFlag', flag: 'compactMode' }),
      ),
      toggle(tr('settingsTimestamps'), tr('settingsTimestampsHint'), Boolean(ui.state.timestamps), () =>
        post({ type: 'toggleFlag', flag: 'timestamps' }),
      ),
      toggle(
        tr('settingsNotify'),
        tr('settingsNotifyHint'),
        ui.state.settings?.notifySound !== false,
        () =>
          post({
            type: 'updateSetting',
            key: 'notifySound',
            value: !(ui.state.settings?.notifySound !== false),
          }),
      ),
    ]),
    card(tr('settingsLang'), [
      seg(
        [
          ['auto', tr('settingsLangAuto')],
          ['en', tr('settingsLangEn')],
          ['zh-CN', tr('settingsLangZh')],
        ],
        settings().locale,
        (value) => post({ type: 'updateSetting', key: 'locale', value }),
      ),
    ]),
    card(tr('settingsPermission'), [
      seg(
        [
          ['ask', tr('settingsPermissionAsk')],
          ['acceptEdits', tr('settingsPermissionEdits')],
          ['auto', tr('settingsPermissionAuto')],
        ],
        settings().permissionMode,
        (value) => post({ type: 'updateSetting', key: 'permissionMode', value }),
      ),
      toggle(
        tr('settingsAlways'),
        tr('settingsAlwaysHint'),
        Boolean(settings().alwaysApprove),
        () => post({ type: 'updateSetting', key: 'alwaysApprove', value: !settings().alwaysApprove }),
      ),
      toggle(
        tr('settingsTerminal'),
        tr('settingsTerminalHint'),
        Boolean(settings().useTerminal),
        () => post({ type: 'updateSetting', key: 'useTerminal', value: !settings().useTerminal }),
      ),
    ]),
  );
  return el;
}

function cliPane(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-stack';
  el.append(
    card(tr('settingsCli'), [
      line(tr('settingsCliPath'), settings().cliPath || 'grok'),
      actions([button(tr('settingsRestart'), () => post({ type: 'restart' }))]),
    ]),
  );
  return el;
}

function extensionBody(page?: SettingsPage): HTMLElement {
  switch (page) {
    case 'og-plugins':
      return mountOgPluginsBody();
    case 'mcps':
      return mountMcpsBody();
    case 'skills':
      return mountSkillsBody();
    case 'rules':
      return mountRulesBody();
    case 'memory':
      return mountMemoryBody();
    case 'worktrees':
      return mountWorktreesBody();
    case 'agents':
      return mountAgentsBody();
    default:
      return mountExtBody();
  }
}

function aboutPane(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-stack';
  const version = document.documentElement.dataset.version || '0.5.5';
  const hero = document.createElement('div');
  hero.className = 'og-about-hero';
  const logo = document.createElement('img');
  logo.className = 'og-about-logo';
  logo.src = '../resources/logo.png';
  logo.alt = '';
  const copy = document.createElement('div');
  copy.className = 'og-about-copy';
  const name = document.createElement('strong');
  name.textContent = tr('appName');
  const ver = document.createElement('span');
  ver.textContent = tr('setVersion', { v: version });
  copy.append(name, ver);
  if (ui.state.agentVersion) {
    const agent = document.createElement('span');
    agent.textContent = tr('settingsAgentVer', { version: ui.state.agentVersion });
    copy.append(agent);
  }
  hero.append(logo, copy);
  const blocks = [card('', [hero, p(tr('appTag')), p(tr('setUnofficial')), p(tr('setAboutLicense'))])];
  if (isDesktop()) {
    blocks.push(updateCard());
  }
  el.append(...blocks);
  return el;
}

type DeskUpdate = {
  kind: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'ready' | 'error' | 'dev';
  version?: string;
  current?: string;
  percent?: number;
  message?: string;
  auto: boolean;
  packaged: boolean;
};

function deskApi():
  | {
      updateState: () => Promise<DeskUpdate>;
      checkUpdate: () => Promise<DeskUpdate>;
      downloadUpdate: () => Promise<DeskUpdate>;
      installUpdate: () => Promise<void>;
      setAutoUpdate: (on: boolean) => Promise<DeskUpdate>;
      onUpdate: (handler: (state: DeskUpdate) => void) => void;
    }
  | undefined {
  return (window as unknown as { opengrok?: ReturnType<typeof deskApi> }).opengrok;
}

function updateStatusText(state: DeskUpdate): string {
  if (state.kind === 'checking') {
    return tr('updateChecking');
  }
  if (state.kind === 'available' && state.version) {
    return tr('updateAvailable', { v: state.version });
  }
  if (state.kind === 'downloading') {
    return tr('updateDownloading', { p: state.percent ?? 0 });
  }
  if (state.kind === 'ready' && state.version) {
    return tr('updateReady', { v: state.version });
  }
  if (state.kind === 'none') {
    return tr('updateLatest');
  }
  if (state.kind === 'dev') {
    return tr('updateDev');
  }
  if (state.kind === 'error') {
    return tr('updateFailed', { e: state.message || '' });
  }
  return tr('updateIdle');
}

function updateCard(): HTMLElement {
  const status = document.createElement('p');
  status.className = 'og-update-status';
  const check = button(tr('updateCheck'), () => {
    void deskApi()?.checkUpdate();
  });
  const install = button(tr('updateNow'), () => {
    void deskApi()?.installUpdate();
  });
  install.hidden = true;
  const download = button(tr('updateDownload'), () => {
    void deskApi()?.downloadUpdate();
  });
  download.hidden = true;
  const autoWrap = document.createElement('div');
  const paint = (state: DeskUpdate) => {
    status.textContent = updateStatusText(state);
    check.disabled = state.kind === 'checking' || state.kind === 'downloading';
    download.hidden = state.kind !== 'available';
    install.hidden = state.kind !== 'ready';
    autoWrap.replaceChildren(
      toggle(tr('updateAuto'), tr('updateAutoHint'), state.auto, () => {
        void deskApi()?.setAutoUpdate(!state.auto);
      }),
    );
  };
  autoWrap.replaceChildren(toggle(tr('updateAuto'), tr('updateAutoHint'), true, () => undefined));
  const api = deskApi();
  if (api) {
    api.onUpdate(paint);
    void api.updateState().then(paint);
  }
  return card(tr('updateTitle'), [status, autoWrap, actions([check, download, install])]);
}

const DEFAULT_BG = '#ffffff';
const DEFAULT_SECONDARY = '#737373';
const COLOR_SWATCHES = ['#ffffff', '#f4f4f4', '#e7e5e4', '#0f172a', '#000000'] as const;

function currentSurface(): SurfaceId {
  return surfaceKind(ui.state.theme?.surface) ?? 'glass';
}

function themeBg(): string {
  return parseHex(ui.state.theme?.background) ?? DEFAULT_BG;
}

function themePrimary(): string {
  return parseHex(ui.state.theme?.primary) ?? contrastFg(themeBg());
}

function themeFont(): string {
  return parseHex(ui.state.theme?.fontColor) ?? contrastFg(themeBg());
}

function followPrimary(background: string): string {
  const current = themePrimary();
  return current === contrastFg(themeBg()) ? contrastFg(background) : current;
}

function resetAppearance(): void {
  const def = DEFAULT_DESKTOP_THEME;
  post({
    type: 'setTheme',
    primary: def.primary,
    secondary: def.secondary ?? '#737373',
    background: def.background ?? '#ffffff',
    surface: def.surface ?? 'glass',
    chromeGlass: def.chromeGlass !== false,
    glassOpacity: def.glassOpacity ?? 100,
    glassBlur: def.glassBlur ?? DEFAULT_GLASS_BLUR,
    chromeBlur: def.chromeBlur ?? DEFAULT_CHROME_BLUR,
    wallpaper: '',
    wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
    fontPath: '',
    fontColor: def.fontColor ?? '',
    lockContrast: true,
  });
}

function commitAppearance(
  patch: {
    background?: string;
    primary?: string;
    surface?: SurfaceId;
    glassOpacity?: number;
    glassBlur?: number;
    chromeBlur?: number;
    wallpaper?: string;
    wallpaperOpacity?: number;
    fontColor?: string;
    lockContrast?: boolean;
  },
): void {
  const surface = patch.surface ?? currentSurface();
  const pack = getSurface(surface);
  const entering = Boolean(patch.surface && patch.surface !== currentSurface());
  const background =
    parseHex(patch.background) ??
    (entering && pack?.theme?.background ? pack.theme.background : themeBg());
  const primary =
    parseHex(patch.primary) ??
    (entering && pack?.theme?.primary ? pack.theme.primary : followPrimary(background));
  const secondary =
    entering && pack?.theme?.secondary
      ? pack.theme.secondary
      : parseHex(ui.state.theme?.secondary) ?? DEFAULT_SECONDARY;
  post({
    type: 'setTheme',
    primary,
    secondary,
    background,
    surface,
    chromeGlass: pack?.frost === true,
    glassOpacity: patch.glassOpacity,
    glassBlur: patch.glassBlur,
    chromeBlur: patch.chromeBlur,
    wallpaper: patch.wallpaper,
    wallpaperOpacity: patch.wallpaperOpacity,
    fontColor: patch.fontColor,
    lockContrast: patch.lockContrast,
  });
}

function previewGlass(patch: {
  glassOpacity?: number;
  glassBlur?: number;
  chromeBlur?: number;
  wallpaperOpacity?: number;
  fontColor?: string;
  lockContrast?: boolean;
}): void {
  applyThemeTo(
    document.documentElement.style,
    {
      ...ui.state.theme,
      ...patch,
      lockContrast: true,
    },
    ui.state.hostChrome,
  );
}

function previewAppearance(background: string, primary: string): void {
  applyThemeTo(
    document.documentElement.style,
    {
      ...ui.state.theme,
      background,
      primary,
      lockContrast: true,
    },
    ui.state.hostChrome,
  );
}

function styleTiles(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'og-theme-tiles';
  const current = currentSurface();
  for (const pack of SURFACES) {
    row.append(
      styleTile(tr(pack.appearanceKey), pack.tone, current === pack.id, () =>
        commitAppearance({ surface: pack.id }),
      ),
    );
  }
  return row;
}

function styleTile(label: string, tone: string, on: boolean, run: () => void): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = on ? 'og-theme-tile on' : 'og-theme-tile';
  btn.dataset.tone = tone;
  btn.innerHTML = `<span></span><em>${label}</em>`;
  btn.addEventListener('click', run);
  return btn;
}

function swatches(current: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'og-swatches';
  for (const hex of COLOR_SWATCHES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = current === hex ? 'og-swatch on' : 'og-swatch';
    btn.style.background = hex;
    btn.setAttribute('aria-label', hex);
    btn.addEventListener('click', () => commitAppearance({ background: hex }));
    row.append(btn);
  }
  return row;
}

function paintRangeFill(el: HTMLInputElement): void {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const val = Number(el.value);
  const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

function rangeRow(
  label: string,
  min: number,
  max: number,
  value: number,
  unit: string,
  disabled: boolean,
  onChange: (n: number, persist: boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'og-set-line theme-opacity-row';
  const name = document.createElement('span');
  name.textContent = label;
  const tools = document.createElement('div');
  tools.className = 'theme-opacity';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.value = String(value);
  slider.disabled = disabled;
  slider.setAttribute('aria-label', label);
  paintRangeFill(slider);
  const readout = document.createElement('span');
  readout.className = 'theme-opacity-value';
  readout.textContent = `${value}${unit}`;
  slider.addEventListener('input', () => {
    const n = Number(slider.value);
    readout.textContent = `${n}${unit}`;
    paintRangeFill(slider);
    onChange(n, false);
  });
  slider.addEventListener('change', () => onChange(Number(slider.value), true));
  tools.append(slider, readout);
  row.append(name, tools);
  return row;
}

function colorRow(
  label: string,
  value: string,
  onChange: (hex: string, persist: boolean) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'og-set-line theme-color-row';
  const name = document.createElement('span');
  name.textContent = label;
  const tools = document.createElement('div');
  tools.className = 'theme-picker';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = value;
  picker.setAttribute('aria-label', label);
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'settings-field theme-hex';
  hex.spellcheck = false;
  hex.maxLength = 7;
  hex.value = value;
  picker.addEventListener('input', () => {
    const next = parseHex(picker.value);
    if (!next) {
      return;
    }
    hex.value = next;
    onChange(next, false);
  });
  picker.addEventListener('change', () => {
    const next = parseHex(picker.value);
    if (next) {
      onChange(next, true);
    }
  });
  hex.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      hex.blur();
    }
  });
  hex.addEventListener('change', () => {
    const next = parseHex(hex.value);
    if (!next) {
      hex.value = picker.value;
      return;
    }
    picker.value = next;
    hex.value = next;
    onChange(next, true);
  });
  tools.append(picker, hex);
  row.append(name, tools);
  return row;
}

function wrapBody(node: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-embed';
  el.append(node);
  return el;
}

function card(title: string, children: HTMLElement[]): HTMLElement {
  const el = document.createElement('section');
  el.className = 'og-set-card';
  if (title) {
    const h = document.createElement('h3');
    h.textContent = title;
    el.append(h);
  }
  for (const child of children) {
    el.append(child);
  }
  return el;
}

function line(label: string, value: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-line';
  const k = document.createElement('span');
  k.textContent = label;
  const v = document.createElement('strong');
  v.textContent = value;
  el.append(k, v);
  return el;
}

function p(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'og-set-copy';
  el.textContent = text;
  return el;
}

function actions(nodes: HTMLElement[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-actions';
  for (const node of nodes) {
    el.append(node);
  }
  return el;
}

function toggle(label: string, hint: string, on: boolean, run: () => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'og-set-toggle';
  const copy = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = label;
  const help = document.createElement('span');
  help.textContent = hint;
  copy.append(name, help);
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = on ? 'switch on' : 'switch';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', on ? 'true' : 'false');
  const knob = document.createElement('span');
  knob.className = 'knob';
  sw.append(knob);
  sw.addEventListener('click', () => {
    const next = !sw.classList.contains('on');
    sw.classList.toggle('on', next);
    sw.setAttribute('aria-checked', next ? 'true' : 'false');
    run();
  });
  row.append(copy, sw);
  return row;
}

function seg(options: Array<[string, string]>, current: string, pick: (value: string) => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'og-set-seg';
  for (const [id, label] of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = id === current ? 'on' : '';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      if (id === current) {
        return;
      }
      for (const child of el.querySelectorAll('button')) {
        child.classList.toggle('on', child === btn);
      }
      pick(id);
    });
    el.append(btn);
  }
  return el;
}

function settings() {
  return ui.state.settings ?? DEFAULT_SETTINGS;
}
