import type { AccountInfo, BillingQuota } from '../../core/types';

export type SuperGrokKind = 'supergrok' | 'heavy';

const MARK_SRC: Record<SuperGrokKind, string> = {
  supergrok: '../resources/SuperGrok.svg',
  heavy: '../resources/SuperGrokHeavy.svg',
};

const markCache = new Map<string, Promise<string>>();

export function superGrokKind(
  account?: AccountInfo,
  billing?: BillingQuota,
): SuperGrokKind | undefined {
  if (!account?.email && !account?.methodId) {
    return undefined;
  }
  const compact = (billing?.subscriptionTier ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  if (compact.includes('heavy') || compact === 'supergrokpro') {
    return 'heavy';
  }
  return 'supergrok';
}

export function superGrokMark(kind: SuperGrokKind): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = kind === 'heavy' ? 'og-home-mark og-home-mark-heavy' : 'og-home-mark';
  void loadMark(MARK_SRC[kind]).then((svg) => {
    wrap.innerHTML = svg;
    const node = wrap.querySelector('svg');
    node?.setAttribute('role', 'img');
    node?.setAttribute('aria-label', kind === 'heavy' ? 'SuperGrok Heavy' : 'SuperGrok');
    node?.removeAttribute('class');
  });
  return wrap;
}

function loadMark(href: string): Promise<string> {
  let hit = markCache.get(href);
  if (!hit) {
    hit = fetch(href).then((res) => {
      if (!res.ok) {
        throw new Error(`mark ${res.status}`);
      }
      return res.text();
    });
    markCache.set(href, hit);
  }
  return hit;
}
