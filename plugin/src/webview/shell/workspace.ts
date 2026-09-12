import type { WebviewToHost } from '../../core/types';
import { isDesktop, persistUi, post, render, tr, ui, type WsFile } from '../app';
import { iconClose, iconFolder, iconPlus } from '../icons';
import { adoptMonacoHost, bindMonacoEditor, dropMonacoModel, parkMonacoHost } from '../editor/monaco';

type DirEntry = { path: string; rel: string; name: string; kind: 'file' | 'dir' };

export type WorkspaceDiff = {
  locale?: string;
  files?: unknown[];
  messageId?: string;
  theme?: unknown;
};

let diffHooked = false;

export function patchWorkspace(parent: HTMLElement): void {
  let shell = document.getElementById('grok-ws-shell');
  if (!shell) {
    shell = document.createElement('div');
    shell.id = 'grok-ws-shell';
    shell.className = 'ws-shell';
    const header = document.getElementById('grok-header');
    if (header?.nextSibling) {
      parent.insertBefore(shell, header.nextSibling);
    } else {
      parent.append(shell);
    }
    shell.append(navPane(), splitter('nav'), mainPane(), splitter('chat'));
  }
  shell.hidden = false;
  applyWidths(shell);
  ensureRootList();
  const navKey = navStamp();
  const mainKey = mainStamp();
  if (shell.dataset.navKey !== navKey) {
    shell.dataset.navKey = navKey;
    shell.querySelector('.ws-nav')?.replaceWith(navPane());
  }
  if (shell.dataset.mainKey !== mainKey) {
    shell.dataset.mainKey = mainKey;
    shell.querySelector('.ws-main')?.replaceWith(mainPane());
  } else if (isReviewTab(activeFile())) {
    const frame = shell.querySelector('iframe.ws-diff');
    if (frame instanceof HTMLIFrameElement) {
      pushDiff(frame);
    }
  }
}

export function hideWorkspace(): void {
  parkMonacoHost();
  document.getElementById('grok-ws-shell')?.remove();
}

export function openWorkspaceReview(payload: WorkspaceDiff): void {
  ui.wsDiff = payload;
  ui.wsActive = ensureReviewTab();
  ui.wsPane = 'review';
  showWorkspaceView();
  render();
}

export function appendWorkspaceDiff(files: unknown[]): void {
  if (!files.length) {
    return;
  }
  if (!ui.wsDiff) {
    openWorkspaceReview({ files });
    return;
  }
  ui.wsDiff = { ...ui.wsDiff, files: [...(ui.wsDiff.files ?? []), ...files] };
  ensureReviewTab();
  const frame = document.querySelector('#grok-ws-shell iframe.ws-diff');
  if (
    isReviewTab(activeFile()) &&
    frame instanceof HTMLIFrameElement &&
    frame.dataset.ready === '1' &&
    frame.contentWindow
  ) {
    frame.contentWindow.postMessage({ type: 'diffMore', files }, '*');
    return;
  }
  render();
}

export function openWorkspacePreview(info: {
  path: string;
  rel?: string;
  text?: string;
  hash?: string;
  tooLarge?: boolean;
  binary?: boolean;
  missing?: boolean;
}): void {
  showWorkspaceView();
  applyWorkspaceFile({
    ...info,
    rel: info.rel ?? relOf(info.path),
  });
}

export function hideWorkspaceReview(): boolean {
  let closed = false;
  for (const id of ['grok-diff-overlay', 'grok-file-overlay']) {
    const leftover = document.getElementById(id);
    if (leftover) {
      leftover.remove();
      closed = true;
    }
  }
  const kept = ui.wsTabs.filter((tab) => !isReviewTab(tab));
  if (kept.length === ui.wsTabs.length && !ui.wsDiff) {
    return closed;
  }
  if (isReviewTab(tabByPath(ui.wsActive))) {
    ui.wsActive = kept[0]?.path ?? '';
  }
  ui.wsTabs = kept;
  ui.wsPane = 'file';
  ui.wsDiff = undefined;
  render();
  return true;
}

export function applyWorkspaceIndex(payload: {
  dir?: string;
  name?: string;
  entries?: DirEntry[];
  truncated?: boolean;
}): void {
  const dir = payload.dir ?? '';
  if (payload.name) {
    ui.wsRootName = payload.name;
  }
  ui.wsDirs[dir] = payload.entries ?? [];
  ui.wsFolderLoading.delete(dir);
  ui.wsListed = true;
  ui.wsTruncated = Boolean(payload.truncated);
  render();
}

export function applyWorkspaceFile(info: {
  path: string;
  rel?: string;
  text?: string;
  hash?: string;
  tooLarge?: boolean;
  binary?: boolean;
  missing?: boolean;
}): void {
  const file: WsFile = { ...info, path: info.path, rel: info.rel ?? relOf(info.path) };
  const idx = findTab(file.path, file.rel);
  if (idx >= 0) {
    ui.wsTabs[idx] = file;
  } else {
    ui.wsTabs.push(file);
  }
  ui.wsDrafts[file.path] = file.text ?? '';
  ui.wsActive = file.path;
  ui.wsNotice = '';
  ui.wsPane = 'file';
  render();
}

export function applyWorkspaceSave(result: {
  path: string;
  ok: boolean;
  hash?: string;
  message?: string;
}): void {
  const idx = findTab(result.path);
  const tab = idx >= 0 ? ui.wsTabs[idx] : undefined;
  if (tab) {
    if (result.ok && result.hash) {
      const draft = draftOf(tab);
      ui.wsTabs[idx] = { ...tab, text: draft, hash: result.hash };
      ui.wsDrafts[tab.path] = draft;
      if (ui.wsActive === tab.path) {
        ui.wsNotice = '';
      }
    }
  }
  render();
}

export function applyWorkspaceMoved(info: { from: string; to: string; rel: string }): void {
  const idx = findTab(info.from);
  if (idx >= 0) {
    const tab = ui.wsTabs[idx];
    const draft = draftOf(tab);
    dropMonacoModel(tab.path);
    delete ui.wsDrafts[tab.path];
    const next = { ...tab, path: info.to, rel: info.rel, missing: false };
    ui.wsTabs[idx] = next;
    ui.wsDrafts[info.to] = draft;
    if (ui.wsActive === tab.path) {
      ui.wsActive = info.to;
    }
  }
  render();
}

export function applyWorkspaceGone(info: { path: string; rel?: string }): void {
  const gone = info.path.replace(/\\/g, '/');
  const rel = (info.rel ?? '').replace(/\\/g, '/');
  const keep: WsFile[] = [];
  for (const tab of ui.wsTabs) {
    const path = tab.path.replace(/\\/g, '/');
    const hit =
      path === gone ||
      path.startsWith(`${gone}/`) ||
      (rel !== '' && (tab.rel === rel || tab.rel.startsWith(`${rel}/`)));
    if (hit) {
      dropMonacoModel(tab.path);
      delete ui.wsDrafts[tab.path];
    } else {
      keep.push(tab);
    }
  }
  ui.wsTabs = keep;
  if (!tabByPath(ui.wsActive)) {
    ui.wsActive = keep[0]?.path ?? '';
  }
  render();
}

function showWorkspaceView(): void {
  if (isDesktop()) {
    return;
  }
  if (ui.remoteView !== 'workspace') {
    ui.remoteView = 'workspace';
    persistUi();
  }
  ensureRootList();
}

function ensureRootList(): void {
  if (ui.wsListed || ui.wsFolderLoading.has('')) {
    return;
  }
  ui.wsFolderLoading.add('');
  post({ type: 'listWorkspace' });
}

function navStamp(): string {
  return [
    rootName(),
    ui.wsQuery,
    ui.wsActive,
    ui.wsTabs.map((tab) => tab.path).join(','),
    [...ui.wsFolderOpen].sort().join(','),
    [...ui.wsFolderLoading].sort().join(','),
    Object.keys(ui.wsDirs)
      .sort()
      .map((dir) => `${dir}:${(ui.wsDirs[dir] ?? []).map((row) => row.name).join(',')}`)
      .join(';'),
  ].join('|');
}

function mainStamp(): string {
  const open = activeFile();
  const review = isReviewTab(open) ? '1' : '0';
  return `${review}:${ui.wsActive}:${ui.wsTabs.map((tab) => tab.path).join(',')}:${open?.hash ?? ''}:${ui.wsNotice}`;
}

function applyWidths(shell: HTMLElement): void {
  const nav = `${ui.wsNavPx}px`;
  const chat = `${ui.wsChatPx}px`;
  shell.style.setProperty('--ws-nav', nav);
  shell.style.setProperty('--ws-chat', chat);
  const app = document.getElementById('app');
  app?.style.setProperty('--ws-nav', nav);
  app?.style.setProperty('--ws-chat', chat);
}

function splitter(which: 'nav' | 'chat'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ws-split';
  el.dataset.split = which;
  el.addEventListener('pointerdown', (event) => startSash(event, which, el));
  return el;
}

function startSash(event: PointerEvent, which: 'nav' | 'chat', el: HTMLElement): void {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  el.classList.add('drag');
  document.documentElement.classList.add('ws-dragging');
  const mask = document.createElement('div');
  mask.className = 'ws-drag-mask';
  document.body.append(mask);
  const shell = document.getElementById('grok-ws-shell');
  const startX = event.clientX;
  const startNav = ui.wsNavPx;
  const startChat = ui.wsChatPx;
  const width = document.getElementById('app')?.clientWidth ?? 960;
  let raf = 0;
  const paint = () => {
    raf = 0;
    if (shell) {
      applyWidths(shell);
    }
  };
  const onMove = (move: PointerEvent) => {
    const dx = move.clientX - startX;
    if (which === 'nav') {
      ui.wsNavPx = clamp(startNav + dx, 140, Math.max(140, width - startChat - 200));
    } else {
      ui.wsChatPx = clamp(startChat - dx, 240, Math.max(240, width - startNav - 200));
    }
    if (!raf) {
      raf = requestAnimationFrame(paint);
    }
  };
  const onUp = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    paint();
    el.classList.remove('drag');
    document.documentElement.classList.remove('ws-dragging');
    mask.remove();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    persistUi();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function navPane(): HTMLElement {
  const nav = document.createElement('div');
  nav.className = 'ws-nav';
  const title = document.createElement('div');
  title.className = 'ws-explorer-title';
  const label = document.createElement('span');
  label.textContent = tr('wsExplorer');
  const actions = document.createElement('div');
  actions.className = 'ws-explorer-actions';
  actions.append(
    explorerBtn(tr('wsNewFile'), iconPlus(), () => createEntry('', 'file')),
    explorerBtn(tr('wsNewFolder'), iconFolder(), () => createEntry('', 'dir')),
  );
  title.append(label, actions);
  title.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showExplorerMenu(event.clientX, event.clientY, { kind: 'dir', path: '', rel: '', name: rootName() });
  });
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'ws-search';
  search.placeholder = tr('wsSearch');
  search.value = ui.wsQuery;
  search.addEventListener('input', () => {
    ui.wsQuery = search.value;
    render();
  });
  const list = document.createElement('div');
  list.className = 'ws-list';
  if (ui.wsTabs.length > 0) {
    list.append(openEditors());
  }
  list.append(rootFolder());
  nav.append(title, search, list);
  return nav;
}

function openEditors(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ws-twist open';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'ws-twist-head';
  head.innerHTML = `<span class="ws-chevron">${iconChevron()}</span><span>${escape(tr('wsOpenEditors'))}</span>`;
  const kids = document.createElement('div');
  kids.className = 'ws-kids';
  for (const file of ui.wsTabs) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = file.path === activeFile()?.path ? 'ws-row on' : 'ws-row';
    row.style.paddingLeft = '22px';
    const mark = isDirty(file) ? '● ' : '';
    row.textContent = `${mark}${file.rel.split('/').pop() ?? file.rel}`;
    row.title = file.rel;
    row.addEventListener('click', () => activateTab(file.path));
    kids.append(row);
  }
  wrap.append(head, kids);
  return wrap;
}

function rootFolder(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ws-root';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'ws-root-head';
  head.innerHTML = `<span class="ws-folder">${iconFolder()}</span><span>${escape(rootName())}</span>`;
  head.title = ui.state.workspacePath ?? rootName();
  head.addEventListener('click', () => {
    ui.wsListed = false;
    ui.wsFolderLoading.add('');
    post({ type: 'listWorkspace' });
    render();
  });
  head.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showExplorerMenu(event.clientX, event.clientY, { kind: 'dir', path: '', rel: '', name: rootName() });
  });
  const kids = document.createElement('div');
  kids.className = 'ws-kids';
  const entries = filterEntries(ui.wsDirs[''] ?? []);
  if (entries.length === 0 && (ui.wsFolderLoading.has('') || !ui.wsListed)) {
    kids.append(emptyRow('…'));
  } else if (entries.length === 0) {
    kids.append(emptyRow(tr('wsEmpty')));
  } else {
    for (const entry of entries) {
      kids.append(entryRow(entry, 1));
    }
  }
  wrap.append(head, kids);
  return wrap;
}

function entryRow(entry: DirEntry, depth: number): HTMLElement {
  if (entry.kind === 'dir') {
    const open = ui.wsFolderOpen.has(entry.rel);
    const wrap = document.createElement('div');
    wrap.className = open ? 'ws-twist open' : 'ws-twist';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'ws-twist-head';
    head.style.paddingLeft = `${8 + depth * 8}px`;
    head.innerHTML = `<span class="ws-chevron">${iconChevron()}</span><span class="ws-folder">${iconFolder()}</span><span>${escape(entry.name)}</span>`;
    head.addEventListener('click', () => toggleDir(entry.rel));
    head.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showExplorerMenu(event.clientX, event.clientY, entry);
    });
    const kids = document.createElement('div');
    kids.className = 'ws-kids';
    if (open) {
      if (ui.wsFolderLoading.has(entry.rel) && !ui.wsDirs[entry.rel]) {
        const loading = emptyRow('…');
        loading.style.paddingLeft = `${16 + depth * 8}px`;
        kids.append(loading);
      } else {
        for (const child of filterEntries(ui.wsDirs[entry.rel] ?? [])) {
          kids.append(entryRow(child, depth + 1));
        }
      }
    }
    wrap.append(head, kids);
    return wrap;
  }
  const row = document.createElement('button');
  row.type = 'button';
  row.className = entry.path === activeFile()?.path ? 'ws-row on' : 'ws-row';
  row.style.paddingLeft = `${22 + depth * 8}px`;
  row.innerHTML = `<span class="ws-file">${iconFile()}</span><span>${escape(entry.name)}</span>`;
  row.title = entry.rel;
  row.addEventListener('click', () => openFile(entry.path));
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showExplorerMenu(event.clientX, event.clientY, entry);
  });
  return row;
}

function explorerBtn(title: string, icon: string, fn: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ws-explorer-btn';
  btn.title = title;
  btn.innerHTML = icon;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    fn();
  });
  return btn;
}

function showExplorerMenu(x: number, y: number, entry: DirEntry): void {
  document.getElementById('ws-explorer-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'ws-explorer-menu';
  menu.className = 'ws-menu';
  const dirRel = entry.kind === 'dir' ? entry.rel : parentOf(entry.rel);
  const add = (label: string, fn: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      menu.remove();
      fn();
    });
    menu.append(btn);
  };
  add(tr('wsNewFile'), () => createEntry(dirRel, 'file'));
  add(tr('wsNewFolder'), () => createEntry(dirRel, 'dir'));
  if (entry.path) {
    add(tr('wsRename'), () => renameEntry(entry));
    add(tr('wsDelete'), () => deleteEntry(entry));
  }
  document.body.append(menu);
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
  const close = (event: Event) => {
    if (event.target instanceof Node && menu.contains(event.target)) {
      return;
    }
    menu.remove();
    window.removeEventListener('pointerdown', close, true);
  };
  window.addEventListener('pointerdown', close, true);
}

function createEntry(dirRel: string, kind: 'file' | 'dir'): void {
  const name = window.prompt(kind === 'dir' ? tr('wsNewFolderName') : tr('wsNewFileName'));
  if (!name) {
    return;
  }
  if (dirRel) {
    ui.wsFolderOpen.add(dirRel);
  }
  post({ type: 'mutateWorkspace', action: 'create', dir: dirRel, name, kind });
}

function renameEntry(entry: DirEntry): void {
  const name = window.prompt(tr('wsRenameName'), entry.name);
  if (!name || name === entry.name) {
    return;
  }
  post({ type: 'mutateWorkspace', action: 'rename', path: entry.path || entry.rel, name });
}

function deleteEntry(entry: DirEntry): void {
  if (!window.confirm(tr('wsDeleteConfirm', { name: entry.name }))) {
    return;
  }
  post({ type: 'mutateWorkspace', action: 'delete', path: entry.path || entry.rel });
}

function parentOf(rel: string): string {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function filterEntries(entries: DirEntry[]): DirEntry[] {
  const needle = ui.wsQuery.trim().toLowerCase();
  if (!needle) {
    return entries;
  }
  return entries.filter((row) => row.name.toLowerCase().includes(needle) || row.rel.toLowerCase().includes(needle));
}

function toggleDir(rel: string): void {
  if (ui.wsFolderOpen.has(rel)) {
    ui.wsFolderOpen.delete(rel);
    render();
    return;
  }
  ui.wsFolderOpen.add(rel);
  if (!ui.wsDirs[rel] && !ui.wsFolderLoading.has(rel)) {
    ui.wsFolderLoading.add(rel);
    post({ type: 'listWorkspace', dir: rel });
  }
  render();
}

function openFile(filePath: string): void {
  const existing = tabByPath(filePath);
  if (existing && !isReviewTab(existing)) {
    ui.wsActive = existing.path;
    ui.wsPane = 'file';
    if (!isDirty(existing)) {
      post({ type: 'openWorkspaceFile', path: existing.path });
    }
    render();
    return;
  }
  post({ type: 'openWorkspaceFile', path: filePath });
}

function activateTab(filePath: string): void {
  const existing = tabByPath(filePath);
  if (!existing) {
    return;
  }
  ui.wsActive = existing.path;
  ui.wsPane = isReviewTab(existing) ? 'review' : 'file';
  render();
}

function closeTab(filePath: string): void {
  const idx = findTab(filePath);
  const tab = idx >= 0 ? ui.wsTabs[idx] : undefined;
  if (!tab) {
    return;
  }
  if (!isReviewTab(tab) && isDirty(tab) && !window.confirm(tr('wsDiscard'))) {
    return;
  }
  ui.wsTabs.splice(idx, 1);
  delete ui.wsDrafts[tab.path];
  dropMonacoModel(tab.path);
  if (!ui.wsTabs.some((item) => isReviewTab(item))) {
    ui.wsDiff = undefined;
  }
  if (ui.wsActive === tab.path) {
    const next = ui.wsTabs[idx] ?? ui.wsTabs[idx - 1];
    ui.wsActive = next?.path ?? '';
    ui.wsPane = isReviewTab(next) ? 'review' : 'file';
    ui.wsNotice = '';
  }
  render();
}

function mainPane(): HTMLElement {
  parkMonacoHost();
  const main = document.createElement('div');
  main.className = 'ws-main';
  const tabs = document.createElement('div');
  tabs.className = 'ws-tabs';
  const strip = document.createElement('div');
  strip.className = 'ws-tab-strip';
  strip.setAttribute('role', 'tablist');
  for (const file of ui.wsTabs) {
    strip.append(fileTab(file));
  }
  queueMicrotask(() => scrollActiveTab(strip));
  const actions = document.createElement('div');
  actions.className = 'ws-tab-actions';
  if (!isReviewTab(activeFile())) {
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ws-action';
    save.dataset.wsSave = '1';
    save.textContent = tr('wsSave');
    save.disabled = !canSave();
    save.addEventListener('click', saveOpen);
    actions.append(save);
  }
  tabs.append(strip, actions);
  const body = isReviewTab(activeFile()) ? reviewBody() : fileBody(main);
  main.append(tabs, body);
  return main;
}

function scrollActiveTab(strip: HTMLElement): void {
  const tab = strip.querySelector('.ws-tab.on');
  if (!(tab instanceof HTMLElement)) {
    return;
  }
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left < strip.scrollLeft) {
    strip.scrollLeft = left;
  } else if (right > strip.scrollLeft + strip.clientWidth) {
    strip.scrollLeft = right - strip.clientWidth;
  }
}

function fileTab(file: WsFile): HTMLElement {
  const active = file.path === activeFile()?.path;
  const tab = document.createElement('div');
  tab.className = `ws-tab${active ? ' on' : ''}${isReviewTab(file) ? ' review' : ''}`;
  tab.title = file.rel;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', active ? 'true' : 'false');
  if (isDirty(file)) {
    const mark = document.createElement('span');
    mark.className = 'ws-dirty';
    mark.textContent = '●';
    tab.append(mark);
  }
  const name = document.createElement('span');
  name.className = 'ws-tab-name';
  name.textContent = tabLabel(file);
  tab.append(name);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ws-tab-close';
  close.title = tr('wsCloseTab');
  close.innerHTML = iconClose();
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeTab(file.path);
  });
  tab.append(close);
  tab.addEventListener('click', () => activateTab(file.path));
  tab.addEventListener('auxclick', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      closeTab(file.path);
    }
  });
  return tab;
}

function fileBody(main: HTMLElement): HTMLElement {
  const open = activeFile();
  const body = document.createElement('div');
  body.className = 'ws-body';
  if (!open) {
    const hint = document.createElement('div');
    hint.className = 'ws-welcome';
    hint.textContent = tr('wsOpenHint');
    body.append(hint);
  } else if (open.binary || open.tooLarge) {
    body.append(document.createElement('div'));
  } else {
    const crumb = document.createElement('div');
    crumb.className = 'ws-crumb';
    crumb.textContent = open.rel;
    const stack = document.createElement('div');
    stack.className = 'ws-edit-stack';
    const editor = document.createElement('textarea');
    editor.className = 'ws-editor';
    editor.spellcheck = false;
    editor.value = draftOf(open);
    const markDirty = (text: string) => {
      ui.wsDrafts[open.path] = text;
      const save = main.querySelector('[data-ws-save]');
      if (save instanceof HTMLButtonElement) {
        save.disabled = !canSave();
      }
      const tab = main.querySelector('.ws-tab.on');
      const mark = tab?.querySelector('.ws-dirty');
      if (isDirty(open) && tab && !mark) {
        tab.insertAdjacentHTML('afterbegin', '<span class="ws-dirty">●</span>');
      }
      if (!isDirty(open)) {
        mark?.remove();
      }
    };
    editor.addEventListener('input', () => markDirty(editor.value));
    const host = adoptMonacoHost();
    stack.append(editor, host);
    bindMonacoEditor({
      host,
      stack,
      textarea: editor,
      file: open,
      onChange: markDirty,
      onSave: saveOpen,
    });
    body.append(crumb, stack);
  }
  return body;
}

function reviewBody(): HTMLElement {
  hookDiffFrame();
  const frame = document.createElement('iframe');
  frame.className = 'ws-diff';
  frame.title = tr('reviewTitle');
  frame.addEventListener('load', () => pushDiff(frame));
  frame.src = isDesktop() ? '../plugin/media/diff.html' : '/diff.html';
  return frame;
}

function saveOpen(): void {
  const open = activeFile();
  if (!open || open.binary || open.tooLarge) {
    return;
  }
  post({ type: 'saveWorkspaceFile', path: open.path, hash: open.hash ?? '', text: draftOf(open) });
}

function canSave(): boolean {
  const open = activeFile();
  if (!open || isReviewTab(open) || open.binary || open.tooLarge) {
    return false;
  }
  if (open.missing || open.text === undefined) {
    return true;
  }
  return Boolean(open.hash && isDirty(open));
}

function activeFile(): WsFile | undefined {
  return tabByPath(ui.wsActive) ?? ui.wsTabs[0];
}

function tabByPath(filePath: string): WsFile | undefined {
  const idx = findTab(filePath);
  return idx >= 0 ? ui.wsTabs[idx] : undefined;
}

function findTab(filePath: string, rel?: string): number {
  const wantReview = filePath.startsWith('diff:');
  const abs = filePath.replace(/\\/g, '/');
  const exact = ui.wsTabs.findIndex((tab) => {
    if (Boolean(tab.review) !== wantReview) {
      return false;
    }
    const path = tab.path.replace(/\\/g, '/');
    return path === abs || path === filePath || (rel !== undefined && tab.rel === rel);
  });
  if (exact >= 0) {
    return exact;
  }
  return ui.wsTabs.findIndex((tab) => {
    if (Boolean(tab.review) !== wantReview) {
      return false;
    }
    const suffix = tab.rel.replace(/\\/g, '/');
    return suffix !== '' && (abs === suffix || abs.endsWith(`/${suffix}`));
  });
}

function isReviewTab(file: WsFile | undefined): boolean {
  return Boolean(file?.review);
}

function ensureReviewTab(): string {
  const id = 'diff:review';
  const tab: WsFile = { path: id, rel: tr('grokDiff'), review: true };
  const idx = findTab(id);
  if (idx >= 0) {
    ui.wsTabs[idx] = { ...ui.wsTabs[idx], ...tab };
  } else {
    ui.wsTabs.push(tab);
  }
  return id;
}

function draftOf(file: WsFile): string {
  return file.path in ui.wsDrafts ? ui.wsDrafts[file.path] : (file.text ?? '');
}

function isDirty(file: WsFile): boolean {
  return file.text !== undefined && draftOf(file) !== file.text;
}

function tabLabel(file: WsFile): string {
  const name = file.rel.split('/').pop() ?? file.rel;
  const clash = ui.wsTabs.some((tab) => tab.path !== file.path && (tab.rel.split('/').pop() ?? tab.rel) === name);
  if (!clash) {
    return name;
  }
  const parent = file.rel.split('/').slice(-2, -1)[0];
  return parent ? `${parent}/${name}` : name;
}

function emptyRow(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ws-empty';
  el.textContent = text;
  return el;
}

function rootName(): string {
  if (ui.wsRootName) {
    return ui.wsRootName;
  }
  const raw = (ui.state.workspacePath ?? '').replace(/\\/g, '/');
  const base = raw.split('/').filter(Boolean).at(-1);
  return base || 'workspace';
}

function relOf(filePath: string): string {
  const root = (ui.state.workspacePath ?? '').replace(/\\/g, '/');
  const abs = filePath.replace(/\\/g, '/');
  if (root && abs.toLowerCase().startsWith(root.toLowerCase())) {
    return abs.slice(root.length).replace(/^\/+/, '');
  }
  return abs.split('/').pop() ?? abs;
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hookDiffFrame(): void {
  if (diffHooked) {
    return;
  }
  diffHooked = true;
  window.addEventListener('message', onDiffFrameMessage);
}

function pushDiff(frame: HTMLIFrameElement): void {
  if (!ui.wsDiff || !frame.contentWindow) {
    return;
  }
  frame.contentWindow.postMessage({ type: 'diff', payload: ui.wsDiff }, '*');
}

function onDiffFrameMessage(event: MessageEvent<{ source?: string; message?: { type: string; path?: string } }>): void {
  if (event.data?.source !== 'grok-diff' || !event.data.message) {
    return;
  }
  const msg = event.data.message;
  if (msg.type === 'ready') {
    const frame = document.querySelector('#grok-ws-shell iframe.ws-diff');
    if (frame instanceof HTMLIFrameElement) {
      frame.dataset.ready = '1';
      pushDiff(frame);
    }
    return;
  }
  post(msg as WebviewToHost);
}

function iconChevron(): string {
  return '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 6l4 4 4-4"/></svg>';
}

function iconFolder(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1.5 3.5h5l1.2 1.5H14.5v8H1.5z" opacity=".15"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M1.8 4h4.7l1.1 1.4H14.2v7.3H1.8z"/></svg>';
}

function iconFile(): string {
  return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 2.5h5.2L12 5.3V13.5H4z"/><path d="M9.2 2.5V5.3H12"/></svg>';
}
