import type { AgentDefItem, PersonaItem } from '../../core/types';
import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

export function agentsNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsAgents');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const n = (ui.state.agents ?? []).length;
  hint.textContent = n > 0 ? tr('settingsAgentsCount', { n }) : tr('settingsAgentsHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openAgents' }));
  return row;
}

export function mountAgentsBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const seg = document.createElement('div');
  seg.className = 'seg settings-seg';
  for (const [id, key] of [
    ['agents', 'settingsAgentsTab'],
    ['personas', 'settingsPersonasTab'],
  ] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tr(key);
    if (ui.agentsTab === id) {
      btn.className = 'on';
    }
    btn.addEventListener('click', () => {
      ui.agentsTab = id;
      post({ type: 'openAgents' });
    });
    seg.append(btn);
  }
  body.append(seg);
  if (ui.agentsTab === 'personas') {
    body.append(personasPane());
    return body;
  }
  body.append(agentsPane());
  return body;
}

function agentsPane(): HTMLElement {
  const wrap = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.append(actionBtn(tr('settingsAgentsImport'), () => post({ type: 'importAgents' })));
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsAgentsHint');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const rows = ui.state.agents ?? [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('settingsAgentsEmpty');
    card.append(empty);
  } else {
    for (const row of rows) {
      card.append(agentRow(row));
    }
  }
  wrap.append(actions, hint, card);
  return wrap;
}

function personasPane(): HTMLElement {
  const wrap = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.append(actionBtn(tr('settingsPersonasImport'), () => post({ type: 'importPersonas' })));
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsPersonasHint');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const rows = ui.state.personas ?? [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('settingsPersonasEmpty');
    card.append(empty);
  } else {
    for (const row of rows) {
      card.append(personaRow(row));
    }
  }
  wrap.append(actions, hint, card);
  return wrap;
}

function agentRow(item: AgentDefItem): HTMLElement {
  const active = (ui.state.agentProfile ?? 'grok-build') === item.name;
  const row = document.createElement('div');
  row.className = 'settings-row rule-row';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'settings-copy rule-open';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = item.name;
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = [scopeLabel(item), item.description].filter(Boolean).join(' · ');
  copy.append(name, hint);
  if (item.filePath) {
    copy.addEventListener('click', () => post({ type: 'openAgent', id: item.id }));
  }
  const tools = document.createElement('div');
  tools.className = 'rule-tools';
  const use = document.createElement('button');
  use.type = 'button';
  use.className = active ? 'btn on' : 'btn';
  use.textContent = active ? tr('settingsAgentsUsing') : tr('settingsAgentsUse');
  use.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!active) {
      post({ type: 'setAgentProfile', name: item.name });
    }
  });
  tools.append(use);
  if (item.filePath) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = item.enabled ? 'switch on' : 'switch';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', item.enabled ? 'true' : 'false');
    const knob = document.createElement('span');
    knob.className = 'knob';
    toggle.append(knob);
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      post({ type: 'toggleAgent', id: item.id });
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn';
    del.textContent = tr('settingsRulesDelete');
    del.addEventListener('click', (event) => {
      event.stopPropagation();
      post({ type: 'deleteAgent', id: item.id });
    });
    tools.append(toggle, del);
  }
  row.append(copy, tools);
  return row;
}

function personaRow(item: PersonaItem): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row rule-row';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'settings-copy rule-open';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = item.name;
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const scope = tr(item.scope === 'project' ? 'settingsPersonasProject' : 'settingsPersonasGlobal');
  hint.textContent = item.description ? `${scope} · ${item.description}` : scope;
  copy.append(name, hint);
  copy.addEventListener('click', () => post({ type: 'openPersona', id: item.id }));
  const tools = document.createElement('div');
  tools.className = 'rule-tools';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = item.enabled ? 'switch on' : 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', item.enabled ? 'true' : 'false');
  const knob = document.createElement('span');
  knob.className = 'knob';
  toggle.append(knob);
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'togglePersona', id: item.id });
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn';
  del.textContent = tr('settingsRulesDelete');
  del.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'deletePersona', id: item.id });
  });
  tools.append(toggle, del);
  row.append(copy, tools);
  return row;
}

function scopeLabel(item: AgentDefItem): string {
  if (item.scope === 'builtin') {
    return tr('settingsAgentsBuiltin');
  }
  return tr(item.scope === 'project' ? 'settingsAgentsProject' : 'settingsAgentsGlobal');
}

function actionBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
