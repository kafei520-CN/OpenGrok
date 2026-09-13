export type PinAlign = 'start' | 'end';
export type PinPrefer = 'above' | 'below' | 'right' | 'left';

export interface PlaceBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlaceAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlaceOpts {
  view: PlaceBox;
  anchor: PlaceAnchor;
  size: { width: number; height: number };
  prefer: PinPrefer;
  align?: PinAlign;
  gap?: number;
  pad?: number;
}

export interface PlaceResult {
  top: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
}

/** Keep a floating panel inside the viewport, flipping above/below or left/right. */
export function placeFloating(opts: PlaceOpts): PlaceResult {
  if (opts.prefer === 'right' || opts.prefer === 'left') {
    return placeBeside(opts);
  }
  return placeAboveBelow(opts);
}

function placeAboveBelow(opts: PlaceOpts): PlaceResult {
  const gap = opts.gap ?? 6;
  const pad = opts.pad ?? 8;
  const viewRight = opts.view.left + opts.view.width;
  const viewBottom = opts.view.top + opts.view.height;
  const availW = Math.max(48, opts.view.width - pad * 2);
  const width = Math.min(Math.max(opts.size.width, 1), availW);
  let left = opts.align === 'end' ? opts.anchor.right - width : opts.anchor.left;
  left = clamp(left, opts.view.left + pad, viewRight - pad - width);

  const spaceAbove = Math.max(0, opts.anchor.top - (opts.view.top + pad) - gap);
  const spaceBelow = Math.max(0, viewBottom - pad - opts.anchor.bottom - gap);
  const need = Math.min(opts.size.height, 96);
  const useAbove =
    opts.prefer === 'above'
      ? spaceAbove >= need || spaceAbove >= spaceBelow
      : spaceBelow < need && spaceAbove > spaceBelow;
  const maxHeight = Math.max(0, useAbove ? spaceAbove : spaceBelow);
  const height = Math.min(opts.size.height, Math.max(maxHeight, 0));
  let top = useAbove ? opts.anchor.top - gap - height : opts.anchor.bottom + gap;
  const minTop = opts.view.top + pad;
  const maxTop = viewBottom - pad - height;
  top = clamp(top, minTop, Math.max(minTop, maxTop));
  return { top, left, maxHeight: Math.max(maxHeight, 48), maxWidth: availW };
}

function placeBeside(opts: PlaceOpts): PlaceResult {
  const gap = opts.gap ?? 6;
  const pad = opts.pad ?? 8;
  const viewRight = opts.view.left + opts.view.width;
  const viewBottom = opts.view.top + opts.view.height;
  const availW = Math.max(48, opts.view.width - pad * 2);
  const width = Math.min(Math.max(opts.size.width, 1), availW);
  const spaceRight = Math.max(0, viewRight - pad - opts.anchor.right - gap);
  const spaceLeft = Math.max(0, opts.anchor.left - (opts.view.left + pad) - gap);
  const need = Math.min(width, 96);
  const useRight =
    opts.prefer === 'right'
      ? spaceRight >= need || spaceRight >= spaceLeft
      : spaceLeft < need && spaceRight > spaceLeft;
  const maxWidth = Math.max(48, useRight ? spaceRight : spaceLeft);
  const placedW = Math.min(width, maxWidth);
  let left = useRight ? opts.anchor.right + gap : opts.anchor.left - gap - placedW;
  left = clamp(left, opts.view.left + pad, viewRight - pad - placedW);
  const availH = Math.max(48, viewBottom - pad - (opts.view.top + pad));
  const height = Math.min(opts.size.height, availH);
  let top = opts.align === 'end' ? opts.anchor.bottom - height : opts.anchor.top;
  const minTop = opts.view.top + pad;
  const maxTop = viewBottom - pad - height;
  top = clamp(top, minTop, Math.max(minTop, maxTop));
  return {
    top,
    left,
    maxHeight: Math.max(viewBottom - pad - top, 48),
    maxWidth: Math.max(maxWidth, 48),
  };
}

type PinSpec = {
  anchor: HTMLElement;
  prefer: PinPrefer;
  align: PinAlign;
  restoreTo?: HTMLElement;
  matchWidth?: boolean;
  pad?: number;
  gap?: number;
};

const pins = new Map<HTMLElement, PinSpec>();
let listening = false;

export function pinFloating(
  el: HTMLElement,
  anchor: HTMLElement,
  opts: {
    prefer: PinPrefer;
    align?: PinAlign;
    restoreTo?: HTMLElement;
    matchWidth?: boolean;
    pad?: number;
    gap?: number;
  },
): void {
  sweepFloating();
  pins.set(el, {
    anchor,
    prefer: opts.prefer,
    align: opts.align ?? 'start',
    restoreTo: opts.restoreTo,
    matchWidth: opts.matchWidth,
    pad: opts.pad,
    gap: opts.gap,
  });
  el.classList.add('pin');
  const host = floatHost();
  if (el.parentElement !== host) {
    host.append(el);
  }
  applyPin(el);
  listen();
}

export function releaseFloating(el: HTMLElement, restoreTo?: HTMLElement): void {
  const spec = pins.get(el);
  pins.delete(el);
  el.classList.remove('pin');
  el.style.position = '';
  el.style.top = '';
  el.style.left = '';
  el.style.right = '';
  el.style.bottom = '';
  el.style.margin = '';
  el.style.width = '';
  el.style.minWidth = '';
  el.style.maxHeight = '';
  el.style.maxWidth = '';
  el.style.zIndex = '';
  const home = restoreTo ?? spec?.restoreTo;
  if (home?.isConnected) {
    home.append(el);
    return;
  }
  el.remove();
}

export function releaseByClass(className: string): void {
  for (const el of [...pins.keys()]) {
    if (el.classList.contains(className)) {
      releaseFloating(el);
    }
  }
  document.getElementById('grok-floats')?.querySelectorAll(`.${className}`).forEach((node) => {
    node.remove();
  });
}

export function findPinned(selector: string): HTMLElement | undefined {
  for (const el of pins.keys()) {
    if (el.matches(selector)) {
      return el;
    }
  }
  const found = document.getElementById('grok-floats')?.querySelector(selector);
  return found instanceof HTMLElement ? found : undefined;
}

export function reflowFloating(): void {
  sweepFloating();
  if (pins.size === 0) {
    return;
  }
  floatHost();
  for (const el of [...pins.keys()]) {
    applyPin(el);
  }
}

/** Show `panel` while the pointer is over `anchor`; used for hover tips. */
export function bindHoverPin(
  anchor: HTMLElement,
  panel: HTMLElement,
  opts: { prefer: PinPrefer; align?: PinAlign },
): void {
  const show = () => pinFloating(panel, anchor, { ...opts, restoreTo: anchor });
  const hide = () => {
    if (pins.has(panel)) {
      releaseFloating(panel, anchor);
    }
  };
  anchor.addEventListener('pointerenter', show);
  anchor.addEventListener('pointerleave', hide);
  anchor.addEventListener('focusin', show);
  anchor.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && anchor.contains(next)) {
      return;
    }
    hide();
  });
}

export function sweepFloating(): void {
  for (const [el, spec] of [...pins.entries()]) {
    if (!spec.anchor.isConnected) {
      releaseFloating(el);
    } else if (!el.isConnected) {
      pins.delete(el);
    }
  }
}

function floatHost(): HTMLElement {
  let host = document.getElementById('grok-floats');
  if (!(host instanceof HTMLElement)) {
    host = document.createElement('div');
    host.id = 'grok-floats';
    document.body.append(host);
  }
  const app = document.getElementById('app');
  if (app instanceof HTMLElement) {
    copyAttr(app, host, 'surface');
    copyAttr(app, host, 'wpKind');
  }
  return host;
}

function copyAttr(from: HTMLElement, to: HTMLElement, key: string): void {
  const value = from.dataset[key];
  if (value) {
    to.dataset[key] = value;
  } else {
    delete to.dataset[key];
  }
}

function applyPin(el: HTMLElement): void {
  const spec = pins.get(el);
  if (!spec || !spec.anchor.isConnected) {
    return;
  }
  el.style.position = 'fixed';
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.margin = '0';
  const view = viewBox();
  const anchor = spec.anchor.getBoundingClientRect();
  const matchW = spec.matchWidth ? Math.round(anchor.width) : 0;
  if (matchW > 0) {
    el.style.width = `${matchW}px`;
    el.style.minWidth = `${matchW}px`;
    el.style.maxWidth = `${matchW}px`;
  } else {
    el.style.width = 'max-content';
    el.style.minWidth = '';
    el.style.maxWidth = '';
  }
  const size = {
    width: matchW > 0 ? matchW : Math.max(el.offsetWidth, el.scrollWidth, 96),
    height: Math.max(el.offsetHeight, el.scrollHeight, 1),
  };
  const placed = placeFloating({
    view,
    anchor,
    size,
    prefer: spec.prefer,
    align: spec.align,
    pad: spec.pad,
    gap: spec.gap,
  });
  el.style.top = `${placed.top}px`;
  el.style.left = `${placed.left}px`;
  el.style.maxHeight = `${placed.maxHeight}px`;
  if (matchW > 0) {
    el.style.maxWidth = `${matchW}px`;
  } else {
    el.style.maxWidth = `${placed.maxWidth}px`;
  }
  el.style.zIndex = '50';
}

function viewBox(): PlaceBox {
  const vv = window.visualViewport;
  if (vv) {
    // Client rects match the visual viewport origin (0, 0) in VS Code and Safari.
    return { left: 0, top: 0, width: vv.width, height: vv.height };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

function listen(): void {
  if (listening) {
    return;
  }
  listening = true;
  window.addEventListener('resize', reflowFloating);
  window.visualViewport?.addEventListener('resize', reflowFloating);
  window.visualViewport?.addEventListener('scroll', reflowFloating);
}

function clamp(n: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, n));
}
