import type { ChatMessage, PlanStep } from '../../core/types';
import { copyText, post, tr, ui } from '../app';
import { iconCheck, iconChevron, iconClose } from '../icons';
import { fileIconSvg } from '../transcript/fileIcons';

const open = { progress: true, project: true, output: true, context: true };

interface SideFile {
  label: string;
  path: string;
  ext: string;
}

/** Claude-style side column: progress, project files, then context. */
export function stepsPane(): HTMLElement {
  const pane = document.createElement('section');
  pane.className = 'og-dock-pane og-steps';
  pane.dataset.pane = 'steps';
  const scroll = document.createElement('div');
  scroll.className = 'og-side-scroll';
  scroll.append(progressBlock(), projectBlock(), contextBlock());
  scroll.addEventListener('scroll', () => {
    if (scroll.dataset.follow === '1') {
      return;
    }
    const gap = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    scroll.dataset.stick = gap < 36 ? '1' : '0';
  });
  pane.append(scroll);
  return pane;
}

export function syncStepsPane(message: ChatMessage | undefined): void {
  const root = document.querySelector<HTMLElement>('[data-pane="steps"]');
  if (!root) {
    return;
  }
  paintProgress(root, message);
  paintProject(root);
  paintContext(root);
}

function progressBlock(): HTMLElement {
  const block = document.createElement('section');
  block.className = 'og-side-block open';
  block.dataset.block = 'progress';
  block.append(sectionToggle('progress', tr('stepsProgress')));
  const list = document.createElement('ol');
  list.className = 'og-steps-list';
  const empty = document.createElement('p');
  empty.className = 'og-side-note';
  empty.textContent = tr('dockStepsEmpty');
  block.append(list, empty);
  return block;
}

function projectBlock(): HTMLElement {
  const block = document.createElement('section');
  block.className = 'og-side-block open';
  block.dataset.block = 'project';
  const head = document.createElement('div');
  head.className = 'og-side-project-head';
  head.append(sectionToggle('project', ''));
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'og-side-copy';
  copy.title = tr('sideCopyPath');
  copy.innerHTML = iconOpen();
  copy.addEventListener('click', () => {
    const path = workspacePath();
    if (path) {
      copyText(path);
    }
  });
  head.append(copy);
  const files = document.createElement('div');
  files.className = 'og-side-files';
  const output = document.createElement('div');
  output.className = 'og-side-sub open';
  output.dataset.block = 'output';
  output.append(sectionToggle('output', tr('sideOutput')));
  const outList = document.createElement('div');
  outList.className = 'og-side-out';
  output.append(outList);
  files.append(output);
  block.append(head, files);
  return block;
}

function contextBlock(): HTMLElement {
  const block = document.createElement('section');
  block.className = 'og-side-block open';
  block.dataset.block = 'context';
  block.append(sectionToggle('context', tr('sideContext')));
  const body = document.createElement('div');
  body.className = 'og-side-context';
  body.append(kicker(tr('sideConnectors')), chips('og-side-connectors'));
  body.append(kicker(tr('sideSkills')), chips('og-side-skills'));
  block.append(body);
  return block;
}

function sectionToggle(key: keyof typeof open, label: string): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'og-side-toggle';
  const chevron = document.createElement('span');
  chevron.className = 'og-side-chevron';
  chevron.innerHTML = iconChevron();
  const text = document.createElement('span');
  text.className = 'og-side-title';
  text.textContent = label;
  button.append(chevron, text);
  button.addEventListener('click', () => {
    open[key] = !open[key];
    button.closest<HTMLElement>('[data-block]')?.classList.toggle('open', open[key]);
  });
  return button;
}

function kicker(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'og-side-kicker';
  el.textContent = text;
  return el;
}

function chips(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function paintProgress(root: HTMLElement, message: ChatMessage | undefined): void {
  const block = root.querySelector<HTMLElement>('[data-block="progress"]');
  const list = block?.querySelector<HTMLElement>('.og-steps-list');
  const note = block?.querySelector<HTMLElement>('.og-side-note');
  const title = block?.querySelector('.og-side-title');
  if (!block || !list || !note) {
    return;
  }
  if (title) {
    title.textContent = tr('stepsProgress');
  }
  block.classList.toggle('open', open.progress);
  const steps = message?.steps ?? [];
  note.hidden = steps.length > 0;
  note.textContent = tr('dockStepsEmpty');
  list.hidden = steps.length === 0;
  block.classList.toggle('stopped', Boolean(message && steps.length && stepsStopped(message)));
  const key = steps.map((step) => `${step.status}:${step.content}`).join('\n');
  const scroll = root.querySelector<HTMLElement>('.og-side-scroll');
  const follow = scroll?.dataset.stick !== '0';
  if (list.dataset.steps !== key) {
    list.dataset.steps = key;
    paintRows(list, steps);
    if (follow && scroll && !root.hidden && open.progress) {
      followActive(scroll);
    }
  }
}

function paintProject(root: HTMLElement): void {
  const block = root.querySelector<HTMLElement>('[data-block="project"]');
  const files = block?.querySelector<HTMLElement>('.og-side-files');
  const title = block?.querySelector('.og-side-project-head .og-side-title');
  const output = block?.querySelector<HTMLElement>('[data-block="output"]');
  const outList = output?.querySelector<HTMLElement>('.og-side-out');
  if (!block || !files || !output || !outList) {
    return;
  }
  if (title) {
    title.textContent = projectName();
  }
  block.classList.toggle('open', open.project);
  output.classList.toggle('open', open.output);
  const outputTitle = output.querySelector('.og-side-title');
  if (outputTitle) {
    outputTitle.textContent = tr('sideOutput');
  }
  const gathered = collectFiles();
  const key = `${gathered.project.map((file) => file.path).join('|')}\n${gathered.output.map((file) => file.path).join('|')}`;
  if (files.dataset.files === key) {
    return;
  }
  files.dataset.files = key;
  const rows = document.createElement('div');
  rows.className = 'og-side-file-rows';
  for (const file of gathered.project) {
    rows.append(fileRow(file));
  }
  const existing = files.querySelector('.og-side-file-rows');
  if (existing) {
    existing.replaceWith(rows);
  } else {
    files.prepend(rows);
  }
  outList.replaceChildren(...gathered.output.map((file) => fileRow(file)));
}

function paintContext(root: HTMLElement): void {
  const block = root.querySelector<HTMLElement>('[data-block="context"]');
  const connectors = block?.querySelector<HTMLElement>('.og-side-connectors');
  const skills = block?.querySelector<HTMLElement>('.og-side-skills');
  if (!block || !connectors || !skills) {
    return;
  }
  block.classList.toggle('open', open.context);
  const title = block.querySelector('.og-side-title');
  if (title) {
    title.textContent = tr('sideContext');
  }
  const kickers = block.querySelectorAll('.og-side-kicker');
  if (kickers[0]) {
    kickers[0].textContent = tr('sideConnectors');
  }
  if (kickers[1]) {
    kickers[1].textContent = tr('sideSkills');
  }
  const mcpKey = (ui.state.mcps ?? [])
    .filter((item) => item.enabled)
    .map((item) => item.id)
    .join('|');
  if (connectors.dataset.items !== mcpKey) {
    connectors.dataset.items = mcpKey;
    connectors.replaceChildren();
    for (const item of ui.state.mcps ?? []) {
      if (!item.enabled) {
        continue;
      }
      const chip = document.createElement('span');
      chip.className = 'og-side-chip';
      chip.innerHTML = iconGlobe();
      chip.append(document.createTextNode(item.name));
      connectors.append(chip);
    }
  }
  const skillKey = (ui.state.skills ?? [])
    .filter((item) => item.enabled)
    .map((item) => item.id)
    .join('|');
  if (skills.dataset.items !== skillKey) {
    skills.dataset.items = skillKey;
    skills.replaceChildren();
    for (const item of ui.state.skills ?? []) {
      if (!item.enabled) {
        continue;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'og-side-file';
      const mark = document.createElement('span');
      mark.className = 'og-side-file-icon';
      mark.innerHTML = fileIconSvg('md');
      const name = document.createElement('span');
      name.textContent = item.name;
      row.append(mark, name);
      row.addEventListener('click', () => post({ type: 'openFile', path: item.skillFile || item.dirPath }));
      skills.append(row);
    }
  }
}

function collectFiles(): { project: SideFile[]; output: SideFile[] } {
  const output: SideFile[] = [];
  const seen = new Set<string>();
  for (let i = ui.state.messages.length - 1; i >= 0; i -= 1) {
    const edits = ui.state.messages[i]?.edits ?? [];
    for (let j = edits.length - 1; j >= 0; j -= 1) {
      const path = edits[j]?.path;
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);
      output.push(describePath(path, false));
    }
  }
  const project: SideFile[] = [];
  for (const rule of ui.state.rules ?? []) {
    if (!rule.filePath || seen.has(rule.filePath)) {
      continue;
    }
    if (rule.scope !== 'project' && !/claude\.md|agents\.md/i.test(rule.filePath)) {
      continue;
    }
    seen.add(rule.filePath);
    project.push(describePath(rule.filePath, true));
  }
  for (const message of ui.state.messages) {
    for (const tool of message.tools) {
      const path = tool.detail;
      if (!path || seen.has(path) || !/[\\/]/.test(path)) {
        continue;
      }
      if (tool.kind === 'execute' || tool.kind === 'terminal') {
        continue;
      }
      seen.add(path);
      project.push(describePath(path, false));
      if (project.length >= 12) {
        return { project, output };
      }
    }
  }
  return { project, output };
}

function describePath(path: string, instruction: boolean): SideFile {
  const base = path.split(/[\\/]/).filter(Boolean).pop() || path;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1) : '';
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const folder = isFolderPath(path);
  return {
    path,
    ext: folder ? 'folder' : ext.toLowerCase(),
    label: instruction
      ? `${tr('sideInstruction')} · ${base}`
      : folder
        ? base
        : `${stem} · ${ext.toUpperCase() || 'FILE'}`,
  };
}

function isFolderPath(path: string): boolean {
  if (/[/\\]$/.test(path)) {
    return true;
  }
  const workspace = workspacePath().replace(/[/\\]+$/, '');
  const normalized = path.replace(/[/\\]+$/, '');
  if (workspace && normalized.toLowerCase() === workspace.toLowerCase()) {
    return true;
  }
  const base = normalized.split(/[\\/]/).pop() ?? '';
  return Boolean(base) && !base.includes('.');
}

function fileRow(file: SideFile): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'og-side-file';
  const mark = document.createElement('span');
  mark.className = 'og-side-file-icon';
  mark.innerHTML = fileIconSvg(file.ext);
  const name = document.createElement('span');
  name.textContent = file.label;
  row.append(mark, name);
  row.addEventListener('click', () => post({ type: 'openFile', path: file.path }));
  return row;
}

function projectName(): string {
  const path = ui.state.sessionCwd || ui.state.workspacePath || '';
  return path.split(/[\\/]/).filter(Boolean).at(-1) || tr('dockTools');
}

function workspacePath(): string {
  return ui.state.sessionCwd || ui.state.workspacePath || '';
}

function stepsStopped(message: ChatMessage): boolean {
  return (
    !message.streaming &&
    Boolean(
      message.steps?.some(
        (step) =>
          step.status === 'abandoned' || step.status === 'pending' || step.status === 'in_progress',
      ),
    )
  );
}

function paintRows(list: HTMLElement, steps: PlanStep[]): void {
  list.replaceChildren();
  steps.forEach((step, index) => {
    const row = document.createElement('li');
    row.className = 'og-step';
    const badge = document.createElement('span');
    badge.className = 'og-step-badge';
    const text = document.createElement('p');
    text.className = 'og-step-text';
    row.append(badge, text);
    paintRow(row, step, index);
    list.append(row);
  });
}

function paintRow(row: HTMLElement, step: PlanStep, index: number): void {
  row.dataset.status = step.status;
  const badge = row.querySelector('.og-step-badge');
  if (badge instanceof HTMLElement) {
    if (step.status === 'completed') {
      badge.innerHTML = iconCheck();
    } else if (step.status === 'failed') {
      badge.innerHTML = iconClose();
    } else {
      badge.textContent = String(index + 1);
    }
  }
  const text = row.querySelector('.og-step-text');
  if (text) {
    text.textContent = step.content;
  }
}

function followActive(scroll: HTMLElement): void {
  const active =
    scroll.querySelector<HTMLElement>('.og-step[data-status="in_progress"]') ??
    scroll.querySelector<HTMLElement>('.og-step:last-child');
  if (!active) {
    return;
  }
  const host = scroll.getBoundingClientRect();
  const box = active.getBoundingClientRect();
  if (host.height < 1) {
    return;
  }
  scroll.dataset.follow = '1';
  if (box.top < host.top) {
    scroll.scrollTop -= host.top - box.top;
  } else if (box.bottom > host.bottom) {
    scroll.scrollTop += box.bottom - host.bottom;
  }
  scroll.dataset.follow = '';
}

function iconGlobe(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.2"/><path d="M2.8 8h10.4M8 2.8c1.6 1.8 1.6 8.6 0 10.4M8 2.8c-1.6 1.8-1.6 8.6 0 10.4"/></svg>';
}

function iconOpen(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 3.2H3.4v9.4h9.4V10"/><path d="M8.2 3.2H12.8V7.8"/><path d="M12.6 3.4 7.2 8.8"/></svg>';
}
