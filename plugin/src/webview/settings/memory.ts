import type { MemoryFile } from '../../core/types';
import { post, tr, ui } from '../app';
import { iconChevron } from '../icons';

export function memoryNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsMemory');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsMemoryHint');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openMemory' }));
  return row;
}

export function mountMemoryBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const flush = document.createElement('button');
  flush.type = 'button';
  flush.className = 'btn';
  flush.textContent = tr('settingsMemoryFlush');
  flush.addEventListener('click', () => post({ type: 'flushMemory' }));
  actions.append(flush);
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsMemoryHint');
  const card = document.createElement('div');
  card.className = 'settings-card';
  const rows = ui.state.memoryFiles ?? [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'settings-row stack';
    empty.textContent = tr('settingsMemoryEmpty');
    card.append(empty);
  } else {
    for (const row of rows) {
      card.append(memoryRow(row));
    }
  }
  body.append(actions, hint, card);
  return body;
}

function memoryRow(item: MemoryFile): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = item.name;
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr(item.scope === 'global' ? 'settingsMemoryGlobal' : 'settingsMemoryWorkspace');
  copy.append(name, hint);
  row.append(copy);
  row.addEventListener('click', () => post({ type: 'openMemoryFile', id: item.id }));
  return row;
}
