import * as path from 'node:path';
import { plat } from '../../core/platform';
import type { ChatMessage } from '../../core/types';

export const WRAP_UP_RULE_FILE = 'opengrok-wrap-up.md';
export const BROWSER_RULE_FILE = 'opengrok-browser.md';

/** Drop builtin rule files so the CLI does not attach them to a chat. */
export async function retireBuiltinRules(): Promise<void> {
  const dir = path.join(plat().homeDir(), '.grok', 'rules');
  for (const name of [BROWSER_RULE_FILE, WRAP_UP_RULE_FILE]) {
    for (const fileName of [name, `${name}.disabled`]) {
      try {
        await plat().deleteFile(path.join(dir, fileName), true);
      } catch {
        // Already gone.
      }
    }
  }
}

const WRAP_UP_MARK = '# OpenGrok wrap-up';

/**
 * Codex-style standing instruction: a user rule file the CLI loads as system
 * context. Never send this as a prompt text block — Grok persists extra user
 * blocks onto the transcript.
 */
export const WRAP_UP_NOTE = `${WRAP_UP_MARK}

Write like Codex. Do not glue the whole answer into one paragraph.

- As soon as you know the cause, say it. Do not wait until every edit is done.
- Use short paragraphs and indented bullets. Break lines after each point.
- Mark files/folders with a leading @ so they become chips: \`@Foo.java\` or \`@plugin/src/foo.ts\`.
- Methods/variables: \`@name (line 12)\`. Ordinary code stays in backticks without @.
- Do not mark fractions, versions, or prose (1/5, 正确率, v0.5.3 stay as text).
- Skip this recap for greetings or simple Q&A.

After real work, end with:
1. What changed and why (cause first).
2. Bullets of concrete effects.
3. Real file paths prefixed with @, one per line, e.g. \`@path/to/artifact.jar\`.
`;

export function wrapUpRulePath(homeDir: string): string {
  return path.join(homeDir, '.grok', 'rules', WRAP_UP_RULE_FILE);
}

export function upgradeWrapUpRule(text: string): string {
  let next = text;
  next = next.replace(
    /Name files as paths \(Foo\.java\)\. Name methods\/variables as `name \(line 12\)` so they become links\./,
    'Mark files/folders with a leading @ so they become chips: `@Foo.java` or `@plugin/src/foo.ts`. Methods/variables: `@name (line 12)`. Leave fractions and ordinary numbers as text.',
  );
  next = next.replace(
    'that names the output files as real paths (so they render as file links)',
    'that names the output files with a leading @ (so they render as file chips)',
  );
  next = next.replace(
    'Do not omit the file paths after edits.',
    'Do not omit the @file paths after edits. Do not mark fractions like 1/5 or other ordinary numbers as files.',
  );
  if (!next.includes('@path/to/artifact.jar')) {
    next = next.replace(/(?<!@)path\/to\/artifact\.jar/g, '@path/to/artifact.jar');
  }
  if (next.includes(WRAP_UP_MARK) && !next.includes('1/5') && !next.includes('leading @')) {
    next = `${next.trimEnd()}\n\nPrefix file, folder, and method refs with @ so they render as chips (example \`@path/to/artifact.jar\`). Do not mark fractions like 1/5 or other ordinary numbers.\n`;
  }
  return next;
}

const HIDDEN_RULE_MARKS = [WRAP_UP_MARK, '# OpenGrok browser'];

/** CLI may have glued a builtin rule onto a user turn. Cut it before display. */
export function stripWrapUpText(text: string): string {
  let cut = text.length;
  for (const mark of HIDDEN_RULE_MARKS) {
    const idx = text.indexOf(mark);
    if (idx >= 0 && idx < cut) {
      cut = idx;
    }
  }
  if (cut === text.length) {
    return text;
  }
  return text.slice(0, cut).replace(/[#\s]+$/u, '').trimEnd();
}

export function scrubUserMessages(messages: ChatMessage[]): void {
  for (const message of messages) {
    if (message.role === 'user') {
      message.text = stripWrapUpText(message.text);
    }
  }
}
