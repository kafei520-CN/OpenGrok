import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

export function rulesNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsRules');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const n = ui.state.rules?.length ?? 0;
  hint.textContent = n > 0 ? tr('settingsRulesCount', { n }) : tr('settingsRulesHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openRules' }));
  return row;
}

export function mountRulesBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn';
  importBtn.textContent = tr('settingsRulesImport');
  importBtn.addEventListener('click', () => post({ type: 'importRules' }));
  actions.append(importBtn);
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsRulesHint');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const rules = ui.state.rules ?? [];
  if (rules.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('settingsRulesEmpty');
    card.append(empty);
  } else {
    for (const rule of rules) {
      card.append(ruleRow(rule));
    }
  }
  body.append(actions, hint, card);
  return body;
}

function ruleRow(rule: NonNullable<typeof ui.state.rules>[number]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row rule-row';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'settings-copy rule-open';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = rule.name;
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = ruleOriginLabel(rule);
  copy.append(name, hint);
  copy.addEventListener('click', () => post({ type: 'openRule', id: rule.id }));
  const tools = document.createElement('div');
  tools.className = 'rule-tools';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = rule.enabled ? 'switch on' : 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', rule.enabled ? 'true' : 'false');
  toggle.title = rule.enabled ? tr('settingsRulesOn') : tr('settingsRulesOff');
  const knob = document.createElement('span');
  knob.className = 'knob';
  toggle.append(knob);
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'toggleRule', id: rule.id });
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn';
  del.textContent = tr('settingsRulesDelete');
  del.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'deleteRule', id: rule.id });
  });
  tools.append(toggle, del);
  row.append(copy, tools);
  return row;
}

function ruleOriginLabel(rule: NonNullable<typeof ui.state.rules>[number]): string {
  if (rule.origin === 'claude') {
    return tr(rule.scope === 'project' ? 'settingsRulesClaudeProject' : 'settingsRulesClaude');
  }
  if (rule.origin === 'cursor') {
    return tr(rule.scope === 'project' ? 'settingsRulesCursorProject' : 'settingsRulesCursor');
  }
  return tr(rule.scope === 'project' ? 'settingsRulesProject' : 'settingsRulesGlobal');
}
