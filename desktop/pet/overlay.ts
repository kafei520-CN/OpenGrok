import {
  isPetColor,
  isPetFace,
  isPetShape,
  resolvePetBodyInk,
  resolvePetEyeInk,
} from './identity';

type PetApi = {
  ready(): void;
  move(delta: { dx: number; dy: number }): void;
  endMove(): void;
  click(): void;
  dblclick(): void;
  menu(): void;
  setIgnore(ignore: boolean): void;
  fit(opts: { bubble?: boolean; size?: number }): void;
  onConfig(handler: (config: unknown) => void): void;
  onStatus(handler: (status: unknown) => void): void;
};

const api = (window as unknown as { opengrokPet?: PetApi }).opengrokPet;
const markHost = document.getElementById('mark') as HTMLElement;
const bubbles = document.getElementById('bubbles') as HTMLElement;

const STATUS_CLASS: Record<string, string> = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  done: 'done',
  alert: 'alert',
};

const DBLCLICK_MS = 280;
const MARK_PATHS = [
  'M13.237 21.041 24.319 12.851c.543-.402 1.32-.245 1.578.379 1.363 3.289.754 7.242-1.957 9.956-2.71 2.714-6.482 3.309-9.93 1.953l-3.766 1.746c5.401 3.696 11.96 2.782 16.059-1.324 3.251-3.255 4.258-7.692 3.317-11.693L29.111 5.091 13.234 21.044Z',
  'M10.95 23.031C7.073 19.324 7.742 13.585 11.05 10.276c2.446-2.449 6.454-3.449 9.952-1.979l3.758-1.737C24.083 6.07 23.215 5.543 22.22 5.173c-4.5-1.854-9.887-.931-13.545 2.728C5.156 11.424 4.05 16.84 5.95 21.462c1.419 3.454-.907 5.898-3.251 8.364C1.868 30.7 1.035 31.575.364 32.5L10.947 23.034Z',
];

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

const svg = svgEl('svg', { viewBox: '0 0 120 120', role: 'img', 'aria-label': 'OpenGrok pet' });
const critter = svgEl('g', { class: 'critter' });
const body = svgEl('g', { class: 'body' });
const face = svgEl('g', { class: 'face' });
const leftEye = svgEl('ellipse', { class: 'eye', cx: 46, cy: 56, rx: 9, ry: 11 });
const rightEye = svgEl('ellipse', { class: 'eye', cx: 74, cy: 56, rx: 9, ry: 11 });
const pupils = svgEl('g', { class: 'pupils' });
pupils.append(
  svgEl('circle', { class: 'pupil', cx: 47, cy: 58, r: 4.4 }),
  svgEl('circle', { class: 'pupil', cx: 75, cy: 58, r: 4.4 }),
  svgEl('circle', { class: 'spark', cx: 45.2, cy: 55.2, r: 1.4 }),
  svgEl('circle', { class: 'spark', cx: 73.2, cy: 55.2, r: 1.4 }),
);
const smile = svgEl('path', { class: 'smile', d: 'M50 76c6 7 14 7 20 0', fill: 'none' });
face.append(leftEye, rightEye, pupils, smile);
critter.append(body, face);
svg.append(critter);
const spriteStage = document.createElement('div');
spriteStage.className = 'sprite-stage';
spriteStage.hidden = true;
const spriteFrames: Record<string, HTMLImageElement> = {};
for (const kind of ['idle', 'blink', 'think'] as const) {
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.dataset.kind = kind;
  spriteStage.append(img);
  spriteFrames[kind] = img;
}
markHost.append(svg, spriteStage);

const SPRITES: Record<string, Record<string, string>> = {
  anime: {
    idle: './pet-assets/anime-idle.png',
    blink: './pet-assets/anime-blink.png',
    think: './pet-assets/anime-think.png',
  },
  pixel: {
    idle: './pet-assets/pixel-idle.png',
    think: './pet-assets/pixel-think.png',
  },
  adult: {
    idle: './pet-assets/adult-idle.png',
    blink: './pet-assets/adult-blink.png',
    think: './pet-assets/adult-think.png',
  },
};

let blinkTimer = 0;
let shownFrame = 'idle';

function paintBody(shape: string, fill: string): void {
  body.replaceChildren();
  if (shape === 'mark') {
    const g = svgEl('g', { transform: 'translate(12 14) scale(2.7)' });
    for (const d of MARK_PATHS) {
      g.append(svgEl('path', { d, fill }));
    }
    body.append(g);
    leftEye.setAttribute('cx', '46');
    rightEye.setAttribute('cx', '74');
    leftEye.setAttribute('cy', '54');
    rightEye.setAttribute('cy', '54');
    return;
  }
  if (shape === 'orb') {
    body.append(svgEl('ellipse', { cx: 60, cy: 64, rx: 42, ry: 40, fill }));
    leftEye.setAttribute('cx', '46');
    rightEye.setAttribute('cx', '74');
    leftEye.setAttribute('cy', '58');
    rightEye.setAttribute('cy', '58');
    return;
  }
  body.append(
    svgEl('path', {
      d: 'M60 6C63 32 78 47 104 60 78 73 63 88 60 114 57 88 42 73 16 60 42 47 57 32 60 6Z',
      fill,
    }),
  );
  leftEye.setAttribute('cx', '46');
  rightEye.setAttribute('cx', '74');
  leftEye.setAttribute('cy', '56');
  rightEye.setAttribute('cy', '56');
}

let prefs = {
  shape: 'star',
  color: 'ink',
  face: 'idle',
  size: 128,
  bubbles: true,
};
let mood = 'idle';
let hideTimer = 0;
let drag: { x: number; y: number } | null = null;
let moved = false;
let overPet = false;
let pendingClick: number | null = null;
let labels = { thinking: '思考中…', working: '工作中…', done: '完成', alert: '需要你' };

function showSpriteFrame(kind: 'idle' | 'blink' | 'think'): void {
  shownFrame = kind;
  for (const [name, img] of Object.entries(spriteFrames)) {
    img.classList.toggle('is-on', name === kind);
  }
}

function loadSpritePack(shape: string): void {
  const pack = SPRITES[shape];
  if (!pack) {
    return;
  }
  for (const kind of ['idle', 'blink', 'think'] as const) {
    const img = spriteFrames[kind];
    const src = pack[kind] ?? pack.idle ?? '';
    if (img && src && img.src !== new URL(src, location.href).href) {
      img.src = src;
    }
  }
}

function stopBlink(): void {
  window.clearTimeout(blinkTimer);
  window.clearInterval(blinkTimer);
  blinkTimer = 0;
}

function startIdleCycle(): void {
  stopBlink();
  showSpriteFrame('idle');
  const hasBlink = Boolean(SPRITES[prefs.shape]?.blink);
  const hasThink = Boolean(SPRITES[prefs.shape]?.think);
  const tick = () => {
    if (mood !== 'idle' || !SPRITES[prefs.shape]) {
      return;
    }
    const roll = Math.random();
    if (hasBlink && roll < 0.62) {
      showSpriteFrame('blink');
      window.setTimeout(() => {
        if (mood !== 'idle') {
          return;
        }
        if (Math.random() < 0.32) {
          showSpriteFrame('idle');
          window.setTimeout(() => {
            if (mood !== 'idle') {
              return;
            }
            showSpriteFrame('blink');
            window.setTimeout(() => {
              if (mood === 'idle') {
                showSpriteFrame('idle');
              }
            }, 120);
          }, 70);
        } else {
          showSpriteFrame('idle');
        }
      }, 150);
    } else if (hasThink) {
      showSpriteFrame('think');
      window.setTimeout(() => {
        if (mood === 'idle') {
          showSpriteFrame('idle');
        }
      }, 720);
    }
    blinkTimer = window.setTimeout(tick, 2000 + Math.random() * 2400);
  };
  blinkTimer = window.setTimeout(tick, 1600 + Math.random() * 1400);
}

function applySpriteFrame(): void {
  const pack = SPRITES[prefs.shape];
  if (!pack) {
    return;
  }
  loadSpritePack(prefs.shape);
  stopBlink();
  if (mood === 'working') {
    showSpriteFrame('think');
    blinkTimer = window.setInterval(() => {
      showSpriteFrame(shownFrame === 'think' ? 'idle' : 'think');
    }, 860);
    return;
  }
  if (mood === 'thinking' || prefs.face === 'curious') {
    showSpriteFrame('think');
    return;
  }
  if (mood === 'done') {
    showSpriteFrame('think');
    window.setTimeout(() => {
      if (mood === 'done' || mood === 'idle') {
        showSpriteFrame('idle');
      }
    }, 520);
  }
  startIdleCycle();
}

function applyLook(): void {
  const fill = resolvePetBodyInk(prefs.color);
  const tone = resolvePetEyeInk(prefs.color);
  const display = prefs.shape === 'adult' ? Math.round(prefs.size * 1.6) : prefs.size;
  document.documentElement.style.setProperty('--pet-size', `${display}px`);
  document.documentElement.style.setProperty('--pet-body', fill);
  document.documentElement.style.setProperty('--pet-eye', tone.eye);
  document.documentElement.style.setProperty('--pet-pupil', tone.pupil);
  const spriteShape = Boolean(SPRITES[prefs.shape]);
  markHost.classList.toggle('is-sprite', spriteShape);
  markHost.classList.toggle('is-anime', prefs.shape === 'anime' || prefs.shape === 'adult');
  markHost.classList.toggle('is-pixel', prefs.shape === 'pixel');
  svg.hidden = spriteShape;
  spriteStage.hidden = !spriteShape;
  if (spriteShape) {
    applySpriteFrame();
    return;
  }
  stopBlink();
  paintBody(prefs.shape, fill);
  smile.style.opacity = prefs.face === 'happy' || mood === 'done' ? '1' : prefs.face === 'idle' ? '0.85' : '0';
  face.style.transform = prefs.face === 'curious' ? 'translate(3px,-1px)' : '';
}

function setIgnore(ignore: boolean): void {
  api?.setIgnore(ignore);
}

function overBlob(x: number, y: number): boolean {
  const box = markHost.getBoundingClientRect();
  return Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2)) < box.width * 0.48;
}

function showBubble(text: string, phase: 'active' | 'done' | 'error' | 'wait', ms: number): void {
  if (!prefs.bubbles) {
    bubbles.hidden = true;
    api?.fit({ bubble: false, size: prefs.size });
    return;
  }
  bubbles.hidden = false;
  bubbles.innerHTML = `<button type="button" class="pet-bubble is-${phase}"><span class="pet-bubble__row"><span class="pet-bubble__glyph">${phase === 'active' ? '<span class="pet-bubble__spin"></span>' : phase === 'done' ? '✓' : '!'}</span><span class="pet-bubble__title"></span></span></button>`;
  const title = bubbles.querySelector('.pet-bubble__title');
  if (title) {
    title.textContent = text;
  }
  api?.fit({ bubble: true, size: prefs.size });
  requestAnimationFrame(() => api?.fit({ bubble: true, size: prefs.size }));
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    bubbles.hidden = true;
    api?.fit({ bubble: false, size: prefs.size });
  }, ms);
}

function setMood(next: string, headline?: string): void {
  mood = next;
  critter.setAttribute('class', `critter ${STATUS_CLASS[next] ?? 'idle'}`);
  if (SPRITES[prefs.shape]) {
    applySpriteFrame();
  }
  const text = (headline ?? '').trim();
  if (next === 'thinking' || next === 'working') {
    showBubble(text || labels.working, 'active', 12000);
  } else if (next === 'done') {
    showBubble(text || labels.done, 'done', 2400);
  } else if (next === 'alert') {
    showBubble(text || labels.alert, 'wait', 8000);
  } else {
    bubbles.hidden = true;
    api?.fit({ bubble: false, size: prefs.size });
  }
}

function applyConfig(config: {
  labels?: typeof labels;
  size?: number;
  color?: string;
  shape?: string;
  expression?: string;
  bubbles?: boolean;
}): void {
  if (config.labels) {
    labels = { ...labels, ...config.labels };
  }
  prefs = {
    shape: isPetShape(config.shape) ? config.shape : prefs.shape,
    color: isPetColor(config.color) ? config.color : prefs.color,
    face: isPetFace(config.expression) ? config.expression : prefs.face,
    size: Number(config.size) || prefs.size,
    bubbles: config.bubbles !== false,
  };
  applyLook();
  api?.fit({ bubble: prefs.bubbles && !bubbles.hidden, size: prefs.size });
}

function applyStatus(status: unknown): void {
  if (typeof status === 'string') {
    setMood(status);
    return;
  }
  if (!status || typeof status !== 'object') {
    setMood('idle');
    return;
  }
  const row = status as { mood?: string; headline?: string };
  setMood(row.mood ?? 'idle', row.headline);
}

window.addEventListener('mousemove', (event) => {
  const hit = overBlob(event.clientX, event.clientY);
  if (hit !== overPet) {
    overPet = hit;
    setIgnore(!hit);
  }
});

document.addEventListener('mouseleave', () => {
  overPet = false;
  if (!drag) {
    setIgnore(true);
  }
});

markHost.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  markHost.setPointerCapture(event.pointerId);
  drag = { x: event.screenX, y: event.screenY };
  moved = false;
  setIgnore(false);
});

markHost.addEventListener('pointermove', (event) => {
  if (!drag) {
    return;
  }
  const dx = event.screenX - drag.x;
  const dy = event.screenY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 8) {
    moved = true;
  }
  drag = { x: event.screenX, y: event.screenY };
  api?.move({ dx, dy });
});

markHost.addEventListener('pointerup', () => {
  if (!drag) {
    return;
  }
  drag = null;
  api?.endMove();
  if (!moved) {
    if (pendingClick != null) {
      window.clearTimeout(pendingClick);
      pendingClick = null;
      api?.dblclick();
    } else {
      pendingClick = window.setTimeout(() => {
        pendingClick = null;
        const faces = ['happy', 'curious', 'idle'] as const;
        prefs.face = faces[Math.floor(Math.random() * faces.length)] ?? 'happy';
        applyLook();
      }, DBLCLICK_MS);
    }
  }
  setIgnore(!overPet);
});

markHost.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  api?.menu();
});

api?.onConfig((config) => applyConfig(config as Parameters<typeof applyConfig>[0]));
api?.onStatus(applyStatus);
applyLook();
api?.ready();
setIgnore(true);
