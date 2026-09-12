import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

export function mcpsNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsMcps');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const n = ui.state.mcps?.length ?? 0;
  hint.textContent = n > 0 ? tr('settingsMcpsCount', { n }) : tr('settingsMcpsHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openMcps' }));
  return row;
}

export function mountMcpsBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = ui.state.currentSessionId ? tr('settingsMcpsHint') : tr('settingsMcpsNeedSession');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const mcps = ui.state.mcps ?? [];
  if (mcps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('settingsMcpsEmpty');
    card.append(empty);
  } else {
    for (const item of mcps) {
      card.append(mcpRow(item));
    }
  }
  body.append(hint, card);
  return body;
}

function mcpRow(item: NonNullable<typeof ui.state.mcps>[number]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row rule-row';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = item.name;
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const source = tr(item.source === 'managed' ? 'settingsMcpsManaged' : 'settingsMcpsLocal');
  const bits = [source];
  if (item.sourceLabel) {
    bits.push(item.sourceLabel);
  }
  if (item.status) {
    bits.push(item.status);
  }
  if (item.toolCount > 0) {
    bits.push(tr('settingsMcpsTools', { n: item.toolCount }));
  }
  hint.textContent = bits.join(' · ');
  copy.append(name, hint);
  const tools = document.createElement('div');
  tools.className = 'rule-tools';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = item.enabled ? 'switch on' : 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', item.enabled ? 'true' : 'false');
  toggle.title = item.enabled ? tr('settingsMcpsOn') : tr('settingsMcpsOff');
  const knob = document.createElement('span');
  knob.className = 'knob';
  toggle.append(knob);
  toggle.addEventListener('click', () => post({ type: 'toggleMcp', id: item.id }));
  tools.append(toggle);
  row.append(copy, tools);
  return row;
}
