import iconv from 'iconv-lite';
import { type TermEncoding } from './termEncoding';

export {
  DEFAULT_TERM_ENCODING,
  TERM_ENCODINGS,
  normalizeTermEncoding,
  type TermEncoding,
} from './termEncoding';

const ICONV_LABEL: Record<string, string> = {
  'utf-8': 'utf8',
  gbk: 'gbk',
  gb18030: 'gb18030',
  gb2312: 'gb2312',
  big5: 'big5',
  shift_jis: 'shiftjis',
  'windows-1252': 'win1252',
  'iso-8859-1': 'iso88591',
};

export function decodeTermUnknown(raw: unknown, encoding: TermEncoding): string {
  const bytes = termBytes(raw);
  if (bytes && bytes.length) {
    return decodeTermBytes(bytes, encoding);
  }
  if (typeof raw !== 'string' || !raw) {
    return '';
  }
  if (!raw.includes('\uFFFD')) {
    return recoverMojibake(raw, encoding) ?? raw;
  }
  return recoverMojibake(raw, encoding) ?? '';
}

export function decodeTermBytes(bytes: Uint8Array, encoding: TermEncoding): string {
  if (encoding === 'utf-8') {
    return decodeUtf8OrGbk(bytes);
  }
  return decodeLabel(bytes, encoding) ?? decodeUtf8OrGbk(bytes);
}

function decodeUtf8OrGbk(bytes: Uint8Array): string {
  if (!bytes.length) {
    return '';
  }
  if (utf8ReplacementCount(bytes) >= 2) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let utf8 = '';
  try {
    utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    utf8 = '';
  }
  if (utf8 && !utf8.includes('\uFFFD')) {
    return utf8;
  }
  const gbk = decodeLabel(bytes, 'gbk') ?? decodeLabel(bytes, 'gb18030');
  if (gbk && !gbk.includes('\uFFFD')) {
    return gbk;
  }
  return utf8 || new TextDecoder('utf-8').decode(bytes);
}

function decodeLabel(bytes: Uint8Array, encoding: string): string | undefined {
  const label = ICONV_LABEL[encoding] ?? encoding;
  try {
    if (iconv.encodingExists(label)) {
      return iconv.decode(Buffer.from(bytes), label);
    }
  } catch {
    /* fall through */
  }
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    if (encoding === 'iso-8859-1' || encoding === 'windows-1252') {
      return Buffer.from(bytes).toString('latin1');
    }
    return undefined;
  }
}

function utf8ReplacementCount(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 2 < bytes.length; i += 1) {
    if (bytes[i] === 0xef && bytes[i + 1] === 0xbf && bytes[i + 2] === 0xbd) {
      n += 1;
      i += 2;
    }
  }
  return n;
}

/** Latin-1 stored GBK/CP936 can be recovered; UTF-8 replacement chars cannot. */
function recoverMojibake(text: string, encoding: TermEncoding): string | undefined {
  const bytes = Buffer.alloc(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 255) {
      return undefined;
    }
    bytes[i] = code;
  }
  const high = bytes.some((b) => b >= 0x80);
  if (!high && encoding === 'utf-8') {
    return undefined;
  }
  return decodeTermBytes(bytes, encoding === 'utf-8' ? 'gbk' : encoding);
}

export function termBytes(raw: unknown): Uint8Array | undefined {
  if (typeof raw === 'string' && isBase64Bytes(raw)) {
    try {
      return Uint8Array.from(Buffer.from(raw, 'base64'));
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === 'number')) {
    return Uint8Array.from(raw as number[]);
  }
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const row = raw as { type?: string; data?: unknown };
  if (row.type === 'Buffer' && Array.isArray(row.data)) {
    return Uint8Array.from(row.data as number[]);
  }
  return undefined;
}

function isBase64Bytes(raw: string): boolean {
  return raw.length >= 8 && raw.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw);
}
