import type { StringKey } from '../../core/i18n';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_LETTER_SPACING,
  DEFAULT_THEME,
  THEME_PRESETS,
  applyThemeTo,
  lockContrastEnabled,
  matchingPresetId,
  normalizeTheme,
  parseHex,
  rgbToHex,
  themeMessage,
} from '../../settings/theme';
import type { ThemeColors } from '../../core/types';
import {
  DEFAULT_CHROME_BLUR,
  DEFAULT_GLASS_BLUR,
  DEFAULT_WALLPAPER_OPACITY,
} from '../../settings/wallpaper';
import { isRemoteWeb, post, tr, ui } from '../app';
import { iconChevron } from '../icons';
import { overlayKind, syncSurface, syncThemeFontFace, syncWallpaper } from '../chrome/wallpaper';

const PRESET_KEYS: Record<string, StringKey> = {
  ice: 'themePresetIce',
  aurora: 'themePresetAurora',
  violet: 'themePresetViolet',
  sunset: 'themePresetSunset',
  rose: 'themePresetRose',
  ember: 'themePresetEmber',
};

export function themeNavRow(): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'settings-row settings-link';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('settingsTheme');
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  const presetId = matchingPresetId(normalizeTheme(ui.state.theme));
  hint.textContent = presetId ? presetLabel(presetId) : tr('themeCustom');
  copy.append(name, hint);
  const chevron = document.createElement('span');
  chevron.className = 'settings-chevron';
  chevron.innerHTML = iconChevron();
  row.append(copy, chevron);
  row.addEventListener('click', () => post({ type: 'openTheme' }));
  return row;
}

let live = DEFAULT_THEME;
let primaryInputs: { set: (hex: string) => void } | undefined;
let secondaryInputs: { set: (hex: string) => void } | undefined;
let backgroundInputs: { set: (hex: string) => void } | undefined;
let fontColorInputs: { set: (hex: string) => void } | undefined;
let autoBtn: HTMLButtonElement | undefined;
let previewRaf = 0;

export function mountThemeBody(): HTMLElement {
  const body = document.createElement('div');
  body.className = 'settings-body';
  live = normalizeTheme(ui.state.theme);
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('settingsThemeHint');
  body.append(
    hint,
    previewCard(),
    block(tr('themePresets'), presetGrid(live)),
    block(tr('themeCustom'), pickerCard(live)),
    block(tr('themeFont'), fontCard(live)),
    block(tr('themeSurface'), surfaceCard(live)),
    block(tr('themeWallpaper'), wallpaperCard(live)),
  );
  return body;
}

function presetLabel(id: string): string {
  const key = PRESET_KEYS[id];
  return key ? tr(key) : id;
}

function block(title: string, card: HTMLElement): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'settings-block';
  const kicker = document.createElement('div');
  kicker.className = 'settings-kicker';
  kicker.textContent = title;
  wrap.append(kicker, card);
  return wrap;
}

function previewCard(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'theme-preview';
  const dots = document.createElement('div');
  dots.className = 'theme-preview-dots';
  const primary = document.createElement('span');
  primary.className = 'theme-dot primary';
  const secondary = document.createElement('span');
  secondary.className = 'theme-dot secondary';
  const background = document.createElement('span');
  background.className = 'theme-dot bg';
  dots.append(primary, secondary, background);
  const copy = document.createElement('div');
  copy.className = 'theme-preview-copy';
  const title = document.createElement('div');
  title.className = 'theme-preview-title';
  title.textContent = tr('themePreview');
  const chips = document.createElement('div');
  chips.className = 'theme-preview-chips';
  const ice = document.createElement('span');
  ice.className = 'theme-chip ice';
  ice.textContent = 'Aa';
  const ok = document.createElement('span');
  ok.className = 'theme-chip ok';
  ok.textContent = '+12';
  chips.append(ice, ok);
  copy.append(title, chips);
  card.append(dots, copy);
  return card;
}

function presetGrid(theme: ThemeColors): HTMLElement {
  const card = document.createElement('div');
  card.className = 'theme-presets';
  const selected = matchingPresetId(theme);
  for (const preset of THEME_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-preset';
    btn.dataset.id = preset.id;
    if (preset.id === selected) {
      btn.classList.add('on');
    }
    const dots = document.createElement('span');
    dots.className = 'theme-preset-dots';
    const a = document.createElement('span');
    a.style.background = preset.primary;
    const b = document.createElement('span');
    b.style.background = preset.secondary;
    const c = document.createElement('span');
    c.style.background = preset.background ?? 'var(--vscode-sideBar-background)';
    dots.append(a, b, c);
    const label = document.createElement('span');
    label.className = 'theme-preset-name';
    label.textContent = presetLabel(preset.id);
    btn.append(dots, label);
    btn.addEventListener('click', () => {
      const next: ThemeColors = {
        ...live,
        primary: preset.primary,
        secondary: preset.secondary,
      };
      if (preset.background) {
        next.background = preset.background;
      } else {
        delete next.background;
      }
      commit(next, true);
    });
    card.append(btn);
  }
  return card;
}

function pickerCard(initial: ThemeColors): HTMLElement {
  const card = document.createElement('div');
  card.className = 'settings-card';
  const primary = colorRow(tr('themePrimary'), initial.primary, (hex, persist) => {
    commit({ ...live, primary: hex }, persist);
  });
  const secondary = colorRow(tr('themeSecondary'), initial.secondary, (hex, persist) => {
    commit({ ...live, secondary: hex }, persist);
  });
  const background = colorRow(
    tr('themeBackground'),
    initial.background ?? computedBgHex(),
    (hex, persist) => {
      commit({ ...live, background: hex }, persist);
    },
  );
  primaryInputs = primary;
  secondaryInputs = secondary;
  backgroundInputs = background;
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const auto = document.createElement('button');
  auto.type = 'button';
  auto.className = 'btn';
  auto.textContent = tr('themeBackgroundAuto');
  auto.addEventListener('click', () => {
    const next = { ...live };
    delete next.background;
    commit(next, true);
  });
  autoBtn = auto;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn';
  reset.textContent = tr('themeReset');
  reset.addEventListener('click', () => commit(DEFAULT_THEME, true));
  actions.append(auto, reset);
  card.append(primary.row, secondary.row, background.row, actions);
  syncAuto();
  return card;
}

function surfaceCard(initial: ThemeColors): HTMLElement {
  const card = document.createElement('div');
  card.className = 'settings-card';
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('themeSurfaceHint');
  const row = document.createElement('div');
  row.className = 'settings-row stack';
  const seg = document.createElement('div');
  seg.className = 'seg settings-seg';
  const current = initial.surface ?? 'flat';
  for (const [id, label] of [
    ['flat', tr('themeSurfaceFlat')],
    ['glass', tr('themeSurfaceGlass')],
    ['solid', tr('themeSurfaceSolid')],
  ] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.surface = id;
    btn.textContent = label;
    if (id === current) {
      btn.classList.add('on');
    }
    btn.addEventListener('click', () => {
      const next = { ...live };
      if (id === 'flat') {
        delete next.surface;
      } else {
        next.surface = id;
      }
      commit(next, true);
    });
    seg.append(btn);
  }
  row.append(seg);
  card.append(
    hint,
    row,
    sliderRow(
      'blur',
      tr('themeGlassBlur'),
      0,
      40,
      initial.glassBlur ?? DEFAULT_GLASS_BLUR,
      current !== 'glass',
      (n, persist) => {
        live = { ...live, glassBlur: n };
        if (persist) {
          commit(live, true);
        } else {
          applyLive();
        }
      },
      'px',
    ),
    sliderRow(
      'chrome-blur',
      tr('themeChromeBlur'),
      0,
      40,
      initial.chromeBlur ?? DEFAULT_CHROME_BLUR,
      current !== 'glass',
      (n, persist) => {
        live = { ...live, chromeBlur: n };
        if (persist) {
          commit(live, true);
        } else {
          applyLive();
        }
      },
      'px',
    ),
  );
  return card;
}

function chromeSwitchRow(initial: ThemeColors, disabled: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';
  row.dataset.key = 'chromeGlass';
  const copy = document.createElement('div');
  copy.className = 'settings-copy';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = tr('themeChromeGlass');
  const help = document.createElement('div');
  help.className = 'settings-hint';
  help.textContent = tr('themeChromeGlassHint');
  copy.append(name, help);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = initial.chromeGlass ? 'switch on' : 'switch';
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', initial.chromeGlass ? 'true' : 'false');
  btn.disabled = disabled;
  const knob = document.createElement('span');
  knob.className = 'knob';
  btn.append(knob);
  btn.addEventListener('click', () => {
    if (live.surface !== 'glass') {
      return;
    }
    const next = { ...live };
    if (next.chromeGlass) {
      delete next.chromeGlass;
    } else {
      next.chromeGlass = true;
    }
    commit(next, true);
  });
  row.append(copy, btn);
  return row;
}

function wallpaperCard(initial: ThemeColors): HTMLElement {
  const card = document.createElement('div');
  card.className = 'settings-card';
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('themeWallpaperHint');
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const icon = document.createElement('button');
  icon.type = 'button';
  icon.className = 'btn';
  icon.textContent = tr('themeWallpaperIcon');
  icon.addEventListener('click', () => {
    commit({ ...live, wallpaper: 'icon' }, true);
  });
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'btn';
  pick.textContent = tr('themeWallpaperPick');
  pick.addEventListener('click', () => post({ type: 'pickThemeWallpaper' }));
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn';
  clear.textContent = tr('themeWallpaperClear');
  clear.addEventListener('click', () => {
    const next = { ...live };
    delete next.wallpaper;
    delete next.wallpaperPath;
    delete next.wallpaperUrl;
    delete next.wallpaperOpacity;
    delete next.wallpaperScale;
    delete next.wallpaperX;
    delete next.wallpaperY;
    commit(next, true);
  });
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'btn primary';
  preview.textContent = tr('themePreviewOpen');
  preview.disabled = !initial.wallpaper;
  preview.addEventListener('click', () => post({ type: 'openThemePreview' }));
  actions.append(icon, pick, clear, preview);
  card.append(
    hint,
    actions,
    sliderRow('opacity', tr('themeWallpaperOpacity'), 0, 100, initial.wallpaperOpacity ?? DEFAULT_WALLPAPER_OPACITY, !initial.wallpaper, (n, persist) => {
      live = { ...live, wallpaperOpacity: n };
      if (persist) {
        commit(live, true);
      } else {
        applyLive();
      }
    }),
  );
  icon.classList.toggle('primary', initial.wallpaper === 'icon');
  return card;
}

function fontCard(initial: ThemeColors): HTMLElement {
  const card = document.createElement('div');
  card.className = 'settings-card';
  const hint = document.createElement('div');
  hint.className = 'settings-hint';
  hint.textContent = tr('themeFontHint');
  const status = document.createElement('div');
  status.className = 'settings-hint';
  status.dataset.font = 'status';
  status.textContent = fontStatusText(initial);
  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'btn';
  pick.textContent = tr('themeFontPick');
  pick.addEventListener('click', () => post({ type: 'pickThemeFont' }));
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn';
  clear.textContent = tr('themeFontClear');
  clear.addEventListener('click', () => {
    const next = { ...live };
    delete next.fontPath;
    delete next.fontUrl;
    commit(next, true);
  });
  actions.append(pick, clear);
  const lock = document.createElement('div');
  lock.className = 'settings-row';
  lock.dataset.key = 'lockContrast';
  const lockCopy = document.createElement('div');
  lockCopy.className = 'settings-copy';
  const lockName = document.createElement('div');
  lockName.className = 'settings-label';
  lockName.textContent = tr('themeLockContrast');
  const lockHelp = document.createElement('div');
  lockHelp.className = 'settings-hint';
  lockHelp.textContent = tr('themeLockContrastHint');
  lockCopy.append(lockName, lockHelp);
  const lockBtn = document.createElement('button');
  lockBtn.type = 'button';
  lockBtn.className = lockContrastEnabled(initial) ? 'switch on' : 'switch';
  lockBtn.setAttribute('role', 'switch');
  lockBtn.setAttribute('aria-checked', lockContrastEnabled(initial) ? 'true' : 'false');
  const knob = document.createElement('span');
  knob.className = 'knob';
  lockBtn.append(knob);
  lockBtn.addEventListener('click', () => {
    const next = { ...live };
    if (lockContrastEnabled(next)) {
      next.lockContrast = false;
    } else {
      delete next.lockContrast;
    }
    commit(next, true);
  });
  lock.append(lockCopy, lockBtn);
  const color = colorRow(
    tr('themeFontColor'),
    initial.fontColor ?? computedFgHex(),
    (hex, persist) => {
      commit({ ...live, fontColor: hex }, persist);
    },
  );
  color.row.dataset.key = 'fontColor';
  fontColorInputs = color;
  card.append(
    hint,
    status,
    actions,
    sliderRow(
      'font-size',
      tr('themeFontSize'),
      10,
      22,
      initial.fontSize ?? DEFAULT_FONT_SIZE,
      false,
      (n, persist) => {
        live = { ...live, fontSize: n };
        if (persist) {
          commit(live, true);
        } else {
          previewChrome();
        }
      },
      'px',
    ),
    sliderRow(
      'letter-spacing',
      tr('themeFontTracking'),
      -4,
      8,
      initial.letterSpacing ?? DEFAULT_LETTER_SPACING,
      false,
      (n, persist) => {
        live = { ...live, letterSpacing: n };
        if (persist) {
          commit(live, true);
        } else {
          previewChrome();
        }
      },
      'px',
    ),
    lock,
    color.row,
  );
  syncFontControls();
  return card;
}

function fontStatusText(theme: ThemeColors): string {
  const file = theme.fontPath;
  if (!file) {
    return tr('themeFontNone');
  }
  const base = file.replace(/\\/g, '/').split('/').pop() ?? file;
  return tr('themeFontFile', { name: base });
}

function sliderRow(
  key: string,
  label: string,
  min: number,
  max: number,
  value: number,
  disabled: boolean,
  onChange: (n: number, persist: boolean) => void,
  unit = '%',
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row theme-opacity-row';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = label;
  const tools = document.createElement('div');
  tools.className = 'theme-opacity';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.value = String(value);
  slider.disabled = disabled;
  slider.setAttribute('aria-label', label);
  slider.dataset.key = key;
  const readout = document.createElement('span');
  readout.className = 'theme-opacity-value';
  readout.textContent = `${slider.value}${unit}`;
  slider.addEventListener('input', () => {
    const n = Number(slider.value);
    readout.textContent = `${n}${unit}`;
    onChange(n, false);
  });
  slider.addEventListener('change', () => onChange(Number(slider.value), true));
  tools.append(slider, readout);
  row.append(name, tools);
  return row;
}

function colorRow(
  label: string,
  value: string,
  onChange: (hex: string, persist: boolean) => void,
): { row: HTMLElement; set: (hex: string) => void } {
  const row = document.createElement('div');
  row.className = 'settings-row theme-color-row';
  const name = document.createElement('div');
  name.className = 'settings-label';
  name.textContent = label;
  const tools = document.createElement('div');
  tools.className = 'theme-picker';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = value;
  picker.setAttribute('aria-label', label);
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'settings-field theme-hex';
  hex.spellcheck = false;
  hex.maxLength = 7;
  hex.value = value;
  picker.addEventListener('input', () => {
    const next = parseHex(picker.value);
    if (!next) {
      return;
    }
    hex.value = next;
    onChange(next, false);
  });
  picker.addEventListener('change', () => {
    const next = parseHex(picker.value);
    if (next) {
      onChange(next, true);
    }
  });
  hex.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      hex.blur();
    }
  });
  hex.addEventListener('change', () => {
    const next = parseHex(hex.value);
    if (!next) {
      hex.value = picker.value;
      return;
    }
    picker.value = next;
    hex.value = next;
    onChange(next, true);
  });
  tools.append(picker, hex);
  row.append(name, tools);
  return {
    row,
    set: (next) => {
      picker.value = next;
      hex.value = next;
    },
  };
}

function applyLive(): void {
  applyThemeVars();
  const app = document.getElementById('app') ?? document.body;
  syncSurface(
    app,
    live,
    overlayKind({
      settingsOpen: ui.state.settingsOpen,
      settingsPage: ui.state.settingsPage,
      drawer: ui.state.drawer,
    }),
  );
  syncWallpaper(app, {
    ...ui.state.theme,
    ...live,
    wallpaperUrl: ui.state.theme?.wallpaperUrl ?? live.wallpaperUrl,
  });
}

/** Color/font drag: CSS vars only. Wallpaper/DOM sync is what made the picker hitch. */
function previewChrome(): void {
  if (previewRaf) {
    return;
  }
  previewRaf = requestAnimationFrame(() => {
    previewRaf = 0;
    applyThemeVars();
  });
}

function applyThemeVars(): void {
  applyThemeTo(
    document.documentElement.style,
    live,
    isRemoteWeb() ? ui.state.hostChrome : undefined,
  );
  syncThemeFontFace(document, ui.state.theme?.fontUrl ?? live.fontUrl);
}

function commit(theme: ThemeColors, persist: boolean): void {
  live = normalizeTheme(theme);
  if (!persist) {
    previewChrome();
    return;
  }
  applyLive();
  const selected = matchingPresetId(live);
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.theme-preset')) {
    btn.classList.toggle('on', btn.dataset.id === selected);
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-surface]')) {
    btn.classList.toggle('on', (btn.dataset.surface || 'flat') === (live.surface ?? 'flat'));
  }
  syncGlassControls();
  syncFontControls();
  primaryInputs?.set(live.primary);
  secondaryInputs?.set(live.secondary);
  backgroundInputs?.set(live.background ?? computedBgHex());
  fontColorInputs?.set(live.fontColor ?? computedFgHex());
  const fontStatus = document.querySelector('[data-font="status"]');
  if (fontStatus) {
    fontStatus.textContent = fontStatusText({
      ...live,
      fontPath: live.fontPath ?? ui.state.theme?.fontPath,
    });
  }
  syncAuto();
  post(themeMessage(live));
}

function syncGlassControls(): void {
  const glass = live.surface === 'glass';
  const chrome = Boolean(live.chromeGlass);
  for (const key of ['blur', 'chrome-blur']) {
    const slider = document.querySelector<HTMLInputElement>(
      `.theme-opacity-row input[data-key="${key}"]`,
    );
    if (slider) {
      slider.disabled = !glass;
    }
  }
  const sw = document.querySelector<HTMLButtonElement>('[data-key="chromeGlass"] .switch');
  if (sw) {
    sw.disabled = !glass;
    sw.classList.toggle('on', chrome);
    sw.setAttribute('aria-checked', glass && chrome ? 'true' : 'false');
  }
}

function syncFontControls(): void {
  const locked = lockContrastEnabled(live);
  const sw = document.querySelector<HTMLButtonElement>('[data-key="lockContrast"] .switch');
  if (sw) {
    sw.classList.toggle('on', locked);
    sw.setAttribute('aria-checked', locked ? 'true' : 'false');
  }
  const picker = document.querySelector<HTMLInputElement>('[data-key="fontColor"] input[type="color"]');
  const hex = document.querySelector<HTMLInputElement>('[data-key="fontColor"] input[type="text"]');
  if (picker) {
    picker.disabled = locked;
  }
  if (hex) {
    hex.disabled = locked;
  }
}

function syncAuto(): void {
  autoBtn?.classList.toggle('primary', !live.background);
}

function computedBgHex(): string {
  return rgbToHex(getComputedStyle(document.body).backgroundColor) ?? '#1e1e1e';
}

function computedFgHex(): string {
  return rgbToHex(getComputedStyle(document.body).color) ?? '#e8e8e8';
}
