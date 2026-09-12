import type { ThemeColors } from '../core/types';

export const DEFAULT_WALLPAPER_OPACITY = 22;
export const DEFAULT_WALLPAPER_SCALE = 100;
export const MIN_WALLPAPER_SCALE = 20;
export const MAX_WALLPAPER_SCALE = 800;
export const DEFAULT_GLASS_OPACITY = 68;
export const DEFAULT_GLASS_BLUR = 18;
export const DEFAULT_CHROME_BLUR = 18;
export const DEFAULT_CHROME_GLASS_OPACITY = 72;
/** Layer 1 is the wallpaper slider. Layers 2–7 follow the component blur slider. */
const GLASS_LAYER_FACTOR = [0, 1, 1.25, 1.45, 1.65, 1.85, 2.05, 2.25] as const;
export const ICON_WALLPAPER = 'grok-symbol.png';
export const WALLPAPER_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
export const WALLPAPER_VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v'] as const;

/** Contain (letterbox with the theme background) unless the image is larger on both axes, then cover-crop. */
export function wallpaperFit(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): 'contain' | 'cover' {
  if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) {
    return 'contain';
  }
  if (imgW >= boxW && imgH >= boxH) {
    return 'cover';
  }
  return 'contain';
}

export function clampWallpaperOpacity(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_WALLPAPER_OPACITY;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function wallpaperKind(raw: unknown): ThemeColors['wallpaper'] {
  return raw === 'icon' || raw === 'custom' ? raw : undefined;
}

export function wallpaperExt(raw: string | undefined): string {
  if (!raw) {
    return '';
  }
  const clean = raw.split(/[?#]/)[0].replace(/\\/g, '/');
  const base = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function wallpaperMediaKind(raw: string | undefined): 'image' | 'video' {
  return (WALLPAPER_VIDEO_EXTS as readonly string[]).includes(wallpaperExt(raw)) ? 'video' : 'image';
}

export function isWallpaperFile(raw: string | undefined): boolean {
  const ext = wallpaperExt(raw);
  return (
    (WALLPAPER_IMAGE_EXTS as readonly string[]).includes(ext) ||
    (WALLPAPER_VIDEO_EXTS as readonly string[]).includes(ext)
  );
}

export function wallpaperMime(raw: string | undefined): string {
  const ext = wallpaperExt(raw);
  if (ext === 'webm') {
    return 'video/webm';
  }
  if (ext === 'ogv' || ext === 'ogg') {
    return 'video/ogg';
  }
  if (ext === 'mp4' || ext === 'm4v' || ext === 'mov') {
    return 'video/mp4';
  }
  return 'application/octet-stream';
}

export function surfaceKind(raw: unknown): ThemeColors['surface'] {
  return raw === 'glass' || raw === 'solid' ? raw : undefined;
}

/** Settings and drawers sit over home/chat. The wallpaper editor is the viewport itself. */
export function overlayKind(flags: {
  settingsOpen?: boolean;
  settingsPage?: string;
  drawer?: unknown;
}): 'settings' | 'drawer' | undefined {
  if (flags.settingsOpen && flags.settingsPage !== 'theme-preview') {
    return 'settings';
  }
  if (flags.drawer) {
    return 'drawer';
  }
  return undefined;
}

export function clampGlassOpacity(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_GLASS_OPACITY;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function clampGlassBlur(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_GLASS_BLUR;
  }
  return Math.max(0, Math.min(40, Math.round(n)));
}

export function clampChromeBlur(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_CHROME_BLUR;
  }
  return Math.max(0, Math.min(40, Math.round(n)));
}

export function clampChromeGlassOpacity(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_CHROME_GLASS_OPACITY;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function glassLayerBlur(basePx: number, layer: number): number {
  const factor = GLASS_LAYER_FACTOR[layer] ?? GLASS_LAYER_FACTOR[7];
  return Math.min(48, Math.round(Math.max(0, basePx) * factor));
}

/** Component frost from the chrome blur slider. Independent of wallpaper blur. */
export function chromeLayerBlur(basePx: number, layer: number): number {
  return glassLayerBlur(basePx, Math.max(2, layer));
}

export function clampWallpaperScale(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_WALLPAPER_SCALE;
  }
  return Math.max(MIN_WALLPAPER_SCALE, Math.min(MAX_WALLPAPER_SCALE, Math.round(n)));
}

export function clampWallpaperAxis(raw: unknown, fallback = 50): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function wallpaperLayerStyle(
  theme: ThemeColors,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { size: string; position: string } {
  if (theme.wallpaperScale != null) {
    return {
      size: `${theme.wallpaperScale}%`,
      position: `${theme.wallpaperX ?? 50}% ${theme.wallpaperY ?? 50}%`,
    };
  }
  return {
    size: wallpaperFit(imgW, imgH, boxW, boxH),
    position: '50% 50%',
  };
}

/** Pixel box that keeps the media aspect ratio. Scale is percent of the viewport width. */
export function wallpaperPlacement(
  theme: ThemeColors,
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { w: number; h: number; x: number; y: number } {
  const painted = wallpaperPaintedSize(imgW, imgH, boxW, boxH, theme.wallpaperScale);
  const px = theme.wallpaperX ?? 50;
  const py = theme.wallpaperY ?? 50;
  return {
    w: painted.w,
    h: painted.h,
    x: (boxW - painted.w) * (px / 100),
    y: (boxH - painted.h) * (py / 100),
  };
}

/** Painted size for `background-size: N%` (width) or contain/cover. */
export function wallpaperPaintedSize(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
  scale?: number,
): { w: number; h: number } {
  if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) {
    return { w: boxW, h: boxH };
  }
  if (scale != null) {
    const w = (scale / 100) * boxW;
    return { w, h: w * (imgH / imgW) };
  }
  const s =
    wallpaperFit(imgW, imgH, boxW, boxH) === 'cover'
      ? Math.max(boxW / imgW, boxH / imgH)
      : Math.min(boxW / imgW, boxH / imgH);
  return { w: imgW * s, h: imgH * s };
}

export function wallpaperScaleFromPainted(paintedW: number, boxW: number): number {
  if (!(boxW > 0)) {
    return DEFAULT_WALLPAPER_SCALE;
  }
  return clampWallpaperScale((paintedW / boxW) * 100);
}

/** CSS % position: offset = (box - painted) * pct / 100. Positive delta moves the image with the pointer. */
export function panWallpaperPct(origPct: number, deltaPx: number, box: number, painted: number): number {
  const span = box - painted;
  if (!(box > 0) || Math.abs(span) < 1) {
    return clampRange(origPct);
  }
  return clampRange(origPct + (deltaPx / span) * 100);
}

/** Shift so the image point under clickPx sits at the box center. */
export function centerWallpaperPct(origPct: number, clickPx: number, box: number, painted: number): number {
  return panWallpaperPct(origPct, box / 2 - clickPx, box, painted);
}

function clampRange(n: number): number {
  if (!Number.isFinite(n)) {
    return 50;
  }
  return Math.max(0, Math.min(100, n));
}

export function resolveWallpaperFile(
  theme: ThemeColors,
  io: {
    mediaFile?: (name: string) => string | undefined;
  },
): string | undefined {
  if (theme.wallpaper === 'custom' && theme.wallpaperPath) {
    return theme.wallpaperPath;
  }
  if (theme.wallpaper === 'icon') {
    return io.mediaFile?.(ICON_WALLPAPER);
  }
  return undefined;
}

export function withWallpaperUrl(
  theme: ThemeColors,
  io: {
    mediaFile?: (name: string) => string | undefined;
    toResourceUrl?: (filePath: string) => string | undefined;
  },
): ThemeColors {
  const file = resolveWallpaperFile(theme, io);
  const url = file ? io.toResourceUrl?.(file) : undefined;
  if (url) {
    return { ...theme, wallpaperUrl: url };
  }
  if (!theme.wallpaperUrl) {
    return theme;
  }
  const next = { ...theme };
  delete next.wallpaperUrl;
  return next;
}

export function withFontUrl(
  theme: ThemeColors,
  io: { toResourceUrl?: (filePath: string) => string | undefined },
): ThemeColors {
  const url = theme.fontPath ? io.toResourceUrl?.(theme.fontPath) : undefined;
  if (url) {
    return { ...theme, fontUrl: url };
  }
  if (!theme.fontUrl) {
    return theme;
  }
  const next = { ...theme };
  delete next.fontUrl;
  return next;
}
