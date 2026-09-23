import * as path from 'node:path';
import { plat } from '../../core/platform';
import type { ChatMessage } from '../../core/types';

export const WRAP_UP_RULE_FILE = 'opengrok-wrap-up.md';
export const BROWSER_RULE_FILE = 'opengrok-browser.md';

const BROWSER_RULE = `# OpenGrok browser

The side-panel browser tools are already registered. Call the names in your tool list. They may show up as browser_open or browser_browser_open. Do not search the workspace, docs, or tool index.

- open a page: browser_open or browser_browser_open { url }
- look: browser_look or browser_browser_look
- click: browser_click { x, y } or { selector } — x,y are screenshot pixels
- drag: browser_drag { x1, y1, x2, y2 } — sling, pointer, mousemove, mouse hold
- browser_type { text }
- browser_press { key } — Enter, Space, ArrowLeft, ArrowRight, ArrowUp, ArrowDown
- browser_scroll { dy }

After one action, call browser_look once. Do not grep the repo.
`;

export async function ensureBrowserRule(): Promise<void> {
  const filePath = path.join(plat().homeDir(), '.grok', 'rules', BROWSER_RULE_FILE);
  try {
    const bytes = await plat().readFile(filePath);
    const text = Buffer.from(bytes).toString('utf8');
    if (text.includes('browser_browser_open')) {
      return;
    }
  } catch {
    // First run: write the rule below.
  }
  await plat().writeFile(filePath, Buffer.from(BROWSER_RULE, 'utf8'));
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

/** Create the rule once. Upgrade only the file-chip marker instruction. */
export async function ensureWrapUpRule(): Promise<void> {
  const filePath = wrapUpRulePath(plat().homeDir());
  try {
    const bytes = await plat().readFile(filePath);
    const text = Buffer.from(bytes).toString('utf8');
    const next = upgradeWrapUpRule(text);
    if (next !== text) {
      await plat().writeFile(filePath, Buffer.from(next, 'utf8'));
    }
  } catch {
    await plat().writeFile(filePath, Buffer.from(WRAP_UP_NOTE, 'utf8'));
  }
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

/** CLI may have glued the old prompt-block wrap-up onto a user turn. */
export function stripWrapUpText(text: string): string {
  const idx = text.indexOf(WRAP_UP_MARK);
  if (idx < 0) {
    return text;
  }
  return text.slice(0, idx).replace(/[#\s]+$/u, '').trimEnd();
}

export function scrubUserMessages(messages: ChatMessage[]): void {
  for (const message of messages) {
    if (message.role === 'user') {
      message.text = stripWrapUpText(message.text);
    }
  }
}
