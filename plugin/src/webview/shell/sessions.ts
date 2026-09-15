import { formatRelativeTime } from '../../core/i18n';
import { groupSessionsByWorkspace, type SessionListMode } from '../../session/sessionGroups';
import type { SessionRow } from '../../core/types';
import { loc, persistUi, post, render, tr, ui } from '../app';
import { iconEdit, iconFolder, iconTrash } from '../icons';
import { escapeHtml } from '../transcript/markdown';

export function listedSessions(): SessionRow[] {
  return (ui.state.sessions ?? []).filter((row) => Boolean(row.title?.trim()));
}

export function mountSessionsDrawer(parent: HTMLElement): void {
  const modes = document.createElement('div');
  modes.className = 'drawer-modes';
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const [id, key] of [
    ['list', 'sessionsModeList'],
    ['workspace', 'sessionsModeWorkspace'],
  ] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tr(key);
    if (ui.sessionsMode === id) {
      btn.className = 'on';
    }
    btn.addEventListener('click', () => {
      setSessionsMode(id);
    });
    seg.append(btn);
  }
  modes.append(seg);
  parent.append(modes);
  const scroll = document.createElement('div');
  scroll.className = 'drawer-scroll';
  const sessions = listedSessions();
  if (!sessions.length) {
    const empty = document.createElement('p');
    empty.textContent = tr('sessionsEmpty');
    scroll.append(empty);
    parent.append(scroll);
    return;
  }
  if (ui.sessionsMode === 'workspace') {
    scroll.append(workspaceOverview(sessions));
  } else {
    for (const row of sessions) {
      scroll.append(sessionButton(row));
    }
  }
  parent.append(scroll);
}

function setSessionsMode(mode: SessionListMode): void {
  if (ui.sessionsMode === mode) {
    return;
  }
  ui.sessionsMode = mode;
  persistUi();
  render();
}

function workspaceOverview(sessions: SessionRow[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'session-groups';
  const groups = groupSessionsByWorkspace(sessions, ui.state.workspacePath);
  for (const group of groups) {
    const wrap = document.createElement('details');
    wrap.className = group.current ? 'session-group current' : 'session-group';
    wrap.open = ui.sessionGroupOpen.get(group.key) ?? group.current;
    wrap.addEventListener('toggle', (event) => {
      if (!event.isTrusted) {
        return;
      }
      ui.sessionGroupOpen.set(group.key, wrap.open);
    });
    const head = document.createElement('summary');
    head.className = 'session-group-head';
    const mark = document.createElement('span');
    mark.className = 'session-group-icon';
    mark.innerHTML = iconFolder();
    const copy = document.createElement('span');
    copy.className = 'session-group-copy';
    const name = document.createElement('span');
    name.className = 'session-group-name';
    name.textContent = group.label || tr('sessionsUnknownWorkspace');
    copy.append(name);
    if (group.path && group.label) {
      const path = document.createElement('span');
      path.className = 'session-group-path';
      path.textContent = group.path;
      path.title = group.path;
      copy.append(path);
    }
    const count = document.createElement('span');
    count.className = 'session-group-count';
    count.textContent = tr('sessionsGroupCount', { n: group.sessions.length });
    head.append(mark, copy, count);
    if (group.current) {
      const badge = document.createElement('span');
      badge.className = 'session-group-now';
      badge.textContent = tr('sessionsCurrentWorkspace');
      head.append(badge);
    }
    const body = document.createElement('div');
    body.className = 'session-group-body';
    for (const row of group.sessions) {
      body.append(sessionButton(row));
    }
    wrap.append(head, body);
    el.append(wrap);
  }
  return el;
}

export function sessionButton(row: SessionRow): HTMLElement {
  const item = document.createElement('div');
  item.className = row.id === ui.state.currentSessionId ? 'session-row active' : 'session-row';
  if (row.live) {
    item.classList.add('is-live');
  }
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'session-main';
  const live = row.live
    ? `<span class="session-live" title="${escapeHtml(tr('sessionsLive'))}"></span>`
    : '';
  open.innerHTML = `<span class="session-title">${live}${escapeHtml(row.title)}</span><span class="session-time">${escapeHtml(formatRelativeTime(loc(), row.updatedAt))}</span>`;
  open.addEventListener('click', () =>
    post({ type: 'loadSession', sessionId: row.id, cwd: row.cwd }),
  );
  const tools = document.createElement('div');
  tools.className = 'session-tools';
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'icon-btn';
  rename.title = tr('sessionsRename');
  rename.innerHTML = iconEdit();
  rename.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'renameSession', sessionId: row.id });
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-btn';
  remove.title = tr('sessionsDelete');
  remove.innerHTML = iconTrash();
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'deleteSession', sessionId: row.id });
  });
  tools.append(rename, remove);
  item.append(open, tools);
  return item;
}
