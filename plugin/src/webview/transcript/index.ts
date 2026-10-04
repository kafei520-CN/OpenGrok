import { totals } from '../../edits/edits';
import { formatDuration, toolKindLabel, turnSourceText } from '../../core/i18n';
import { permissionButtonClass, permissionLabelKey } from '../../core/permissions';
import { permissionActions, permissionNeedsCancel, permissionTarget } from '../../core/permissions/permissionView';
import { renderTermHtml } from '../../terminal/termAnsi';
import type {
  ChatMessage,
  ChatState,
  FileEdit,
  PermissionOption,
  PermissionPrompt,
  PlanStep,
} from '../../core/types';
import { copyText, isDesktop, loc, post, render, tr, ui } from '../app';
import { bindHoverPin } from '../chrome/popover';
import { patchJumpBottom } from '../chrome/composer';
import { shouldPinToBottom, stickFromScroll, type TranscriptScroll } from '../chrome/scroll';
import { bootStar, errorCard, home, loginCard, panel, setupCard } from '../chrome';
import { superGrokKind } from '../shell/superGrokMark';
import { button, iconButton } from '../dom';
import {
  iconAskHint,
  iconCheck,
  iconChevron,
  iconClock,
  iconClose,
  iconCopy,
  iconEdit,
  iconFork,
  iconRewind,
  iconStar,
  grokBootMark,
  toolIcon,
} from '../icons';
import {
  fileName,
  renderMarkdown,
  splitStreamingMarkdown,
  STREAM_LIVE_KEEP,
  streamingMarkdownPatch,
} from './markdown';
import { fileLinkHtml } from './fileLinks';
import {
  HISTORY_SLICE_TURNS,
  HISTORY_TAIL,
  paintAlign,
  shouldLoadOlder,
  tailStart,
} from './historyPaint';
import { fireOgPatch } from '../ogPlugins';
import { post } from '../app';
import { openInDockBrowser, revealSteps } from '../shell/toolsDock';
import { traceBeats, type TurnBeat } from '../../session/traceBeats';
import { fileIconSvg } from './fileIcons';
import { takeHeroFiles } from './fileLinks';

type Turn = { user?: ChatMessage; assistant?: ChatMessage };

const STREAM_MD_MS = 80;
const pendingMarkdown = new WeakMap<HTMLElement, { src: string; timer: ReturnType<typeof setTimeout> }>();
const streamCommitted = new WeakMap<HTMLElement, string>();

export function renderBody(): HTMLElement {
  const el = document.createElement('main');
  el.className = 'body';
  el.dataset.kind = bodyKind(ui.state);
  fillBody(el);
  return el;
}

export function patchBody(parent: HTMLElement): void {
  const kind = bodyKind(ui.state);
  let body = document.getElementById('grok-body') as HTMLElement | null;
  if (!body) {
    cancelHistoryPaint();
    body = renderBody();
    body.id = 'grok-body';
    const header = document.getElementById('grok-header');
    const composer = document.getElementById('composer-wrap');
    if (composer && composer.parentElement === parent) {
      parent.insertBefore(body, composer);
    } else if (header?.nextSibling) {
      parent.insertBefore(body, header.nextSibling);
    } else {
      parent.append(body);
    }
    bindTranscriptScroll();
    pinChatIfNeeded();
    return;
  }
  if (body.dataset.kind !== kind) {
    cancelHistoryPaint();
    const next = renderBody();
    next.id = 'grok-body';
    body.replaceWith(next);
    bindTranscriptScroll();
    pinChatIfNeeded();
    return;
  }
  if (kind === 'chat') {
    patchTranscript();
    patchPermission(body);
    patchAsk(body);
    patchErrorBanner(body);
    return;
  }
  if (kind.startsWith('login') || kind.startsWith('home') || kind === 'restoring') {
    const next = renderBody();
    next.id = 'grok-body';
    body.replaceWith(next);
  }
}

function bodyKind(state: ChatState): string {
  if (state.status === 'untrusted') {
    return 'untrusted';
  }
  if (state.status === 'missingCli') {
    return 'missingCli';
  }
  if (state.status === 'connecting') {
    return 'connecting';
  }
  if (state.status === 'login' || state.status === 'authenticating') {
    return `login:${state.status}:${state.login?.url ?? ''}`;
  }
  if (state.status === 'error' && state.messages.length === 0) {
    return `error:${state.error ?? ''}`;
  }
  if (state.restoringSession) {
    return 'restoring';
  }
  if (state.messages.length === 0) {
    const brand = superGrokKind(state.account, state.billing) ?? 'logo';
    return `home:${state.sessions?.length ?? 0}:${state.currentSessionId ?? ''}:${brand}:${state.billing?.subscriptionTier ?? ''}`;
  }
  return 'chat';
}

function fillBody(el: HTMLElement): void {
  const status = ui.state.status;
  if (status === 'untrusted') {
    el.append(panel(tr('untrustedTitle'), tr('untrustedBody')));
    return;
  }
  if (status === 'missingCli') {
    el.append(setupCard());
    return;
  }
  if (status === 'connecting') {
    el.append(bootStar());
    if (ui.state.permission) {
      el.append(permissionBar());
    }
    if (visibleAsk()) {
      el.append(askBar());
    }
    return;
  }
  if (status === 'login' || status === 'authenticating') {
    el.append(loginCard());
    return;
  }
  if (status === 'error' && ui.state.messages.length === 0) {
    el.append(errorCard());
    return;
  }
  if (ui.state.restoringSession) {
    el.append(bootStar(true));
    return;
  }
  if (ui.state.messages.length === 0) {
    el.append(home());
    if (ui.state.permission) {
      el.append(permissionBar());
    }
    if (visibleAsk()) {
      el.append(askBar());
    }
  } else {
    const transcript = document.createElement('div');
    transcript.className = 'transcript';
    transcript.id = 'transcript';
    syncTranscript(transcript);
    if (ui.state.permission) {
      transcript.append(permissionBar());
    }
    if (visibleAsk()) {
      transcript.append(askBar());
    }
    el.append(transcript);
    revealSteps(ui.state.messages);
  }
  if (ui.state.error && status === 'error') {
    el.append(errorBanner(ui.state.error));
  }
}

function patchTranscript(): void {
  const transcript = document.getElementById('transcript');
  if (!transcript) {
    return;
  }
  if (
    ui.state.status === 'streaming' &&
    !ui.editingUserId &&
    transcript.dataset.sid === (ui.state.currentSessionId ?? '') &&
    patchLastStreamingTurn(transcript)
  ) {
    revealSteps(ui.state.messages);
    scrollTranscript();
    syncWorkClock();
    return;
  }
  syncTranscript(transcript);
  dockPrompts(transcript);
  revealSteps(ui.state.messages);
  scrollTranscript();
  syncWorkClock();
}

let historyPaintGen = 0;
let historyPaintRaf = 0;
/** Last host olderCount we already asked for, so a scroll doesn't re-request the same page. */
let askedOlder = -1;

function cancelHistoryPaint(): void {
  historyPaintGen += 1;
  if (historyPaintRaf) {
    cancelAnimationFrame(historyPaintRaf);
    historyPaintRaf = 0;
  }
  document.getElementById('transcript')?.classList.remove('catching-up');
}

function syncTranscript(transcript: HTMLElement): void {
  const session = ui.state.currentSessionId ?? '';
  if (transcript.dataset.sid !== session) {
    cancelHistoryPaint();
    clearTurns(transcript);
    transcript.dataset.sid = session;
    askedOlder = -1;
  }
  const grouped = groupTurns(ui.state.messages);
  const wanted = grouped.map(turnId);
  const nodes = turnNodes(transcript);
  const align = paintAlign(
    wanted,
    nodes.map((node) => node.dataset.turnId ?? ''),
  );
  if (align.kind === 'equal') {
    patchTurnRange(grouped, nodes, 0);
    return;
  }
  if (align.kind === 'prefix') {
    if (align.extra > HISTORY_TAIL) {
      // 一次接上大段历史时，顺着已画的开头往下补会从第一轮铺到最后一轮。
      paintOpenTail(transcript, grouped);
      return;
    }
    patchTurnRange(grouped, nodes, 0);
    paintTurnRange(transcript, grouped, nodes.length, grouped.length);
    return;
  }
  if (align.kind === 'trim') {
    patchTurnRange(grouped, nodes.slice(0, grouped.length), 0);
    while (turnNodes(transcript).length > grouped.length) {
      turnNodes(transcript).at(-1)?.remove();
    }
    return;
  }
  if (align.kind === 'suffix') {
    patchTurnRange(grouped, nodes, grouped.length - nodes.length);
    queueViewportFill(transcript);
    return;
  }
  paintOpenTail(transcript, grouped);
}

/** 打开历史时只画最新几轮，并钉在底部。更早的轮次等滚到顶边再向上补。 */
function paintOpenTail(transcript: HTMLElement, grouped: Turn[]): void {
  cancelHistoryPaint();
  clearTurns(transcript);
  const start = tailStart(grouped.length);
  paintTurnRange(transcript, grouped, start, grouped.length);
  queueViewportFill(transcript);
}

function clearTurns(transcript: HTMLElement): void {
  for (const node of turnNodes(transcript)) {
    node.remove();
  }
}

function paintTurnRange(
  transcript: HTMLElement,
  grouped: Turn[],
  start: number,
  end: number,
): void {
  if (start >= end) {
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    frag.append(turnEl(grouped[i], i < grouped.length - 1));
  }
  const anchor = promptAnchor(transcript);
  if (anchor) {
    transcript.insertBefore(frag, anchor);
  } else {
    transcript.append(frag);
  }
}

function patchTurnRange(grouped: Turn[], nodes: HTMLElement[], offset: number): void {
  for (let i = 0; i < nodes.length; i++) {
    const at = offset + i;
    const turn = grouped[at];
    if (!turn) {
      break;
    }
    syncTurnNode(nodes[i], turn, at < grouped.length - 1);
  }
}

function syncTurnNode(node: HTMLElement, turn: Turn, split: boolean): void {
  const id = turnId(turn);
  if (node.dataset.turnId !== id) {
    node.replaceWith(turnEl(turn, split));
    return;
  }
  if (turn.assistant?.streaming) {
    syncUserBubble(node, turn.user);
    patchStreamingTurn(node, turn);
    return;
  }
  if (turn.assistant && !turn.assistant.streaming) {
    node.querySelector('.trace.live')?.classList.remove('live');
  }
  const sig = turnSig(turn, split);
  if (node.dataset.sig !== sig) {
    node.replaceWith(turnEl(turn, split));
  } else if (
    !isDesktop() &&
    turn.assistant &&
    visibleSteps(turn.assistant).length &&
    !node.querySelector('.steps-card')
  ) {
    node.replaceWith(turnEl(turn, split));
  }
}

function olderTurnCount(transcript: HTMLElement): number {
  const grouped = groupTurns(ui.state.messages);
  const align = paintAlign(
    grouped.map(turnId),
    turnNodes(transcript).map((node) => node.dataset.turnId ?? ''),
  );
  return align.kind === 'suffix' ? align.extra : 0;
}

/** 把紧挨着已画尾部的更早几轮插到上面，阅读位置不动。 */
function prependOlder(transcript: HTMLElement, limit: number): boolean {
  const grouped = groupTurns(ui.state.messages);
  const nodes = turnNodes(transcript);
  const align = paintAlign(
    grouped.map(turnId),
    nodes.map((node) => node.dataset.turnId ?? ''),
  );
  if (align.kind !== 'suffix' || align.extra <= 0) {
    return false;
  }
  const count = Math.min(limit, align.extra);
  const start = align.extra - count;
  const fromBottom = transcript.scrollHeight - transcript.scrollTop;
  const frag = document.createDocumentFragment();
  for (let i = start; i < align.extra; i += 1) {
    const turn = grouped[i];
    if (!turn) {
      break;
    }
    frag.append(turnEl(turn, i < grouped.length - 1));
  }
  const anchor = nodes[0] ?? promptAnchor(transcript);
  if (anchor) {
    transcript.insertBefore(frag, anchor);
  } else {
    transcript.append(frag);
  }
  assignScrollTop(transcript, transcript.scrollHeight - fromBottom);
  fireOgPatch();
  return true;
}

/** 尾部还不满一屏时逐帧向上补，补满就停，避免把整段历史一次性铺开。 */
function queueViewportFill(transcript: HTMLElement): void {
  if (historyPaintRaf) {
    return;
  }
  if (transcript.clientHeight > 0 && transcript.scrollHeight > transcript.clientHeight + 8) {
    return;
  }
  const token = historyPaintGen;
  const run = () => {
    historyPaintRaf = 0;
    if (token !== historyPaintGen) {
      return;
    }
    if (document.getElementById('transcript') !== transcript) {
      return;
    }
    if (transcript.scrollHeight > transcript.clientHeight + 8) {
      schedulePin();
      return;
    }
    if (!prependOlder(transcript, HISTORY_SLICE_TURNS)) {
      if ((ui.state.olderCount ?? 0) > 0) {
        requestHostOlder();
        return;
      }
      schedulePin();
      return;
    }
    historyPaintRaf = requestAnimationFrame(run);
  };
  historyPaintRaf = requestAnimationFrame(run);
}

function requestHostOlder(): void {
  const count = ui.state.olderCount ?? 0;
  if (count <= 0 || askedOlder === count || ui.state.restoringSession) {
    return;
  }
  askedOlder = count;
  post({ type: 'loadOlder' });
}

function scheduleOlderPage(transcript: HTMLElement): void {
  if (historyPaintRaf) {
    return;
  }
  const token = historyPaintGen;
  historyPaintRaf = requestAnimationFrame(() => {
    historyPaintRaf = 0;
    if (token !== historyPaintGen) {
      return;
    }
    if (document.getElementById('transcript') !== transcript) {
      return;
    }
    if (
      !shouldLoadOlder({
        scrollTop: transcript.scrollTop,
        scrollHeight: transcript.scrollHeight,
        clientHeight: transcript.clientHeight,
        olderCount: olderTurnCount(transcript),
      })
    ) {
      return;
    }
    prependOlder(transcript, HISTORY_SLICE_TURNS);
  });
}

function lastTurn(messages: ChatMessage[]): Turn | undefined {
  const last = messages.at(-1);
  if (!last) {
    return undefined;
  }
  if (last.role === 'assistant') {
    const prev = messages.at(-2);
    if (prev?.role === 'user') {
      return { user: prev, assistant: last };
    }
    return { assistant: last };
  }
  return { user: last };
}

function patchLastStreamingTurn(transcript: HTMLElement): boolean {
  const turn = lastTurn(ui.state.messages);
  if (!turn?.assistant?.streaming) {
    return false;
  }
  const node = turnNodes(transcript).at(-1);
  if (!node || node.dataset.turnId !== turnId(turn)) {
    return false;
  }
  patchStreamingTurn(node, turn);
  return true;
}

function patchStreamingTurn(node: HTMLElement, turn: Turn): void {
  const assistant = turn.assistant;
  if (!assistant) {
    return;
  }
  const col = node.querySelector('.msg.assistant') as HTMLElement | null;
  if (!col) {
    node.replaceWith(turnEl(turn, false));
    return;
  }
  if (hasWork(assistant)) {
    let trace = col.querySelector('.trace');
    if (!(trace instanceof HTMLElement)) {
      trace = traceBlock(assistant);
      col.prepend(trace);
    } else {
      const nextClass = assistant.streaming ? 'trace live' : 'trace';
      if (trace.className !== nextClass) {
        trace.className = nextClass;
      }
      patchTrace(trace, assistant);
    }
    col.querySelector('details.work')?.remove();
    col.querySelector('.pulse')?.remove();
  }
  if (assistant.text) {
    let answer = col.querySelector('.md.answer') as HTMLElement | null;
    if (!answer) {
      answer = document.createElement('div');
      answer.className = 'md answer';
      const trace = col.querySelector('.trace');
      if (trace) {
        trace.after(answer);
      } else {
        col.prepend(answer);
      }
    }
    paintAnswer(answer, assistant);
    col.querySelector('.pulse')?.remove();
  }
  const liveTrace = col.querySelector('.trace');
  if (liveTrace instanceof HTMLElement) {
    syncElapsed(liveTrace, assistant);
  }
  patchErrorCard(col, assistant);
  placeSteps(col, assistant);
}

function traceBlock(message: ChatMessage): HTMLElement {
  const el = document.createElement('div');
  el.className = message.streaming ? 'trace live' : 'trace';
  el.dataset.mid = message.id;
  const beats = document.createElement('div');
  beats.className = 'trace-beats';
  el.append(beats);
  patchTrace(el, message);
  return el;
}

function finishedWork(message: ChatMessage, trace: HTMLElement): HTMLElement {
  const details = document.createElement('details');
  details.className = 'work';
  details.open = ui.workOpen.get(message.id) ?? false;
  details.addEventListener('toggle', (event) => {
    if (!event.isTrusted) {
      return;
    }
    ui.workOpen.set(message.id, details.open);
  });
  const summary = document.createElement('summary');
  const label = document.createElement('span');
  label.className = 'work-label';
  const time = turnElapsed(message);
  label.textContent = time ? tr('elapsed', { time }) : tr('thinking');
  summary.append(label);
  details.append(summary, trace);
  return details;
}

function liveFoot(): HTMLElement {
  const foot = document.createElement('div');
  foot.className = 'trace-live-foot';
  foot.hidden = true;
  const mark = document.createElement('span');
  mark.className = 'trace-live-mark';
  mark.innerHTML = grokBootMark();
  const time = document.createElement('span');
  time.className = 'trace-live-time';
  const compact = document.createElement('div');
  compact.className = 'trace-compact';
  compact.hidden = true;
  const copy = document.createElement('div');
  copy.className = 'trace-compact-copy';
  const meter = document.createElement('div');
  meter.className = 'trace-compact-meter';
  const track = document.createElement('div');
  track.className = 'trace-compact-track';
  const fill = document.createElement('div');
  fill.className = 'trace-compact-fill';
  track.append(fill);
  const pct = document.createElement('span');
  pct.className = 'trace-compact-pct';
  meter.append(track, pct);
  compact.append(copy, meter);
  foot.append(mark, time, compact);
  return foot;
}

function beatHost(trace: HTMLElement): HTMLElement {
  const found = trace.querySelector(':scope > .trace-beats');
  if (found instanceof HTMLElement) {
    return found;
  }
  const host = document.createElement('div');
  host.className = 'trace-beats';
  trace.append(host);
  return host;
}

function patchTrace(trace: HTMLElement, message: ChatMessage): void {
  const host = beatHost(trace);
  const beats = traceBeats(message).filter((beat) => !isCompactBeat(beat, message));
  const plan = message.plan?.trim() ?? '';
  const keys = beats.map((beat, index) => beatKey(beat, index));
  if (plan) {
    keys.push('plan');
  }
  const children = [...host.children] as HTMLElement[];
  const same =
    children.length === keys.length && children.every((node, index) => node.dataset.beat === keys[index]);
  if (!same) {
    const pool = new Map(children.map((node) => [node.dataset.beat ?? '', node]));
    const frag = document.createDocumentFragment();
    beats.forEach((beat, index) => {
      const key = beatKey(beat, index);
      const node = pool.get(key) ?? createBeat(beat, message);
      node.dataset.beat = key;
      updateBeat(node, beat, message);
      frag.append(node);
    });
    if (plan) {
      const node = pool.get('plan') ?? createPlanBeat();
      node.dataset.beat = 'plan';
      const copy = node.querySelector('.trace-copy');
      if (copy instanceof HTMLElement) {
        setMarkdown(copy, plan, Boolean(message.streaming));
      }
      frag.append(node);
    }
    host.replaceChildren(frag);
  } else {
    beats.forEach((beat, index) => {
      const node = children[index];
      if (node) {
        updateBeat(node, beat, message);
      }
    });
    if (plan) {
      const copy = children[beats.length]?.querySelector('.trace-copy');
      if (copy instanceof HTMLElement) {
        setMarkdown(copy, plan, Boolean(message.streaming));
      }
    }
  }
  trace.classList.toggle('quiet', beats.length === 0 && !plan);
  syncElapsed(trace, message);
}

function turnElapsed(message: ChatMessage): string {
  if (!message.createdAt) {
    return '';
  }
  const start = Date.parse(message.createdAt);
  if (Number.isNaN(start)) {
    return '';
  }
  const end = message.endedAt ? Date.parse(message.endedAt) : Date.now();
  if (Number.isNaN(end)) {
    return '';
  }
  const ms = Math.max(0, end - start);
  if (message.streaming && ms < 1000) {
    return '';
  }
  return formatDuration(ms);
}

function compactTool(message: ChatMessage): ChatMessage['tools'][number] | undefined {
  return message.tools.find((tool) => tool.kind === 'compact');
}

function isCompactBeat(beat: TurnBeat, message: ChatMessage): boolean {
  if (beat.kind !== 'tool') {
    return false;
  }
  return message.tools.find((tool) => tool.id === beat.id)?.kind === 'compact';
}

function isCompactOnly(message: ChatMessage): boolean {
  if (!compactTool(message)) {
    return false;
  }
  if (message.text.trim() || message.thinking?.trim() || message.plan?.trim()) {
    return false;
  }
  return message.tools.every((tool) => tool.kind === 'compact');
}

/** Climbs toward 92% while the compact call is still open. */
function compactPercent(tool: ChatMessage['tools'][number], message: ChatMessage): number {
  const start = Date.parse(tool.startedAt ?? message.createdAt ?? '');
  const elapsed = Number.isNaN(start) ? 0 : Math.max(0, Date.now() - start);
  const eased = 1 - Math.exp(-elapsed / 14_000);
  return Math.max(8, Math.min(92, Math.round(8 + 84 * eased)));
}

function syncElapsed(trace: HTMLElement, message: ChatMessage): void {
  const time = turnElapsed(message);
  const live = Boolean(message.streaming);
  const tool = compactTool(message);
  const compacting = tool?.status === 'in_progress' || tool?.status === 'pending';
  const keep = isCompactOnly(message) && !message.error;
  const foot = placeLiveFoot(trace, live || keep);
  if (!(foot instanceof HTMLElement)) {
    return;
  }
  foot.hidden = false;
  const label = foot.querySelector('.trace-live-time');
  const compact = foot.querySelector('.trace-compact');
  if (compacting && tool && compact instanceof HTMLElement) {
    if (label instanceof HTMLElement) {
      label.hidden = true;
    }
    compact.hidden = false;
    const copy = compact.querySelector('.trace-compact-copy');
    if (copy) {
      copy.textContent = tr('compactLive');
    }
    const percent = compactPercent(tool, message);
    const fill = compact.querySelector('.trace-compact-fill');
    if (fill instanceof HTMLElement) {
      fill.style.width = `${percent}%`;
    }
    const pct = compact.querySelector('.trace-compact-pct');
    if (pct) {
      pct.textContent = `${percent}%`;
    }
    return;
  }
  if (compact instanceof HTMLElement) {
    compact.hidden = true;
  }
  if (label instanceof HTMLElement) {
    label.hidden = false;
    label.textContent = time ? tr('elapsedLive', { time }) : tr('thinkingNow');
  }
}

function placeLiveFoot(trace: HTMLElement, show: boolean): HTMLElement | null {
  const col = trace.closest('.msg.assistant');
  if (!(col instanceof HTMLElement)) {
    return null;
  }
  trace.querySelector(':scope > .trace-live-foot')?.remove();
  let foot = col.querySelector(':scope > .trace-live-foot');
  if (!show) {
    foot?.remove();
    return null;
  }
  if (!(foot instanceof HTMLElement)) {
    foot = liveFoot();
  }
  if (foot.parentElement !== col || col.lastElementChild !== foot) {
    col.append(foot);
  }
  return foot;
}

function beatKey(beat: TurnBeat, index: number): string {
  if (beat.kind === 'tool') {
    return `tool:${beat.id}`;
  }
  if (beat.kind === 'task') {
    return `task:${index}:${beat.phase}:${beat.id}`;
  }
  return `think:${index}`;
}

function createBeat(beat: TurnBeat, message: ChatMessage): HTMLElement {
  if (beat.kind === 'task') {
    return createTaskBeat();
  }
  if (beat.kind === 'tool') {
    const tool = message.tools.find((item) => item.id === beat.id);
    return tool ? createToolBeat(tool) : createThinkBeat();
  }
  return createThinkBeat();
}

function createTaskBeat(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'trace-item trace-task';
  const mark = document.createElement('span');
  mark.className = 'trace-mark';
  mark.innerHTML =
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.2 4.6h1.1M6.2 4.6h6.4M3.2 8h1.1M6.2 8h6.4M3.2 11.4h1.1M6.2 11.4h6.4"/></svg>';
  const label = document.createElement('span');
  label.className = 'trace-task-label';
  row.append(mark, label);
  return row;
}

function taskLabel(beat: Extract<TurnBeat, { kind: 'task' }>): string {
  const name = beat.phase === 'completed' ? tr('taskCompleted') : tr('taskStarted');
  return `${name} ${beat.text}`;
}

function createThinkBeat(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'trace-item trace-think';
  const mark = document.createElement('span');
  mark.className = 'trace-mark';
  mark.innerHTML = iconClock();
  const copy = document.createElement('div');
  copy.className = 'trace-copy md thinking';
  row.append(mark, copy);
  return row;
}

function createPlanBeat(): HTMLElement {
  const row = createThinkBeat();
  row.classList.add('trace-plan');
  return row;
}

function createToolBeat(tool: ChatMessage['tools'][number]): HTMLElement {
  const row = document.createElement('div');
  row.className = `trace-item trace-tool tool-row ${tool.status}`;
  row.dataset.id = tool.id;
  if (tool.kind) {
    row.dataset.kind = tool.kind;
  }
  const mark = document.createElement('span');
  mark.className = 'trace-mark';
  paintToolMark(mark, tool);
  const main = document.createElement('div');
  main.className = 'trace-main';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'trace-tool-head';
  const name = document.createElement('span');
  name.className = 'trace-tool-name';
  const chevron = document.createElement('span');
  chevron.className = 'trace-chevron';
  chevron.innerHTML = iconChevron();
  head.append(name, chevron);
  head.addEventListener('click', () => {
    const next = !row.classList.contains('open');
    ui.termOpen.set(tool.id, next);
    row.classList.toggle('open', next);
    const body = row.querySelector('.trace-tool-body');
    if (body instanceof HTMLElement) {
      body.hidden = !next;
      if (next) {
        const live = ui.state.messages.flatMap((item) => item.tools).find((item) => item.id === tool.id);
        if (live) {
          fillToolBody(body, live);
          row.dataset.sig = toolRowSig(live);
        }
      }
    }
  });
  const body = document.createElement('div');
  body.className = 'trace-tool-body';
  main.append(head, body);
  row.append(mark, main);
  return row;
}

function updateBeat(node: HTMLElement, beat: TurnBeat, message: ChatMessage): void {
  if (beat.kind === 'think') {
    const copy = node.querySelector('.trace-copy');
    if (copy instanceof HTMLElement) {
      setMarkdown(copy, beat.text, Boolean(message.streaming));
    }
    return;
  }
  if (beat.kind === 'task') {
    const label = node.querySelector('.trace-task-label');
    if (label) {
      label.textContent = taskLabel(beat);
    }
    return;
  }
  const tool = message.tools.find((item) => item.id === beat.id);
  if (!tool) {
    return;
  }
  node.className = `trace-item trace-tool tool-row ${tool.status}${toolHasBody(tool) ? '' : ' bare'}`;
  node.dataset.id = tool.id;
  if (tool.kind) {
    node.dataset.kind = tool.kind;
  }
  const mark = node.querySelector('.trace-mark');
  if (mark instanceof HTMLElement) {
    paintToolMark(mark, tool);
  }
  const name = node.querySelector('.trace-tool-name');
  if (name) {
    name.textContent = toolHead(tool);
  }
  const open = toolOpen(tool) && toolHasBody(tool);
  node.classList.toggle('open', open);
  const body = node.querySelector('.trace-tool-body');
  if (!(body instanceof HTMLElement)) {
    return;
  }
  body.hidden = !open;
  const sig = toolRowSig(tool);
  if (node.dataset.sig !== sig) {
    node.dataset.sig = sig;
    if (open) {
      fillToolBody(body, tool);
    }
  } else if (open) {
    paintTermElapsed(node, tool);
  }
}

function paintToolMark(mark: HTMLElement, tool: ChatMessage['tools'][number]): void {
  const key = `${tool.status}|${tool.kind ?? ''}`;
  if (mark.dataset.sig === key) {
    return;
  }
  mark.dataset.sig = key;
  if (tool.status === 'completed') {
    mark.innerHTML = iconCheck();
    mark.title = tr('toolOk');
    return;
  }
  if (tool.status === 'failed') {
    mark.innerHTML = iconClose();
    mark.title = tr('toolFailed');
    return;
  }
  mark.title = tr('toolRunning');
  const glyph = toolIcon(tool.kind);
  if (glyph.startsWith('<svg')) {
    mark.innerHTML = glyph;
    return;
  }
  mark.textContent = glyph;
}

function toolOpen(tool: ChatMessage['tools'][number]): boolean {
  const saved = ui.termOpen.get(tool.id);
  if (saved !== undefined) {
    return saved;
  }
  return tool.status === 'in_progress' || tool.status === 'pending';
}

function toolHasBody(tool: ChatMessage['tools'][number]): boolean {
  return isTermTool(tool) || Boolean(tool.detail) || Boolean(tool.output) || Boolean(tool.command);
}

function toolHead(tool: ChatMessage['tools'][number]): string {
  const kind = toolKindLabel(loc(), tool.kind);
  if (isTermTool(tool) || tool.kind === 'compact') {
    return kind;
  }
  if (tool.detail) {
    return `${kind} · ${fileName(tool.detail)}`;
  }
  return tool.title || kind;
}

function fillToolBody(body: HTMLElement, tool: ChatMessage['tools'][number]): void {
  body.replaceChildren();
  if (tool.detail && !isTermTool(tool)) {
    const detail = document.createElement('button');
    detail.className = 'tool-detail';
    detail.type = 'button';
    detail.textContent = tool.detail;
    detail.addEventListener('click', () => post({ type: 'openFile', path: tool.detail! }));
    body.append(detail);
  }
  if (isTermTool(tool)) {
    body.append(termPreview(tool));
  }
}

function setMarkdown(el: HTMLElement, src: string, streaming: boolean): void {
  const flush = (text: string, mode: 's' | 'd'): void => {
    const len = String(text.length);
    if (el.dataset.len === len && el.dataset.md === mode) {
      return;
    }
    el.dataset.len = len;
    el.dataset.md = mode;
    if (mode === 'd') {
      el.replaceChildren();
      streamCommitted.delete(el);
      el.innerHTML = renderMarkdown(text);
      return;
    }
    paintStreamingMarkdown(el, text);
  };
  const cancel = (): void => {
    const hold = pendingMarkdown.get(el);
    if (hold) {
      clearTimeout(hold.timer);
      pendingMarkdown.delete(el);
    }
  };
  if (!streaming) {
    cancel();
    if (src.length > 48_000) {
      setTimeout(() => flush(src, 'd'), 0);
      return;
    }
    flush(src, 'd');
    return;
  }
  const hold = pendingMarkdown.get(el);
  if (hold) {
    hold.src = src;
    return;
  }
  if (!el.dataset.len) {
    flush(src, 's');
  }
  const delay = Math.min(320, STREAM_MD_MS + Math.floor(src.length / 40));
  pendingMarkdown.set(el, {
    src,
    timer: setTimeout(() => {
      const next = pendingMarkdown.get(el);
      pendingMarkdown.delete(el);
      if (next && el.dataset.md !== 'd') {
        flush(next.src, 's');
      }
    }, delay),
  });
}

function paintStreamingMarkdown(el: HTMLElement, text: string): void {
  const prev = streamCommitted.get(el) ?? '';
  const { committed, rest } = splitStreamingMarkdown(text, prev);
  let stable = el.querySelector(':scope > .md-stable') as HTMLElement | null;
  let live = el.querySelector(':scope > .md-live') as HTMLElement | null;
  if (!stable || !live) {
    stable = document.createElement('div');
    stable.className = 'md-stable';
    live = document.createElement('div');
    live.className = 'md-live';
    el.replaceChildren(stable, live);
    streamCommitted.delete(el);
  }
  const patch = streamingMarkdownPatch(streamCommitted.get(el) ?? '', committed);
  if (patch.replace !== undefined) {
    stable.replaceChildren();
    if (patch.replace) {
      appendCommitted(stable, patch.replace);
    }
    streamCommitted.set(el, committed);
  } else if (patch.append) {
    appendCommitted(stable, patch.append);
    streamCommitted.set(el, committed);
  }
  paintLiveMarkdown(live, rest, true);
}

function appendCommitted(stable: HTMLElement, added: string): void {
  if (added.length > 16_000) {
    const p = document.createElement('p');
    p.className = 'md-chunk-plain';
    p.textContent = added;
    stable.append(p);
    return;
  }
  stable.insertAdjacentHTML('beforeend', renderMarkdown(added));
}

function paintLiveMarkdown(live: HTMLElement, rest: string, cheap: boolean): void {
  if (!rest) {
    live.classList.remove('md-live-plain');
    live.replaceChildren();
    delete live.dataset.key;
    return;
  }
  if (cheap) {
    const shown = rest.length > STREAM_LIVE_KEEP ? rest.slice(-STREAM_LIVE_KEEP) : rest;
    const key = `t:${shown.length}:${rest.length}`;
    if (live.dataset.key === key) {
      return;
    }
    live.dataset.key = key;
    live.classList.add('md-live-plain');
    const node = live.firstChild;
    if (node && node.nodeType === Node.TEXT_NODE) {
      const prev = (node as Text).data;
      if (shown.startsWith(prev)) {
        (node as Text).appendData(shown.slice(prev.length));
        return;
      }
      (node as Text).data = shown;
      return;
    }
    live.replaceChildren(document.createTextNode(shown));
    return;
  }
  const liveKey = `m:${rest.length}`;
  if (live.dataset.key === liveKey) {
    return;
  }
  live.dataset.key = liveKey;
  live.classList.remove('md-live-plain');
  live.innerHTML = renderMarkdown(rest);
}

function visibleAsk(): ChatState['ask'] {
  const ask = ui.state.ask;
  if (!ask || ask.requestId === ui.askDismissedId) {
    return undefined;
  }
  return ask;
}

function promptHost(body: HTMLElement): HTMLElement {
  return document.getElementById('transcript') ?? body;
}

function turnNodes(transcript: HTMLElement): HTMLElement[] {
  return [...transcript.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('turn'),
  );
}

function promptAnchor(transcript: HTMLElement): Element | null {
  return transcript.querySelector(':scope > .permission, :scope > .ask-card.ask-prompt');
}

function insertTurn(transcript: HTMLElement, turn: HTMLElement): void {
  const anchor = promptAnchor(transcript);
  if (anchor) {
    transcript.insertBefore(turn, anchor);
    return;
  }
  transcript.append(turn);
}

function dockPrompts(transcript: HTMLElement): void {
  for (const el of [...transcript.querySelectorAll(':scope > .permission, :scope > .ask-card.ask-prompt')]) {
    transcript.append(el);
  }
}

function promptAskCards(body: HTMLElement): HTMLElement[] {
  return [...promptHost(body).querySelectorAll(':scope > .ask-card.ask-prompt')] as HTMLElement[];
}

function clearAskLocal(): void {
  ui.askDismissedId = ui.state.ask?.requestId ?? ui.askDismissedId;
  ui.state.ask = undefined;
  ui.askOtherOpen = false;
  ui.askOtherDraft = '';
  ui.askPicked.clear();
  ui.askPickStamp = '';
}

function patchAsk(body: HTMLElement): void {
  const cards = promptAskCards(body);
  const ask = visibleAsk();
  if (!ask) {
    for (const card of cards) {
      card.remove();
    }
    ui.askOtherOpen = false;
    ui.askOtherDraft = '';
    ui.askPicked.clear();
    ui.askPickStamp = '';
    return;
  }
  ui.askDismissedId = '';
  const stamp = `${ask.requestId}:${ask.index ?? 0}`;
  if (ui.askPickStamp !== stamp) {
    ui.askPickStamp = stamp;
    ui.askOtherOpen = false;
    ui.askOtherDraft = '';
    ui.askPicked.clear();
  }
  const other = ui.askOtherOpen ? '1' : '0';
  const open = (ui.askOpen.get(ask.requestId) ?? true) ? '1' : '0';
  const picked = [...ui.askPicked].sort().join('|');
  const existing = cards[0];
  for (const extra of cards.slice(1)) {
    extra.remove();
  }
  if (
    existing?.dataset.id === ask.requestId &&
    existing.dataset.stamp === stamp &&
    existing.dataset.other === other &&
    existing.dataset.open === open &&
    existing.dataset.picked === picked
  ) {
    return;
  }
  if (existing) {
    fillAskCard(existing);
    promptHost(body).append(existing);
    return;
  }
  promptHost(body).append(fillAskCard());
}

function patchPermission(body: HTMLElement): void {
  const host = promptHost(body);
  const existing = host.querySelector(':scope > .permission') as HTMLElement | null;
  const perm = ui.state.permission;
  if (!perm) {
    existing?.remove();
    return;
  }
  if (existing?.dataset.id === perm.requestId) {
    host.append(existing);
    return;
  }
  existing?.remove();
  host.append(permissionBar());
}

function patchErrorBanner(body: HTMLElement): void {
  const existing = body.querySelector('.error-banner');
  if (ui.state.error && ui.state.status === 'error') {
    if (existing) {
      existing.textContent = ui.state.error;
      return;
    }
    body.append(errorBanner(ui.state.error));
    return;
  }
  existing?.remove();
}

function errorBanner(text: string): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'error-banner';
  banner.textContent = text;
  return banner;
}

const scrollState: TranscriptScroll = {
  stickToBottom: true,
  transcriptScroll: 0,
  lastUserScroll: 0,
  pinLock: false,
};

let pinFrame = 0;
let pinDepth = 0;
let contentObserver: ResizeObserver | null = null;
let childObserver: MutationObserver | null = null;

function pinChatIfNeeded(): void {
  if (bodyKind(ui.state) !== 'chat') {
    return;
  }
  if (!ui.stickToBottom) {
    return;
  }
  scrollTranscript(true);
}

export function scrollTranscript(force = false): void {
  const el = document.getElementById('transcript');
  if (!el) {
    return;
  }
  bindTranscriptScroll(el);
  if (el.classList.contains('catching-up')) {
    return;
  }
  if (force && ui.stickToBottom) {
    scrollState.lastUserScroll = 0;
  }
  scrollState.stickToBottom = ui.stickToBottom;
  if (
    !shouldPinToBottom({
      stickToBottom: ui.stickToBottom,
      lightbox: Boolean(ui.lightboxSrc),
      now: Date.now(),
      lastUserScroll: scrollState.lastUserScroll,
      force,
    })
  ) {
    return;
  }
  schedulePin();
}

function holdPinLock(): void {
  pinDepth += 1;
  scrollState.pinLock = true;
}

function releasePinLock(): void {
  requestAnimationFrame(() => {
    pinDepth = Math.max(0, pinDepth - 1);
    scrollState.pinLock = pinDepth > 0;
  });
}

function assignScrollTop(el: HTMLElement, top: number): void {
  const next = Math.max(0, top);
  if (Math.abs(el.scrollTop - next) < 1) {
    ui.transcriptScroll = el.scrollTop;
    scrollState.transcriptScroll = el.scrollTop;
    return;
  }
  holdPinLock();
  el.scrollTop = next;
  ui.transcriptScroll = el.scrollTop;
  scrollState.transcriptScroll = el.scrollTop;
  releasePinLock();
}

function pinTranscript(el: HTMLElement): void {
  assignScrollTop(el, el.scrollHeight);
}

function schedulePin(): void {
  if (pinFrame) {
    return;
  }
  pinFrame = requestAnimationFrame(() => {
    pinFrame = 0;
    const node = document.getElementById('transcript');
    if (!node || node.classList.contains('catching-up')) {
      return;
    }
    if (
      !shouldPinToBottom({
        stickToBottom: ui.stickToBottom,
        lightbox: Boolean(ui.lightboxSrc),
        now: Date.now(),
        lastUserScroll: scrollState.lastUserScroll,
      })
    ) {
      return;
    }
    pinTranscript(node);
    patchJumpBottom();
  });
}

function noteHold(): void {
  scrollState.lastUserScroll = Date.now();
}

function bindTranscriptScroll(el?: HTMLElement | null): void {
  const node = el ?? document.getElementById('transcript');
  if (!node || node.dataset.scrollBound === '1') {
    return;
  }
  node.dataset.scrollBound = '1';
  node.addEventListener(
    'pointerdown',
    () => {
      let moved = false;
      noteHold();
      const move = () => {
        moved = true;
        noteHold();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        if (!moved) {
          scrollState.lastUserScroll = 0;
        }
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    },
    { passive: true },
  );
  node.addEventListener('wheel', noteHold, { passive: true });
  node.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'PageUp' ||
        event.key === 'PageDown' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === ' '
      ) {
        noteHold();
      }
    },
    { passive: true },
  );
  node.addEventListener(
    'scroll',
    () => {
      const next = stickFromScroll(scrollState, {
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      });
      if (next === scrollState) {
        return;
      }
      scrollState.stickToBottom = next.stickToBottom;
      scrollState.transcriptScroll = next.transcriptScroll;
      ui.stickToBottom = next.stickToBottom;
      ui.transcriptScroll = next.transcriptScroll;
      patchJumpBottom();
      if (
        shouldLoadOlder({
          scrollTop: node.scrollTop,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          olderCount: olderTurnCount(node) || ui.state.olderCount || 0,
        })
      ) {
        if (olderTurnCount(node) > 0) {
          scheduleOlderPage(node);
        } else {
          requestHostOlder();
        }
      }
    },
    { passive: true },
  );
  watchTranscriptSize(node);
}

function watchTranscriptSize(node: HTMLElement): void {
  contentObserver?.disconnect();
  childObserver?.disconnect();
  contentObserver = new ResizeObserver(() => {
    schedulePin();
  });
  contentObserver.observe(node);
  for (const child of node.children) {
    if (child instanceof HTMLElement) {
      contentObserver.observe(child);
    }
  }
  childObserver = new MutationObserver((records) => {
    if (!contentObserver) {
      return;
    }
    for (const record of records) {
      for (const removed of record.removedNodes) {
        if (removed instanceof HTMLElement) {
          contentObserver.unobserve(removed);
        }
      }
      for (const added of record.addedNodes) {
        if (added instanceof HTMLElement) {
          contentObserver.observe(added);
        }
      }
    }
  });
  childObserver.observe(node, { childList: true });
}

function turnId(turn: Turn): string {
  return `${turn.user?.id ?? ''}:${turn.assistant?.id ?? ''}`;
}

function turnSig(turn: Turn, split: boolean): string {
  const a = turn.assistant;
  const sum = totals(a?.edits ?? []);
  return [
    split ? '1' : '0',
    a?.streaming ? '1' : '0',
    a?.text.length ?? 0,
    a?.thinking?.length ?? 0,
    a?.plan?.length ?? 0,
    a?.tools.length ?? 0,
    a?.edits?.length ?? 0,
    sum.added,
    sum.removed,
    a?.images?.length ?? 0,
    a?.error?.code ?? '',
    a?.error?.message ?? '',
    a?.error?.retrying ? 'r' : '',
    a?.error?.attempt ?? 0,
    a?.compact ?? '',
    a?.tools.find((tool) => tool.kind === 'compact')?.status ?? '',
    ui.copiedId === a?.id ? 'c' : '',
    stepsKey(a ? visibleSteps(a) : undefined),
    turn.user?.text.length ?? 0,
    turn.user?.files?.length ?? 0,
    turn.user?.images?.length ?? 0,
    ui.editingUserId === turn.user?.id ? 'e' : '',
    ui.copiedId === turn.user?.id ? 'uc' : '',
  ].join(':');
}

function groupTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ user: message });
    } else {
      const last = turns.at(-1);
      if (last && !last.assistant) {
        last.assistant = message;
      } else {
        turns.push({ assistant: message });
      }
    }
  }
  return turns;
}

function turnEl(turn: Turn, split: boolean): HTMLElement {
  const el = document.createElement('section');
  el.className = 'turn';
  el.dataset.turnId = turnId(turn);
  el.dataset.sig = turnSig(turn, split);
  if (turn.user) {
    el.append(userBubble(turn.user));
  }
  if (turn.assistant) {
    el.append(assistantColumn(turn.assistant));
  }
  if (split) {
    el.append(turnSplit());
  }
  return el;
}

function turnSplit(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'turn-split';
  el.innerHTML = `<span></span><span class="mark">${iconStar('10')}</span><span></span>`;
  return el;
}

function syncUserBubble(node: HTMLElement, user: ChatMessage | undefined): void {
  if (!user) {
    return;
  }
  const userNode = node.querySelector('.msg.user') as HTMLElement | null;
  if (!userNode) {
    return;
  }
  const editing = ui.editingUserId === user.id;
  const hasEditor = Boolean(userNode.querySelector('textarea.user-edit'));
  if (editing !== hasEditor) {
    userNode.replaceWith(userBubble(user));
  }
}

function userBubble(message: ChatMessage): HTMLElement {
  const el = document.createElement('article');
  el.className = 'msg user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const editing = ui.editingUserId === message.id;
  if (editing) {
    const input = document.createElement('textarea');
    input.className = 'user-edit';
    input.value = ui.editDraft;
    input.rows = Math.min(12, Math.max(3, ui.editDraft.split('\n').length + 1));
    input.addEventListener('input', () => {
      ui.editDraft = input.value;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        ui.editingUserId = undefined;
        ui.editDraft = '';
        render();
        return;
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submitUserEdit(message);
      }
    });
    bubble.append(input);
    queueMicrotask(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  } else if (message.text) {
    const body = document.createElement('div');
    body.className = 'md';
    setMarkdown(body, message.text, false);
    bubble.append(body);
  }
  if (!editing && message.files?.length) {
    bubble.append(messageFileRow(message));
  }
  if (!editing && message.images?.length) {
    bubble.append(imageGallery(message.images));
  }
  el.append(bubble, userActions(message, editing));
  return el;
}

function messageFileRow(message: ChatMessage): HTMLElement {
  const row = document.createElement('div');
  row.className = 'msg-files';
  for (const file of message.files ?? []) {
    if (!file.path && !file.folder && !file.mimeType) {
      const quote = document.createElement('span');
      quote.className = 'chip chip-quote';
      quote.textContent = file.label;
      row.append(quote);
      continue;
    }
    const wrap = document.createElement('span');
    wrap.innerHTML = fileLinkHtml(
      file.folder
        ? { kind: 'folder', name: file.label, path: file.path }
        : { kind: 'file', name: file.label, path: file.path },
    );
    const node = wrap.firstElementChild;
    if (node) {
      row.append(node);
    }
  }
  return row;
}

function userActions(message: ChatMessage, editing: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'user-actions';
  if (editing) {
    row.append(
      iconButton(tr('send'), iconCheck(), () => submitUserEdit(message)),
      iconButton(tr('cancel'), iconClose(), () => {
        ui.editingUserId = undefined;
        ui.editDraft = '';
        render();
      }),
    );
    return row;
  }
  if (canEditUser(message)) {
    row.append(
      iconButton(tr('editMessage'), iconEdit(), () => {
        ui.editingUserId = message.id;
        ui.editDraft = message.text;
        render();
      }),
    );
  }
  const copy = iconButton(ui.copiedId === message.id ? tr('copied') : tr('copy'), iconCopy(), () => {
    copyMessage(message);
  });
  if (ui.copiedId === message.id) {
    copy.classList.add('copied');
    copy.innerHTML = iconCheck();
  }
  copy.disabled = !message.text;
  row.append(copy);
  return row;
}

function copyMessage(message: ChatMessage): void {
  if (!message.text) {
    return;
  }
  copyText(message.text);
  ui.copiedId = message.id;
  if (ui.copiedTimer !== undefined) {
    window.clearTimeout(ui.copiedTimer);
  }
  ui.copiedTimer = window.setTimeout(() => {
    ui.copiedId = undefined;
    ui.copiedTimer = undefined;
    render();
  }, 1400);
  render();
}

function canEditUser(message: ChatMessage): boolean {
  const lastUser = [...ui.state.messages].reverse().find((item) => item.role === 'user');
  return lastUser?.id === message.id;
}

function submitUserEdit(message: ChatMessage): void {
  const text = ui.editDraft.trim();
  if (!text) {
    return;
  }
  ui.editingUserId = undefined;
  ui.editDraft = '';
  ui.stickToBottom = true;
  post({ type: 'editUserPrompt', messageId: message.id, text });
  render();
  scrollTranscript(true);
}

function paintAnswer(body: HTMLElement, message: ChatMessage): void {
  const split = takeHeroFiles(message.text);
  setMarkdown(body, split.body, Boolean(message.streaming));
  const parent = body.parentElement;
  if (!parent) {
    return;
  }
  let cards = parent.querySelector(':scope > .hero-files');
  if (!split.paths.length) {
    cards?.remove();
    return;
  }
  if (!(cards instanceof HTMLElement)) {
    cards = document.createElement('div');
    cards.className = 'hero-files';
    body.after(cards);
  }
  const key = split.paths.join('\n');
  if (cards.dataset.files === key) {
    return;
  }
  cards.dataset.files = key;
  cards.replaceChildren(...split.paths.map((path) => heroCard(path)));
  const missing = split.paths.filter((path) => !heroAppNames.get(path)?.absolute && !/^https?:\/\//i.test(path));
  if (missing.length) {
    post({ type: 'heroApps', paths: missing });
  }
}

const heroAppNames = new Map<string, { absolute: string; name: string }>();

export function applyHeroApps(apps: Array<{ path?: string; absolute?: string; name?: string }>): void {
  for (const app of apps) {
    if (!app.path) {
      continue;
    }
    heroAppNames.set(app.path, { absolute: app.absolute ?? '', name: app.name ?? '' });
  }
  for (const card of document.querySelectorAll<HTMLElement>('.hero-file')) {
    const known = heroAppNames.get(card.dataset.path ?? '');
    const label = card.querySelector('.hero-file-open-label');
    const menuOpen = card.querySelector('.hero-file-menu-item');
    const text = known?.name ? tr('heroOpenIn', { name: known.name }) : '';
    if (label && text) {
      label.textContent = text;
    }
    if (menuOpen && text) {
      menuOpen.textContent = text;
    }
  }
}

function heroCard(path: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'hero-file';
  card.dataset.path = path;
  const icon = document.createElement('span');
  icon.className = 'hero-deck';
  const ext = extOfPath(path);
  icon.append(deckSheet(), deckFace(fileIconSvg(heroIconExt(path, ext))));
  const copy = document.createElement('div');
  copy.className = 'hero-file-copy';
  const filePath = document.createElement('div');
  filePath.className = 'hero-file-path';
  filePath.title = path;
  filePath.textContent = shortPath(path);
  const kind = document.createElement('div');
  kind.className = 'hero-file-kind';
  kind.textContent = heroKindLabel(heroKindOf(path));
  copy.append(filePath, kind);
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'hero-file-open';
  const openLabel = document.createElement('span');
  openLabel.className = 'hero-file-open-label';
  const known = heroAppNames.get(path);
  openLabel.textContent = known?.name ? tr('heroOpenIn', { name: known.name }) : heroOpenLabel(ext);
  open.append(openLabel);
  open.addEventListener('click', (event) => {
    event.stopPropagation();
    post({ type: 'openFile', path });
  });
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'hero-file-menu-btn';
  menuBtn.innerHTML = iconChevron();
  const menu = document.createElement('div');
  menu.className = 'hero-file-menu';
  menu.hidden = true;
  const openItem = document.createElement('button');
  openItem.type = 'button';
  openItem.className = 'hero-file-menu-item';
  openItem.textContent = openLabel.textContent;
  openItem.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = true;
    post({ type: 'openFile', path });
  });
  const revealItem = document.createElement('button');
  revealItem.type = 'button';
  revealItem.className = 'hero-file-menu-item';
  revealItem.textContent = tr('heroReveal');
  revealItem.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.hidden = true;
    post({ type: 'revealFile', path });
  });
  menu.append(openItem, revealItem);
  menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = menu.hidden;
    closeHeroMenus();
    menu.hidden = !next;
  });
  const actions = document.createElement('div');
  actions.className = 'hero-file-actions';
  actions.append(open, menuBtn, menu);
  ensureHeroMenuCloser();
  card.addEventListener('click', () => openHero(path));
  card.append(icon, copy, actions);
  return card;
}

let heroMenuBound = false;

function closeHeroMenus(): void {
  for (const menu of document.querySelectorAll<HTMLElement>('.hero-file-menu')) {
    menu.hidden = true;
  }
}

function ensureHeroMenuCloser(): void {
  if (heroMenuBound) {
    return;
  }
  heroMenuBound = true;
  document.addEventListener('click', () => closeHeroMenus());
}

function deckExpand(): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'hero-expand';
  mark.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 6V2.6H6M10 2.6h3.4V6M13.4 10v3.4H10M6 13.4H2.6V10"/></svg>';
  return mark;
}

function deckSheet(): HTMLElement {
  const sheet = document.createElement('span');
  sheet.className = 'hero-sheet';
  sheet.append(deckExpand());
  return sheet;
}

function deckFace(svg: string): HTMLElement {
  const face = document.createElement('span');
  face.className = 'hero-face';
  face.innerHTML = svg;
  return face;
}

function openHero(path: string): void {
  const kind = heroKindOf(path);
  const absolute = heroAppNames.get(path)?.absolute || '';
  const local = absolute || (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') ? path : '');
  if (kind === 'web') {
    const href = /^https?:\/\//i.test(path) ? path : local ? fileHref(local) : '';
    if (!href) {
      post({ type: 'openFile', path });
      return;
    }
    void openInDockBrowser(href).catch(() => post({ type: 'openFile', path }));
    return;
  }
  if (kind === 'image' && local) {
    ui.lightboxSrc = fileHref(local);
    render();
    return;
  }
  post({ type: 'openFile', path });
}

function fileHref(path: string): string {
  const slash = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(slash)) {
    return `file:///${slash}`;
  }
  if (slash.startsWith('/')) {
    return `file://${slash}`;
  }
  return `file:///${slash}`;
}

type HeroKind = 'web' | 'image' | 'folder' | 'app' | 'file';

function heroKindOf(path: string): HeroKind {
  if (/^https?:\/\//i.test(path)) {
    return 'web';
  }
  const ext = extOfPath(path);
  if (ext === 'html' || ext === 'htm') {
    return 'web';
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) {
    return 'image';
  }
  if (['exe', 'msi', 'bat', 'cmd', 'lnk', 'app'].includes(ext)) {
    return 'app';
  }
  if (!ext || /[/\\]$/.test(path)) {
    return 'folder';
  }
  return 'file';
}

function heroIconExt(path: string, ext: string): string {
  const kind = heroKindOf(path);
  if (kind === 'web') {
    return 'html';
  }
  if (kind === 'folder') {
    return 'folder';
  }
  return ext || 'default';
}

function extOfPath(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function shortPath(path: string): string {
  if (path.length <= 32) {
    return path;
  }
  return `${path.slice(0, 18)}…${path.slice(-10)}`;
}

function heroKindLabel(kind: HeroKind): string {
  if (kind === 'web') {
    return tr('heroKindWeb');
  }
  if (kind === 'image') {
    return tr('heroKindImage');
  }
  if (kind === 'folder') {
    return tr('heroKindFolder');
  }
  if (kind === 'app') {
    return tr('heroKindApp');
  }
  return tr('heroKindFile');
}

function heroOpenLabel(ext: string): string {
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
    return tr('heroOpenImage');
  }
  if (['html', 'htm'].includes(ext)) {
    return tr('heroOpenBrowser');
  }
  return tr('heroOpen');
}

function assistantColumn(message: ChatMessage): HTMLElement {
  const el = document.createElement('article');
  el.className = 'msg assistant';
  if (hasWork(message)) {
    const trace = traceBlock(message);
    if (isCompactOnly(message)) {
      trace.classList.add('quiet');
      el.append(trace);
    } else {
      el.append(message.streaming ? trace : finishedWork(message, trace));
    }
  }
  if (message.text) {
    const body = document.createElement('div');
    body.className = 'md answer';
    el.append(body);
    paintAnswer(body, message);
  } else if (message.error?.retrying) {
    el.append(turnErrorCard(message));
  } else if (message.streaming && !hasWork(message) && !message.error) {
    const pulse = document.createElement('div');
    pulse.className = 'pulse';
    const star = document.createElement('span');
    star.className = 'mark pulse';
    star.innerHTML = grokBootMark();
    pulse.append(star, document.createTextNode(tr('working')));
    el.append(pulse);
  }
  if (message.images?.length) {
    el.append(imageGallery(message.images));
  }
  if (message.error && !message.error.retrying) {
    el.append(turnErrorCard(message));
  }
  if (!isDesktop() && visibleSteps(message).length) {
    el.append(stepsBlock(message));
  }
  if (!message.streaming) {
    el.append(turnMeta(message));
    if (message.edits?.length) {
      el.append(changesBlock(message.id, message.edits));
    }
  }
  const trace = el.querySelector('.trace');
  if (trace instanceof HTMLElement) {
    syncElapsed(trace, message);
  }
  return el;
}

function patchErrorCard(col: HTMLElement, message: ChatMessage): void {
  const existing = col.querySelector('.turn-error') as HTMLElement | null;
  if (!message.error) {
    existing?.remove();
    return;
  }
  col.querySelector('.pulse')?.remove();
  const next = turnErrorCard(message);
  if (existing?.dataset.err === next.dataset.err) {
    return;
  }
  if (existing) {
    existing.replaceWith(next);
    return;
  }
  const answer = col.querySelector('.md.answer');
  if (answer) {
    answer.after(next);
    return;
  }
  const trace = col.querySelector('.trace');
  if (trace) {
    trace.after(next);
    return;
  }
  const later = col.querySelector('.steps-card, .turn-meta, .changes');
  if (later) {
    col.insertBefore(next, later);
    return;
  }
  col.append(next);
}

function turnErrorCard(message: ChatMessage): HTMLElement {
  const error = message.error!;
  const el = document.createElement('div');
  el.className = error.retrying ? 'turn-error live' : 'turn-error';
  el.dataset.err = [
    error.retrying ? '1' : '0',
    error.attempt ?? '',
    error.maxAttempts ?? '',
    error.code ?? '',
    error.message,
  ].join('|');
  const title = document.createElement('div');
  title.className = 'turn-error-title';
  title.textContent = error.retrying
    ? tr('turnRetrying', { n: error.attempt ?? 1, max: error.maxAttempts ?? '?' })
    : tr('turnError');
  el.append(title);
  if (error.code) {
    const code = document.createElement('div');
    code.className = 'turn-error-code';
    code.textContent = tr('errorCode', { code: error.code });
    el.append(code);
  }
  const body = document.createElement('div');
  body.className = 'turn-error-msg';
  body.textContent = error.message;
  el.append(body);
  if (/unknownissuer|invalid peer certificate|certificate unverified|not trusted/i.test(error.message)) {
    const hint = document.createElement('div');
    hint.className = 'turn-error-msg';
    hint.textContent = tr('errorUntrustedCert');
    el.append(hint);
  } else if (/auth recovery succeeded but .*rejected \(401\)/i.test(error.message)) {
    const hint = document.createElement('div');
    hint.className = 'turn-error-msg';
    hint.textContent = tr('errorRelayAfterOfficialLogin');
    el.append(hint);
  } else if (isCustomEndpointAuthError(error)) {
    const hint = document.createElement('div');
    hint.className = 'turn-error-msg';
    hint.textContent = tr('errorApiKeyRejected');
    el.append(hint);
  }
  return el;
}

function isCustomEndpointAuthError(error: { code?: string; message: string }): boolean {
  const text = error.message;
  if (/\/login to re-authenticate|session has expired/i.test(text)) {
    return !/(?:api\.x\.ai|api\.grok\.com|cli-chat-proxy|\.x\.ai\/|\.grok\.com\/)/i.test(text);
  }
  if (error.code !== 'HTTP 401' && error.code !== 'auth' && !/unauthorized \(401\)/i.test(text)) {
    return false;
  }
  return !/(?:api\.x\.ai|api\.grok\.com|cli-chat-proxy|\.x\.ai\/|\.grok\.com\/)/i.test(text);
}

function hasWork(message: ChatMessage): boolean {
  return Boolean(message.thinking || message.plan || message.tools.length || message.beats?.length);
}

function visibleSteps(message: ChatMessage): PlanStep[] {
  return message.steps ?? [];
}

function stepsKey(steps: PlanStep[] | undefined): string {
  return (steps ?? []).map((step) => `${step.status}:${step.content}`).join('\n');
}

function stepsBlock(message: ChatMessage): HTMLElement {
  const open = ui.stepsOpen.get(message.id) ?? true;
  const el = document.createElement('section');
  el.className = stepsCardClass(message, open);
  el.dataset.mid = message.id;
  el.dataset.open = open ? '1' : '0';
  const head = document.createElement('header');
  head.className = 'ask-head';
  const brand = document.createElement('div');
  brand.className = 'ask-brand';
  const kicker = document.createElement('span');
  kicker.className = 'ask-kicker';
  kicker.textContent = tr('stepsTitle');
  const preview = document.createElement('span');
  preview.className = 'ask-preview';
  preview.textContent = stepsPreview(visibleSteps(message));
  brand.append(kicker, preview);
  const tools = document.createElement('div');
  tools.className = 'ask-head-tools';
  const foldBtn = document.createElement('button');
  foldBtn.type = 'button';
  foldBtn.className = open ? 'icon-btn open' : 'icon-btn';
  foldBtn.title = tr('stepsTitle');
  foldBtn.innerHTML = iconChevron();
  tools.append(foldBtn);
  head.append(brand, tools);
  head.addEventListener('click', () => toggleStepsOpen(el, message.id));
  const list = document.createElement('div');
  list.className = 'ask-actions steps-list';
  fillStepRows(list, visibleSteps(message), Boolean(message.streaming));
  el.append(head, list);
  return el;
}

function stepsStopped(message: ChatMessage): boolean {
  return (
    !message.streaming &&
    Boolean(
      message.steps?.some(
        (step) =>
          step.status === 'abandoned' ||
          step.status === 'pending' ||
          step.status === 'in_progress',
      ),
    )
  );
}

function stepsCardClass(message: ChatMessage, open: boolean): string {
  return [
    'ask-card',
    'steps-card',
    message.streaming ? 'live' : '',
    stepsStopped(message) ? 'stopped' : '',
    open ? 'open' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function toggleStepsOpen(el: HTMLElement, messageId: string): void {
  const next = !el.classList.contains('open');
  ui.stepsOpen.set(messageId, next);
  el.classList.toggle('open', next);
  el.dataset.open = next ? '1' : '0';
  el.querySelector('.ask-head-tools .icon-btn')?.classList.toggle('open', next);
}

function placeSteps(col: HTMLElement, message: ChatMessage): void {
  if (isDesktop()) {
    col.querySelector('.steps-card')?.remove();
    return;
  }
  patchStepsCard(col, message);
}

function patchStepsCard(col: HTMLElement, message: ChatMessage): void {
  const existing = col.querySelector('.steps-card') as HTMLElement | null;
  const steps = visibleSteps(message);
  if (!steps.length) {
    existing?.remove();
    return;
  }
  if (!existing) {
    const card = stepsBlock(message);
    const later = col.querySelector('.turn-meta, .changes');
    if (later) {
      col.insertBefore(card, later);
    } else {
      col.append(card);
    }
    return;
  }
  const open = ui.stepsOpen.get(message.id) ?? existing.classList.contains('open');
  existing.className = stepsCardClass(message, open);
  existing.dataset.open = open ? '1' : '0';
  const preview = existing.querySelector('.ask-preview');
  if (preview) {
    preview.textContent = stepsPreview(steps);
  }
  existing.querySelector('.ask-head-tools .icon-btn')?.classList.toggle('open', open);
  const list = existing.querySelector('.steps-list') as HTMLElement | null;
  if (list) {
    fillStepRows(list, steps, Boolean(message.streaming));
  }
}

function fillStepRows(body: HTMLElement, steps: PlanStep[], streaming: boolean): void {
  const key = `${streaming ? '1' : '0'}\n${stepsKey(steps)}`;
  if (body.dataset.steps === key) {
    return;
  }
  body.dataset.steps = key;
  const rows = [...body.children] as HTMLElement[];
  if (rows.length === steps.length) {
    steps.forEach((step, index) => {
      const row = rows[index];
      if (!row) {
        return;
      }
      const live = streaming && step.status === 'in_progress';
      row.dataset.status = step.status;
      const icon = row.querySelector('.step-icon');
      if (icon instanceof HTMLElement) {
        icon.className = `step-icon ${stepIconKind(step.status, live)}`;
        icon.innerHTML = stepIcon(step.status, live);
      }
      const text = row.querySelector('.step-text');
      if (text) {
        text.textContent = step.content;
      }
    });
    return;
  }
  body.replaceChildren();
  for (const step of steps) {
    body.append(stepRow(step, streaming));
  }
}

function stepRow(step: PlanStep, streaming: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'step-row';
  row.dataset.status = step.status;
  const icon = document.createElement('span');
  const live = streaming && step.status === 'in_progress';
  icon.className = `step-icon ${stepIconKind(step.status, live)}`;
  icon.innerHTML = stepIcon(step.status, live);
  const text = document.createElement('span');
  text.className = 'step-text';
  text.textContent = step.content;
  row.append(icon, text);
  return row;
}

function stepIconKind(status: PlanStep['status'], live: boolean): string {
  if (status === 'completed') {
    return 'ok';
  }
  if (status === 'failed') {
    return 'fail';
  }
  if (live) {
    return 'run';
  }
  return 'wait';
}

function stepIcon(status: PlanStep['status'], live: boolean): string {
  if (status === 'completed') {
    return iconCheck();
  }
  if (status === 'failed') {
    return iconClose();
  }
  if (live) {
    return iconEdit();
  }
  return iconClock();
}

function stepsPreview(steps: PlanStep[]): string {
  const done = steps.filter((step) => step.status === 'completed' || step.status === 'failed').length;
  const count = tr('stepsCount', { done, n: steps.length });
  const running = steps.find((step) => step.status === 'in_progress');
  if (running) {
    return `${count} · ${running.content}`;
  }
  return count;
}

let workClock: ReturnType<typeof setInterval> | undefined;

export function syncWorkClock(): void {
  const live = ui.state.messages.some(
    (message) => message.role === 'assistant' && message.streaming,
  );
  if (live) {
    if (workClock === undefined) {
      workClock = setInterval(paintWorkLabels, 1000);
    }
    paintWorkLabels();
    return;
  }
  if (workClock !== undefined) {
    clearInterval(workClock);
    workClock = undefined;
  }
}

function paintWorkLabels(): void {
  const live = ui.state.messages.at(-1);
  if (!live || live.role !== 'assistant' || !live.streaming) {
    return;
  }
  for (const node of document.querySelectorAll('.trace.live')) {
    if (node instanceof HTMLElement && node.dataset.mid === live.id) {
      syncElapsed(node, live);
    }
  }
  const tools = new Map(live.tools.map((tool) => [tool.id, tool]));
  for (const node of document.querySelectorAll('.trace.live .trace-tool[data-id]')) {
    if (!(node instanceof HTMLElement) || !node.dataset.id) {
      continue;
    }
    const tool = tools.get(node.dataset.id);
    if (tool) {
      paintTermElapsed(node, tool);
    }
  }
}

function toolRowSig(tool: ChatMessage['tools'][number]): string {
  return `${tool.status}|${tool.kind ?? ''}|${tool.title}|${tool.detail ?? ''}|${tool.output?.length ?? 0}|${tool.command ?? ''}`;
}

function isTermTool(tool: ChatMessage['tools'][number]): boolean {
  const kind = (tool.kind ?? '').toLowerCase();
  const title = tool.title.toLowerCase();
  return (
    kind === 'execute' ||
    kind === 'terminal' ||
    title.includes('terminal') ||
    title.includes('bash') ||
    title.includes('run_terminal')
  );
}

function termPreview(tool: ChatMessage['tools'][number]): HTMLElement {
  const live = tool.status === 'in_progress' || tool.status === 'pending';
  const open = ui.termOpen.get(tool.id) ?? live;
  const box = document.createElement('details');
  box.className = 'tool-term';
  box.open = open;
  const summary = document.createElement('summary');
  const prompt = document.createElement('span');
  prompt.className = 'term-prompt';
  prompt.textContent = '$';
  const cmd = document.createElement('span');
  cmd.className = 'term-cmd';
  cmd.textContent = tool.command || tool.title || tr('termRun');
  const meta = document.createElement('span');
  meta.className = 'term-meta';
  const elapsed = document.createElement('span');
  elapsed.className = 'term-elapsed';
  elapsed.textContent = termElapsedText(tool);
  const status = document.createElement('span');
  status.className = 'term-status';
  meta.append(elapsed, status);
  summary.append(prompt, cmd, meta);
  const frame = document.createElement('div');
  frame.className = 'term-frame';
  const body = document.createElement('pre');
  body.className = 'term-body';
  if (open) {
    paintTermBody(body, tool.output || '');
  }
  box.addEventListener('toggle', (event) => {
    if (!event.isTrusted) {
      return;
    }
    ui.termOpen.set(tool.id, box.open);
    if (box.open) {
      paintTermBody(body, tool.output || '');
    }
  });
  frame.append(body);
  box.append(summary, frame);
  return box;
}

function paintTermBody(body: HTMLElement, text: string): void {
  const src = text || '';
  if (body.dataset.src === src && body.dataset.ready === '1') {
    return;
  }
  const pin = body.scrollHeight - body.scrollTop - body.clientHeight < 28;
  body.dataset.src = src;
  if (!src) {
    body.classList.add('idle');
    body.textContent = tr('termIdle');
  } else {
    body.classList.remove('idle');
    body.innerHTML = renderTermHtml(src);
  }
  if (pin || body.dataset.ready !== '1') {
    body.scrollTop = body.scrollHeight;
  }
  body.dataset.ready = '1';
}

function paintTermElapsed(row: HTMLElement, tool: ChatMessage['tools'][number]): void {
  const elapsed = row.querySelector('.term-elapsed');
  if (elapsed) {
    elapsed.textContent = termElapsedText(tool);
  }
  const cmd = row.querySelector('.term-cmd');
  if (cmd && tool.command && cmd.textContent !== tool.command) {
    cmd.textContent = tool.command;
  }
  const term = row.querySelector('.tool-term');
  if (!(term instanceof HTMLDetailsElement) || !term.open) {
    return;
  }
  const body = term.querySelector('.term-body');
  if (body instanceof HTMLElement && tool.output !== undefined) {
    paintTermBody(body, tool.output);
  }
}

function termElapsedText(tool: ChatMessage['tools'][number]): string {
  const start = Date.parse(tool.startedAt ?? '');
  if (Number.isNaN(start)) {
    return '';
  }
  const end = tool.endedAt ? Date.parse(tool.endedAt) : Date.now();
  if (Number.isNaN(end)) {
    return '';
  }
  const ms = Math.max(0, end - start);
  if (!tool.endedAt && ms < 1000) {
    return '';
  }
  return formatDuration(ms);
}

function imageGallery(images: ChatMessage['images']): HTMLElement {
  const gallery = document.createElement('div');
  gallery.className = 'gallery';
  for (const image of images ?? []) {
    const src = image.uri ? image.uri : `data:${image.mimeType};base64,${image.data ?? ''}`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'thumb';
    btn.title = tr('previewImage');
    const img = document.createElement('img');
    img.alt = tr('imgGenerated');
    img.src = src;
    btn.append(img);
    btn.addEventListener('click', () => {
      ui.lightboxSrc = src;
      render();
    });
    gallery.append(btn);
  }
  return gallery;
}

function turnMeta(message: ChatMessage): HTMLElement {
  const el = document.createElement('div');
  el.className = 'turn-meta';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'meta-btn';
  const copied = ui.copiedId === message.id;
  if (copied) {
    copy.classList.add('copied');
  }
  copy.title = copied ? tr('copied') : tr('copy');
  copy.innerHTML = copied ? iconCheck() : iconCopy();
  copy.disabled = !message.text;
  copy.addEventListener('click', () => copyMessage(message));
  const fork = document.createElement('button');
  fork.type = 'button';
  fork.className = 'meta-btn';
  fork.title = tr('menuFork');
  fork.innerHTML = iconFork();
  fork.addEventListener('click', () => post({ type: 'runSlash', command: 'fork' }));
  const rewind = document.createElement('button');
  rewind.type = 'button';
  rewind.className = 'meta-btn';
  rewind.title = tr('menuRewind');
  rewind.innerHTML = iconRewind();
  rewind.addEventListener('click', () => post({ type: 'rewindTurn', messageId: message.id }));
  el.append(copy, fork, rewind);
  const stamp = turnSourceText(loc(), message, ui.state.timestamps !== false);
  if (stamp) {
    const time = document.createElement('span');
    time.className = 'turn-time';
    time.title = stamp;
    time.textContent = stamp;
    el.append(time);
  }
  return el;
}

function changesBlock(messageId: string, edits: FileEdit[]): HTMLElement {
  const el = document.createElement('section');
  el.className = 'changes';
  const sum = totals(edits);
  const expanded = ui.editsExpanded.has(messageId);
  const shown = expanded ? edits : edits.slice(0, 6);
  const hidden = Math.max(0, edits.length - shown.length);
  const line = document.createElement('div');
  line.className = 'changes-line';
  const mark = document.createElement('span');
  mark.className = 'mark';
  mark.innerHTML = iconStar();
  const count = document.createElement('span');
  count.className = 'changes-count';
  count.textContent = tr('editsTitle', { n: edits.length });
  const diff = document.createElement('span');
  diff.className = 'changes-diff';
  diff.innerHTML = `<span class="add">+${sum.added}</span> <span class="del">−${sum.removed}</span>`;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'text-btn';
  undo.textContent = tr('undo');
  undo.addEventListener('click', () => post({ type: 'undoEdits', messageId }));
  const review = document.createElement('button');
  review.type = 'button';
  review.className = 'text-btn';
  review.textContent = tr('review');
  review.addEventListener('click', () => post({ type: 'reviewEdits', messageId }));
  line.append(mark, count, diff, undo, review);
  const chips = document.createElement('div');
  chips.className = 'change-chips';
  for (const edit of shown) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'change-chip';
    chip.title = edit.path;
    const name = document.createElement('span');
    name.className = 'change-name';
    name.textContent = fileName(edit.path);
    chip.append(name);
    if (edit.added || edit.removed) {
      const stat = document.createElement('span');
      stat.className = 'change-stat';
      stat.innerHTML = `<span class="add">+${edit.added}</span> <span class="del">−${edit.removed}</span>`;
      chip.append(stat);
    }
    chip.addEventListener('click', () => post({ type: 'openEdit', path: edit.path, messageId }));
    chips.append(chip);
  }
  if (hidden > 0) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'change-chip more';
    more.textContent = tr('editsMore', { n: hidden });
    more.addEventListener('click', () => {
      ui.editsExpanded.add(messageId);
      render();
    });
    chips.append(more);
  }
  el.append(line, chips);
  return el;
}

function permissionBar(): HTMLElement {
  const bar = document.createElement('section');
  bar.className = 'permission';
  const perm = ui.state.permission!;
  bar.dataset.id = perm.requestId;
  const fold = document.createElement('details');
  fold.className = 'permission-fold';
  fold.open = ui.permissionOpen.get(perm.requestId) ?? false;
  fold.addEventListener('toggle', (event) => {
    if (event.isTrusted) {
      ui.permissionOpen.set(perm.requestId, fold.open);
    }
  });
  const head = document.createElement('summary');
  const kicker = document.createElement('span');
  kicker.className = 'permission-kind';
  kicker.textContent = toolKindLabel(loc(), perm.toolKind);
  const name = document.createElement('span');
  name.className = 'permission-file';
  name.textContent = permissionTarget(perm);
  head.append(kicker, name);
  fold.append(head);
  if (perm.details) {
    const pre = document.createElement('pre');
    pre.textContent = perm.details;
    fold.append(pre);
  } else if (perm.title && perm.title !== name.textContent) {
    const copy = document.createElement('div');
    copy.className = 'permission-copy';
    copy.textContent = perm.title;
    fold.append(copy);
  }
  const row = document.createElement('div');
  row.className = 'permission-actions';
  for (const action of permissionActions(perm)) {
    const option = perm.options.find((item) => item.optionId === action.optionId);
    if (option) {
      row.append(permissionButton(option, perm.toolKind));
    }
  }
  if (permissionNeedsCancel(perm)) {
    row.append(button(tr('cancel'), () => post({ type: 'cancelPermission' })));
  }
  bar.append(fold, row);
  return bar;
}

function askBar(): HTMLElement {
  return fillAskCard();
}

function fillAskCard(el?: HTMLElement): HTMLElement {
  const ask = ui.state.ask!;
  const open = ui.askOpen.get(ask.requestId) ?? true;
  const card = el ?? document.createElement('section');
  card.className = 'ask-card ask-prompt';
  card.dataset.id = ask.requestId;
  card.dataset.stamp = `${ask.requestId}:${ask.index ?? 0}`;
  card.dataset.other = ui.askOtherOpen ? '1' : '0';
  card.dataset.open = open ? '1' : '0';
  card.dataset.picked = [...ui.askPicked].sort().join('|');
  card.replaceChildren();
  const head = document.createElement('header');
  head.className = 'ask-head';
  const brand = document.createElement('div');
  brand.className = 'ask-brand';
  const kicker = document.createElement('span');
  kicker.className = 'ask-kicker';
  kicker.textContent =
    ask.kind === 'plan'
      ? tr('planReadyTitle')
      : ask.multiSelect
        ? tr('askMultiHint')
        : ask.total && ask.total > 1
          ? tr('askQuestionOf', { n: (ask.index ?? 0) + 1, total: ask.total })
          : tr('askTitle');
  const preview = document.createElement('span');
  preview.className = 'ask-preview';
  preview.textContent =
    ask.kind === 'question' ? ask.title : (ask.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 72);
  brand.append(kicker, preview);
  const tools = document.createElement('div');
  tools.className = 'ask-head-tools';
  const foldBtn = iconButton(open ? tr('permDetails') : tr('planReadyTitle'), iconChevron(), () => {
    ui.askOpen.set(ask.requestId, !open);
    render();
  });
  foldBtn.classList.toggle('open', open);
  const closeBtn = iconButton(tr('settingsClose'), iconClose(), () => {
    clearAskLocal();
    post({ type: 'cancelAsk' });
    render();
  });
  tools.append(foldBtn, closeBtn);
  head.append(brand, tools);
  card.append(head);
  if (!open) {
    return card;
  }
  if (ask.kind === 'question' && ask.title) {
    const title = document.createElement('div');
    title.className = 'ask-title';
    title.textContent = ask.title;
    card.append(title);
  }
  if (ask.kind === 'plan') {
    const body = document.createElement('div');
    body.className = 'ask-plan';
    if (ask.body) {
      body.innerHTML = renderMarkdown(ask.body);
    } else {
      body.textContent = tr('planReadyEmpty');
    }
    card.append(body);
  }
  const actions = document.createElement('div');
  actions.className = 'ask-actions';
  for (const choice of ask.choices) {
    actions.append(askChoiceButton(choice, ask.kind, Boolean(ask.multiSelect)));
  }
  card.append(actions);
  if (ui.askOtherOpen) {
    card.append(askOtherForm(ask.kind, Boolean(ask.multiSelect)));
  } else if (ask.multiSelect) {
    card.append(askMultiSubmit());
  }
  return card;
}

function askChoiceButton(
  choice: import('../../core/types').AskChoice,
  kind: 'question' | 'plan',
  multiSelect: boolean,
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className =
    choice.id === 'execute'
      ? 'btn primary ask-choice'
      : choice.id === 'decline'
        ? 'btn reject ask-choice'
        : 'btn allow ask-choice';
  const picked = ui.askPicked.has(choice.id);
  el.classList.toggle('picked', multiSelect && picked);
  el.setAttribute('aria-pressed', multiSelect && picked ? 'true' : 'false');
  const label = document.createElement('span');
  label.className = 'ask-choice-label';
  label.textContent = askChoiceLabel(choice, kind);
  el.append(label);
  const hint = askChoiceHint(choice, kind);
  if (hint) {
    const mark = document.createElement('span');
    mark.className = 'ask-hint';
    mark.setAttribute('aria-label', tr('askHint'));
    mark.innerHTML = iconAskHint();
    const tip = document.createElement('span');
    tip.className = 'ask-tip';
    tip.textContent = hint;
    mark.append(tip);
    bindHoverPin(mark, tip, { prefer: 'above', align: 'end' });
    mark.addEventListener('click', (event) => event.stopPropagation());
    el.append(mark);
  }
  el.addEventListener('click', () => {
    if (multiSelect) {
      toggleAskChoice(choice);
      return;
    }
    if (choice.other) {
      ui.askOtherOpen = true;
      render();
      return;
    }
    post({ type: 'answerAsk', choiceId: choice.id });
  });
  return el;
}

function toggleAskChoice(choice: import('../../core/types').AskChoice): void {
  if (ui.askPicked.has(choice.id)) {
    ui.askPicked.delete(choice.id);
  } else {
    ui.askPicked.add(choice.id);
  }
  ui.askOtherOpen = [...ui.askPicked].some((id) => {
    const row = ui.state.ask?.choices.find((item) => item.id === id);
    return Boolean(row?.other) || id === 'Other';
  });
  if (!ui.askOtherOpen) {
    ui.askOtherDraft = '';
  }
  render();
}

function askMultiSubmit(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ask-other';
  const send = button(tr('askSubmit'), submitAskPicked);
  send.className = 'btn primary';
  send.disabled = ui.askPicked.size === 0;
  wrap.append(send);
  return wrap;
}

function submitAskPicked(): void {
  const ids = [...ui.askPicked];
  if (!ids.length) {
    return;
  }
  const other = ids.some((id) => {
    const row = ui.state.ask?.choices.find((item) => item.id === id);
    return Boolean(row?.other) || id === 'Other';
  });
  const notes = ui.askOtherDraft.trim();
  if (other && !notes) {
    return;
  }
  post({ type: 'answerAsk', choiceIds: ids, notes: notes || undefined });
  ui.askOtherDraft = '';
  ui.askOtherOpen = false;
  ui.askPicked.clear();
}

function askChoiceHint(choice: import('../../core/types').AskChoice, kind: 'question' | 'plan'): string {
  if (kind === 'plan') {
    if (choice.id === 'execute') {
      return tr('planExecuteHint');
    }
    if (choice.id === 'decline') {
      return tr('planDeclineHint');
    }
    if (choice.id === 'supplement') {
      return tr('planSupplementHint');
    }
  }
  if (choice.other) {
    return choice.description ?? tr('askOtherHint');
  }
  return choice.description ?? '';
}

function askChoiceLabel(choice: import('../../core/types').AskChoice, kind: 'question' | 'plan'): string {
  if (kind === 'plan') {
    if (choice.id === 'execute') {
      return tr('planExecute');
    }
    if (choice.id === 'decline') {
      return tr('planDecline');
    }
    if (choice.id === 'supplement') {
      return tr('planSupplement');
    }
  }
  return choice.other ? tr('askOther') : choice.label;
}

function askOtherForm(kind: 'question' | 'plan', multiSelect: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ask-other';
  const input = document.createElement('textarea');
  input.rows = 3;
  input.placeholder = kind === 'plan' ? tr('planSupplementHint') : tr('askOtherHint');
  input.value = ui.askOtherDraft;
  input.addEventListener('input', () => {
    ui.askOtherDraft = input.value;
  });
  const send = button(tr('askSubmit'), () => {
    if (multiSelect) {
      submitAskPicked();
      return;
    }
    const notes = ui.askOtherDraft.trim();
    if (!notes) {
      return;
    }
    post({
      type: 'answerAsk',
      choiceId: kind === 'plan' ? 'supplement' : 'Other',
      notes,
    });
    ui.askOtherDraft = '';
    ui.askOtherOpen = false;
  });
  send.className = 'btn primary';
  wrap.append(input, send);
  queueMicrotask(() => input.focus());
  return wrap;
}

function permissionButton(option: PermissionOption, toolKind?: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = permissionButtonClass(option.kind);
  el.textContent = tr(permissionLabelKey(option, toolKind));
  el.title = option.name;
  el.addEventListener('click', () => post({ type: 'choosePermission', optionId: option.optionId }));
  return el;
}
