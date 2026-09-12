import type { HookItem, MarketplacePlugin, PluginItem, WorkflowItem } from '../../core/types';
import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

const TABS = [
  ['plugins', 'settingsPlugins'],
  ['marketplace', 'settingsMarketplace'],
  ['hooks', 'settingsHooks'],
  ['workflows', 'settingsWorkflows'],
] as const;

export function extNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsExt');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsExtHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openExt' }));
  return row;
}

export function mountExtBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const seg = document.createElement('div');
  seg.className = 'seg settings-seg';
  const tab = ui.state.extTab ?? 'plugins';
  for (const [id, key] of TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tr(key);
    if (tab === id) {
      btn.className = 'on';
    }
    btn.addEventListener('click', () => post({ type: 'setExtTab', tab: id }));
    seg.append(btn);
  }
  body.append(seg);
  if (tab === 'marketplace') {
    body.append(marketplacePane());
  } else if (tab === 'hooks') {
    body.append(hooksPane());
  } else if (tab === 'workflows') {
    body.append(workflowsPane());
  } else {
    body.append(pluginsPane());
  }
  return body;
}

function pluginsPane(): HTMLElement {
  return listPane(
    ui.state.plugins ?? [],
    tr('settingsPluginsEmpty'),
    (item: PluginItem) =>
      row(item.name, hintOf(item.description, item.scope, item.version), [
        toggle(item.enabled, () => post({ type: 'togglePlugin', id: item.id })),
        action(tr('settingsRulesDelete'), () => post({ type: 'uninstallPlugin', id: item.id })),
      ]),
  );
}

function marketplacePane(): HTMLElement {
  const wrap = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.append(action(tr('settingsMarketplaceRefresh'), () => post({ type: 'refreshMarketplace' })));
  wrap.append(
    actions,
    listPane(
      ui.state.marketplace ?? [],
      tr('settingsMarketplaceEmpty'),
      (item: MarketplacePlugin) =>
        row(item.name, hintOf(item.sourceName, item.installStatus, item.description), [
          action(tr('settingsMarketplaceInstall'), () => post({ type: 'installMarketplace', id: item.id })),
        ]),
    ),
  );
  return wrap;
}

function hooksPane(): HTMLElement {
  return listPane(
    ui.state.hooks ?? [],
    tr('settingsHooksEmpty'),
    (item: HookItem) =>
      row(item.name, hintOf(item.event, item.matcher, item.command), [
        toggle(item.enabled, () => post({ type: 'toggleHook', id: item.id })),
      ]),
  );
}

function workflowsPane(): HTMLElement {
  return listPane(
    ui.state.workflows ?? [],
    tr('settingsWorkflowsEmpty'),
    (item: WorkflowItem) =>
      row(item.name, hintOf(item.description, item.source, item.whenToUse), [
        action(tr('settingsWorkflowsRun'), () => post({ type: 'runWorkflow', name: item.name })),
      ]),
  );
}

function listPane<T>(
  rows: T[],
  empty: string,
  render: (item: T) => HTMLElement,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'settings-card';
  if (!rows.length) {
    const el = document.createElement('div');
    el.className = 'settings-row stack';
    el.textContent = ui.state.currentSessionId ? empty : tr('settingsNeedSession');
    card.append(el);
    return card;
  }
  for (const item of rows) {
    card.append(render(item));
  }
  return card;
}

function row(title: string, hint: string, tools: HTMLElement[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'settings-row rule-row';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = title;
  const sub = document.createElement('div');
  sub.className = 'settings-hint';
  sub.textContent = hint;
  copy.append(name, sub);
  const bar = document.createElement('div');
  bar.className = 'rule-tools';
  for (const tool of tools) {
    bar.append(tool);
  }
  el.append(copy, bar);
  return el;
}

function toggle(on: boolean, click: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = on ? 'switch on' : 'switch';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', on ? 'true' : 'false');
  const knob = document.createElement('span');
  knob.className = 'knob';
  btn.append(knob);
  btn.addEventListener('click', click);
  return btn;
}

function action(label: string, click: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = label;
  btn.addEventListener('click', click);
  return btn;
}

function hintOf(...parts: Array<string | undefined>): string {
  return parts.filter((part) => Boolean(part && part.trim())).join(' · ');
}
