import en from './en.json';
import zh from './zh-CN.json';

export type UiLocale = 'en' | 'zh-CN';

export function resolveLocale(
  setting: string | undefined,
  vscodeLanguage: string,
): UiLocale {
  const value = (setting ?? 'auto').trim();
  if (value === 'en') {
    return 'en';
  }
  if (value === 'zh-CN' || value === 'zh' || value === 'zh-cn') {
    return 'zh-CN';
  }
  const lang = vscodeLanguage.toLowerCase();
  if (lang === 'zh-cn' || lang === 'zh' || lang.startsWith('zh-')) {
    return 'zh-CN';
  }
  return 'en';
}

/** Copy lives in en.json and zh-CN.json so catalog edits stay plain UTF-8. */
export const EN = en;
export const ZH: Record<keyof typeof en, string> = zh;

export type StringKey = keyof typeof en;

export function t(
  locale: UiLocale,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  const table: Record<StringKey, string> = locale === 'zh-CN' ? ZH : EN;
  let out = table[key] ?? EN[key] ?? String(key);
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatClock(locale: UiLocale, iso?: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (locale === 'zh-CN') {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${hh}:${mm}`;
}

export function formatRelativeTime(
  locale: UiLocale,
  iso?: string,
  now = Date.now(),
): string {
  if (!iso) {
    return '';
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return '';
  }
  const min = Math.max(0, Math.round((now - parsed) / 60000));
  if (min < 1) {
    return t(locale, 'timeJustNow');
  }
  if (min < 60) {
    return t(locale, 'timeMinutes', { n: min });
  }
  const hours = Math.round(min / 60);
  if (hours < 24) {
    return t(locale, 'timeHours', { n: hours });
  }
  return t(locale, 'timeDays', { n: Math.round(hours / 24) });
}

export function effortLabel(locale: UiLocale, effort?: string): string {
  switch (effort) {
    case 'max':
      return t(locale, 'effortMax');
    case 'xhigh':
      return t(locale, 'effortXhigh');
    case 'high':
      return t(locale, 'effortHigh');
    case 'medium':
      return t(locale, 'effortMedium');
    case 'low':
      return t(locale, 'effortLow');
    default:
      return '';
  }
}

export function modelDisplayName(id?: string, name?: string): string {
  const raw = (name ?? id ?? '').trim();
  if (!raw) {
    return '';
  }
  return raw.replace(/^Grok\s+/i, 'Grok ');
}

/** Timestamp, then the model and effort that produced this assistant turn. */
export function turnSourceText(
  locale: UiLocale,
  source: {
    modelId?: string;
    modelName?: string;
    effort?: string;
    createdAt?: string;
    endedAt?: string;
  },
  timestamps: boolean,
): string {
  const parts: string[] = [];
  if (timestamps) {
    const clock = formatClock(locale, source.endedAt ?? source.createdAt);
    if (clock) {
      parts.push(clock);
    }
  }
  const name = modelDisplayName(source.modelId, source.modelName);
  if (name) {
    parts.push(name);
  }
  const effort = effortLabel(locale, source.effort) || (source.effort ?? '').trim();
  if (effort) {
    parts.push(effort);
  }
  return parts.join(' · ');
}

export function toolKindLabel(locale: UiLocale, kind?: string): string {
  switch (kind) {
    case 'read':
      return t(locale, 'toolRead');
    case 'edit':
      return t(locale, 'toolEdit');
    case 'write':
      return t(locale, 'toolWrite');
    case 'execute':
    case 'terminal':
      return t(locale, 'toolTerminal');
    case 'search':
      return t(locale, 'toolSearch');
    case 'delete':
      return t(locale, 'toolDelete');
    case 'compact':
      return t(locale, 'toolCompact');
    default:
      return t(locale, 'toolGeneric');
  }
}
