import { applyThemeTo, normalizeTheme, themeMessage } from '../../settings/theme';
import type { ThemeColors } from '../../core/types';
import {
  DEFAULT_WALLPAPER_OPACITY,
  DEFAULT_WALLPAPER_SCALE,
  MAX_WALLPAPER_SCALE,
  MIN_WALLPAPER_SCALE,
  centerWallpaperPct,
  clampWallpaperAxis,
  clampWallpaperScale,
  panWallpaperPct,
  wallpaperPaintedSize,
  wallpaperPlacement,
  wallpaperScaleFromPainted,
} from '../../settings/wallpaper';
import { post, tr, ui } from '../app';
import { fillWallpaperLayer, overlayKind, placeWallpaperMedia, syncSurface, syncThemeFontFace, syncWallpaper, wallpaperMediaEl } from '../chrome/wallpaper';

let liveX = 50;
let liveY = 50;
let liveScale: number | undefined;

export function mountThemePreview(): HTMLElement {
  const theme = normalizeTheme(ui.state.theme);
  liveX = ui.state.theme?.wallpaperX ?? theme.wallpaperX ?? 50;
  liveY = ui.state.theme?.wallpaperY ?? theme.wallpaperY ?? 50;
  liveScale = ui.state.theme?.wallpaperScale ?? theme.wallpaperScale;
  const wrap = document.createElement('div');
  wrap.className = 'wp-editor-root';
  const stage = document.createElement('div');
  stage.className = 'wp-editor-stage';
  if (!usesWindowWallpaper()) {
    stage.style.backgroundColor = theme.background ?? 'var(--bg)';
  }
  const layer = document.createElement('div');
  layer.className = 'wp-editor-layer';
  layer.style.opacity = String((theme.wallpaperOpacity ?? DEFAULT_WALLPAPER_OPACITY) / 100);
  const cross = document.createElement('div');
  cross.id = 'og-wp-cross';
  cross.className = 'wp-editor-cross';
  cross.setAttribute('aria-hidden', 'true');
  const aim = document.createElement('div');
  aim.className = 'wp-editor-aim';
  cross.append(aim);
  stage.append(layer);
  document.getElementById('og-wp-cross')?.remove();
  if (usesWindowWallpaper()) {
    document.getElementById('app')?.append(cross);
  } else {
    stage.append(cross);
  }
  const tip = document.createElement('div');
  tip.className = 'wp-editor-tip';
  tip.textContent = tr('themePreviewHint');
  wrap.append(stage, tip, hud(stage, layer));
  bindPreviewPointer(stage, layer);
  paintLayer(layer, currentTheme(), stage);
  return wrap;
}

function hud(stage: HTMLElement, layer: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'wp-editor-hud';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn primary';
  back.textContent = tr('themePreviewDone');
  back.addEventListener('click', () => post({ type: 'closeThemePreview' }));
  const size = document.createElement('span');
  size.className = 'wp-editor-size';
  const meta = document.createElement('span');
  meta.className = 'wp-editor-meta';
  const zoom = document.createElement('input');
  zoom.type = 'range';
  zoom.min = String(MIN_WALLPAPER_SCALE);
  zoom.max = String(MAX_WALLPAPER_SCALE);
  zoom.value = String(liveScale ?? DEFAULT_WALLPAPER_SCALE);
  zoom.disabled = !ui.state.theme?.wallpaperUrl;
  zoom.setAttribute('aria-label', tr('themeWallpaperScale'));
  zoom.addEventListener('input', () => {
    const next = withPos(liveX, liveY, Number(zoom.value));
    paintLayer(layer, next, stage);
    applyPreview(next);
    writeHud(stage, next, true);
  });
  zoom.addEventListener('change', () => persistPreview(withPos(liveX, liveY, Number(zoom.value))));
  const syncSize = (): void => {
    const box = wallpaperBox(stage);
    size.textContent = tr('themePreviewSize', { w: box.clientWidth, h: box.clientHeight });
    const theme = currentTheme();
    writeHud(stage, theme);
    paintLayer(layer, theme, stage);
  };
  requestAnimationFrame(syncSize);
  const ro = new ResizeObserver(syncSize);
  ro.observe(stage);
  bar.append(back, size, meta, zoom);
  return bar;
}

function bindPreviewPointer(stage: HTMLElement, layer: HTMLElement): void {
  let startX = 0;
  let startY = 0;
  let origX = 50;
  let origY = 50;
  let origScale = DEFAULT_WALLPAPER_SCALE;
  let paintedW = 0;
  let paintedH = 0;
  let moved = false;
  const onMove = (event: PointerEvent): void => {
    if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > 4) {
      moved = true;
    }
    const next = withPos(
      panWallpaperPct(origX, event.clientX - startX, wallpaperBox(stage).clientWidth, paintedW),
      panWallpaperPct(origY, event.clientY - startY, wallpaperBox(stage).clientHeight, paintedH),
      origScale,
    );
    placeLive(layer, next, stage);
    applyPreview(next);
    writeHud(stage, next);
  };
  const onUp = (event: PointerEvent): void => {
    stage.releasePointerCapture(event.pointerId);
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerup', onUp);
    stage.removeEventListener('pointercancel', onUp);
    stage.style.cursor = 'crosshair';
    const natural = readNatural(layer);
    if (!moved && natural) {
      const rect = wallpaperBox(stage).getBoundingClientRect();
      const box = wallpaperBox(stage);
      const next = withPos(
        centerWallpaperPct(origX, event.clientX - rect.left, box.clientWidth, paintedW),
        centerWallpaperPct(origY, event.clientY - rect.top, box.clientHeight, paintedH),
        origScale,
      );
      placeLive(layer, next, stage);
      applyPreview(next);
      persistPreview(next);
      writeHud(stage, next);
      return;
    }
    persistPreview(withPos(
      panWallpaperPct(origX, event.clientX - startX, wallpaperBox(stage).clientWidth, paintedW),
      panWallpaperPct(origY, event.clientY - startY, wallpaperBox(stage).clientHeight, paintedH),
      origScale,
    ));
  };
  stage.addEventListener('pointerdown', (event) => {
    const natural = readNatural(layer);
    if (!ui.state.theme?.wallpaperUrl || !natural) {
      return;
    }
    event.preventDefault();
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    const theme = freezeScale(
      {
        ...currentTheme(),
        wallpaperX: liveX,
        wallpaperY: liveY,
        ...(liveScale != null ? { wallpaperScale: liveScale } : {}),
      },
      natural,
      stage,
    );
    origX = theme.wallpaperX ?? 50;
    origY = theme.wallpaperY ?? 50;
    origScale = theme.wallpaperScale ?? DEFAULT_WALLPAPER_SCALE;
    liveScale = origScale;
    const box = wallpaperBox(stage);
    const painted = wallpaperPaintedSize(
      natural.w,
      natural.h,
      box.clientWidth,
      box.clientHeight,
      origScale,
    );
    paintedW = painted.w;
    paintedH = painted.h;
    stage.setPointerCapture(event.pointerId);
    stage.style.cursor = 'grabbing';
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
  });
}

function freezeScale(theme: ThemeColors, natural: { w: number; h: number }, stage: HTMLElement): ThemeColors {
  if (theme.wallpaperScale != null) {
    return theme;
  }
  const box = wallpaperBox(stage);
  const painted = wallpaperPaintedSize(natural.w, natural.h, box.clientWidth, box.clientHeight);
  return withPos(theme.wallpaperX ?? 50, theme.wallpaperY ?? 50, wallpaperScaleFromPainted(painted.w, box.clientWidth));
}

function currentTheme(): ThemeColors {
  const theme = normalizeTheme(ui.state.theme);
  return {
    ...theme,
    wallpaperUrl: ui.state.theme?.wallpaperUrl,
    wallpaperScale: liveScale ?? theme.wallpaperScale,
    wallpaperX: liveX,
    wallpaperY: liveY,
  };
}

function withPos(x: number, y: number, scale: number): ThemeColors {
  liveX = x;
  liveY = y;
  liveScale = scale;
  return {
    ...normalizeTheme(ui.state.theme),
    wallpaperUrl: ui.state.theme?.wallpaperUrl,
    wallpaperScale: scale,
    wallpaperX: x,
    wallpaperY: y,
  };
}

function usesWindowWallpaper(): boolean {
  return document.documentElement.classList.contains('opengrok');
}

function wallpaperBox(stage: HTMLElement): HTMLElement {
  if (!usesWindowWallpaper()) {
    return stage;
  }
  return document.getElementById('app') ?? stage;
}

function liveLayer(layer: HTMLElement): HTMLElement {
  if (!usesWindowWallpaper()) {
    return layer;
  }
  const real = document.getElementById('grok-wallpaper');
  return real instanceof HTMLElement ? real : layer;
}

function paintLayer(layer: HTMLElement, theme: ThemeColors, stage: HTMLElement): void {
  const box = wallpaperBox(stage);
  if (usesWindowWallpaper()) {
    syncWallpaper(box, theme);
    return;
  }
  fillWallpaperLayer(layer, theme, { w: box.clientWidth, h: box.clientHeight }, { playing: true });
}

function placeLive(layer: HTMLElement, theme: ThemeColors, stage: HTMLElement): void {
  const host = liveLayer(layer);
  const media = wallpaperMediaEl(host);
  const size = readNatural(host);
  const box = wallpaperBox(stage);
  if (!media || !size) {
    return;
  }
  placeWallpaperMedia(
    media,
    wallpaperPlacement(theme, size.w, size.h, box.clientWidth, box.clientHeight),
  );
}

function readNatural(layer: HTMLElement): { w: number; h: number } | undefined {
  const host = liveLayer(layer);
  const w = Number(host.dataset.nw);
  const h = Number(host.dataset.nh);
  return w > 0 && h > 0 ? { w, h } : undefined;
}

function applyPreview(theme: ThemeColors): void {
  applyThemeTo(document.documentElement.style, theme);
  syncThemeFontFace(document, theme.fontUrl ?? ui.state.theme?.fontUrl);
  const app = document.getElementById('app') ?? document.body;
  syncSurface(
    app,
    theme,
    overlayKind({
      settingsOpen: ui.state.settingsOpen,
      settingsPage: ui.state.settingsPage,
      drawer: ui.state.drawer,
    }),
  );
  syncWallpaper(app, theme);
}

function persistPreview(theme: ThemeColors): void {
  post({
    ...themeMessage(theme),
    wallpaperScale: clampWallpaperScale(theme.wallpaperScale),
    wallpaperX: clampWallpaperAxis(theme.wallpaperX),
    wallpaperY: clampWallpaperAxis(theme.wallpaperY),
  });
}

function writeHud(stage: HTMLElement, theme: ThemeColors, skipZoom = false): void {
  const wrap = stage.parentElement;
  const meta = wrap?.querySelector('.wp-editor-meta');
  if (meta) {
    meta.textContent = tr('themePreviewCenter', {
      x: Math.round(theme.wallpaperX ?? 50),
      y: Math.round(theme.wallpaperY ?? 50),
    });
  }
  if (skipZoom) {
    return;
  }
  const zoom = wrap?.querySelector('.wp-editor-hud input[type="range"]');
  if (zoom instanceof HTMLInputElement && theme.wallpaperScale != null) {
    zoom.value = String(clampWallpaperScale(theme.wallpaperScale));
  }
}
