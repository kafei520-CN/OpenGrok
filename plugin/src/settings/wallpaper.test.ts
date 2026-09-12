import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clampChromeBlur,
  clampChromeGlassOpacity,
  chromeLayerBlur,
  glassLayerBlur,
  clampGlassBlur,
  DEFAULT_CHROME_BLUR,
  clampGlassOpacity,
  clampWallpaperOpacity,
  DEFAULT_CHROME_GLASS_OPACITY,
  DEFAULT_GLASS_BLUR,
  DEFAULT_GLASS_OPACITY,
  DEFAULT_WALLPAPER_OPACITY,
  resolveWallpaperFile,
  overlayKind,
  wallpaperFit,
  wallpaperKind,
  wallpaperMediaKind,
  wallpaperExt,
  isWallpaperFile,
  wallpaperMime,
  wallpaperLayerStyle,
  wallpaperPaintedSize,
  wallpaperPlacement,
  wallpaperScaleFromPainted,
  clampWallpaperScale,
  MAX_WALLPAPER_SCALE,
  MIN_WALLPAPER_SCALE,
  panWallpaperPct,
  centerWallpaperPct,
  withWallpaperUrl,
  withFontUrl,
} from './wallpaper';

describe('wallpaper fit', () => {
  it('letterboxes when the image cannot cover the box', () => {
    assert.equal(wallpaperFit(100, 100, 400, 800), 'contain');
    assert.equal(wallpaperFit(2000, 100, 400, 800), 'contain');
    assert.equal(wallpaperFit(100, 2000, 400, 800), 'contain');
  });

  it('center-crops when the image is larger on both axes', () => {
    assert.equal(wallpaperFit(4000, 3000, 400, 800), 'cover');
    assert.equal(wallpaperFit(400, 800, 400, 800), 'cover');
  });
});

describe('wallpaper fields', () => {
  it('clamps opacity to 0–100', () => {
    assert.equal(clampWallpaperOpacity(-4), 0);
    assert.equal(clampWallpaperOpacity(140), 100);
    assert.equal(clampWallpaperOpacity('22'), 22);
    assert.equal(clampWallpaperOpacity('nope'), DEFAULT_WALLPAPER_OPACITY);
    assert.equal(clampGlassOpacity(70), 70);
    assert.equal(clampGlassOpacity(-1), 0);
    assert.equal(clampGlassOpacity(200), 100);
    assert.equal(clampGlassOpacity('x'), DEFAULT_GLASS_OPACITY);
    assert.equal(clampGlassBlur(28), 28);
    assert.equal(clampGlassBlur(-2), 0);
    assert.equal(clampGlassBlur(99), 40);
    assert.equal(clampGlassBlur('x'), DEFAULT_GLASS_BLUR);
    assert.equal(clampChromeGlassOpacity(88), 88);
    assert.equal(clampChromeGlassOpacity(-4), 0);
    assert.equal(clampChromeGlassOpacity(200), 100);
    assert.equal(clampChromeGlassOpacity('x'), DEFAULT_CHROME_GLASS_OPACITY);
    assert.equal(glassLayerBlur(18, 1), 18);
    assert.equal(glassLayerBlur(18, 2), 23);
    assert.equal(glassLayerBlur(18, 3), 26);
    assert.equal(glassLayerBlur(18, 4), 30);
    assert.equal(glassLayerBlur(18, 5), 33);
    assert.equal(glassLayerBlur(18, 6), 37);
    assert.equal(glassLayerBlur(18, 7), 41);
    assert.equal(glassLayerBlur(0, 2), 0);
    assert.equal(glassLayerBlur(30, 7), 48);
    assert.equal(clampChromeBlur(30), 30);
    assert.equal(clampChromeBlur(-2), 0);
    assert.equal(clampChromeBlur(99), 40);
    assert.equal(clampChromeBlur('x'), DEFAULT_CHROME_BLUR);
    assert.equal(chromeLayerBlur(18, 1), 23);
    assert.equal(chromeLayerBlur(18, 2), 23);
    assert.equal(chromeLayerBlur(18, 7), 41);
    assert.equal(chromeLayerBlur(0, 2), 0);
    assert.equal(chromeLayerBlur(30, 2), 38);
  });

  it('resolves icon and custom files', () => {
    assert.equal(wallpaperKind('icon'), 'icon');
    assert.equal(wallpaperKind('nope'), undefined);
    assert.equal(wallpaperExt('E:/clips/wall.mp4'), 'mp4');
    assert.equal(wallpaperExt('vscode-webview://x/theme-wallpaper.webm?t=1'), 'webm');
    assert.equal(wallpaperMediaKind('E:/a/b.mov'), 'video');
    assert.equal(wallpaperMediaKind('E:/a/b.png'), 'image');
    assert.equal(isWallpaperFile('clip.mp4'), true);
    assert.equal(isWallpaperFile('notes.txt'), false);
    assert.equal(wallpaperMime('a.webm'), 'video/webm');
    assert.equal(wallpaperMime('a.mp4?t=1'), 'video/mp4');
    assert.equal(
      resolveWallpaperFile({ primary: '#000', secondary: '#000', wallpaper: 'icon' }, {
        mediaFile: (name) => `/media/${name}`,
      }),
      '/media/grok-symbol.png',
    );
    const custom = withWallpaperUrl(
      { primary: '#000', secondary: '#000', wallpaper: 'custom', wallpaperPath: 'E:/pic.png' },
      { toResourceUrl: (file) => `vscode-webview://x/${file}` },
    );
    assert.equal(custom.wallpaperUrl, 'vscode-webview://x/E:/pic.png');
    const withFont = withFontUrl(
      { primary: '#000', secondary: '#000', fontPath: 'E:/a.ttf' },
      { toResourceUrl: (file) => `vscode-webview://x/${file}` },
    );
    assert.equal(withFont.fontUrl, 'vscode-webview://x/E:/a.ttf');
    const placed = wallpaperLayerStyle(
      { primary: '#000', secondary: '#000', wallpaperScale: 140, wallpaperX: 20, wallpaperY: 80 },
      100,
      100,
      400,
      800,
    );
    assert.equal(placed.size, '140%');
    assert.equal(placed.position, '20% 80%');
    assert.equal(overlayKind({ settingsOpen: true }), 'settings');
    assert.equal(overlayKind({ settingsOpen: true, settingsPage: 'theme' }), 'settings');
    assert.equal(overlayKind({ settingsOpen: true, settingsPage: 'theme-preview' }), undefined);
    assert.equal(overlayKind({ drawer: 'sessions' }), 'drawer');
    assert.equal(overlayKind({}), undefined);
  });

  it('pans and centers with CSS background-position percent', () => {
    assert.deepEqual(wallpaperPaintedSize(100, 50, 200, 200, 150), { w: 300, h: 150 });
    assert.equal(wallpaperScaleFromPainted(300, 200), 150);
    assert.equal(panWallpaperPct(50, 50, 200, 400), 25);
    assert.equal(centerWallpaperPct(50, 50, 200, 400), 25);
    assert.equal(centerWallpaperPct(50, 100, 200, 400), 50);
    assert.equal(panWallpaperPct(50, 50, 200, 100), 100);
    assert.equal(clampWallpaperScale(10), MIN_WALLPAPER_SCALE);
    assert.equal(clampWallpaperScale(999), MAX_WALLPAPER_SCALE);
    const box = wallpaperPlacement(
      { primary: '#000', secondary: '#000', wallpaperScale: 150, wallpaperX: 50, wallpaperY: 50 },
      100,
      50,
      200,
      200,
    );
    assert.equal(box.w, 300);
    assert.equal(box.h, 150);
    assert.equal(box.x, -50);
    assert.equal(box.y, 25);
  });
});
