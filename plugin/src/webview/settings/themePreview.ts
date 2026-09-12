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
  stage.style.backgroundColor = theme.background ?? 'var(--bg)';
  const layer = document.createElement('div');
  layer.className = 'wp-editor-layer';
  layer.style.opacity = String((theme.wallpaperOpacity ?? DEFAULT_WALLPAPER_OPACITY) / 100);
  const cross = document.createElement('div');
  cross.className = 'wp-editor-cross';
  cross.setAttribute('aria-hidden', 'true');
  const aim = document.createElement('div');
  aim.className = 'wp-editor-aim';
  cross.append(aim);
  stage.append(layer, cross);
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
    size.textContent = tr('themePreviewSize', { w: stage.clientWidth, h: stage.clientHeight });
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
      panWallpaperPct(origX, event.clientX - startX, stage.clientWidth, paintedW),
      panWallpaperPct(origY, event.clientY - startY, stage.clientHeight, paintedH),
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
      const rect = stage.getBoundingClientRect();
      const next = withPos(
        centerWallpaperPct(origX, event.clientX - rect.left, stage.clientWidth, paintedW),
        centerWallpaperPct(origY, event.clientY - rect.top, stage.clientHeight, paintedH),
        origScale,
      );
      placeLive(layer, next, stage);
      applyPreview(next);
      persistPreview(next);
      writeHud(stage, next);
      return;
    }
    persistPreview(withPos(
      panWallpaperPct(origX, event.clientX - startX, stage.clientWidth, paintedW),
      panWallpaperPct(origY, event.clientY - startY, stage.clientHeight, paintedH),
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
    const painted = wallpaperPaintedSize(
      natural.w,
      natural.h,
      stage.clientWidth,
      stage.clientHeight,
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
  const painted = wallpaperPaintedSize(natural.w, natural.h, stage.clientWidth, stage.clientHeight);
  return withPos(theme.wallpaperX ?? 50, theme.wallpaperY ?? 50, wallpaperScaleFromPainted(painted.w, stage.clientWidth));
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

function paintLayer(layer: HTMLElement, theme: ThemeColors, stage: HTMLElement): void {
  fillWallpaperLayer(layer, theme, { w: stage.clientWidth, h: stage.clientHeight }, { playing: true });
}

function placeLive(layer: HTMLElement, theme: ThemeColors, stage: HTMLElement): void {
  const media = wallpaperMediaEl(layer);
  const size = readNatural(layer);
  if (!media || !size) {
    return;
  }
  placeWallpaperMedia(
    media,
    wallpaperPlacement(theme, size.w, size.h, stage.clientWidth, stage.clientHeight),
  );
}

function readNatural(layer: HTMLElement): { w: number; h: number } | undefined {
  const w = Number(layer.dataset.nw);
  const h = Number(layer.dataset.nh);
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
