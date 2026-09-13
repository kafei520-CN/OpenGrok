import { AUTH_METHODS } from '../core/constants';

export interface AuthMethodInfo {
  id: string;
  name: string;
  description?: string;
  meta?: Record<string, unknown>;
}

export function methodId(method: AuthMethodInfo | string): string {
  return typeof method === 'string' ? method : method.id;
}

export function isInteractiveAuthMethod(id: string): boolean {
  return id === AUTH_METHODS.grokCom || id === AUTH_METHODS.oidc;
}

export function isSessionAuthMethod(id: string | undefined): boolean {
  return (
    id === AUTH_METHODS.cachedToken ||
    id === AUTH_METHODS.grokCom ||
    id === AUTH_METHODS.oidc
  );
}

export function needsInteractiveLogin(methods: AuthMethodInfo[]): boolean {
  const first = methods[0];
  return Boolean(first && isInteractiveAuthMethod(first.id));
}

/**
 * Prefer the agent's defaultAuthMethodId. Fall back to cached_token, then
 * the first advertised method. Matches the pager so we never invent a method.
 */
export function selectEagerAuthMethod(
  methods: AuthMethodInfo[],
  defaultAuthMethodId?: string,
): string | undefined {
  return pickAuthMethod(methods, defaultAuthMethodId);
}

/** Same as eager pick, but never grok.com / OIDC — used when the user skips sign-in. */
export function selectNonInteractiveAuthMethod(
  methods: AuthMethodInfo[],
  defaultAuthMethodId?: string,
): string | undefined {
  return pickAuthMethod(
    methods.filter((method) => !isInteractiveAuthMethod(method.id)),
    defaultAuthMethodId,
  );
}

function pickAuthMethod(
  methods: AuthMethodInfo[],
  defaultAuthMethodId?: string,
): string | undefined {
  if (
    defaultAuthMethodId &&
    methods.some((method) => method.id === defaultAuthMethodId)
  ) {
    return defaultAuthMethodId;
  }
  const cached = methods.find((method) => method.id === AUTH_METHODS.cachedToken);
  return cached?.id ?? methods[0]?.id;
}

export function findInteractiveAuthMethod(
  methods: AuthMethodInfo[],
): AuthMethodInfo | undefined {
  return methods.find((method) => isInteractiveAuthMethod(method.id));
}

/** Method id to send on session/new. Skip-login falls back to the API key so a relay works unsigned. */
export function resolveSessionAuthMethodId(opts: {
  accountMethodId?: string;
  sessionAuthMethodId?: string;
  skipInteractive?: boolean;
  methods: AuthMethodInfo[];
  defaultId?: string;
}): string | undefined {
  if (opts.accountMethodId) {
    return opts.accountMethodId;
  }
  if (opts.sessionAuthMethodId) {
    return opts.sessionAuthMethodId;
  }
  if (opts.skipInteractive) {
    return selectNonInteractiveAuthMethod(opts.methods, opts.defaultId) ?? AUTH_METHODS.apiKey;
  }
  return selectEagerAuthMethod(opts.methods, opts.defaultId);
}

export function isExternalProvider(method: AuthMethodInfo | undefined): boolean {
  const value = method?.meta?.['external_provider'];
  return value === true;
}
