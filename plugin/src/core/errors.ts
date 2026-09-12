import { RpcError } from '../agent/rpc';
import type { SessionUpdate, TurnError } from './types';
import { asNum, asObject, asString } from './wire';

const RPC_LABELS: Record<number, string> = {
  [-32700]: 'Parse error',
  [-32600]: 'Invalid request',
  [-32601]: 'Method not found',
  [-32602]: 'Invalid params',
  [-32603]: 'Internal error',
  [-32003]: 'Rate limited',
  [-32000]: 'Server error',
};

export function formatAgentError(error: unknown): TurnError {
  if (error instanceof RpcError) {
    const fromData = parseErrorPayload(error.data);
    const fromMessage = extractFromText(error.message);
    const code = fromData.code ?? fromMessage.code ?? rpcCodeLabel(error.code);
    const message =
      fromData.message ||
      (fromMessage.message && fromMessage.message !== 'Internal error' ? fromMessage.message : '') ||
      error.message ||
      'ACP error';
    return compactError({ message, code });
  }
  if (error instanceof Error) {
    return compactError(extractFromText(error.message));
  }
  if (error && typeof error === 'object') {
    return compactError(parseErrorPayload(error));
  }
  return { message: error ? String(error) : 'Unknown error' };
}

export function formatRetryUpdate(update: SessionUpdate): TurnError {
  const kind = (update.type ?? '').toLowerCase();
  const raw = update.message || update.reason || update.error || 'Request failed';
  const extracted = extractFromText(raw);
  const typeCode = update.errorType?.trim();
  const code =
    extracted.code ??
    (typeCode && typeCode !== 'api' && typeCode !== 'server' ? typeCode : undefined);
  if (kind === 'retrying') {
    return compactError({
      message: extracted.message,
      code,
      retrying: true,
      attempt: update.attempt,
      maxAttempts: update.maxRetries,
    });
  }
  return compactError({
    message: extracted.message,
    code,
    attempt: update.attempts ?? update.attempt,
    maxAttempts: update.maxRetries,
  });
}

export function formatErrorLine(error: TurnError): string {
  return error.code ? `[${error.code}] ${error.message}` : error.message;
}

export function isCancelError(error: unknown): boolean {
  if (error instanceof RpcError) {
    if (/cancel/i.test(error.message)) {
      return true;
    }
    const data =
      typeof error.data === 'string' ? error.data : JSON.stringify(error.data ?? '');
    return /cancel/i.test(data);
  }
  return /cancel/i.test(error instanceof Error ? error.message : String(error ?? ''));
}

export function extractFromText(text: string): TurnError {
  const trimmed = text.trim();
  if (!trimmed) {
    return { message: 'Unknown error' };
  }
  const afterRetries = trimmed.match(/^failed after \d+ retries:\s*([\s\S]*)$/i);
  if (afterRetries?.[1]) {
    return extractFromText(afterRetries[1]);
  }
  const api = trimmed.match(/^API error \(status (\d+)(?:\s+([^)]*))?\):\s*([\s\S]*)$/);
  if (api) {
    const body = api[3]?.trim();
    const fromJson = parseJsonError(body);
    return compactError({
      code: fromJson?.code ?? `HTTP ${api[1]}`,
      message: fromJson?.message || body || api[2]?.trim() || trimmed,
    });
  }
  const fromJson = parseJsonError(trimmed);
  if (fromJson) {
    return compactError(fromJson);
  }
  if (
    /run \/login to re-authenticate/i.test(trimmed) &&
    !/(?:api\.x\.ai|api\.grok\.com|cli-chat-proxy|\.x\.ai\/|\.grok\.com\/)/i.test(trimmed)
  ) {
    return compactError({
      code: 'HTTP 401',
      message: trimmed,
    });
  }
  const sending = trimmed.replace(/\s+/g, ' ').match(
    /^request error:\s*error sending request for url \((https?:\/\/[^)]+)\)(?::\s*(.*))?$/i,
  );
  if (sending) {
    const url = sending[1];
    const cause = sending[2]?.trim();
    return compactError({
      code: 'connection',
      message: cause ? `${cause}\n${url}` : trimmed,
    });
  }
  const empty = trimmed.match(/empty response from model \(([^)]+)\)/i);
  if (empty) {
    return { code: empty[1], message: trimmed };
  }
  const httpParen = trimmed.match(/\((\d{3})\)/);
  if (httpParen && /unauthorized|forbidden|not found|status|http/i.test(trimmed)) {
    return { code: `HTTP ${httpParen[1]}`, message: trimmed };
  }
  const httpWord = trimmed.match(/\b(?:HTTP|status)\s+(\d{3})\b/i);
  if (httpWord) {
    return { code: `HTTP ${httpWord[1]}`, message: trimmed };
  }
  return { message: trimmed };
}

function parseJsonError(text: string | undefined): { message: string; code?: string } | undefined {
  if (!text) {
    return undefined;
  }
  const start = text.indexOf('{');
  if (start < 0) {
    return undefined;
  }
  try {
    const obj = JSON.parse(text.slice(start)) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return undefined;
    }
    const root = obj as Record<string, unknown>;
    const nested =
      root['error'] && typeof root['error'] === 'object' && !Array.isArray(root['error'])
        ? (root['error'] as Record<string, unknown>)
        : {};
    const message =
      (typeof root['error'] === 'string' && root['error']) ||
      (typeof nested['message'] === 'string' && nested['message']) ||
      (typeof root['message'] === 'string' && root['message']) ||
      (typeof root['detail'] === 'string' && root['detail']) ||
      '';
    const codeRaw = nested['code'] ?? nested['type'] ?? root['code'];
    const code = typeof codeRaw === 'string' && codeRaw.trim() ? codeRaw : undefined;
    if (!message && !code) {
      return undefined;
    }
    return { message: message || text, code };
  } catch {
    return undefined;
  }
}

function parseErrorPayload(data: unknown): TurnError & { http?: number; kind?: string } {
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return parseErrorPayload(JSON.parse(trimmed));
      } catch {
        /* fall through */
      }
    }
    return extractFromText(trimmed);
  }
  const obj = asObject(data);
  if (!Object.keys(obj).length) {
    return { message: '' };
  }
  const nested =
    obj['error'] && typeof obj['error'] === 'object' && !Array.isArray(obj['error'])
      ? asObject(obj['error'])
      : {};
  const message =
    asString(obj['message']) ??
    asString(nested['message']) ??
    asString(obj['error']) ??
    asString(obj['detail']) ??
    '';
  const http =
    asNum(obj['http_status']) ??
    asNum(obj['httpStatus']) ??
    asNum(obj['status']) ??
    asNum(obj['statusCode']) ??
    asNum(nested['status']);
  const kind =
    asString(obj['error_kind']) ??
    asString(obj['errorKind']) ??
    asString(obj['error_type']) ??
    asString(obj['errorType']) ??
    asString(nested['code']) ??
    asString(nested['type']) ??
    asString(obj['code']);
  const fromText = extractFromText(message);
  return compactError({
    message: fromText.message || message,
    code: fromText.code ?? (kind && !isGenericKind(kind) ? kind : undefined) ?? httpCode(http),
    http,
    kind,
  });
}

function compactError(error: TurnError & { http?: number; kind?: string }): TurnError {
  const code = error.code ?? httpCode(error.http);
  const out: TurnError = { message: error.message.trim() || 'Unknown error' };
  if (code) {
    out.code = code;
  }
  if (error.retrying) {
    out.retrying = true;
  }
  if (error.attempt) {
    out.attempt = error.attempt;
  }
  if (error.maxAttempts) {
    out.maxAttempts = error.maxAttempts;
  }
  return out;
}

function httpCode(status?: number): string | undefined {
  return status ? `HTTP ${status}` : undefined;
}

function rpcCodeLabel(code?: number): string | undefined {
  if (code === undefined) {
    return undefined;
  }
  const name = RPC_LABELS[code];
  return name ? `${name} (${code})` : `ACP ${code}`;
}

function isGenericKind(kind: string): boolean {
  return /^(api|server|http|error|internal_error)$/i.test(kind);
}
