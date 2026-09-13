import type { StringKey } from '../core/i18n';
import type { ThemeColors } from '../core/types';

/**
 * Surface packs. Add a skin by:
 * 1. appending an entry here
 * 2. adding i18n keys
 * 3. writing `#app[data-surface='id']` rules in plugin/media/surfaces.css
 *
 * `glass` / `solid` keep their historical CSS in chat.css + workbench.css.
 * New packs (endfield and anything after) live entirely in surfaces.css.
 */
export const SURFACE_IDS = ['glass', 'solid', 'endfield'] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

export type SurfacePack = {
  id: SurfaceId;
  /** Plugin theme segment. */
  labelKey: StringKey;
  /** Desktop appearance tiles. */
  appearanceKey: StringKey;
  /** Appearance tile preview tone. */
  tone: string;
  /** Frosted wallpaper / chrome blur. */
  frost: boolean;
  /** Inset floating chrome (frost layer + padding). */
  framed: boolean;
  /** Title bar uses the theme background instead of transparent overlay. */
  opaqueChrome: boolean;
  /** Palette applied when the user first switches to this pack. */
  theme?: Pick<ThemeColors, 'primary' | 'secondary' | 'background'>;
};

export const SURFACES: readonly SurfacePack[] = [
  {
    id: 'glass',
    labelKey: 'themeSurfaceGlass',
    appearanceKey: 'themeSurfaceGlass',
    tone: 'glass',
    frost: true,
    framed: true,
    opaqueChrome: false,
  },
  {
    id: 'solid',
    labelKey: 'themeSurfaceSolid',
    appearanceKey: 'themeSurfaceFlat',
    tone: 'flat',
    frost: false,
    framed: true,
    opaqueChrome: true,
  },
  {
    id: 'endfield',
    labelKey: 'themeSurfaceEndfield',
    appearanceKey: 'themeSurfaceEndfield',
    tone: 'endfield',
    frost: false,
    framed: true,
    opaqueChrome: true,
    theme: {
      primary: '#fff936',
      secondary: '#ffffff',
      background: '#191919',
    },
  },
];

const PACKS = Object.fromEntries(SURFACES.map((pack) => [pack.id, pack])) as Record<
  SurfaceId,
  SurfacePack
>;

export function isSurfaceId(raw: unknown): raw is SurfaceId {
  return raw === 'glass' || raw === 'solid' || raw === 'endfield';
}

export function surfaceKind(raw: unknown): SurfaceId | undefined {
  return isSurfaceId(raw) ? raw : undefined;
}

export function getSurface(raw: unknown): SurfacePack | undefined {
  const id = surfaceKind(raw);
  return id ? PACKS[id] : undefined;
}

export function framedSurface(raw: unknown): boolean {
  return getSurface(raw)?.framed === true;
}

export function frostSurface(raw: unknown): boolean {
  return getSurface(raw)?.frost === true;
}

export function opaqueChrome(raw: unknown): boolean {
  return getSurface(raw)?.opaqueChrome === true;
}
