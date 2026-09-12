import type { WorktreeItem } from '../../core/types';
import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

export function worktreesNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsWorktrees');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const n = ui.state.worktrees?.length ?? 0;
  hint.textContent = n > 0 ? tr('settingsWorktreesCount', { n }) : tr('settingsWorktreesHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openWorktrees' }));
  return row;
}

export function mountWorktreesBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsWorktreesHint');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const rows = ui.state.worktrees ?? [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('settingsWorktreesEmpty');
    card.append(empty);
  } else {
    for (const row of rows) {
      card.append(worktreeRow(row));
    }
  }
  body.append(hint, card);
  return body;
}

function worktreeRow(item: WorktreeItem): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row rule-row';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = item.label || item.repoName || item.id.slice(0, 8);
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const status = tr(item.status === 'dead' ? 'settingsWorktreesDead' : 'settingsWorktreesAlive');
  hint.textContent = [status, item.kind, item.path].filter(Boolean).join(' · ');
  copy.append(name, hint);
  const tools = document.createElement('div');
  tools.className = 'rule-tools';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'btn';
  apply.textContent = tr('settingsWorktreesApply');
  apply.addEventListener('click', () => post({ type: 'applyWorktree', id: item.id }));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn';
  remove.textContent = tr('settingsWorktreesRemove');
  remove.addEventListener('click', () => post({ type: 'removeWorktree', id: item.id }));
  tools.append(apply, remove);
  row.append(copy, tools);
  return row;
}
