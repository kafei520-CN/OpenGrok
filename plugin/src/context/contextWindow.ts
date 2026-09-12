const MAX_TOKENS = 16_000_000;

/** Parse a token window. Empty is unset. Accepts 128000, 128k, 128K, 1m. */
export function parseContextWindow(raw: string): number | undefined {
  const compact = raw.trim().replace(/[_,\s]/g, '');
  if (!compact) {
    return undefined;
  }
  const match = compact.match(/^(\d+)([kKmM])?$/);
  if (!match) {
    throw new Error('invalid context window');
  }
  const n = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  const tokens = unit === 'm' ? n * 1_000_000 : unit === 'k' ? n * 1_000 : n;
  if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > MAX_TOKENS) {
    throw new Error('invalid context window');
  }
  return tokens;
}

export function formatContextWindow(tokens?: number): string {
  if (!tokens) {
    return '';
  }
  if (tokens % 1_000_000 === 0) {
    return `${tokens / 1_000_000}m`;
  }
  if (tokens % 1_000 === 0) {
    return `${tokens / 1_000}k`;
  }
  return String(tokens);
}
