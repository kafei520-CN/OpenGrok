import { THEME_FONT_FAMILY } from '../../settings/theme';
import type { ThemeColors } from '../../core/types';
import { framedSurface, frostSurface, surfaceKind } from '../../settings/surfaces';
import {
  DEFAULT_WALLPAPER_OPACITY,
  overlayKind,
  wallpaperMediaKind,
  wallpaperMime,
  wallpaperPlacement,
} from '../../settings/wallpaper';
import { isDesktop, isRemoteWeb } from '../app';

/** Inject @font-face for a user-imported file. Empty url removes it. */
export function syncThemeFontFace(doc: Document, url?: string): void {
  const id = 'grok-theme-font';
  let el = doc.getElementById(id);
  if (!url) {
    el?.remove();
    return;
  }
  if (!el) {
    el = doc.createElement('style');
    el.id = id;
    doc.head.append(el);
  }
  el.textContent =
    `@font-face{font-family:${JSON.stringify(THEME_FONT_FAMILY)};src:url(${JSON.stringify(url)});font-display:swap;}`;
}

const watchers = new WeakMap<HTMLElement, ResizeObserver>();
const natural = new WeakMap<HTMLElement, { w: number; h: number }>();
const liveTheme = new WeakMap<HTMLElement, ThemeColors | undefined>();

export { overlayKind };

export function syncSurface(
  root: HTMLElement,
  theme: ThemeColors | undefined,
  overlay?: 'settings' | 'drawer',
): void {
  const surface = surfaceKind(theme?.surface) ?? (isDesktop() ? 'glass' : undefined);
  if (surface && framedSurface(surface)) {
    root.dataset.surface = surface;
    ensureLayer(root, 'grok-frost', ['grok-wallpaper']);
  } else {
    delete root.dataset.surface;
    document.getElementById('grok-frost')?.remove();
  }
  if (frostSurface(surface) && (theme?.chromeGlass || isDesktop())) {
    root.dataset.chromeGlass = 'on';
  } else {
    delete root.dataset.chromeGlass;
  }
  if (overlay) {
    root.dataset.overlay = overlay;
    root.classList.add('overlay');
    ensureLayer(root, 'grok-veil', ['grok-frost', 'grok-wallpaper']);
  } else {
    delete root.dataset.overlay;
    root.classList.remove('overlay');
    document.getElementById('grok-veil')?.remove();
  }
}

export function chromeKeepers(): HTMLElement[] {
  return ['grok-wallpaper', 'grok-frost', 'grok-veil', 'og-dock']
    .map((id) => document.getElementById(id))
    .filter((node): node is HTMLElement => node instanceof HTMLElement);
}

export function syncWallpaper(root: HTMLElement, theme: ThemeColors | undefined): void {
  if (isRemoteWeb()) {
    const el = document.getElementById('grok-wallpaper');
    if (el instanceof HTMLElement) {
      releaseWallpaperLayer(el);
      el.remove();
    }
    delete root.dataset.wpKind;
    clearWpVars();
    return;
  }
  const url = theme?.wallpaperUrl;
  if (url) {
    root.dataset.wpKind = wallpaperMediaKind(theme?.wallpaperPath ?? url);
  } else {
    delete root.dataset.wpKind;
  }
  let el = document.getElementById('grok-wallpaper');
  if (!url) {
    if (el) {
      releaseWallpaperLayer(el);
      el.remove();
    }
    clearWpVars();
    return;
  }
  if (!(el instanceof HTMLElement)) {
    el = ensureLayer(root, 'grok-wallpaper', []);
  }
  fillWallpaperLayer(el, theme, { w: el.clientWidth, h: el.clientHeight }, {
    playing: !document.querySelector('#grok-settings.wp-editor'),
  });
}

export function fillWallpaperLayer(
  layer: HTMLElement,
  theme: ThemeColors | undefined,
  box: { w: number; h: number },
  opts?: { playing?: boolean },
): void {
  const url = theme?.wallpaperUrl;
  layer.style.opacity = String((theme?.wallpaperOpacity ?? DEFAULT_WALLPAPER_OPACITY) / 100);
  layer.style.backgroundImage = 'none';
  if (!url) {
    releaseWallpaperLayer(layer);
    return;
  }
  const kind = wallpaperMediaKind(theme?.wallpaperPath ?? url);
  liveTheme.set(layer, theme);
  if (layer.dataset.url !== url) {
    releaseWallpaperLayer(layer);
    layer.dataset.url = url;
    liveTheme.set(layer, theme);
    const media = makeWallpaperMedia(url, kind);
    layer.append(media);
    bindNatural(media, (w, h) => {
      if (layer.dataset.url !== url) {
        return;
      }
      natural.set(layer, { w, h });
      layer.dataset.nw = String(w);
      layer.dataset.nh = String(h);
      placeWallpaperLayer(layer, liveTheme.get(layer) ?? theme, {
        w: layer.clientWidth || box.w,
        h: layer.clientHeight || box.h,
      });
      watchFit(layer);
    });
  }
  placeWallpaperLayer(layer, theme, {
    w: layer.clientWidth || box.w,
    h: layer.clientHeight || box.h,
  });
  setWallpaperPlaying(layer, opts?.playing !== false);
  watchFit(layer);
}

export function wallpaperMediaEl(layer: HTMLElement): HTMLElement | undefined {
  const el = layer.querySelector('.grok-wp-media');
  return el instanceof HTMLElement ? el : undefined;
}

export function placeWallpaperMedia(
  media: HTMLElement,
  placed: { w: number; h: number; x: number; y: number },
): void {
  const s = media.style;
  s.inset = 'auto';
  s.width = `${placed.w}px`;
  s.height = `${placed.h}px`;
  s.left = `${placed.x}px`;
  s.top = `${placed.y}px`;
  s.right = 'auto';
  s.bottom = 'auto';
  s.transform = 'none';
  s.objectFit = 'fill';
  s.objectPosition = '50% 50%';
}

function placeWallpaperLayer(layer: HTMLElement, theme: ThemeColors | undefined, box: { w: number; h: number }): void {
  liveTheme.set(layer, theme);
  const media = wallpaperMediaEl(layer);
  const known = natural.get(layer);
  if (!media || !known || !(box.w > 0 && box.h > 0)) {
    return;
  }
  const placed = wallpaperPlacement(theme ?? { primary: '', secondary: '' }, known.w, known.h, box.w, box.h);
  placeWallpaperMedia(media, placed);
  writeWpVars(layer, theme, placed);
}

function writeWpVars(
  layer: HTMLElement,
  theme: ThemeColors | undefined,
  placed: { w: number; h: number; x: number; y: number },
): void {
  const url = theme?.wallpaperUrl;
  const style = document.documentElement.style;
  if (theme?.surface !== 'glass' || !url) {
    clearWpVars();
    return;
  }
  const rect = layer.getBoundingClientRect();
  style.setProperty('--wp-url', `url(${JSON.stringify(url)})`);
  style.setProperty('--wp-left', `${Math.round(rect.left + placed.x)}px`);
  style.setProperty('--wp-top', `${Math.round(rect.top + placed.y)}px`);
  style.setProperty('--wp-w', `${Math.round(placed.w)}px`);
  style.setProperty('--wp-h', `${Math.round(placed.h)}px`);
}

function clearWpVars(): void {
  const style = document.documentElement.style;
  style.removeProperty('--wp-url');
  style.removeProperty('--wp-left');
  style.removeProperty('--wp-top');
  style.removeProperty('--wp-w');
  style.removeProperty('--wp-h');
}

function watchFit(layer: HTMLElement): void {
  if (watchers.has(layer)) {
    return;
  }
  const ro = new ResizeObserver(() => {
    placeWallpaperLayer(layer, liveTheme.get(layer), { w: layer.clientWidth, h: layer.clientHeight });
  });
  watchers.set(layer, ro);
  ro.observe(layer);
}

function makeWallpaperMedia(url: string, kind: 'image' | 'video'): HTMLElement {
  if (kind === 'video') {
    const video = document.createElement('video');
    video.className = 'grok-wp-media';
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = false;
    video.preload = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.disablePictureInPicture = true;
    const source = document.createElement('source');
    source.src = url;
    source.type = wallpaperMime(url);
    video.append(source);
    video.src = url;
    return video;
  }
  const img = document.createElement('img');
  img.className = 'grok-wp-media';
  img.alt = '';
  img.draggable = false;
  img.src = url;
  return img;
}

function bindNatural(media: HTMLElement, onSize: (w: number, h: number) => void): void {
  if (media instanceof HTMLVideoElement) {
    const apply = (): void => {
      if (media.videoWidth > 0) {
        onSize(media.videoWidth, media.videoHeight);
      }
    };
    media.addEventListener('loadedmetadata', apply);
    if (media.readyState >= 1) {
      apply();
    }
    return;
  }
  if (media instanceof HTMLImageElement) {
    const apply = (): void => {
      if (media.naturalWidth > 0) {
        onSize(media.naturalWidth, media.naturalHeight);
      }
    };
    media.addEventListener('load', apply);
    if (media.complete) {
      apply();
    }
  }
}

function setWallpaperPlaying(layer: HTMLElement, playing: boolean): void {
  const media = layer.querySelector('video');
  if (!(media instanceof HTMLVideoElement)) {
    return;
  }
  if (playing) {
    void media.play().catch(() => undefined);
  } else {
    media.pause();
  }
}

function releaseWallpaperLayer(layer: HTMLElement): void {
  watchers.get(layer)?.disconnect();
  watchers.delete(layer);
  natural.delete(layer);
  liveTheme.delete(layer);
  clearWpVars();
  delete layer.dataset.url;
  delete layer.dataset.nw;
  delete layer.dataset.nh;
  const video = layer.querySelector('video');
  if (video instanceof HTMLVideoElement) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  layer.replaceChildren();
}

function ensureLayer(root: HTMLElement, id: string, afterIds: string[]): HTMLElement {
  let el = document.getElementById(id);
  if (el instanceof HTMLElement) {
    return el;
  }
  el = document.createElement('div');
  el.id = id;
  el.setAttribute('aria-hidden', 'true');
  let after: HTMLElement | null = null;
  for (const afterId of afterIds) {
    const node = document.getElementById(afterId);
    if (node instanceof HTMLElement) {
      after = node;
      break;
    }
  }
  if (after?.nextSibling) {
    root.insertBefore(el, after.nextSibling);
  } else if (after) {
    after.after(el);
  } else {
    root.insertBefore(el, root.firstChild);
  }
  return el;
}
