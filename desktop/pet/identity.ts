export const PET_SHAPES = ['star', 'mark', 'orb', 'anime', 'adult', 'pixel'] as const;
export type PetShape = (typeof PET_SHAPES)[number];

export const PET_COLORS = ['ink', 'paper', 'moss', 'ice', 'ember'] as const;
export type PetColor = (typeof PET_COLORS)[number];

export const PET_FACES = ['idle', 'happy', 'curious'] as const;
export type PetFace = (typeof PET_FACES)[number];

export const PET_SIZES = [96, 128, 160] as const;

export const PET_COLOR_SWATCH: Record<PetColor, { label: string; value: string }> = {
  ink: { label: 'Ink', value: '#171717' },
  paper: { label: 'Paper', value: '#f4f4f5' },
  moss: { label: 'Moss', value: '#16a34a' },
  ice: { label: 'Ice', value: '#2563eb' },
  ember: { label: 'Ember', value: '#ea580c' },
};

export function isPetShape(v: string | null | undefined): v is PetShape {
  return !!v && (PET_SHAPES as readonly string[]).includes(v);
}

export function isPetColor(v: string | null | undefined): v is PetColor {
  return !!v && (PET_COLORS as readonly string[]).includes(v);
}

export function isPetFace(v: string | null | undefined): v is PetFace {
  return !!v && (PET_FACES as readonly string[]).includes(v);
}

export function resolvePetBodyInk(color: string): string {
  return isPetColor(color) ? PET_COLOR_SWATCH[color].value : PET_COLOR_SWATCH.ink.value;
}

export function resolvePetEyeInk(body: string): { eye: string; pupil: string } {
  const hex = resolvePetBodyInk(body);
  const raw = hex.replace('#', '');
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma < 0.45 ? { eye: '#f7f7f7', pupil: '#111111' } : { eye: '#ffffff', pupil: '#171717' };
}

export function normalizePetSize(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n);
  if (x <= 112) {
    return 96;
  }
  if (x >= 144) {
    return 160;
  }
  return 128;
}
