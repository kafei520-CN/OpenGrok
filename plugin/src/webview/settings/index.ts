import {
  displayUsagePercent,
  formatQuotaReset,
  isOfficialGrokAccount,
  quotaTitle,
} from '../../billing/billing';
import { TERM_ENCODINGS, normalizeTermEncoding } from '../../terminal/termEncoding';
import { DEFAULT_SETTINGS, type GrokSettings, type WebviewToHost } from '../../core/types';
import { isDesktop, post, tr, ui } from '../app';
import { iconButton } from '../dom';
import { iconBack, iconClose, iconChevron, iconStar } from '../icons';
import { pinFloating, releaseByClass } from '../chrome/popover';
import { apisNavRow, mountApiFormBody, mountApisBody } from './api';
import { mountRulesBody, rulesNavRow } from './rules';
import { mountSkillsBody, skillsNavRow } from './skills';
import { mcpsNavRow, mountMcpsBody } from './mcps';
import { agentsNavRow, mountAgentsBody } from './agents';
import { extNavRow, mountExtBody } from './ext';
import { mountOgPluginsBody, ogPluginsNavRow } from './ogPlugins';
import { memoryNavRow, mountMemoryBody } from './memory';
import { mountWorktreesBody, worktreesNavRow } from './worktrees';
import { mountThemeBody, themeNavRow } from './theme';
import { mountThemePreview } from './themePreview';
import { mountRemoteBody, remoteNavRow } from './remote';
import { cronNavRow, mountCronBody } from './cron';

let paintedKey: string | undefined;

export function patchSettings(parent: HTMLElement): void {
  if (isDesktop()) {
    document.getElementById('grok-settings')?.remove();
    paintedKey = undefined;
    return;
  }
  const existing = document.getElementById('grok-settings');
  if (!ui.state.settingsOpen) {
    closeSettingsPicker();
    existing?.remove();
    paintedKey = undefined;
    return;
  }
  const key = [
    ui.state.locale ?? 'en',
    ui.state.settingsPage ?? 'main',
    ui.state.apiEditId ?? '',
    (ui.state.rules ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.skills ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.apis ?? []).map((row) => `${row.id}:${row.enabled ? '1' : '0'}`).join('|'),
    (ui.state.mcps ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.agents ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.personas ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    ui.state.agentProfile ?? '',
    ui.agentsTab,
    ui.state.extTab ?? '',
    (ui.state.worktrees ?? []).map((row) => row.id).join('|'),
    (ui.state.plugins ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.ogPlugins ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.hooks ?? []).map((row) => `${row.id}:${row.enabled}`).join('|'),
    (ui.state.marketplace ?? []).map((row) => row.id).join('|'),
    (ui.state.workflows ?? []).map((row) => row.id).join('|'),
    (ui.state.memoryFiles ?? []).map((row) => row.id).join('|'),
    (ui.state.cronJobs ?? []).map((row) => `${row.id}:${row.enabled}:${row.nextRunAt ?? ''}`).join('|'),
    `${ui.state.theme?.wallpaper ?? ''}|${ui.state.theme?.wallpaperUrl ?? ''}|${ui.state.theme?.surface ?? ''}|${ui.state.theme?.fontUrl ?? ''}|${ui.state.theme?.fontPath ?? ''}`,
    `${ui.state.remote?.running ? '1' : '0'}|${ui.state.remote?.local ? '1' : '0'}|${ui.state.remote?.public ? '1' : '0'}|${ui.state.remote?.port ?? ''}|${ui.state.remote?.code ?? ''}|${ui.state.remote?.codeMode ?? ''}|${ui.state.remote?.publicUrl ?? ''}|${ui.state.remote?.tunnel ?? ''}|${ui.state.remote?.tunnelError ?? ''}|${ui.state.remote?.tunnelHost ?? ''}|${ui.state.remote?.forwardPort ?? ''}|${ui.state.remote?.clients ?? 0}|${ui.state.remote?.error ?? ''}|${ui.state.remote?.sshPublicKey ?? ''}|${ui.state.remote?.bundledRelay ? '1' : '0'}|${ui.state.remote?.relayKind ?? ''}|${ui.state.remote?.relayPort ?? ''}|${ui.state.remote?.hasRelayKey ? '1' : '0'}`,
  ].join(':');
  if (!existing || paintedKey !== key) {
    closeSettingsPicker();
    existing?.remove();
    parent.append(mountSettings());
    paintedKey = key;
    return;
  }
  syncSettings(existing);
}

function mountSettings(): HTMLElement {
  const el = document.createElement('section');
  el.id = 'grok-settings';
  const page = ui.state.settingsPage ?? 'main';
  if (page === 'theme-preview') {
    el.className = 'settings wp-editor';
    el.append(mountThemePreview());
    return el;
  }
  el.className = 'settings';
  const head = document.createElement('header');
  head.className = 'settings-head';
  const brand = document.createElement('div');
  brand.className = 'brand';
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.innerHTML = iconStar();
  const title = document.createElement('span');
  title.textContent = settingsTitle(page);
  brand.append(mark, title);
  const tools = document.createElement('div');
  tools.className = 'settings-head-tools';
  if (
    page === 'rules' ||
    page === 'skills' ||
    page === 'apis' ||
    page === 'api-form' ||
    page === 'theme' ||
    page === 'mcps' ||
    page === 'agents' ||
    page === 'worktrees' ||
    page === 'extensions' ||
    page === 'og-plugins' ||
    page === 'memory' ||
    page === 'remote' ||
    page === 'cron'
  ) {
    tools.append(iconButton(tr('settingsRulesBack'), iconBack(), () => post(settingsBackMessage(page))));
  }
  tools.append(iconButton(tr('settingsClose'), iconClose(), () => post({ type: 'closeSettings' })));
  head.append(brand, tools);
  if (page === 'rules') {
    el.append(head, mountRulesBody());
    return el;
  }
  if (page === 'skills') {
    el.append(head, mountSkillsBody());
    return el;
  }
  if (page === 'apis') {
    el.append(head, mountApisBody());
    return el;
  }
  if (page === 'api-form') {
    el.append(head, mountApiFormBody());
    return el;
  }
  if (page === 'theme') {
    el.append(head, mountThemeBody());
    return el;
  }
  if (page === 'mcps') {
    el.append(head, mountMcpsBody());
    return el;
  }
  if (page === 'agents') {
    el.append(head, mountAgentsBody());
    return el;
  }
  if (page === 'worktrees') {
    el.append(head, mountWorktreesBody());
    return el;
  }
  if (page === 'extensions') {
    el.append(head, mountExtBody());
    return el;
  }
  if (page === 'og-plugins') {
    el.append(head, mountOgPluginsBody());
    return el;
  }
  if (page === 'memory') {
    el.append(head, mountMemoryBody());
    return el;
  }
  if (page === 'remote') {
    el.append(head, mountRemoteBody());
    return el;
  }
  if (page === 'cron') {
    el.append(head, mountCronBody());
    return el;
  }
  const body = document.createElement('div');
  body.className = 'settings-body';
  body.append(
    section(tr('settingsUi'), [
      themeNavRow(),
      cronNavRow(),
      remoteNavRow(),
      localeRow(),
      termEncodingRow(),
      toggleRow(
        'compactMode',
        tr('settingsCompact'),
        tr('settingsCompactHint'),
        () => Boolean(ui.state.compactMode),
        () => post({ type: 'toggleFlag', flag: 'compactMode' }),
      ),
      toggleRow(
        'multiline',
        tr('settingsMultiline'),
        tr('settingsMultilineHint'),
        () => Boolean(ui.state.multiline),
        () => post({ type: 'toggleFlag', flag: 'multiline' }),
      ),
      toggleRow(
        'timestamps',
        tr('settingsTimestamps'),
        tr('settingsTimestampsHint'),
        () => Boolean(ui.state.timestamps),
        () => post({ type: 'toggleFlag', flag: 'timestamps' }),
      ),
      toggleRow(
        'notifySound',
        tr('settingsNotify'),
        tr('settingsNotifyHint'),
        () => current().notifySound !== false,
        () =>
          post({
            type: 'updateSetting',
            key: 'notifySound',
            value: !(ui.state.settings?.notifySound !== false),
          }),
      ),
    ]),
    section(tr('settingsAgent'), [
      permissionRow(),
      toggleRow(
        'alwaysApprove',
        tr('settingsAlways'),
        tr('settingsAlwaysHint'),
        () => Boolean(current().alwaysApprove),
        () => post({ type: 'updateSetting', key: 'alwaysApprove', value: !current().alwaysApprove }),
      ),
      toggleRow(
        'useTerminal',
        tr('settingsTerminal'),
        tr('settingsTerminalHint'),
        () => Boolean(current().useTerminal),
        () => post({ type: 'updateSetting', key: 'useTerminal', value: !current().useTerminal }),
      ),
      toggleRow(
        'includeSelectionOnSend',
        tr('settingsSelection'),
        tr('settingsSelectionHint'),
        () => Boolean(current().includeSelectionOnSend),
        () =>
          post({
            type: 'updateSetting',
            key: 'includeSelectionOnSend',
            value: !current().includeSelectionOnSend,
          }),
      ),
      rulesNavRow(),
      skillsNavRow(),
      agentsNavRow(),
      worktreesNavRow(),
      ogPluginsNavRow(),
      extNavRow(),
      memoryNavRow(),
      mcpsNavRow(),
      apisNavRow(),
    ]),
    section(tr('settingsCli'), [
      textRow(
        'cliPath',
        tr('settingsCliPath'),
        tr('settingsCliPathHint'),
        () => current().cliPath,
      ),
      toggleRow(
        'preferWorkspaceBinary',
        tr('settingsPreferBin'),
        tr('settingsPreferBinHint'),
        () => Boolean(current().preferWorkspaceBinary),
        () =>
          post({
            type: 'updateSetting',
            key: 'preferWorkspaceBinary',
            value: !current().preferWorkspaceBinary,
          }),
      ),
      textRow(
        'minCliVersion',
        tr('settingsMinVer'),
        tr('settingsMinVerHint'),
        () => current().minCliVersion,
      ),
    ]),
    accountCard(),
    quotaCard(),
  );
  el.append(head, body);
  syncSettings(el);
  return el;
}

export function settingsBackMessage(page: string): WebviewToHost {
  switch (page) {
    case 'skills':
      return { type: 'closeSkills' };
    case 'api-form':
      return { type: 'closeApiForm' };
    case 'apis':
      return { type: 'closeApis' };
    case 'theme':
      return { type: 'closeTheme' };
    case 'remote':
      return { type: 'closeRemote' };
    case 'cron':
      return { type: 'closeCron' };
    case 'theme-preview':
      return { type: 'closeThemePreview' };
    case 'mcps':
      return { type: 'closeMcps' };
    case 'agents':
      return { type: 'closeAgents' };
    case 'worktrees':
      return { type: 'closeWorktrees' };
    case 'extensions':
      return { type: 'closeExt' };
    case 'og-plugins':
      return { type: 'closeSettings' };
    case 'memory':
      return { type: 'closeMemory' };
    case 'rules':
      return { type: 'closeRules' };
    default:
      return { type: 'closeSettings' };
  }
}

function settingsTitle(page: string): string {
  if (page === 'rules') {
    return tr('settingsRules');
  }
  if (page === 'skills') {
    return tr('settingsSkills');
  }
  if (page === 'apis') {
    return tr('settingsApis');
  }
  if (page === 'api-form') {
    return ui.state.apiEditId ? tr('settingsApisEdit') : tr('settingsApisAdd');
  }
  if (page === 'theme') {
    return tr('settingsTheme');
  }
  if (page === 'remote') {
    return tr('settingsRemote');
  }
  if (page === 'mcps') {
    return tr('settingsMcps');
  }
  if (page === 'agents') {
    return tr('settingsAgents');
  }
  if (page === 'worktrees') {
    return tr('settingsWorktrees');
  }
  if (page === 'extensions') {
    return tr('settingsExt');
  }
  if (page === 'og-plugins') {
    return tr('ogPlugins');
  }
  if (page === 'memory') {
    return tr('settingsMemory');
  }
  if (page === 'cron') {
    return tr('cronTitle');
  }
  return tr('settingsTitle');
}

function current(): GrokSettings {
  return ui.state.settings ?? DEFAULT_SETTINGS;
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'settings-block';
  const kicker = document.createElement('div');
  kicker.className = 'settings-kicker';
  kicker.textContent = title;
  const card = document.createElement('div');
  card.className = 'settings-card';
  for (const row of rows) {
    card.append(row);
  }
  wrap.append(kicker, card);
  return wrap;
}

function localeRow(): HTMLElement {
  return choiceRow(
    'locale',
    tr('settingsLang'),
    [
      ['auto', tr('settingsLangAuto')],
      ['en', tr('settingsLangEn')],
      ['zh-CN', tr('settingsLangZh')],
    ],
    () => current().locale,
    (value) => post({ type: 'updateSetting', key: 'locale', value }),
  );
}

function termEncodingRow(): HTMLElement {
  const selected = current().termEncoding ?? 'utf-8';
  const row = document.createElement('div');
  row.className = 'settings-row stack';
  row.dataset.key = 'termEncoding';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsTermEncoding');
  const wrap = document.createElement('div');
  wrap.className = 'picker settings-picker';
  wrap.addEventListener('click', (event) => event.stopPropagation());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'picker-btn';
  btn.dataset.field = 'termEncoding';
  btn.setAttribute('aria-haspopup', 'listbox');
  const text = document.createElement('span');
  text.className = 'picker-label';
  text.dataset.pickerLabel = 'termEncoding';
  text.textContent = termEncodingLabel(selected);
  btn.append(text);
  btn.insertAdjacentHTML('beforeend', iconChevron());
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleSettingsPicker(btn, encodingMenu(current().termEncoding ?? 'utf-8'));
  });
  wrap.append(btn);
  const help = document.createElement('div');
  help.className = 'settings-hint';
  help.textContent = tr('settingsTermEncodingHint');
  row.append(name, wrap, help);
  return row;
}

function encodingMenu(selected: string): HTMLElement {
  const list = document.createElement('div');
  list.className = 'picker-menu settings-picker-menu';
  list.setAttribute('role', 'listbox');
  list.addEventListener('click', (event) => event.stopPropagation());
  for (const id of TERM_ENCODINGS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = id === selected ? 'picker-item on' : 'picker-item';
    option.dataset.id = id;
    option.setAttribute('role', 'option');
    option.textContent = termEncodingLabel(id);
    option.addEventListener('click', () => {
      closeSettingsPicker();
      pickTermEncoding(id);
    });
    list.append(option);
  }
  return list;
}

function pickTermEncoding(id: string): void {
  const value = normalizeTermEncoding(id);
  const settings = { ...(ui.state.settings ?? DEFAULT_SETTINGS), termEncoding: value };
  ui.state.settings = settings;
  const label = document.querySelector('[data-picker-label="termEncoding"]');
  if (label) {
    label.textContent = termEncodingLabel(value);
  }
  post({ type: 'updateSetting', key: 'termEncoding', value });
}

export function closeSettingsPicker(): void {
  releaseByClass('settings-picker-menu');
  const btn = document.querySelector('.settings-picker .picker-btn.open');
  if (btn instanceof HTMLElement) {
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
}

function toggleSettingsPicker(btn: HTMLElement, menu: HTMLElement): void {
  const open = btn.classList.contains('open');
  closeSettingsPicker();
  if (open) {
    return;
  }
  btn.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  pinFloating(menu, btn, { prefer: 'below', align: 'start', matchWidth: true });
}

function termEncodingLabel(id: string): string {
  if (id === 'utf-8') {
    return 'UTF-8';
  }
  if (id === 'shift_jis') {
    return 'Shift_JIS';
  }
  if (id === 'windows-1252') {
    return 'Windows-1252';
  }
  if (id === 'iso-8859-1') {
    return 'ISO-8859-1';
  }
  return id.toUpperCase();
}

function permissionRow(): HTMLElement {
  return choiceRow(
    'permissionMode',
    tr('settingsPermission'),
    [
      ['ask', tr('settingsPermissionAsk')],
      ['acceptEdits', tr('settingsPermissionEdits')],
      ['auto', tr('settingsPermissionAuto')],
    ],
    () => current().permissionMode,
    (value) => post({ type: 'updateSetting', key: 'permissionMode', value }),
  );
}

function choiceRow(
  key: string,
  label: string,
  options: Array<[string, string]>,
  read: () => string,
  pick: (value: string) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row stack';
  row.dataset.key = key;
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = label;
  const seg = document.createElement('div');
  seg.className = 'seg settings-seg';
  for (const [id, text] of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = id;
    btn.textContent = text;
    btn.addEventListener('click', () => {
      if (read() !== id) {
        pick(id);
      }
    });
    seg.append(btn);
  }
  row.append(name, seg);
  return row;
}

function toggleRow(
  key: string,
  label: string,
  hint: string,
  read: () => boolean,
  toggle: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';
  row.dataset.key = key;
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = label;
  const help = document.createElement('div');
  help.className = 'settings-hint';
  help.textContent = hint;
  copy.append(name, help);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'switch';
  btn.setAttribute('role', 'switch');
  const knob = document.createElement('span');
  knob.className = 'knob';
  btn.append(knob);
  btn.addEventListener('click', toggle);
  row.append(copy, btn);
  return row;
}

function textRow(key: keyof GrokSettings, label: string, hint: string, read: () => string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row stack';
  row.dataset.key = key;
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'settings-field';
  input.dataset.field = key;
  input.value = read();
  input.addEventListener('change', () => {
    post({ type: 'updateSetting', key, value: input.value });
  });
  const help = document.createElement('div');
  help.className = 'settings-hint';
  help.dataset.hint = key;
  help.textContent = hint;
  row.append(name, input, help);
  return row;
}

function accountCard(): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'settings-block';
  const kicker = document.createElement('div');
  kicker.className = 'settings-kicker';
  kicker.textContent = tr('settingsAccount');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const status = document.createElement('div');
  status.className = 'settings-row stack';
  status.dataset.key = 'account';
  const label = document.createElement('div');
  label.className = 'settings-label';
  label.dataset.account = 'label';
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.dataset.account = 'hint';
  status.append(label, hint);
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const login = document.createElement('button');
  login.type = 'button';
  login.className = 'btn primary';
  login.dataset.account = 'login';
  login.textContent = tr('loginGrok');
  login.addEventListener('click', () => post({ type: 'login' }));
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'btn';
  logout.dataset.account = 'logout';
  logout.textContent = tr('settingsLogout');
  logout.addEventListener('click', () => post({ type: 'logout' }));
  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'btn';
  restart.textContent = tr('settingsRestart');
  restart.addEventListener('click', () => post({ type: 'restart' }));
  const restartHint = document.createElement('div');
  restartHint.className = 'settings-hint';
  restartHint.textContent = tr('settingsRestartHint');
  actions.append(login, logout, restart);
  card.append(status, actions, restartHint);
  wrap.append(kicker, card);
  return wrap;
}

function quotaCard(): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'settings-block';
  wrap.dataset.quota = 'wrap';
  wrap.hidden = true;
  const card = document.createElement('div');
  card.className = 'settings-card quota-card';
  const loading = document.createElement('div');
  loading.className = 'quota-loading';
  loading.dataset.quota = 'loading';
  const title = document.createElement('div');
  title.className = 'quota-title';
  title.dataset.quota = 'title';
  const used = document.createElement('div');
  used.className = 'quota-used';
  used.dataset.quota = 'used';
  const reset = document.createElement('div');
  reset.className = 'quota-reset';
  reset.dataset.quota = 'reset';
  const bar = document.createElement('div');
  bar.className = 'quota-bar';
  bar.dataset.quota = 'bar';
  const fill = document.createElement('span');
  fill.className = 'quota-fill';
  fill.dataset.quota = 'fill';
  bar.append(fill);
  const product = document.createElement('div');
  product.className = 'quota-product';
  product.dataset.quota = 'product';
  const productName = document.createElement('span');
  productName.dataset.quota = 'product-name';
  const productPct = document.createElement('strong');
  productPct.dataset.quota = 'product-pct';
  product.append(productName, productPct);
  card.append(loading, title, used, reset, bar, product);
  wrap.append(card);
  return wrap;
}

function syncSettings(root: HTMLElement): void {
  const settings = current();
  syncSwitch(root, 'compactMode', Boolean(ui.state.compactMode));
  syncSwitch(root, 'multiline', Boolean(ui.state.multiline));
  syncSwitch(root, 'timestamps', Boolean(ui.state.timestamps));
  syncSwitch(root, 'notifySound', settings.notifySound !== false);
  syncSwitch(root, 'alwaysApprove', settings.alwaysApprove);
  syncSwitch(root, 'useTerminal', settings.useTerminal);
  syncSwitch(root, 'includeSelectionOnSend', settings.includeSelectionOnSend);
  syncSwitch(root, 'preferWorkspaceBinary', settings.preferWorkspaceBinary);
  syncChoice(root, 'locale', settings.locale);
  syncChoice(root, 'permissionMode', settings.permissionMode);
  const encoding = settings.termEncoding ?? 'utf-8';
  const encodingLabel = root.querySelector('[data-picker-label="termEncoding"]');
  if (encodingLabel) {
    encodingLabel.textContent = termEncodingLabel(encoding);
  }
  syncField(root, 'cliPath', settings.cliPath);
  syncField(root, 'minCliVersion', settings.minCliVersion);
  const pathHint = root.querySelector('[data-hint="cliPath"]');
  if (pathHint) {
    pathHint.textContent = ui.state.cliPath
      ? `${tr('settingsCliPathHint')} ${tr('settingsCliCurrent', { path: ui.state.cliPath })}`
      : tr('settingsCliMissing');
  }
  const verHint = root.querySelector('[data-hint="minCliVersion"]');
  if (verHint) {
    verHint.textContent = tr('settingsMinVerHint');
  }
  const account = ui.state.account;
  const label = root.querySelector('[data-account="label"]');
  const hint = root.querySelector('[data-account="hint"]');
  const login = root.querySelector('[data-account="login"]') as HTMLButtonElement | null;
  const logout = root.querySelector('[data-account="logout"]') as HTMLButtonElement | null;
  const signedIn = Boolean(account?.email || account?.methodId);
  if (label) {
    label.textContent = signedIn
      ? tr('settingsSignedIn', {
          name: account?.email || account?.firstName || account?.methodId || 'Grok',
        })
      : tr('settingsSignedOut');
  }
  if (hint) {
    hint.textContent = ui.state.agentVersion
      ? tr('settingsAgentVer', { version: ui.state.agentVersion })
      : '';
  }
  if (login) {
    login.hidden = signedIn;
  }
  if (logout) {
    logout.hidden = !signedIn;
  }
  syncQuota(root);
}

function syncQuota(root: HTMLElement): void {
  const wrap = root.querySelector('[data-quota="wrap"]') as HTMLElement | null;
  if (!wrap) {
    return;
  }
  const official = isOfficialGrokAccount(ui.state.account);
  const quota = ui.state.billing;
  const loading = Boolean(ui.state.billingLoading) && !quota;
  if (!official || (!quota && !ui.state.billingLoading)) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const locale = ui.state.locale === 'zh-CN' ? 'zh-CN' : 'en';
  const loadingEl = wrap.querySelector('[data-quota="loading"]') as HTMLElement | null;
  const title = wrap.querySelector('[data-quota="title"]') as HTMLElement | null;
  const used = wrap.querySelector('[data-quota="used"]') as HTMLElement | null;
  const reset = wrap.querySelector('[data-quota="reset"]') as HTMLElement | null;
  const bar = wrap.querySelector('[data-quota="bar"]') as HTMLElement | null;
  const fill = wrap.querySelector('[data-quota="fill"]') as HTMLElement | null;
  const product = wrap.querySelector('[data-quota="product"]') as HTMLElement | null;
  const productName = wrap.querySelector('[data-quota="product-name"]') as HTMLElement | null;
  const productPct = wrap.querySelector('[data-quota="product-pct"]') as HTMLElement | null;
  if (loadingEl) {
    loadingEl.textContent = tr('quotaLoading');
    loadingEl.hidden = !loading;
  }
  if (!quota) {
    if (title) {
      title.hidden = true;
    }
    if (used) {
      used.hidden = true;
    }
    if (reset) {
      reset.hidden = true;
    }
    if (bar) {
      bar.hidden = true;
    }
    if (product) {
      product.hidden = true;
    }
    return;
  }
  const percent = displayUsagePercent(quota.usagePercent);
  if (title) {
    title.hidden = false;
    title.textContent = quotaTitle(locale, quota);
  }
  if (used) {
    used.hidden = false;
    used.textContent = tr('quotaUsed', { n: percent });
  }
  const resetText = formatQuotaReset(locale, quota.periodEnd);
  if (reset) {
    reset.hidden = !resetText;
    reset.textContent = resetText ? tr('quotaReset', { time: resetText }) : '';
  }
  if (bar) {
    bar.hidden = false;
    bar.classList.toggle('warn', percent >= 80 && percent < 100);
    bar.classList.toggle('hot', percent >= 100);
  }
  if (fill) {
    fill.style.width = `${percent}%`;
  }
  const row = quota.products[0];
  if (product) {
    product.hidden = !row;
  }
  if (row && productName && productPct) {
    productName.textContent = row.label;
    productPct.textContent = `${displayUsagePercent(row.usagePercent)}%`;
  }
}

function syncSwitch(root: HTMLElement, key: string, on: boolean): void {
  const btn = root.querySelector(`[data-key="${key}"] .switch`) as HTMLButtonElement | null;
  if (!btn) {
    return;
  }
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
}

function syncChoice(root: HTMLElement, key: string, value: string): void {
  for (const btn of root.querySelectorAll(`[data-key="${key}"] .seg button`)) {
    btn.classList.toggle('on', (btn as HTMLElement).dataset.id === value);
  }
}

function syncField(root: HTMLElement, key: string, value: string): void {
  const input = root.querySelector(`[data-field="${key}"]`) as HTMLInputElement | null;
  if (!input || document.activeElement === input) {
    return;
  }
  if (input.value !== value) {
    input.value = value;
  }
}
