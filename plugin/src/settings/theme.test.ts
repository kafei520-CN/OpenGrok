import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_THEME,
  THEME_PRESETS,
  applyThemeTo,
  contrastFg,
  isFontFile,
  lockContrastEnabled,
  matchingPresetId,
  normalizeTheme,
  parseHex,
  rgbToHex,
} from './theme';

describe('theme', () => {
  it('parses 3-digit and 6-digit hex', () => {
    assert.equal(parseHex('#ABC'), '#aabbcc');
    assert.equal(parseHex('#b9d4ff'), '#b9d4ff');
    assert.equal(parseHex('  #3FB950  '), '#3fb950');
    assert.equal(parseHex('red'), undefined);
    assert.equal(parseHex('#gg0000'), undefined);
    assert.equal(parseHex('#ffff'), undefined);
  });

  it('parses computed rgb colors', () => {
    assert.equal(rgbToHex('rgb(30, 30, 30)'), '#1e1e1e');
    assert.equal(rgbToHex('rgba(11, 22, 32, 1)'), '#0b1620');
    assert.equal(rgbToHex('rgb(11 22 32)'), '#0b1620');
    assert.equal(rgbToHex('#0B1620'), '#0b1620');
    assert.equal(rgbToHex('transparent'), undefined);
  });

  it('falls back to the Ice palette without locking a background', () => {
    assert.deepEqual(normalizeTheme(undefined), DEFAULT_THEME);
    assert.equal(normalizeTheme(undefined).background, undefined);
    assert.deepEqual(normalizeTheme({ primary: 'nope', secondary: '#0f0' }), {
      primary: DEFAULT_THEME.primary,
      secondary: '#00ff00',
    });
    assert.equal(normalizeTheme({ background: '#0b1620' }).background, '#0b1620');
    assert.equal(normalizeTheme({ wallpaper: 'icon', wallpaperOpacity: 40 }).wallpaper, 'icon');
    assert.equal(normalizeTheme({ wallpaper: 'icon', wallpaperOpacity: 40 }).wallpaperOpacity, 40);
    assert.equal(normalizeTheme({ wallpaper: 'custom' }).wallpaper, undefined);
    assert.equal(normalizeTheme({ surface: 'glass' }).surface, 'glass');
    assert.equal(normalizeTheme({ surface: 'endfield' }).surface, 'endfield');
    assert.equal(
      normalizeTheme({ wallpaper: 'icon', wallpaperScale: 140, wallpaperX: 20, wallpaperY: 80 }).wallpaperScale,
      140,
    );
    assert.equal(normalizeTheme({ wallpaper: 'icon' }).wallpaperScale, undefined);
    assert.equal(normalizeTheme({ surface: 'glass' }).glassOpacity, 36);
    assert.equal(normalizeTheme({ surface: 'glass', glassOpacity: 70 }).glassOpacity, 70);
    assert.equal(normalizeTheme({ surface: 'glass' }).glassBlur, 24);
    assert.equal(normalizeTheme({ surface: 'glass', glassBlur: 28 }).glassBlur, 28);
    assert.equal(normalizeTheme({ surface: 'glass' }).chromeBlur, 32);
    assert.equal(normalizeTheme({ surface: 'glass', chromeBlur: 30 }).chromeBlur, 30);
    assert.equal(normalizeTheme({ surface: 'glass' }).chromeGlass, undefined);
    assert.equal(normalizeTheme({ chromeGlass: true }).chromeGlass, true);
    assert.equal(normalizeTheme({ chromeGlass: true }).chromeGlassOpacity, 38);
    assert.equal(normalizeTheme({ chromeGlass: true, chromeGlassOpacity: 88 }).chromeGlassOpacity, 88);
    assert.equal(normalizeTheme({ fontPath: 'E:/a.ttf' }).fontPath, 'E:/a.ttf');
    assert.equal(normalizeTheme({ fontPath: 'notes.txt' }).fontPath, undefined);
    assert.equal(normalizeTheme({ fontSize: 18 }).fontSize, 18);
    assert.equal(normalizeTheme({ fontSize: 3 }).fontSize, 10);
    assert.equal(normalizeTheme({ letterSpacing: 2 }).letterSpacing, 2);
    assert.equal(normalizeTheme({ fontColor: '#ABC' }).fontColor, '#aabbcc');
    assert.equal(normalizeTheme({ lockContrast: false }).lockContrast, false);
    assert.equal(normalizeTheme({ lockContrast: true }).lockContrast, undefined);
    assert.equal(lockContrastEnabled({}), true);
    assert.equal(lockContrastEnabled({ lockContrast: false }), false);
    assert.equal(isFontFile('a.woff2'), true);
    assert.equal(isFontFile('a.png'), false);
  });

  it('matches presets including background', () => {
    const ice = THEME_PRESETS.find((row) => row.id === 'ice');
    const aurora = THEME_PRESETS.find((row) => row.id === 'aurora');
    assert.ok(ice && aurora);
    assert.equal(matchingPresetId(ice), 'ice');
    assert.equal(matchingPresetId(aurora), 'aurora');
    assert.equal(matchingPresetId({ ...DEFAULT_THEME, background: '#111111' }), undefined);
    assert.equal(matchingPresetId({ primary: '#ff00aa', secondary: '#00ffaa' }), undefined);
  });

  it('picks dark text on light backgrounds', () => {
    assert.equal(contrastFg('#f5f5f5'), '#1c1c1c');
    assert.equal(contrastFg('#0b1620'), '#e8e8e8');
  });

  it('writes ice/ok and surface CSS variables', () => {
    const props = new Map<string, string>();
    applyThemeTo(
      {
        setProperty: (name, value) => props.set(name, value),
        removeProperty: (name) => {
          props.delete(name);
        },
      },
      { primary: '#ff0000', secondary: '#00ff00', background: '#0b1620' },
    );
    assert.equal(props.has('--ok'), false);
    assert.equal(props.get('--bg'), '#0b1620');
    assert.equal(props.get('--fg'), '#e8e8e8');
    assert.equal(props.get('--ice'), 'color-mix(in srgb, #ff0000 72%, var(--fg))');
    applyThemeTo(
      {
        setProperty: (name, value) => props.set(name, value),
        removeProperty: (name) => {
          props.delete(name);
        },
      },
      DEFAULT_THEME,
    );
    assert.equal(props.has('--bg'), false);
    assert.equal(props.has('--ok'), false);
    applyThemeTo(
      {
        setProperty: (name, value) => props.set(name, value),
        removeProperty: (name) => {
          props.delete(name);
        },
      },
      { chromeGlass: true, chromeGlassOpacity: 40, glassBlur: 30 },
    );
    assert.equal(props.get('--chrome-fill'), '40%');
    assert.equal(props.get('--glass-1-blur'), '30px');
    assert.equal(props.get('--glass-bg-pad'), '1.08');
    assert.equal(props.get('--glass-2-blur'), '40px');
    assert.equal(props.get('--glass-3-blur'), '46px');
    assert.equal(props.get('--glass-5-blur'), '59px');
    assert.equal(props.get('--glass-7-blur'), '72px');
    applyThemeTo(
      {
        setProperty: (name, value) => props.set(name, value),
        removeProperty: (name) => {
          props.delete(name);
        },
      },
      { surface: 'glass', glassBlur: 0, chromeBlur: 30 },
    );
    assert.equal(props.get('--glass-1-blur'), '0px');
    assert.equal(props.get('--glass-bg-pad'), '1');
    assert.equal(props.get('--glass-2-blur'), '38px');
    assert.equal(props.get('--glass-7-blur'), '68px');
  });

  it('uses host chrome when Ice has no background', () => {
    const props = new Map<string, string>();
    applyThemeTo(
      {
        setProperty: (name, value) => props.set(name, value),
        removeProperty: (name) => {
          props.delete(name);
        },
      },
      DEFAULT_THEME,
      { background: '#2b2d30', foreground: '#ced0d6' },
    );
    assert.equal(props.get('--bg'), '#2b2d30');
    assert.equal(props.get('--fg'), '#ced0d6');
  });

  it('auto-contrasts a custom background and ignores host foreground', () => {
    const props = new Map<string, string>();
    const style = {
      setProperty: (name: string, value: string) => props.set(name, value),
      removeProperty: (name: string) => {
        props.delete(name);
      },
    };
    applyThemeTo(
      style,
      { primary: '#111111', secondary: '#737373', background: '#ffffff' },
      { background: '#000000', foreground: '#f4f4f4' },
    );
    assert.equal(props.get('--bg'), '#ffffff');
    assert.equal(props.get('--fg'), '#1c1c1c');
    assert.equal(props.get('--vscode-foreground'), '#1c1c1c');
    applyThemeTo(
      style,
      { primary: '#f4f4f4', secondary: '#737373', background: '#000000' },
      { background: '#ffffff', foreground: '#111111' },
    );
    assert.equal(props.get('--bg'), '#000000');
    assert.equal(props.get('--fg'), '#e8e8e8');
  });

  it('keeps auto contrast when lock is on and uses fontColor when off', () => {
    const props = new Map<string, string>();
    const style = {
      setProperty: (name: string, value: string) => props.set(name, value),
      removeProperty: (name: string) => {
        props.delete(name);
      },
    };
    applyThemeTo(style, {
      primary: '#b9d4ff',
      secondary: '#3fb950',
      background: '#0b1620',
      fontColor: '#ff0000',
    });
    assert.equal(props.get('--fg'), '#e8e8e8');
    applyThemeTo(style, {
      primary: '#b9d4ff',
      secondary: '#3fb950',
      background: '#0b1620',
      fontColor: '#ff0000',
      lockContrast: false,
    });
    assert.equal(props.get('--fg'), '#ff0000');
    applyThemeTo(style, {
      primary: '#b9d4ff',
      secondary: '#3fb950',
      fontPath: 'E:/a.ttf',
      fontSize: 16,
      letterSpacing: 2,
    });
    assert.equal(props.get('--font-size'), '16px');
    assert.equal(props.get('--letter-spacing'), '2px');
    assert.match(props.get('--font') ?? '', /Grok Custom/);
  });
});
