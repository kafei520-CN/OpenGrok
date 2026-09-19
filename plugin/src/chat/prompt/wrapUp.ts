import * as path from 'node:path';
import { plat } from '../../core/platform';
import type { ContentBlock } from '../../core/types';

export const WRAP_UP_RULE_FILE = 'opengrok-wrap-up.md';

/** Standing wrap-up prompt. Grok loads ~/.grok/rules; we also send it with each turn. */
export const WRAP_UP_NOTE = `# OpenGrok wrap-up

When you finish actual work (edits, builds, or a fix), end the assistant reply itself with a Codex-style recap. Do not put this in a tool card. Skip it for greetings or simple Q&A.

Write it in the user's language, using this layout:

1. One or two sentences: what you changed and why.
2. A short bullet list of the concrete fixes or effects.
3. A closing line that names the output files as real paths (so they render as file links), for example:
已构建并复制到游戏目录：
path/to/artifact.jar

Do not omit the file paths after edits.
`;

export function wrapUpMeta(): { instructions: string } {
  return { instructions: WRAP_UP_NOTE };
}

export function wrapUpPromptBlock(): ContentBlock {
  return { type: 'text', text: WRAP_UP_NOTE };
}

export function wrapUpRulePath(homeDir: string): string {
  return path.join(homeDir, '.grok', 'rules', WRAP_UP_RULE_FILE);
}

export async function ensureWrapUpRule(): Promise<void> {
  const filePath = wrapUpRulePath(plat().homeDir());
  const next = Buffer.from(WRAP_UP_NOTE, 'utf8');
  try {
    const prev = await plat().readFile(filePath);
    if (Buffer.from(prev).equals(next)) {
      return;
    }
  } catch {
    /* create */
  }
  await plat().writeFile(filePath, next);
}
