import { resolveLocale, t, type StringKey, type UiLocale } from './index';
import { plat } from '../platform';

export function uiLocale(): UiLocale {
  return resolveLocale(plat().getConfig('locale', 'auto'), plat().language());
}

export function tr(key: StringKey, vars?: Record<string, string | number>): string {
  return t(uiLocale(), key, vars);
}
