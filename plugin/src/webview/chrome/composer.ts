import { contextTone, formatTokens } from '../../context/context';
import { looksLikeFilePath } from '../../edits/edits';
import { effortLabel, modelDisplayName } from '../../core/i18n';
import { lerpInt, liveEditSummary, type LiveEditSummary } from '../../edits/liveEdits';
import { FALLBACK_COMMANDS, filterCommands } from '../../chat/prompt/slash';
import type { Attachment, ChatState, ModelOption } from '../../core/types';
import { jumpBottomKind } from './scroll';
import { canSend, canType, isBooting, isDesktop, isRemoteWeb, loc, post, render, tr, turnBusy, ui } from '../app';
import { scrollTranscript } from '../transcript';
import { iconButton } from '../dom';
import { pickRemoteFiles, sendBrowserFiles } from './drop';
import { bindHoverPin, findPinned, pinFloating, releaseByClass } from './popover';
import { iconChevron, iconClose, iconDown, iconPlus, iconStar, iconStop } from '../icons';

function iconSend(): string {
  return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5V3.6M4.2 7.4 8 3.6l3.8 3.8"/></svg>';
}
import { escapeHtml } from '../transcript/markdown';

const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

export function mountComposer(parent: HTMLElement): void {
  if (document.getElementById('composer-wrap')) {
    return;
  }
  const footer = document.createElement('footer');
  footer.className = 'composer-wrap';
  footer.id = 'composer-wrap';
  const queue = document.createElement('div');
  queue.id = 'composer-queue';
  queue.className = 'queue';
  queue.hidden = true;
  const chips = document.createElement('div');
  chips.id = 'composer-chips';
  chips.className = 'chips';
  chips.style.display = 'none';
  const menuBox = document.createElement('div');
  menuBox.id = 'composer-menu-slot';
  const live = document.createElement('div');
  live.id = 'live-edits';
  live.className = 'live-edits';
  live.hidden = true;
  const card = document.createElement('div');
  card.id = 'composer-card';
  card.className = 'composer-card';
  const input = document.createElement('textarea');
  input.id = 'composer';
  input.rows = 2;
  bindComposerInput(input);
  const bar = document.createElement('div');
  bar.id = 'composer-bar';
  bar.className = 'composer-bar';
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.id = 'jump-bottom';
  jump.className = 'jump-bottom';
  jump.hidden = true;
  jump.addEventListener('click', jumpToLatest);
  card.append(input, bar, jump);
  footer.append(queue, chips, menuBox, live, card);
  parent.append(footer);
  ui.composer = input;
}

let barKey = '';
let chipKey = '';
let menuKey = '';
let pendingEffortModel: string | undefined;
let fileSearchTimer: ReturnType<typeof setTimeout> | undefined;

export function patchComposer(): void {
  if (!document.getElementById('composer-wrap')) {
    mountComposer(document.getElementById('app') ?? document.body);
  }
  const input =
    ui.composer ?? (document.getElementById('composer') as HTMLTextAreaElement | null);
  if (!input) {
    return;
  }
  ui.composer = input;
  patchQueue();
  const chips = document.getElementById('composer-chips');
  const nextChipKey = (ui.state.attachments ?? []).map((item) => item.id).join('|');
  if (chips && nextChipKey !== chipKey) {
    chipKey = nextChipKey;
    chips.replaceChildren();
    const attachments = ui.state.attachments ?? [];
    chips.style.display = attachments.length ? 'flex' : 'none';
    for (const attachment of attachments) {
      chips.append(attachmentChip(attachment));
    }
  }
  if (isBooting() || ui.state.settingsOpen) {
    releaseByClass('menu');
    releaseByClass('picker-menu');
    releaseByClass('ctx-tip');
    pendingEffortModel = undefined;
  }
  const menuSlot = document.getElementById('composer-menu-slot');
  const nextMenuKey = `${ui.menu ?? ''}:${ui.draft}:${(ui.state.fileHits ?? []).length}`;
  if (menuSlot && nextMenuKey !== menuKey) {
    menuKey = nextMenuKey;
    menuSlot.replaceChildren();
    releaseByClass('menu');
    if (!isBooting() && !ui.state.settingsOpen && ui.menu === 'slash') {
      pinFloating(slashMenu(), input, { prefer: 'above', align: 'start' });
    } else if (!isBooting() && !ui.state.settingsOpen && ui.menu === 'files') {
      pinFloating(fileMenu(), input, { prefer: 'above', align: 'start' });
    }
  }
  const card = document.getElementById('composer-card');
  if (card) {
    card.className =
      ui.state.status === 'streaming' ? 'composer-card live' : 'composer-card';
  }
  const placeholder = composerPlaceholder();
  if (input.placeholder !== placeholder) {
    input.placeholder = placeholder;
  }
  const disabled = !canType();
  if (input.disabled !== disabled) {
    input.disabled = disabled;
  }
  const composing = input.dataset.composing === '1';
  const focused = document.activeElement === input;
  if (ui.wantFocus) {
    ui.wantFocus = false;
    if (input.value !== ui.draft) {
      input.value = ui.draft;
      autosize(input);
    }
    input.focus();
    input.setSelectionRange(ui.draft.length, ui.draft.length);
  } else if (focused || composing) {
    ui.draft = input.value;
  } else if (input.value !== ui.draft) {
    input.value = ui.draft;
    autosize(input);
  }
  if (turnBusy() && ui.picker) {
    ui.picker = undefined;
  }
  const bar = document.getElementById('composer-bar');
  const nextBarKey = composerBarKey();
  if (bar && (nextBarKey !== barKey || bar.childElementCount === 0)) {
    barKey = nextBarKey;
    fillComposerBar(bar, input);
  } else if (bar) {
    patchContextMeter(bar);
  }
  patchLiveEdits();
  patchJumpBottom();
  syncComposerLift();
  if (input.dataset.composing !== '1') {
    autosize(input);
  }
}

function bindComposerInput(input: HTMLTextAreaElement): void {
  input.addEventListener('focus', () => {
    ui.composerFocused = true;
  });
  input.addEventListener('blur', () => {
    ui.composerFocused = false;
  });
  input.addEventListener('compositionstart', () => {
    input.dataset.composing = '1';
  });
  input.addEventListener('compositionend', () => {
    input.dataset.composing = '0';
    ui.draft = input.value;
  });
  input.addEventListener('input', () => {
    ui.draft = input.value;
    autosize(input);
    const last = ui.draft.split(/\s+/).pop() ?? '';
    if (last.startsWith('/')) {
      ui.menu = 'slash';
      ui.picker = undefined;
      render();
    } else if (last.startsWith('@')) {
      ui.menu = 'files';
      ui.picker = undefined;
      const query = last.slice(1);
      if (fileSearchTimer) {
        clearTimeout(fileSearchTimer);
      }
      fileSearchTimer = setTimeout(() => post({ type: 'searchFiles', query }), 160);
      render();
    } else if (ui.menu) {
      ui.menu = undefined;
      render();
    }
  });
  input.addEventListener('paste', (event) => {
    handlePaste(event);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (ui.lightboxSrc || ui.menu || ui.picker) {
        event.preventDefault();
        event.stopPropagation();
        ui.lightboxSrc = undefined;
        ui.menu = undefined;
        ui.picker = undefined;
        render();
      }
      return;
    }
    const sendKey = ui.state.multiline
      ? event.key === 'Enter' && (event.shiftKey || event.altKey)
      : event.key === 'Enter' && !event.shiftKey;
    if (sendKey) {
      event.preventDefault();
      sendFrom(input);
    }
  });
}

function fillComposerBar(bar: HTMLElement, input: HTMLTextAreaElement): void {
  const plus = iconButton(isRemoteWeb() ? tr('attachPick') : tr('attach'), iconPlus(), () => {
    if (isRemoteWeb()) {
      pickRemoteFiles();
      return;
    }
    post({ type: 'attach' });
  });
  const send = document.createElement('button');
  send.type = 'button';
  send.className = ui.state.status === 'streaming' ? 'send-fab stop' : 'send-fab';
  send.title = ui.state.status === 'streaming' ? tr('stop') : tr('send');
  send.disabled = ui.state.status === 'streaming' ? false : !canSend();
  if (ui.state.status === 'streaming') {
    send.innerHTML = iconStop();
    send.addEventListener('click', () => post({ type: 'cancel' }));
  } else {
    send.innerHTML = isDesktop() ? iconSend() : iconStar('14');
    send.addEventListener('click', () => sendFrom(input));
  }
  releaseByClass('picker-menu');
  bar.replaceChildren(plus, modePicker(), modelEffortPicker(), contextMeter(), send);
}

function composerBarKey(): string {
  const model = ui.state.models;
  const current = model?.available.find((item) => item.id === model.currentId);
  return [
    ui.state.status,
    ui.state.modeId ?? '',
    model?.currentId ?? '',
    current?.currentEffort ?? '',
    current?.efforts?.join(',') ?? '',
    ui.picker ?? '',
    pendingEffortModel ?? '',
    ui.state.locale ?? '',
    canType() ? '1' : '0',
    (model?.available.length ?? 0).toString(),
  ].join('|');
}

function patchContextMeter(bar: HTMLElement): void {
  const wrap = bar.querySelector('.ctx-meter') as HTMLElement | null;
  if (!wrap) {
    return;
  }
  const ctx = ui.state.context;
  const percent = ctx?.percent ?? 0;
  const key = `${percent}:${ctx?.used ?? ''}:${ctx?.total ?? ''}`;
  if (wrap.dataset.sig === key) {
    return;
  }
  wrap.dataset.sig = key;
  const compactAt = ctx?.compactAt ?? 85;
  const tone = contextTone(percent, compactAt);
  wrap.className = `ctx-meter ${tone}`;
  wrap.setAttribute(
    'aria-label',
    ctx ? `${tr('ctxTitle')} ${percent}%` : tr('ctxWaiting'),
  );
  const fill = wrap.querySelector('circle.fill') as SVGCircleElement | null;
  if (fill) {
    const radius = 10;
    const circ = 2 * Math.PI * radius;
    const offset = circ * (1 - Math.min(1, Math.max(0, percent / 100)));
    fill.setAttribute('stroke-dasharray', circ.toFixed(2));
    fill.setAttribute('stroke-dashoffset', offset.toFixed(2));
  }
  const tip = wrap.querySelector('.ctx-tip') ?? findPinned('.ctx-tip');
  if (tip instanceof HTMLElement) {
    fillContextTip(tip, ctx, percent, compactAt);
  }
}

function contextMeter(): HTMLElement {
  const wrap = document.createElement('div');
  const ctx = ui.state.context;
  const percent = ctx?.percent ?? 0;
  const compactAt = ctx?.compactAt ?? 85;
  const tone = contextTone(percent, compactAt);
  wrap.className = `ctx-meter ${tone}`;
  wrap.setAttribute('role', 'img');
  wrap.setAttribute(
    'aria-label',
    ctx ? `${tr('ctxTitle')} ${percent}%` : tr('ctxWaiting'),
  );
  const radius = 10;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - Math.min(1, Math.max(0, percent / 100)));
  wrap.innerHTML = `<svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true">
    <circle class="track" cx="14" cy="14" r="${radius}" fill="none" stroke-width="2.5"/>
    <circle class="fill" cx="14" cy="14" r="${radius}" fill="none" stroke-width="2.5"
      stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}"
      stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 14 14)"/>
  </svg>`;
  const tip = contextTip(ctx, percent, compactAt);
  wrap.append(tip);
  bindHoverPin(wrap, tip, { prefer: 'above', align: 'end' });
  return wrap;
}

function contextTip(
  ctx: ChatState['context'],
  percent: number,
  compactAt: number,
): HTMLElement {
  const tip = document.createElement('div');
  tip.className = 'ctx-tip';
  fillContextTip(tip, ctx, percent, compactAt);
  return tip;
}

function fillContextTip(
  tip: HTMLElement,
  ctx: ChatState['context'],
  percent: number,
  compactAt: number,
): void {
  tip.replaceChildren();
  if (!ctx || ctx.total <= 0) {
    tip.textContent = tr('ctxWaiting');
    return;
  }
  const rows: Array<[string, string]> = [
    [tr('ctxTitle'), `${percent}%`],
    ['', `${formatTokens(ctx.used)} / ${formatTokens(ctx.total)}`],
  ];
  if (ctx.systemTokens !== undefined) {
    rows.push([tr('ctxSystem'), formatTokens(ctx.systemTokens)]);
  }
  if (ctx.messageTokens !== undefined) {
    rows.push([tr('ctxMessages'), formatTokens(ctx.messageTokens)]);
  }
  if (ctx.toolTokens !== undefined) {
    rows.push([tr('ctxTools'), formatTokens(ctx.toolTokens)]);
  }
  if (ctx.free !== undefined) {
    rows.push([tr('ctxFree'), formatTokens(ctx.free)]);
  }
  for (const cat of ctx.categories ?? []) {
    rows.push([cat.detail ? `${cat.label} · ${cat.detail}` : cat.label, formatTokens(cat.tokens)]);
  }
  rows.push([tr('ctxCompact', { pct: compactAt }), '']);
  for (const [label, value] of rows) {
    const line = document.createElement('div');
    line.className = 'ctx-tip-row';
    const left = document.createElement('span');
    left.textContent = label;
    line.append(left);
    if (value) {
      const right = document.createElement('span');
      right.textContent = value;
      line.append(right);
    }
    tip.append(line);
  }
}

function currentModel(): ModelOption | undefined {
  return ui.state.models?.available.find((m) => m.id === ui.state.models?.currentId);
}

function modelById(id?: string): ModelOption | undefined {
  if (!id) {
    return undefined;
  }
  return ui.state.models?.available.find((m) => m.id === id);
}

function currentModelLabel(): string {
  const model = currentModel();
  return modelDisplayName(model?.id ?? ui.state.models?.currentId, model?.name) || 'Grok';
}

function currentModeId(): string {
  const current = ui.state.modeId ?? 'default';
  return current === 'ask' || current === 'plan' ? current : 'default';
}

function currentModeLabel(): string {
  const id = currentModeId();
  if (id === 'ask') {
    return tr('modeAsk');
  }
  if (id === 'plan') {
    return tr('modePlan');
  }
  return tr('modeAgent');
}

function currentEffortValue(model?: ModelOption): string {
  const target = model ?? currentModel();
  if (target?.currentEffort) {
    return target.currentEffort;
  }
  const choices = effortChoices(target);
  return choices.includes('high') ? 'high' : (choices[0] ?? 'high');
}

function effortChoices(model?: ModelOption): string[] {
  const listed = (model ?? currentModel())?.efforts?.filter((item) => item.trim().length > 0);
  if (listed && listed.length > 0) {
    return listed;
  }
  return FALLBACK_EFFORTS;
}

function displayEffort(level?: string): string {
  if (!level) {
    return tr('switchEffort');
  }
  return effortLabel(loc(), level) || level;
}

function combinedModelEffortLabel(): string {
  const model = modelById(pendingEffortModel) ?? currentModel();
  const name = modelDisplayName(model?.id ?? ui.state.models?.currentId, model?.name) || 'Grok';
  const effort = displayEffort(currentEffortValue(model));
  return effort ? `${name} · ${effort}` : name;
}

function modePicker(): HTMLElement {
  const current = currentModeId();
  return pickerControl({
    kind: 'mode',
    label: currentModeLabel(),
    title: tr('switchMode'),
    disabled: turnBusy(),
    items: [
      { id: 'ask', label: tr('modeAsk'), selected: current === 'ask' },
      { id: 'plan', label: tr('modePlan'), selected: current === 'plan' },
      { id: 'default', label: tr('modeAgent'), selected: current === 'default' },
    ],
    onPick: (id) => post({ type: 'setMode', modeId: id }),
  });
}

function modelEffortPicker(): HTMLElement {
  const models = ui.state.models?.available ?? [];
  const open = ui.picker === 'model' || ui.picker === 'effort';
  const wrap = document.createElement('div');
  wrap.className = 'picker model';
  wrap.addEventListener('click', (event) => event.stopPropagation());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = open ? 'picker-btn open' : 'picker-btn';
  const locked = turnBusy() || !canType() || models.length === 0;
  btn.title = locked && turnBusy() ? tr('busyLock') : tr('switchModel');
  btn.disabled = locked;
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  const text = document.createElement('span');
  text.className = 'picker-label';
  text.textContent = combinedModelEffortLabel();
  btn.append(text);
  btn.insertAdjacentHTML('beforeend', iconChevron());
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (locked) {
      return;
    }
    if (open) {
      ui.picker = undefined;
      pendingEffortModel = undefined;
    } else {
      ui.picker = 'model';
      pendingEffortModel = ui.state.models?.currentId;
    }
    ui.moreOpen = false;
    ui.menu = undefined;
    render();
  });
  wrap.append(btn);
  if (!open || ui.state.settingsOpen) {
    return wrap;
  }
  if (ui.picker === 'effort') {
    const model = modelById(pendingEffortModel) ?? currentModel();
    const selectedEffort = currentEffortValue(model);
    const efforts = effortChoices(model);
    const list = pickerMenu(
      efforts.map((level) => ({
        id: level,
        label: displayEffort(level),
        selected: level === selectedEffort,
      })),
      (item) => {
        ui.picker = undefined;
        pendingEffortModel = undefined;
        if (!item.selected) {
          post({ type: 'setEffort', level: item.id });
        }
        render();
      },
    );
    pinFloating(list, btn, { prefer: 'above', align: 'end' });
    return wrap;
  }
  if (models.length === 0) {
    return wrap;
  }
  const list = pickerMenu(
    models.map((model) => ({
      id: model.id,
      label: modelDisplayName(model.id, model.name) || model.id,
      selected: model.id === (pendingEffortModel ?? ui.state.models?.currentId),
    })),
    (item) => {
      pendingEffortModel = item.id;
      if (ui.state.models) {
        ui.state.models = { ...ui.state.models, currentId: item.id };
      }
      if (!item.selected) {
        post({ type: 'setModel', modelId: item.id });
      }
      const picked = modelById(item.id);
      ui.picker = effortChoices(picked).length ? 'effort' : undefined;
      if (ui.picker !== 'effort') {
        pendingEffortModel = undefined;
      }
      render();
    },
  );
  pinFloating(list, btn, { prefer: 'above', align: 'end' });
  return wrap;
}

function pickerControl(opts: {
  kind: 'mode' | 'model' | 'effort';
  label: string;
  title: string;
  disabled: boolean;
  items: Array<{ id: string; label: string; selected: boolean }>;
  onPick: (id: string) => void;
}): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `picker ${opts.kind}`;
  wrap.addEventListener('click', (event) => event.stopPropagation());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = ui.picker === opts.kind ? 'picker-btn open' : 'picker-btn';
  btn.title = opts.disabled && turnBusy() ? tr('busyLock') : opts.title;
  btn.disabled = opts.disabled;
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', ui.picker === opts.kind ? 'true' : 'false');
  const text = document.createElement('span');
  text.className = 'picker-label';
  text.textContent = opts.label;
  btn.append(text);
  btn.insertAdjacentHTML('beforeend', iconChevron());
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    if (opts.disabled) {
      return;
    }
    ui.picker = ui.picker === opts.kind ? undefined : opts.kind;
    pendingEffortModel = undefined;
    ui.moreOpen = false;
    ui.menu = undefined;
    render();
  });
  wrap.append(btn);
  if (ui.picker === opts.kind && opts.items.length > 0 && !ui.state.settingsOpen) {
    const list = pickerMenu(opts.items, (item) => {
      ui.picker = undefined;
      if (!item.selected) {
        opts.onPick(item.id);
      }
      render();
    });
    pinFloating(list, btn, {
      prefer: 'above',
      align: 'start',
    });
  }
  return wrap;
}

function pickerMenu(
  items: Array<{ id: string; label: string; selected: boolean }>,
  onPick: (item: { id: string; label: string; selected: boolean }) => void,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'picker-menu';
  list.setAttribute('role', 'listbox');
  list.addEventListener('click', (event) => event.stopPropagation());
  for (const item of items) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = item.selected ? 'picker-item on' : 'picker-item';
    option.setAttribute('role', 'option');
    option.textContent = item.label;
    option.addEventListener('click', () => onPick(item));
    list.append(option);
  }
  return list;
}

function slashMenu(): HTMLElement {
  const query = (ui.draft.split(/\s+/).pop() ?? '').replace(/^\//, '');
  const hits = filterCommands(
    ui.state.commands.length ? ui.state.commands : FALLBACK_COMMANDS,
    query,
  );
  const el = document.createElement('div');
  el.className = 'menu';
  el.addEventListener('click', (event) => event.stopPropagation());
  for (const cmd of hits) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.innerHTML = `<code>/${escapeHtml(cmd.name)}</code> <span>${escapeHtml(cmd.description)}</span>`;
    item.addEventListener('click', () => {
      ui.draft = `/${cmd.name}${cmd.hint ? ' ' : ''}`;
      ui.menu = undefined;
      ui.wantFocus = true;
      render();
    });
    el.append(item);
  }
  return el;
}

function fileMenu(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'menu';
  el.addEventListener('click', (event) => event.stopPropagation());
  for (const hit of ui.state.fileHits ?? []) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.textContent = hit.label;
    item.addEventListener('click', () => {
      post({ type: 'pickFile', path: hit.path });
      ui.draft = ui.draft.replace(/@[^\s]*$/, '').trimEnd();
      ui.menu = undefined;
      ui.wantFocus = true;
      render();
    });
    el.append(item);
  }
  if (!ui.state.fileHits?.length) {
    const empty = document.createElement('div');
    empty.className = 'menu-item';
    empty.textContent = tr('fileSearchHint');
    el.append(empty);
  }
  return el;
}

function handlePaste(event: ClipboardEvent): void {
  const data = event.clipboardData;
  if (!data) {
    return;
  }
  let files = [...data.files];
  if (files.length === 0) {
    for (const item of [...data.items]) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }
  }
  const uris = (data.getData('text/uri-list') || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const text = data.getData('text');
  if (files.length === 0 && uris.length === 0 && !looksLikeFilePath(text)) {
    return;
  }
  event.preventDefault();
  void sendBrowserFiles(files, { text, uris });
}

function patchQueue(): void {
  const el = document.getElementById('composer-queue');
  if (!el) {
    return;
  }
  const items = ui.state.queue ?? [];
  el.hidden = items.length === 0;
  if (!items.length) {
    el.replaceChildren();
    el.dataset.q = '';
    return;
  }
  const key = items.join('\0');
  if (el.dataset.q === key) {
    return;
  }
  el.dataset.q = key;
  el.replaceChildren();
  const head = document.createElement('div');
  head.className = 'queue-head';
  head.textContent = tr('queued', { n: items.length });
  el.append(head);
  for (let i = 0; i < items.length; i += 1) {
    const row = document.createElement('div');
    row.className = 'queue-item';
    const text = document.createElement('span');
    text.className = 'queue-text';
    text.textContent = items[i] ?? '';
    const drop = iconButton(tr('cancel'), iconClose(), () => {
      post({ type: 'dropQueue', index: i });
    });
    row.append(text, drop);
    el.append(row);
  }
}

function sendFrom(input: HTMLTextAreaElement): void {
  const text = input.value.trim();
  if ((!text && !ui.state.attachments?.length) || !canType()) {
    return;
  }
  post({ type: 'send', text });
  ui.draft = '';
  ui.menu = undefined;
  ui.stickToBottom = true;
  input.value = '';
  autosize(input);
  scrollTranscript();
}

function autosize(input: HTMLTextAreaElement): void {
  const before = input.style.height;
  input.style.height = 'auto';
  const next = `${Math.min(Math.max(input.scrollHeight, 44), 160)}px`;
  input.style.height = next;
  if (before !== next) {
    scrollTranscript();
  }
}

function syncComposerLift(): void {
  const wrap = document.getElementById('composer-wrap');
  if (!wrap) {
    return;
  }
  let lift = 0;
  for (const id of ['composer-queue', 'composer-chips', 'live-edits']) {
    const el = document.getElementById(id);
    if (!el || el.hidden) {
      continue;
    }
    const style = getComputedStyle(el);
    if (style.display === 'none') {
      continue;
    }
    lift += el.offsetHeight + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
  }
  wrap.style.setProperty('--composer-lift', `${Math.round(lift)}px`);
}

function composerPlaceholder(): string {
  if (ui.state.status === 'login' || ui.state.status === 'authenticating') {
    return tr('placeholderLogin');
  }
  if (ui.state.status === 'streaming') {
    return tr('placeholderQueue');
  }
  return isDesktop() ? tr('placeholderDesk') : tr('placeholderAsk');
}

function attachmentChip(attachment: Attachment): HTMLElement {
  const image =
    attachment.data && attachment.mimeType?.startsWith('image/')
      ? `data:${attachment.mimeType};base64,${attachment.data}`
      : undefined;
  if (image) {
    const tile = document.createElement('div');
    tile.className = 'attach-tile';
    const img = document.createElement('img');
    img.alt = attachment.label;
    img.src = image;
    img.addEventListener('click', () => {
      ui.lightboxSrc = image;
      render();
    });
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'attach-x';
    x.title = tr('removeAttach');
    x.textContent = '×';
    x.addEventListener('click', (event) => {
      event.stopPropagation();
      post({ type: 'removeAttachment', id: attachment.id });
    });
    tile.append(img, x);
    return tile;
  }
  const chip = document.createElement('span');
  chip.className = 'chip';
  const label = document.createElement('span');
  label.textContent = attachment.label;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'chip-x';
  x.title = tr('removeAttach');
  x.textContent = '×';
  x.addEventListener('click', () => post({ type: 'removeAttachment', id: attachment.id }));
  chip.append(label, x);
  return chip;
}

const TICK_MS = 280;
let liveHideTimer: ReturnType<typeof setTimeout> | undefined;
let liveRaf = 0;
let liveShown = { files: 0, added: 0, removed: 0 };
let liveFrom = { files: 0, added: 0, removed: 0 };
let liveTo = { files: 0, added: 0, removed: 0 };
let liveTickStart = 0;

function patchLiveEdits(): void {
  const wrap = document.getElementById('composer-wrap');
  let el = document.getElementById('live-edits');
  if (!el && wrap) {
    el = document.createElement('div');
    el.id = 'live-edits';
    el.className = 'live-edits';
    el.hidden = true;
    const card = document.getElementById('composer-card');
    wrap.insertBefore(el, card ?? null);
  }
  if (!el) {
    return;
  }
  const summary = liveEditSummary(ui.state);
  if (!summary) {
    hideLiveEdits(el);
    return;
  }
  if (liveHideTimer) {
    clearTimeout(liveHideTimer);
    liveHideTimer = undefined;
  }
  const first = el.hidden || el.childElementCount === 0;
  if (first) {
    el.replaceChildren(mountLiveEditsInner(summary));
    liveShown = { files: 0, added: 0, removed: 0 };
  }
  el.hidden = false;
  el.classList.remove('leave');
  el.dataset.id = summary.messageId;
  const label = el.querySelector('.live-edits-label');
  if (label) {
    label.textContent = tr('liveEdits', { n: summary.files });
  }
  const review = el.querySelector('.live-edits-review') as HTMLButtonElement | null;
  if (review) {
    review.onclick = () => post({ type: 'reviewEdits', messageId: summary.messageId });
  }
  tickLiveCounts(el, summary, first);
}

function mountLiveEditsInner(summary: LiveEditSummary): DocumentFragment {
  const frag = document.createDocumentFragment();
  const rail = document.createElement('span');
  rail.className = 'live-edits-rail';
  const star = document.createElement('span');
  star.className = 'mark pulse';
  star.innerHTML = iconStar('11');
  const label = document.createElement('span');
  label.className = 'live-edits-label';
  label.textContent = tr('liveEdits', { n: summary.files });
  const stats = document.createElement('span');
  stats.className = 'live-edits-stats';
  stats.innerHTML =
    '<span class="add" data-kind="added">+0</span> <span class="del" data-kind="removed">−0</span>';
  const review = document.createElement('button');
  review.type = 'button';
  review.className = 'live-edits-review';
  review.textContent = tr('review');
  review.addEventListener('click', () =>
    post({ type: 'reviewEdits', messageId: summary.messageId }),
  );
  frag.append(rail, star, label, stats, review);
  return frag;
}

function hideLiveEdits(el: HTMLElement): void {
  if (el.hidden || el.classList.contains('leave')) {
    return;
  }
  el.classList.add('leave');
  if (liveRaf) {
    cancelAnimationFrame(liveRaf);
    liveRaf = 0;
  }
  liveHideTimer = setTimeout(() => {
    el.hidden = true;
    el.classList.remove('leave');
    el.replaceChildren();
    liveShown = { files: 0, added: 0, removed: 0 };
    liveHideTimer = undefined;
    syncComposerLift();
  }, 180);
}

function tickLiveCounts(el: HTMLElement, summary: LiveEditSummary, first: boolean): void {
  const next = { files: summary.files, added: summary.added, removed: summary.removed };
  if (
    liveShown.files === next.files &&
    liveShown.added === next.added &&
    liveShown.removed === next.removed &&
    !first
  ) {
    return;
  }
  if (liveRaf) {
    cancelAnimationFrame(liveRaf);
  }
  liveFrom = { ...liveShown };
  liveTo = next;
  liveTickStart = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - liveTickStart) / TICK_MS);
    const files = lerpInt(liveFrom.files, liveTo.files, t);
    const added = lerpInt(liveFrom.added, liveTo.added, t);
    const removed = lerpInt(liveFrom.removed, liveTo.removed, t);
    paintLiveCounts(el, files, added, removed, t < 1);
    if (t < 1) {
      liveRaf = requestAnimationFrame(step);
      return;
    }
    liveRaf = 0;
    liveShown = liveTo;
    paintLiveCounts(el, liveTo.files, liveTo.added, liveTo.removed, false);
  };
  liveRaf = requestAnimationFrame(step);
}

export function jumpToLatest(): void {
  ui.stickToBottom = true;
  scrollTranscript(true);
  patchJumpBottom();
}

export function patchJumpBottom(): void {
  const el = ensureJumpBottom();
  if (!el) {
    return;
  }
  const kind = jumpBottomKind({
    stickToBottom: ui.stickToBottom,
    streaming: ui.state.status === 'streaming',
  });
  if (kind === 'hidden') {
    el.hidden = true;
    el.classList.remove('dots');
    return;
  }
  el.hidden = false;
  el.title = kind === 'dots' ? tr('jumpBottomLive') : tr('jumpBottom');
  el.setAttribute('aria-label', el.title);
  const nextMode = kind === 'dots' ? 'dots' : 'arrow';
  if (el.dataset.mode === nextMode && el.childElementCount > 0) {
    return;
  }
  el.dataset.mode = nextMode;
  el.classList.toggle('dots', kind === 'dots');
  if (kind === 'dots') {
    el.replaceChildren(jumpDots());
  } else {
    el.innerHTML = iconDown();
  }
}

function ensureJumpBottom(): HTMLButtonElement | null {
  const card = document.getElementById('composer-card');
  let el = document.getElementById('jump-bottom') as HTMLButtonElement | null;
  if (!el && card) {
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'jump-bottom';
    el.className = 'jump-bottom';
    el.hidden = true;
    el.addEventListener('click', jumpToLatest);
    card.append(el);
  }
  if (el && card && el.parentElement !== card) {
    card.append(el);
  }
  return el;
}

function jumpDots(): HTMLElement {
  const row = document.createElement('span');
  row.className = 'jump-dots';
  row.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i += 1) {
    row.append(document.createElement('i'));
  }
  return row;
}

function paintLiveCounts(
  el: HTMLElement,
  files: number,
  added: number,
  removed: number,
  ticking: boolean,
): void {
  const label = el.querySelector('.live-edits-label');
  if (label) {
    label.textContent = tr('liveEdits', { n: files });
  }
  const add = el.querySelector('[data-kind="added"]');
  const del = el.querySelector('[data-kind="removed"]');
  if (add) {
    add.textContent = `+${added}`;
    add.classList.toggle('tick', ticking && added !== liveFrom.added);
  }
  if (del) {
    del.textContent = `−${removed}`;
    del.classList.toggle('tick', ticking && removed !== liveFrom.removed);
  }
}
