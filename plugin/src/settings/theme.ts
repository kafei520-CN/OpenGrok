import type { ThemeColors, WebviewToHost } from '../core/types';
import {
  clampChromeBlur,
  clampChromeGlassOpacity,
  chromeLayerBlur,
  clampGlassBlur,
  clampGlassOpacity,
  clampWallpaperAxis,
  clampWallpaperOpacity,
  clampWallpaperScale,
  DEFAULT_CHROME_BLUR,
  DEFAULT_CHROME_GLASS_OPACITY,
  DEFAULT_GLASS_BLUR,
  DEFAULT_GLASS_OPACITY,
  DEFAULT_WALLPAPER_OPACITY,
  surfaceKind,
  wallpaperExt,
  wallpaperKind,
} from './wallpaper';

export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 22;
export const DEFAULT_LETTER_SPACING = 0;
export const MIN_LETTER_SPACING = -4;
export const MAX_LETTER_SPACING = 8;
export const THEME_FONT_FAMILY = 'Grok Custom';
export const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'] as const;

export const DEFAULT_THEME: ThemeColors = {
  primary: '#f4f4f4',
  secondary: '#737373',
};

export const THEME_PRESETS: Array<{
  id: string;
  primary: string;
  secondary: string;
  background?: string;
}> = [
  { id: 'ink', primary: '#f4f4f4', secondary: '#737373', background: '#000000' },
  { id: 'paper', primary: '#111111', secondary: '#737373', background: '#f4f4f4' },
  { id: 'ice', primary: '#b9d4ff', secondary: '#3fb950' },
  { id: 'aurora', primary: '#7dd3fc', secondary: '#34d399', background: '#0b1620' },
  { id: 'violet', primary: '#c4b5fd', secondary: '#a78bfa', background: '#14101c' },
  { id: 'sunset', primary: '#fdba74', secondary: '#f59e0b', background: '#1a140f' },
  { id: 'rose', primary: '#fda4af', secondary: '#fb7185', background: '#1a1014' },
  { id: 'ember', primary: '#fcd34d', secondary: '#f97316', background: '#1a150c' },
];

const SURFACE_VARS = [
  '--bg',
  '--fg',
  '--muted',
  '--elev',
  '--line',
  '--hover',
  '--vscode-foreground',
  '--vscode-descriptionForeground',
  '--vscode-sideBar-background',
  '--vscode-editor-background',
  '--vscode-textLink-foreground',
] as const;

export function parseHex(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = /^#([0-9a-f]{6})$/i.exec(value);
  return full ? `#${full[1].toLowerCase()}` : undefined;
}

export function rgbToHex(raw: string): string | undefined {
  const hex = parseHex(raw);
  if (hex) {
    return hex;
  }
  const value = raw.trim();
  const csv = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (csv) {
    return toHex(+csv[1], +csv[2], +csv[3]);
  }
  const spaced = /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)/i.exec(value);
  return spaced ? toHex(+spaced[1], +spaced[2], +spaced[3]) : undefined;
}

export function contrastFg(background: string): string {
  return hexLuminance(background) > 0.4 ? '#1c1c1c' : '#e8e8e8';
}

export function normalizeTheme(raw: unknown): ThemeColors {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const background = parseHex(value.background);
  const wallpaper = wallpaperKind(value.wallpaper);
  const wallpaperPath =
    typeof value.wallpaperPath === 'string' && value.wallpaperPath.trim()
      ? value.wallpaperPath.trim()
      : undefined;
  const customPath = wallpaper === 'custom' ? wallpaperPath : undefined;
  const kind = wallpaper === 'custom' && !customPath ? undefined : wallpaper;
  const surface = surfaceKind(value.surface);
  const manual = kind && value.wallpaperScale != null;
  return {
    primary: parseHex(value.primary) ?? DEFAULT_THEME.primary,
    secondary: parseHex(value.secondary) ?? DEFAULT_THEME.secondary,
    ...(background ? { background } : {}),
    ...(kind ? { wallpaper: kind } : {}),
    ...(kind ? { wallpaperOpacity: clampWallpaperOpacity(value.wallpaperOpacity) } : {}),
    ...(customPath ? { wallpaperPath: customPath } : {}),
    ...(manual ? { wallpaperScale: clampWallpaperScale(value.wallpaperScale) } : {}),
    ...(manual ? { wallpaperX: clampWallpaperAxis(value.wallpaperX) } : {}),
    ...(manual ? { wallpaperY: clampWallpaperAxis(value.wallpaperY) } : {}),
    ...(surface ? { surface } : {}),
    ...(surface === 'glass' || value.glassOpacity != null
      ? { glassOpacity: clampGlassOpacity(value.glassOpacity) }
      : {}),
    ...(surface === 'glass' || value.glassBlur != null
      ? { glassBlur: clampGlassBlur(value.glassBlur) }
      : {}),
    ...(surface === 'glass' || value.chromeBlur != null
      ? { chromeBlur: clampChromeBlur(value.chromeBlur) }
      : {}),
    ...(value.chromeGlass === true ? { chromeGlass: true } : {}),
    ...(value.chromeGlass === true || value.chromeGlassOpacity != null
      ? { chromeGlassOpacity: clampChromeGlassOpacity(value.chromeGlassOpacity) }
      : {}),
    ...(typeof value.fontPath === 'string' && value.fontPath.trim() && isFontFile(value.fontPath)
      ? { fontPath: value.fontPath.trim() }
      : {}),
    ...(value.fontSize != null ? { fontSize: clampFontSize(value.fontSize) } : {}),
    ...(value.letterSpacing != null ? { letterSpacing: clampLetterSpacing(value.letterSpacing) } : {}),
    ...(parseHex(value.fontColor) ? { fontColor: parseHex(value.fontColor) } : {}),
    ...(value.lockContrast === false ? { lockContrast: false } : {}),
  };
}

export function isFontFile(raw: string | undefined): boolean {
  return (FONT_EXTS as readonly string[]).includes(wallpaperExt(raw));
}

export function clampFontSize(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_FONT_SIZE;
  }
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)));
}

export function clampLetterSpacing(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_LETTER_SPACING;
  }
  return Math.max(MIN_LETTER_SPACING, Math.min(MAX_LETTER_SPACING, Math.round(n)));
}

/** Default on: custom fontColor does not change --fg. */
export function lockContrastEnabled(theme: Pick<ThemeColors, 'lockContrast'>): boolean {
  return theme.lockContrast !== false;
}

export function themeMessage(theme: ThemeColors): Extract<WebviewToHost, { type: 'setTheme' }> {
  const base = normalizeTheme(theme);
  return {
    type: 'setTheme',
    primary: base.primary,
    secondary: base.secondary,
    background: base.background ?? '',
    wallpaper: base.wallpaper ?? '',
    wallpaperOpacity: base.wallpaperOpacity ?? DEFAULT_WALLPAPER_OPACITY,
    wallpaperScale: base.wallpaperScale,
    wallpaperX: base.wallpaperX,
    wallpaperY: base.wallpaperY,
    surface: base.surface ?? '',
    glassOpacity: base.glassOpacity ?? DEFAULT_GLASS_OPACITY,
    glassBlur: base.glassBlur ?? DEFAULT_GLASS_BLUR,
    chromeBlur: base.chromeBlur ?? DEFAULT_CHROME_BLUR,
    chromeGlass: base.chromeGlass === true,
    chromeGlassOpacity: base.chromeGlassOpacity ?? DEFAULT_CHROME_GLASS_OPACITY,
    fontPath: base.fontPath ?? '',
    fontSize: base.fontSize ?? DEFAULT_FONT_SIZE,
    letterSpacing: base.letterSpacing ?? DEFAULT_LETTER_SPACING,
    fontColor: base.fontColor ?? '',
    lockContrast: lockContrastEnabled(base),
  };
}

export function matchingPresetId(theme: ThemeColors): string | undefined {
  const current = normalizeTheme(theme);
  return THEME_PRESETS.find(
    (row) =>
      row.primary === current.primary &&
      row.secondary === current.secondary &&
      (row.background ?? '') === (current.background ?? ''),
  )?.id;
}

export function applyThemeTo(
  style: { setProperty(name: string, value: string): void; removeProperty?(name: string): void },
  raw: unknown,
  chrome?: { background?: string; foreground?: string },
): void {
  const theme = normalizeTheme(raw);
  const background = theme.background ?? parseHex(chrome?.background);
  const hostFg = parseHex(chrome?.foreground);
  const fg = resolveFg(theme, background, hostFg);
  if (background) {
    const text = fg ?? contrastFg(background);
    style.setProperty('--bg', background);
    style.setProperty('--fg', text);
    style.setProperty('--muted', 'color-mix(in srgb, var(--fg) 55%, transparent)');
    style.setProperty('--elev', 'color-mix(in srgb, var(--fg) 6%, var(--bg))');
    style.setProperty('--line', 'color-mix(in srgb, var(--fg) 12%, transparent)');
    style.setProperty('--hover', 'color-mix(in srgb, var(--fg) 8%, transparent)');
    style.setProperty('--vscode-foreground', text);
    style.setProperty('--vscode-descriptionForeground', 'color-mix(in srgb, var(--fg) 55%, transparent)');
    style.setProperty('--vscode-sideBar-background', background);
    style.setProperty('--vscode-editor-background', background);
    style.setProperty('--vscode-textLink-foreground', text);
    style.setProperty('color-scheme', hexLuminance(background) > 0.4 ? 'light' : 'dark');
  } else {
    for (const name of SURFACE_VARS) {
      style.removeProperty?.(name);
    }
    style.removeProperty?.('color-scheme');
    if (fg) {
      style.setProperty('--fg', fg);
    }
  }
  style.setProperty('--font-size', `${theme.fontSize ?? DEFAULT_FONT_SIZE}px`);
  style.setProperty('--letter-spacing', `${theme.letterSpacing ?? DEFAULT_LETTER_SPACING}px`);
  if (theme.fontPath || theme.fontUrl) {
    style.setProperty('--font', `'${THEME_FONT_FAMILY}', var(--vscode-font-family, sans-serif)`);
  } else {
    style.removeProperty?.('--font');
  }
  style.setProperty('--ice', `color-mix(in srgb, ${theme.primary} 72%, var(--fg))`);
  style.setProperty('--ice-dim', 'color-mix(in srgb, var(--ice) 28%, transparent)');
  style.setProperty('--ok', theme.secondary);
  style.setProperty('--accent', theme.primary);
  style.setProperty('--on-accent', contrastFg(theme.primary));
  style.setProperty('--glass-fill', `${theme.glassOpacity ?? DEFAULT_GLASS_OPACITY}%`);
  const bgBlur = theme.glassBlur ?? DEFAULT_GLASS_BLUR;
  const chromeBlur = theme.chromeBlur ?? DEFAULT_CHROME_BLUR;
  style.setProperty('--glass-blur', `${bgBlur}px`);
  style.setProperty('--glass-1-blur', `${bgBlur}px`);
  style.setProperty('--glass-bg-pad', bgBlur > 0 ? '1.08' : '1');
  for (let layer = 2; layer <= 7; layer += 1) {
    style.setProperty(`--glass-${layer}-blur`, `${chromeLayerBlur(chromeBlur, layer)}px`);
  }
  const chromeFill = theme.chromeGlassOpacity ?? DEFAULT_CHROME_GLASS_OPACITY;
  style.setProperty('--chrome-fill', `${chromeFill}%`);
}

function resolveFg(
  theme: ThemeColors,
  background: string | undefined,
  hostFg: string | undefined,
): string | undefined {
  if (!lockContrastEnabled(theme) && theme.fontColor) {
    return theme.fontColor;
  }
  if (theme.background) {
    return contrastFg(theme.background);
  }
  if (hostFg) {
    return hostFg;
  }
  return background ? contrastFg(background) : undefined;
}

function toHex(r: number, g: number, b: number): string | undefined {
  if (![r, g, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return undefined;
  }
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function hexLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const c = ((n >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}
