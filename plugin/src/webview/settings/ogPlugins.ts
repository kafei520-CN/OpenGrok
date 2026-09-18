import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

export function ogPluginsNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('ogPlugins');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('ogPluginsHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openOgPlugins' }));
  return row;
}

export function mountOgPluginsBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const hint = document.createElement('p');
  hint.className = 'settings-hint';
  hint.textContent = tr('ogPluginsHint');
  body.append(hint);
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn';
  open.textContent = tr('ogPluginsOpenDir');
  open.addEventListener('click', () => post({ type: 'openOgPluginsDir' }));
  actions.append(open);
  body.append(actions);
  const rows = ui.state.ogPlugins ?? [];
  const card = document.createElement('div');
  card.className = 'settings-card';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('ogPluginsEmpty');
    card.append(empty);
    body.append(card);
    return body;
  }
  for (const plugin of rows) {
    const row = document.createElement('div');
    row.className = 'settings-row rule-row';
    const copy = document.createElement('div');
    copy.className = 'settings-copy';
    const name = document.createElement('div');
    name.className = 'settings-label';
    name.textContent = plugin.name;
    const bits = [
      plugin.id,
      plugin.hasUi ? tr('ogPluginsHasUi') : '',
      plugin.hasHost ? tr('ogPluginsHasHost') : '',
      plugin.hasCss ? 'CSS' : '',
      plugin.dir,
    ].filter(Boolean);
    const sub = document.createElement('div');
    sub.className = 'settings-hint';
    sub.textContent = bits.join(' · ');
    copy.append(name, sub);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = plugin.enabled ? 'switch on' : 'switch';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', plugin.enabled ? 'true' : 'false');
    const knob = document.createElement('span');
    knob.className = 'knob';
    toggle.append(knob);
    toggle.addEventListener('click', () => post({ type: 'toggleOgPlugin', id: plugin.id }));
    row.append(copy, toggle);
    card.append(row);
  }
  body.append(card);
  return body;
}
