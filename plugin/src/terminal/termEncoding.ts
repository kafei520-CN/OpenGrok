/** Encodings offered for terminal tool output. Default is UTF-8. */
export const TERM_ENCODINGS = [
  'utf-8',
  'gbk',
  'gb18030',
  'gb2312',
  'big5',
  'shift_jis',
  'windows-1252',
  'iso-8859-1',
] as const;

export type TermEncoding = (typeof TERM_ENCODINGS)[number];

export const DEFAULT_TERM_ENCODING: TermEncoding = 'utf-8';

const ENCODING_ALIASES: Record<string, TermEncoding> = {
  utf8: 'utf-8',
  'utf-8': 'utf-8',
  gbk: 'gbk',
  cp936: 'gbk',
  gb18030: 'gb18030',
  gb2312: 'gb2312',
  big5: 'big5',
  'shift-jis': 'shift_jis',
  shift_jis: 'shift_jis',
  sjis: 'shift_jis',
  'windows-1252': 'windows-1252',
  cp1252: 'windows-1252',
  'iso-8859-1': 'iso-8859-1',
  latin1: 'iso-8859-1',
  'latin-1': 'iso-8859-1',
};

export function normalizeTermEncoding(raw: unknown): TermEncoding {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  return ENCODING_ALIASES[value] ?? DEFAULT_TERM_ENCODING;
}
