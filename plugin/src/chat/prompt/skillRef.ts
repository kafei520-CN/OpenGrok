/** A skill the composer can cite with `#name`. */
export interface SkillRefSource {
  name: string;
  dirPath: string;
  enabled: boolean;
  description?: string;
  scope?: string;
}

export interface SkillHit extends SkillRefSource {
  token: string;
}

const TOKEN = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;

/** Slash-safe token. The CLI expands `/token`, not `#token`. */
export function skillToken(skill: Pick<SkillRefSource, 'name' | 'dirPath'>): string | undefined {
  return normalizeToken(skill.name) ?? normalizeToken(skill.dirPath.split(/[/\\]/).pop() ?? '');
}

export function filterSkills(skills: SkillRefSource[], query: string): SkillHit[] {
  const q = query.replace(/^#/, '').trim().toLowerCase();
  const seen = new Set<string>();
  const hits: SkillHit[] = [];
  for (const skill of skills) {
    if (!skill.enabled) {
      continue;
    }
    const token = skillToken(skill);
    if (!token || seen.has(token)) {
      continue;
    }
    if (
      q &&
      !token.includes(q) &&
      !skill.name.toLowerCase().includes(q) &&
      !(skill.description ?? '').toLowerCase().includes(q)
    ) {
      continue;
    }
    seen.add(token);
    hits.push({ ...skill, token });
  }
  hits.sort((a, b) => a.token.localeCompare(b.token));
  return hits.slice(0, 40);
}

/** Replace a trailing `#query` with `#token `, or append one. */
export function insertSkillToken(draft: string, token: string): string {
  if (/#[^\s]*$/.test(draft)) {
    return draft.replace(/#[^\s]*$/, `#${token} `);
  }
  const gap = draft.length === 0 || /\s$/.test(draft) ? '' : ' ';
  return `${draft}${gap}#${token} `;
}

/**
 * Turn `#token` citations into a prompt the CLI will expand.
 *
 * The shell only loads a skill when the prompt starts with `/token`.
 * A leading citation is rewritten in place. A citation later in the
 * sentence keeps the visible `#token` and gains a leading `/token` line.
 * Unknown hashes, and a hash inside a word, stay text.
 */
export function skillPromptText(text: string, skills: SkillRefSource[]): string {
  const tokens = enabledTokens(skills);
  if (!tokens.length || !text.includes('#')) {
    return text;
  }
  const cites = findCites(text, tokens);
  if (!cites.length) {
    return text;
  }
  const rewritten = rewriteInPlace(text, tokens);
  if (startsWithSkill(rewritten, tokens) || text.trimStart().startsWith('/')) {
    return rewritten;
  }
  const lead = [...new Set(cites)].map((token) => `/${token}`).join(' ');
  return `${lead}\n${text}`;
}

function enabledTokens(skills: SkillRefSource[]): string[] {
  return [
    ...new Set(
      skills
        .filter((skill) => skill.enabled)
        .map(skillToken)
        .filter((token): token is string => Boolean(token)),
    ),
  ].sort((a, b) => b.length - a.length);
}

function findCites(text: string, tokens: string[]): string[] {
  const cites: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const hit = citeAt(text, i, tokens);
    if (!hit) {
      continue;
    }
    cites.push(hit);
    i += hit.length;
  }
  return cites;
}

function rewriteInPlace(text: string, tokens: string[]): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const hit = citeAt(text, i, tokens);
    if (hit) {
      out += `/${hit}`;
      i += hit.length;
      continue;
    }
    out += text[i];
  }
  return out;
}

function citeAt(text: string, index: number, tokens: string[]): string | undefined {
  const boundary = index === 0 || /\s/.test(text[index - 1] ?? '');
  if (text[index] !== '#' || !boundary) {
    return undefined;
  }
  const rest = text.slice(index + 1);
  return tokens.find((token) => tokenAt(rest, token));
}

function startsWithSkill(text: string, tokens: string[]): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) {
    return false;
  }
  const word = (trimmed.slice(1).split(/\s/, 1)[0] ?? '').toLowerCase();
  return tokens.includes(word);
}

function normalizeToken(raw: string): string | undefined {
  const token = raw.trim().toLowerCase();
  if (!TOKEN.test(token) || token.includes('--') || token.startsWith('-') || token.endsWith('-')) {
    return undefined;
  }
  return token;
}

function tokenAt(rest: string, token: string): boolean {
  if (rest.length < token.length || rest.slice(0, token.length).toLowerCase() !== token) {
    return false;
  }
  const next = rest[token.length];
  return next === undefined || /\s/.test(next);
}
