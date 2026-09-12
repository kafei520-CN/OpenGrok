import katex from 'katex';
import 'katex/contrib/mhchem';

const OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: 'ignore' as const,
  output: 'html' as const,
};

export function renderKatex(src: string, display: boolean): string {
  const body = src.trim();
  if (!body) {
    return '';
  }
  try {
    return katex.renderToString(body, { ...OPTIONS, displayMode: display });
  } catch {
    return `<code>${escapeMath(body)}</code>`;
  }
}

/** Pull TeX / mhchem out before HTML escaping. */
export function extractMath(src: string, stash: (html: string) => string): string {
  let text = src.replace(/\$\$([\s\S]+?)\$\$/g, (_all, body: string) => stash(renderKatex(body, true)));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_all, body: string) => stash(renderKatex(body, true)));
  text = text.replace(/\\\((.+?)\\\)/g, (_all, body: string) => stash(renderKatex(body, false)));
  text = text.replace(/(^|[^$\\])\$([^\s$][^$\n]*?)\$/g, (_all, pre: string, body: string) => {
    return `${pre}${stash(renderKatex(body, false))}`;
  });
  // Bare \ce{...} only after $...$ so $\ce{H2O}$ is one math span, not "$" + 0 + "$".
  text = text.replace(/\\ce\{([^}]*)\}/g, (_all, body: string) => stash(renderKatex(`\\ce{${body}}`, false)));
  return text;
}

function escapeMath(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
