import { ui } from '../app';
import {
  activeRailIndex,
  evenTickCenter,
  railEdge,
  railSegment,
  scrollReach,
  userRailMarks,
  type RailMark,
} from './userRail';

let hostEdge: 'start' | 'end' | undefined;
let popHeld = false;
let closePopTimer = 0;
let revealUser: (id: string) => void = () => {};

export function setUserReveal(reveal: (id: string) => void): void {
  revealUser = reveal;
}

export function setRailHostEdge(side: string | undefined): void {
  hostEdge = side === 'start' || side === 'end' ? side : undefined;
  syncUserRail();
}

export function syncUserRail(): void {
  const body = document.getElementById('grok-body');
  const transcript = document.getElementById('transcript');
  if (!body || !transcript) {
    document.getElementById('user-rail')?.remove();
    return;
  }
  if (ui.state.restoringSession || transcript.classList.contains('catching-up')) {
    document.getElementById('user-rail')?.remove();
    return;
  }
  const marks = userRailMarks(ui.state.messages);
  if (marks.length < 2) {
    document.getElementById('user-rail')?.remove();
    return;
  }
  const rail = ensureRail(body);
  const tops = marks.map((mark) => userTop(transcript, mark.id));
  const reach = scrollReach(
    Math.max(0, transcript.scrollHeight - transcript.clientHeight),
    Number.parseFloat(transcript.style.paddingBottom) || 0,
    composerOverlap(transcript),
  );
  const active = activeRailIndex(tops, transcript.scrollTop, reach);
  const previous = rail.dataset.segmentStart === undefined ? undefined : Number(rail.dataset.segmentStart);
  const segment = railSegment(marks.length, Math.max(0, active), previous);
  rail.dataset.segmentStart = String(segment.start);
  const shown = marks.slice(segment.start, segment.end).map((mark, index) => ({ mark, index }));
  const rowSig = marks.map((mark) => `${mark.id}\t${mark.label}`).join('\n');
  const tickSig = `${segment.start}:${shown.map((item) => item.mark.id).join(',')}`;
  const changed = rail.dataset.rows !== rowSig || rail.dataset.ticks !== tickSig;
  if (changed || !rail.dataset.side || hostEdge) {
    rail.dataset.side = railEdge(hostEdge, 'unknown');
  }
  if (rail.dataset.rows !== rowSig) {
    rail.dataset.rows = rowSig;
    paintRows(rail, marks);
  }
  if (rail.dataset.ticks !== tickSig) {
    rail.dataset.ticks = tickSig;
    paintTicks(rail, shown);
  }
  sizeRows(rail);
  markActive(rail, active >= 0 ? marks[active]?.id : undefined);
  placeTicks(rail);
}

function ensureRail(body: HTMLElement): HTMLElement {
  let rail = document.getElementById('user-rail');
  if (rail && rail.parentElement === body) {
    return rail;
  }
  rail?.remove();
  rail = document.createElement('div');
  rail.id = 'user-rail';
  rail.className = 'user-rail';
  rail.addEventListener('pointerenter', () => holdPop());
  rail.addEventListener('pointerleave', (event) => {
    if (event.relatedTarget instanceof Node && rail.contains(event.relatedTarget)) {
      return;
    }
    scheduleClosePop(rail);
  });
  rail.addEventListener(
    'wheel',
    (event) => {
      const pop = rail?.querySelector('.user-rail-pop');
      if (pop && event.target instanceof Node && pop.contains(event.target)) {
        return;
      }
      const transcript = document.getElementById('transcript');
      if (!transcript) {
        return;
      }
      transcript.scrollTop += event.deltaY;
    },
    { passive: true },
  );
  body.append(rail);
  return rail;
}

function paintRows(rail: HTMLElement, marks: RailMark[]): void {
  let pop = rail.querySelector<HTMLElement>('.user-rail-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'user-rail-pop';
    pop.addEventListener('pointerenter', () => holdPop());
    pop.addEventListener(
      'wheel',
      (event) => {
        popHeld = true;
        event.stopPropagation();
      },
      { passive: true },
    );
    rail.append(pop);
  }
  delete pop.dataset.rowH;
  pop.replaceChildren();
  for (const mark of marks) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'user-rail-row';
    row.dataset.id = mark.id;
    const text = document.createElement('span');
    text.textContent = mark.label;
    const dash = document.createElement('i');
    row.append(text, dash);
    row.addEventListener('click', () => jumpTo(mark.id));
    pop.append(row);
  }
}

function paintTicks(rail: HTMLElement, items: { mark: RailMark; index: number }[]): void {
  rail.querySelectorAll('.user-rail-tick').forEach((node) => node.remove());
  const pop = rail.querySelector('.user-rail-pop');
  for (const item of items) {
    const mark = item.mark;
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'user-rail-tick';
    tick.dataset.id = mark.id;
    tick.dataset.index = String(item.index);
    tick.title = mark.label;
    const bar = document.createElement('i');
    tick.append(bar);
    tick.addEventListener('pointerenter', () => {
      holdPop();
      openPop(rail);
    });
    tick.addEventListener('click', () => jumpTo(mark.id));
    if (pop) {
      rail.insertBefore(tick, pop);
    } else {
      rail.append(tick);
    }
  }
}

function holdPop(): void {
  window.clearTimeout(closePopTimer);
  closePopTimer = 0;
}

function scheduleClosePop(rail: HTMLElement): void {
  window.clearTimeout(closePopTimer);
  closePopTimer = window.setTimeout(() => {
    closePopTimer = 0;
    popHeld = false;
    rail.classList.remove('open');
  }, 360);
}

function openPop(rail: HTMLElement): void {
  const wasOpen = rail.classList.contains('open');
  rail.classList.add('open');
  if (wasOpen) {
    return;
  }
  popHeld = false;
  revealActiveRow(rail, rail.querySelector('.user-rail-row.on')?.dataset.id);
}

function sizeRows(rail: HTMLElement): void {
  const pop = rail.querySelector<HTMLElement>('.user-rail-pop');
  if (!pop) {
    return;
  }
  const rows = pop.querySelectorAll<HTMLElement>('.user-rail-row');
  const slots = Math.min(10, rows.length);
  const rowH = slots > 0 ? rail.clientHeight / slots : 0;
  const stamp = String(Math.round(rowH * 10) / 10);
  if (pop.dataset.rowH === stamp) {
    return;
  }
  pop.dataset.rowH = stamp;
  rows.forEach((row) => {
    row.style.flex = `0 0 ${rowH}px`;
    row.style.height = `${rowH}px`;
  });
}

function placeTicks(rail: HTMLElement): void {
  const ticks = [...rail.querySelectorAll<HTMLElement>('.user-rail-tick')];
  const height = rail.clientHeight;
  ticks.forEach((tick, index) => {
    tick.hidden = false;
    tick.style.top = `${evenTickCenter(index, ticks.length, height)}px`;
  });
  const active = rail.querySelector<HTMLElement>('.user-rail-tick.on');
  const index = active ? Math.max(0, ticks.indexOf(active)) : 0;
  const knob = ensureKnob(rail);
  knob.hidden = false;
  knob.style.top = `${evenTickCenter(index, ticks.length, height)}px`;
}

function ensureKnob(rail: HTMLElement): HTMLElement {
  let knob = rail.querySelector<HTMLElement>('.user-rail-knob');
  if (knob) {
    return knob;
  }
  knob = document.createElement('i');
  knob.className = 'user-rail-knob';
  rail.append(knob);
  return knob;
}

function markActive(rail: HTMLElement, activeId: string | undefined): void {
  rail.querySelectorAll<HTMLElement>('.user-rail-tick, .user-rail-row').forEach((node) => {
    node.classList.toggle('on', Boolean(activeId) && node.dataset.id === activeId);
  });
}

function revealActiveRow(rail: HTMLElement, id: string | undefined): void {
  const pop = rail.querySelector<HTMLElement>('.user-rail-pop');
  const row = id ? pop?.querySelector<HTMLElement>(`[data-id="${cssEscape(id)}"]`) : null;
  if (!pop || !row) {
    return;
  }
  pop.scrollTop = Math.max(0, row.offsetTop - (pop.clientHeight - row.offsetHeight) / 2);
}

function jumpTo(id: string): void {
  const transcript = document.getElementById('transcript');
  if (!transcript) {
    return;
  }
  ui.stickToBottom = false;
  revealUser(id);
  const top = userTop(transcript, id);
  if (top < 0) {
    return;
  }
  transcript.scrollTop = Math.max(0, top - 8);
  document.getElementById('user-rail')?.classList.remove('open');
}

function composerOverlap(transcript: HTMLElement): number {
  const composer = document.getElementById('composer-card') ?? document.getElementById('composer-wrap');
  if (!composer) {
    return 0;
  }
  const view = transcript.getBoundingClientRect();
  const box = composer.getBoundingClientRect();
  return Math.max(0, view.bottom - box.top);
}

function userTop(transcript: HTMLElement, id: string): number {
  const node = transcript.querySelector<HTMLElement>(`[data-user-id="${cssEscape(id)}"]`);
  if (!node) {
    return -1;
  }
  const host = transcript.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  return box.top - host.top + transcript.scrollTop;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
