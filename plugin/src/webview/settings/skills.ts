import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

export function skillsNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsSkills');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const n = ui.state.skills?.length ?? 0;
  hint.textContent = n > 0 ? tr('settingsSkillsCount', { n }) : tr('settingsSkillsHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openSkills' }));
  return row;
}

export function mountSkillsBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.append(
    actionBtn(tr('settingsSkillsImportZip'), () => post({ type: 'importSkillZip' })),
    actionBtn(tr('settingsSkillsImportFolder'), () => post({ type: 'importSkillFolder' })),
  );
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsSkillsHint');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const skills = ui.state.skills ?? [];
  if (skills.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('settingsSkillsEmpty');
    card.append(empty);
  } else {
    for (const skill of skills) {
      card.append(skillRow(skill));
    }
  }
  body.append(actions, hint, card);
  return body;
}

function actionBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function skillRow(skill: NonNullable<typeof ui.state.skills>[number]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row rule-row';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'settings-copy rule-open';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = skill.name;
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const scope = tr(skill.scope === 'project' ? 'settingsSkillsProject' : 'settingsSkillsGlobal');
  hint.textContent = skill.description ? `${scope} · ${skill.description}` : scope;
  copy.append(name, hint);
  copy.addEventListener('click', () => post({ type: 'openSkill', id: skill.id }));
  const tools = document.createElement('div');
  tools.className = 'rule-tools';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = skill.enabled ? 'switch on' : 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', skill.enabled ? 'true' : 'false');
  toggle.title = skill.enabled ? tr('settingsSkillsOn') : tr('settingsSkillsOff');
  const knob = document.createElement('span');
  knob.className = 'knob';
  toggle.append(knob);
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'toggleSkill', id: skill.id });
  });
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn';
  del.textContent = tr('settingsSkillsDelete');
  del.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'deleteSkill', id: skill.id });
  });
  tools.append(toggle, del);
  row.append(copy, tools);
  return row;
}
