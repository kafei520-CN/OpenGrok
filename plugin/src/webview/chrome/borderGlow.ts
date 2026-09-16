const CARD_SEL = [
  '#og-rail',
  '#og-dash',
  '.composer-card',
  '.og-card',
  '.starter',
  '.recent-card',
  '.og-set-card',
  '.settings-card',
  '.og-login',
  '.permission',
  '.ask-card',
].join(',');

const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
const GRADIENT_KEYS = [
  '--gradient-one',
  '--gradient-two',
  '--gradient-three',
  '--gradient-four',
  '--gradient-five',
  '--gradient-six',
  '--gradient-seven',
] as const;
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];
const DEFAULT_COLORS = ['#c084fc', '#f472b6', '#38bdf8'];
const LIGHT_COLORS = ['#c4b5fd', '#7dd3fc', '#fda4af'];

let boundRoot: HTMLElement | undefined;

export function syncBorderGlow(root: HTMLElement): void {
  bindPointer(root);
  if (root.dataset.surface !== 'glass') {
    for (const card of root.querySelectorAll<HTMLElement>('[data-border-glow]')) {
      teardown(card);
    }
    return;
  }
  const live = new Set<HTMLElement>();
  for (const node of root.querySelectorAll(CARD_SEL)) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    mount(node);
    live.add(node);
  }
  for (const card of root.querySelectorAll<HTMLElement>('[data-border-glow]')) {
    if (!live.has(card)) {
      teardown(card);
    }
  }
}

export function parseHsl(hslStr: string): { h: number; s: number; l: number } {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  if (!match) {
    return { h: 40, s: 80, l: 80 };
  }
  return { h: Number.parseFloat(match[1]), s: Number.parseFloat(match[2]), l: Number.parseFloat(match[3]) };
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === red) {
    h = ((green - blue) / d + (green < blue ? 6 : 0)) / 6;
  } else if (max === green) {
    h = ((blue - red) / d + 2) / 6;
  } else {
    h = ((red - green) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function parseCssColor(raw: string): [number, number, number] | undefined {
  const value = raw.trim();
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) {
      body = body.split('').map((ch) => ch + ch).join('');
    }
    const n = Number.parseInt(body, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) {
    return undefined;
  }
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

export function isLightColor(color: string): boolean {
  const rgb = parseCssColor(color);
  if (!rgb) {
    return false;
  }
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 180;
}

export function glowPalette(
  background: string,
  accent: string,
  ice: string,
): { glowColor: string; colors: string[]; light: boolean } {
  const light = isLightColor(background);
  const accentRgb = parseCssColor(accent);
  const hsl = accentRgb ? rgbToHsl(accentRgb[0], accentRgb[1], accentRgb[2]) : { h: 40, s: 80, l: 80 };
  if (hsl.s < 18) {
    return {
      glowColor: light ? '40 50 92' : '40 80 80',
      colors: light ? LIGHT_COLORS : DEFAULT_COLORS,
      light,
    };
  }
  const iceHex = cssColorToHex(ice) ?? shiftHex(cssColorToHex(accent) ?? DEFAULT_COLORS[2], 40);
  const accentHex = cssColorToHex(accent) ?? DEFAULT_COLORS[0];
  return {
    glowColor: `${fmt(hsl.h)} ${fmt(Math.max(hsl.s, 55))} ${fmt(light ? 78 : 70)}`,
    colors: [accentHex, iceHex, shiftHex(accentHex, 200)],
    light,
  };
}

function mount(card: HTMLElement): void {
  card.dataset.borderGlow = card.dataset.borderGlow || 'dark';
  if (!card.querySelector(':scope > .border-glow')) {
    card.prepend(createLayers());
  }
  paint(card);
}

function teardown(card: HTMLElement): void {
  card.querySelector(':scope > .border-glow')?.remove();
  delete card.dataset.borderGlow;
  card.classList.remove('sweep-active');
}

function createLayers(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'border-glow';
  wrap.setAttribute('aria-hidden', 'true');
  const mesh = document.createElement('span');
  mesh.className = 'border-glow-mesh';
  const ring = document.createElement('span');
  ring.className = 'border-glow-mesh-ring';
  mesh.append(ring);
  const fill = document.createElement('span');
  fill.className = 'border-glow-fill';
  const light = document.createElement('span');
  light.className = 'edge-light';
  wrap.append(mesh, fill, light);
  return wrap;
}

function paint(card: HTMLElement): void {
  const style = getComputedStyle(card);
  const rootStyle = getComputedStyle(document.documentElement);
  const background = rootStyle.getPropertyValue('--bg').trim() || style.backgroundColor;
  const accent = rootStyle.getPropertyValue('--accent').trim() || rootStyle.getPropertyValue('--fg').trim();
  const ice = rootStyle.getPropertyValue('--ice').trim() || accent;
  const theme = glowPalette(background, accent, ice);
  card.dataset.borderGlow = theme.light ? 'light' : 'dark';
  const glowVars = buildGlowVars(theme.glowColor, theme.light ? 1.28 : 1.5);
  const gradientVars = buildGradientVars(theme.colors);
  card.style.setProperty('--edge-sensitivity', '28');
  card.style.setProperty('--glow-padding', '16px');
  card.style.setProperty('--cone-spread', '33');
  card.style.setProperty('--fill-opacity', theme.light ? '0.33' : '0.54');
  for (const [name, value] of Object.entries({ ...glowVars, ...gradientVars })) {
    card.style.setProperty(name, value);
  }
}

function buildGlowVars(glowColor: string, intensity: number): Record<string, string> {
  const { h, s, l } = parseHsl(glowColor);
  const base = `${h}deg ${s}% ${l}%`;
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
  const vars: Record<string, string> = {};
  for (let i = 0; i < opacities.length; i += 1) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`;
  }
  return vars;
}

function buildGradientVars(colors: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  for (let i = 0; i < 7; i += 1) {
    const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)];
    vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`;
  }
  vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`;
  return vars;
}

function bindPointer(root: HTMLElement): void {
  if (boundRoot === root) {
    return;
  }
  boundRoot = root;
  root.addEventListener('pointermove', onPointerMove);
}

function onPointerMove(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const card = target.closest('[data-border-glow]');
  if (!(card instanceof HTMLElement)) {
    return;
  }
  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const edge = edgeProximity(rect.width, rect.height, x, y);
  const angle = cursorAngle(rect.width, rect.height, x, y);
  card.style.setProperty('--edge-proximity', edge.toFixed(3));
  card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
}

export function edgeProximity(width: number, height: number, x: number, y: number): number {
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  const dy = y - cy;
  let kx = Infinity;
  let ky = Infinity;
  if (dx !== 0) {
    kx = cx / Math.abs(dx);
  }
  if (dy !== 0) {
    ky = cy / Math.abs(dy);
  }
  return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1) * 100;
}

export function cursorAngle(width: number, height: number, x: number, y: number): number {
  const dx = x - width / 2;
  const dy = y - height / 2;
  if (dx === 0 && dy === 0) {
    return 0;
  }
  const degrees = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
  return degrees < 0 ? degrees + 360 : degrees;
}

function cssColorToHex(raw: string): string | undefined {
  const rgb = parseCssColor(raw);
  if (!rgb) {
    return undefined;
  }
  return `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

function shiftHex(hex: string, delta: number): string {
  const rgb = parseCssColor(hex);
  if (!rgb) {
    return DEFAULT_COLORS[2];
  }
  const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const next = (hsl.h + delta) % 360;
  return hslToHex(next < 0 ? next + 360 : next, Math.max(hsl.s, 45), Math.min(Math.max(hsl.l, 42), 78));
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return lig - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return cssColorToHex(`rgb(${f(0) * 255}, ${f(8) * 255}, ${f(4) * 255})`) ?? DEFAULT_COLORS[0];
}

function fmt(n: number): string {
  return n.toFixed(1);
}
