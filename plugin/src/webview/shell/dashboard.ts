import { formatDuration, type StringKey } from '../../core/i18n';
import type { RosterActivity, RosterEntry, SubagentLive } from '../../core/types';
import { isDesktop, post, tr, ui } from '../app';
import { button } from '../dom';
import { iconClose } from '../icons';
import { escapeHtml } from '../transcript/markdown';

export function patchDesktopDash(parent: HTMLElement, settingsOn: boolean): void {
  const on = isDesktop() && ui.state.drawer === 'dashboard' && !settingsOn;
  parent.querySelectorAll('.drawer-layer').forEach((node) => node.remove());
  let el = document.getElementById('og-dash');
  if (!on) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('aside');
    el.id = 'og-dash';
    parent.append(el);
  }
  const key = [
    ui.state.currentSessionId ?? '',
    (ui.state.roster ?? []).map((row) => `${row.id}:${row.activity}:${row.title}`).join('|'),
    (ui.state.subagents ?? []).map((row) => row.id).join('|'),
    ui.dashTarget ?? '',
  ].join('~');
  const keep = document.activeElement;
  const keepDash = keep instanceof HTMLInputElement && keep.classList.contains('dash-input');
  const caret = keepDash ? keep.selectionStart : null;
  if (el.dataset.key === key) {
    return;
  }
  el.dataset.key = key;
  el.replaceChildren();
  const head = document.createElement('div');
  head.className = 'og-dash-head';
  const title = document.createElement('strong');
  title.textContent = tr('drawerDashboard');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'og-dash-close';
  close.title = tr('drawerClose');
  close.innerHTML = iconClose();
  close.addEventListener('click', () => post({ type: 'closeDrawer' }));
  head.append(title, close);
  const body = document.createElement('div');
  body.className = 'og-dash';
  try {
    mountDashboard(body);
  } catch (err) {
    const fail = document.createElement('p');
    fail.className = 'dash-empty';
    fail.textContent = err instanceof Error ? err.message : String(err);
    body.append(fail);
  }
  el.append(head, body);
  if (keepDash) {
    const input = el.querySelector<HTMLInputElement>('.dash-input');
    input?.focus();
    if (input && caret != null) {
      input.setSelectionRange(caret, caret);
    }
  }
}

export function mountDashboard(parent: HTMLElement): void {
  parent.append(dispatchBar(), subagentSection(), sessionSection());
}

function dispatchBar(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'dash-dispatch';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dash-input';
  input.placeholder = tr('dashboardDispatchHint');
  input.value = ui.dashDraft;
  input.addEventListener('input', () => {
    ui.dashDraft = input.value;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendDispatch();
    }
  });
  const go = button(tr('dashboardDispatch'), sendDispatch);
  wrap.append(input, go);
  return wrap;
}

function sendDispatch(): void {
  const text = ui.dashDraft.trim();
  if (!text) {
    return;
  }
  post({
    type: 'dashboardDispatch',
    text,
    sessionId: ui.dashTarget ?? ui.state.currentSessionId,
  });
  ui.dashDraft = '';
}

function subagentSection(): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'dash-section';
  const title = document.createElement('div');
  title.className = 'dash-kicker';
  title.textContent = tr('dashboardSubagents');
  wrap.append(title);
  const rows = ui.state.subagents ?? [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'dash-empty';
    empty.textContent = tr('dashboardNoSub');
    wrap.append(empty);
    return wrap;
  }
  for (const row of rows) {
    wrap.append(subagentCard(row));
  }
  return wrap;
}

function sessionSection(): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'dash-section';
  const title = document.createElement('div');
  title.className = 'dash-kicker';
  title.textContent = tr('dashboardSessions');
  wrap.append(title);
  const rows = ui.state.roster ?? [];
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'dash-empty';
    empty.textContent = tr('dashboardEmpty');
    wrap.append(empty);
    return wrap;
  }
  for (const row of rows) {
    wrap.append(sessionCard(row));
  }
  return wrap;
}

function subagentCard(row: SubagentLive): HTMLElement {
  const el = document.createElement('div');
  el.className = 'dash-card';
  const copy = document.createElement('div');
  copy.className = 'dash-copy';
  copy.innerHTML = `<strong>${escapeHtml(row.type)}</strong><span>${escapeHtml(row.description || row.id)}</span><em>${formatDuration(row.durationMs)}</em>`;
  const cancel = button(tr('dashboardCancelSub'), () =>
    post({ type: 'cancelSubagent', subagentId: row.id }),
  );
  el.append(copy, cancel);
  return el;
}

function sessionCard(row: RosterEntry): HTMLElement {
  const current = row.id === ui.state.currentSessionId;
  const selected = (ui.dashTarget ?? ui.state.currentSessionId) === row.id;
  const el = document.createElement('div');
  el.className = `dash-card${current ? ' current' : ''}${selected ? ' selected' : ''}`;
  el.addEventListener('click', () => {
    ui.dashTarget = row.id;
    const parent = el.parentElement;
    if (!parent) {
      return;
    }
    for (const card of parent.querySelectorAll('.dash-card')) {
      card.classList.toggle('selected', card === el);
    }
  });
  const copy = document.createElement('div');
  copy.className = 'dash-copy';
  const tags = [tr(activityKey(row.activity))];
  if (current) {
    tags.push(tr('dashboardCurrent'));
  }
  if (row.isWorktree) {
    tags.push(tr('dashboardWorktree'));
  }
  if (row.modelId) {
    tags.push(row.modelId);
  }
  copy.innerHTML = `<strong>${escapeHtml(row.title || row.id.slice(0, 8))}</strong><span>${escapeHtml(row.lastTurnSummary || row.cwd || row.id)}</span><em>${escapeHtml(tags.join(' · '))}</em>`;
  const actions = document.createElement('div');
  actions.className = 'dash-actions';
  if (!current) {
    actions.append(
      button(tr('dashboardSwitch'), () =>
        post({ type: 'switchRosterSession', sessionId: row.id, cwd: row.cwd || undefined }),
      ),
    );
  }
  if (row.activity === 'working' || current) {
    actions.append(
      button(tr('dashboardStop'), () => post({ type: 'stopRosterSession', sessionId: row.id })),
    );
  }
  if (current) {
    actions.append(button(tr('dashboardFork'), () => post({ type: 'runSlash', command: 'fork' })));
  }
  if (row.isWorktree) {
    actions.append(
      button(tr('dashboardApply'), () => post({ type: 'applyWorktree', id: row.cwd || row.id })),
    );
  }
  el.append(copy, actions);
  return el;
}

function activityKey(activity: RosterActivity): StringKey {
  switch (activity) {
    case 'working':
      return 'activityWorking';
    case 'needs_input':
      return 'activityNeedsInput';
    case 'dormant':
      return 'activityDormant';
    case 'completed':
      return 'activityCompleted';
    case 'dead':
      return 'activityDead';
    default:
      return 'activityIdle';
  }
}
