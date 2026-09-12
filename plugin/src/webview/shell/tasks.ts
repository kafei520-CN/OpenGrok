import { post, tr, ui } from '../app';
import { button } from '../dom';
import { escapeHtml } from '../transcript/markdown';

export function mountTasks(parent: HTMLElement): void {
  const tasks = ui.state.tasks ?? [];
  const subs = ui.state.subagents ?? [];
  if (!tasks.length && !subs.length) {
    const empty = document.createElement('p');
    empty.textContent = tr('tasksEmpty');
    parent.append(empty);
    return;
  }
  if (subs.length) {
    const kicker = document.createElement('div');
    kicker.className = 'dash-kicker';
    kicker.textContent = tr('dashboardSubagents');
    parent.append(kicker);
    for (const row of subs) {
      const card = document.createElement('div');
      card.className = 'dash-card';
      const copy = document.createElement('div');
      copy.className = 'dash-copy';
      copy.innerHTML = `<strong>${escapeHtml(row.type)}</strong><span>${escapeHtml(row.description || row.id)}</span>`;
      card.append(
        copy,
        button(tr('dashboardCancelSub'), () => post({ type: 'cancelSubagent', subagentId: row.id })),
      );
      parent.append(card);
    }
  }
  if (tasks.length) {
    const kicker = document.createElement('div');
    kicker.className = 'dash-kicker';
    kicker.textContent = tr('drawerTasks');
    parent.append(kicker);
    for (const row of tasks) {
      const card = document.createElement('div');
      card.className = 'dash-card';
      const copy = document.createElement('div');
      copy.className = 'dash-copy';
      const state = tr(row.completed ? 'tasksDone' : 'tasksRunning');
      copy.innerHTML = `<strong>${escapeHtml(row.command)}</strong><span>${escapeHtml(row.cwd)}</span><em>${escapeHtml(`${state} · ${row.kind}`)}</em>`;
      const tools = document.createElement('div');
      tools.className = 'dash-actions';
      if (!row.completed) {
        tools.append(button(tr('tasksKill'), () => post({ type: 'killTask', taskId: row.id })));
      }
      card.append(copy, tools);
      parent.append(card);
    }
  }
}
