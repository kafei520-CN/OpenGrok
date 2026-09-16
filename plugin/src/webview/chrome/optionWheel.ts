export type OptionWheelSide = 'left' | 'right';
export type OptionWheelAxis = 'vertical' | 'horizontal';

export interface OptionWheelItem {
  id: string;
  label: string;
}

export interface OptionWheelOpts {
  items: OptionWheelItem[];
  selectedIndex?: number;
  onChange?: (index: number, item: OptionWheelItem) => void;
  onCommit?: (index: number, item: OptionWheelItem) => void;
  textColor?: string;
  activeColor?: string;
  side?: OptionWheelSide;
  axis?: OptionWheelAxis;
  fontSize?: number;
  spacing?: number;
  curve?: number;
  tilt?: number;
  blur?: number;
  fade?: number;
  minOpacity?: number;
  smoothing?: number;
  inset?: number;
  /** Place the circle's center on the left/right edge of the wheel. */
  centerAt?: 'inset' | 'side';
  loop?: boolean;
  draggable?: boolean;
  className?: string;
  ariaLabel?: string;
}

interface WheelConfig {
  count: number;
  items: OptionWheelItem[];
  rowH: number;
  curve: number;
  tilt: number;
  blur: number;
  fade: number;
  minOpacity: number;
  side: OptionWheelSide;
  axis: OptionWheelAxis;
  centerAt: 'inset' | 'side';
  loop: boolean;
  smoothing: number;
  draggable: boolean;
}

type WheelHandle = {
  dispose: () => void;
};

const handles = new WeakMap<HTMLElement, WheelHandle>();

export function shortestDelta(index: number, position: number, count: number, loop: boolean): number {
  let d = index - position;
  if (loop && count > 1) {
    d = ((d % count) + count) % count;
    if (d > count / 2) {
      d -= count;
    }
  }
  return d;
}

export function clampTarget(value: number, count: number, loop: boolean, snap: boolean): number {
  let v = value;
  if (!loop) {
    v = Math.min(Math.max(v, 0), Math.max(count - 1, 0));
  }
  if (snap) {
    v = Math.round(v);
  }
  return v;
}

export function wrapIndex(value: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return ((Math.round(value) % count) + count) % count;
}

export function mountOptionWheel(opts: OptionWheelOpts): HTMLElement {
  const items = opts.items;
  const count = items.length;
  const start = wrapIndex(opts.selectedIndex ?? 0, Math.max(count, 1));
  const root = document.createElement('div');
  const axis: OptionWheelAxis = opts.axis === 'horizontal' ? 'horizontal' : 'vertical';
  root.className = [
    'option-wheel',
    opts.side === 'right' ? 'option-wheel--right' : '',
    axis === 'horizontal' ? 'option-wheel--horizontal' : '',
    opts.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  root.setAttribute('role', 'listbox');
  root.tabIndex = 0;
  root.setAttribute('aria-label', opts.ariaLabel || 'Option wheel');
  root.style.setProperty('--ow-font-size', `${opts.fontSize ?? 3}rem`);
  {
    const rem =
      typeof window === 'undefined'
        ? 16
        : Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const rowH = Math.max((opts.fontSize ?? 3) * (opts.spacing ?? 1.4) * rem, 1);
    const tiltRad = ((opts.tilt ?? 6) * Math.PI) / 180;
    const radius = tiltRad > 0.0005 ? rowH / tiltRad : 0;
    const inset =
      opts.centerAt === 'side' && radius > 0 ? radius : (opts.inset ?? 80);
    root.style.setProperty('--ow-inset', `${inset}px`);
  }
  if (opts.textColor) {
    root.style.setProperty('--ow-text-color', opts.textColor);
  }
  if (opts.activeColor) {
    root.style.setProperty('--ow-active-color', opts.activeColor);
  }

  const itemEls: HTMLDivElement[] = [];
  const posRef = { current: start };
  const targetRef = { current: start };
  const selectedRef = { current: start };
  let raf: number | null = null;
  let last = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;
  let drag: { pos: number; start: number; id: number } | null = null;
  let dragMoved = false;

  const cfg = (): WheelConfig => {
    const rem =
      typeof window === 'undefined'
        ? 16
        : Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return {
      count,
      items,
      rowH: Math.max((opts.fontSize ?? 3) * (opts.spacing ?? 1.4) * rem, 1),
      curve: opts.curve ?? 1,
      tilt: opts.tilt ?? 6,
      blur: opts.blur ?? 2,
      fade: opts.fade ?? 0.25,
      minOpacity: opts.minOpacity ?? 0.05,
      side: opts.side ?? 'left',
      axis,
      centerAt: opts.centerAt === 'side' ? 'side' : 'inset',
      loop: Boolean(opts.loop),
      smoothing: opts.smoothing ?? 200,
      draggable: opts.draggable !== false,
    };
  };

  const paint = (now: number) => {
    if (!root.isConnected) {
      dispose();
      return;
    }
    const conf = cfg();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const tau = Math.max(conf.smoothing, 1) / 1000;
    const k = 1 - Math.exp(-dt / tau);
    const target = targetRef.current;
    const cur = posRef.current;
    let next = cur + (target - cur) * k;
    const settled = Math.abs(target - next) < 0.001;
    if (settled) {
      next = target;
    }
    posRef.current = next;

    const mirror = conf.side === 'right' ? -1 : 1;
    const along = conf.axis === 'horizontal' ? mirror : 1;
    const tiltRad = (conf.tilt * Math.PI) / 180;
    const radius = tiltRad > 0.0005 ? conf.rowH / tiltRad : 0;
    if (conf.centerAt === 'side' && radius > 0) {
      root.style.setProperty('--ow-inset', `${radius.toFixed(1)}px`);
    }
    for (let i = 0; i < conf.count; i += 1) {
      const el = itemEls[i];
      if (!el) {
        continue;
      }
      const d = shortestDelta(i, next, conf.count, conf.loop);
      const dist = Math.abs(d);
      let x = 0;
      let y = d * conf.rowH;
      let rot = 0;
      if (radius > 0) {
        const ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d * tiltRad));
        const arc = radius * Math.sin(ang);
        const dip = radius * (1 - Math.cos(ang)) * conf.curve;
        if (conf.axis === 'horizontal') {
          x = along * arc;
          y = -dip;
          rot = -along * ((ang * 180) / Math.PI);
        } else {
          y = arc;
          x = -mirror * dip;
          rot = (mirror * ang * 180) / Math.PI;
        }
      } else if (conf.axis === 'horizontal') {
        x = along * d * conf.rowH;
        y = 0;
      }
      el.style.transform = `translate(${x.toFixed(2)}px, calc(${y.toFixed(2)}px - 50%)) rotate(${rot.toFixed(3)}deg)`;
      el.style.opacity = String(Math.max(conf.minOpacity, 1 - dist * conf.fade));
      el.style.filter = conf.blur > 0 ? `blur(${(dist * conf.blur).toFixed(2)}px)` : 'none';
      el.style.setProperty('--ow-p', Math.max(0, 1 - Math.min(dist, 1)).toFixed(4));
    }
    raf = settled ? null : requestAnimationFrame(paint);
  };

  const startLoop = () => {
    if (raf != null) {
      cancelAnimationFrame(raf);
    }
    last = performance.now();
    raf = requestAnimationFrame(paint);
  };

  const markSelected = (idx: number) => {
    for (let i = 0; i < itemEls.length; i += 1) {
      const el = itemEls[i];
      if (!el) {
        continue;
      }
      const on = i === idx;
      el.classList.toggle('option-wheel__item--selected', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  };

  const applyTarget = (value: number, snap: boolean, commit: boolean) => {
    const conf = cfg();
    const v = clampTarget(value, conf.count, conf.loop, snap);
    targetRef.current = v;
    const idx = wrapIndex(v, conf.count);
    if (idx !== selectedRef.current) {
      selectedRef.current = idx;
      markSelected(idx);
      const item = conf.items[idx];
      if (item) {
        opts.onChange?.(idx, item);
        if (commit) {
          opts.onCommit?.(idx, item);
        }
      }
    } else if (commit) {
      const item = conf.items[idx];
      if (item) {
        opts.onCommit?.(idx, item);
      }
    }
    startLoop();
  };

  const handleItemClick = (index: number) => {
    if (dragMoved) {
      return;
    }
    const conf = cfg();
    const cur = targetRef.current;
    let d = index - wrapIndex(cur, conf.count);
    if (conf.loop && conf.count > 1) {
      if (d > conf.count / 2) {
        d -= conf.count;
      } else if (d < -conf.count / 2) {
        d += conf.count;
      }
    }
    applyTarget(cur + d, true, true);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const conf = cfg();
    const raw = conf.axis === 'horizontal' && event.deltaX ? event.deltaX : event.deltaY;
    const delta = event.deltaMode === 1 ? raw * 24 : raw;
    const step = Math.max(-1, Math.min(1, delta / conf.rowH));
    applyTarget(targetRef.current + step, false, false);
    if (wheelTimer) {
      clearTimeout(wheelTimer);
    }
    wheelTimer = setTimeout(() => applyTarget(targetRef.current, true, false), 140);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!cfg().draggable) {
      return;
    }
    drag = {
      pos: axis === 'horizontal' ? event.clientX : event.clientY,
      start: targetRef.current,
      id: event.pointerId,
    };
    dragMoved = false;
    root.classList.add('option-wheel--dragging');
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag) {
      return;
    }
    const now = axis === 'horizontal' ? event.clientX : event.clientY;
    const delta = now - drag.pos;
    if (!dragMoved && Math.abs(delta) > 4) {
      dragMoved = true;
      root.setPointerCapture(drag.id);
    }
    if (dragMoved) {
      applyTarget(drag.start - delta / cfg().rowH, false, false);
    }
  };

  const onPointerEnd = () => {
    if (!drag) {
      return;
    }
    drag = null;
    root.classList.remove('option-wheel--dragging');
    if (dragMoved) {
      applyTarget(targetRef.current, true, false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    let delta: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      delta = -1;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      delta = 1;
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      applyTarget(targetRef.current, true, true);
      return;
    }
    if (delta == null) {
      return;
    }
    event.preventDefault();
    applyTarget(Math.round(targetRef.current) + delta, true, false);
  };

  function dispose() {
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    if (wheelTimer) {
      clearTimeout(wheelTimer);
      wheelTimer = null;
    }
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerEnd);
    root.removeEventListener('pointercancel', onPointerEnd);
    root.removeEventListener('keydown', onKeyDown);
    handles.delete(root);
  }

  for (let i = 0; i < count; i += 1) {
    const item = items[i]!;
    const el = document.createElement('div');
    el.className = i === start ? 'option-wheel__item option-wheel__item--selected' : 'option-wheel__item';
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', i === start ? 'true' : 'false');
    el.textContent = item.label;
    el.addEventListener('click', () => handleItemClick(i));
    root.append(el);
    itemEls.push(el);
  }
  const sizer = document.createElement('span');
  sizer.className = 'option-wheel__sizer';
  sizer.setAttribute('aria-hidden', 'true');
  sizer.textContent = items.reduce((best, item) => (item.label.length > best.length ? item.label : best), '');
  root.append(sizer);

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerEnd);
  root.addEventListener('pointercancel', onPointerEnd);
  root.addEventListener('keydown', onKeyDown);
  handles.set(root, { dispose });
  applyTarget(start, true, false);
  return root;
}

export function destroyOptionWheel(root: HTMLElement): void {
  handles.get(root)?.dispose();
}
