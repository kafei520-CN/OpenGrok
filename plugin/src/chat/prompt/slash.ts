export interface SlashCommand {
  name: string;
  description: string;
  hint?: string;
}

export type HostAction =
  | { kind: 'newSession' }
  | { kind: 'resume' }
  | { kind: 'dashboard' }
  | { kind: 'agents' }
  | { kind: 'home' }
  | { kind: 'login' }
  | { kind: 'logout' }
  | { kind: 'settings' }
  | { kind: 'docs'; target?: string }
  | { kind: 'copy'; n?: number; path?: string }
  | { kind: 'export' }
  | { kind: 'quit' }
  | { kind: 'compact'; note?: string }
  | { kind: 'rewind' }
  | { kind: 'fork' }
  | { kind: 'rename'; title?: string; auto?: boolean }
  | { kind: 'delete' }
  | { kind: 'sessionInfo' }
  | { kind: 'usage'; manage?: boolean }
  | { kind: 'privacy' }
  | { kind: 'plan'; text?: string }
  | { kind: 'model'; name?: string }
  | { kind: 'effort'; level?: string }
  | { kind: 'history' }
  | { kind: 'feedback'; text?: string }
  | { kind: 'btw'; text?: string }
  | { kind: 'extensions'; tab: string }
  | { kind: 'mcpSettings' }
  | { kind: 'worktrees' }
  | { kind: 'tasks' }
  | { kind: 'memory' }
  | { kind: 'viewPlan' }
  | { kind: 'editPrompt' }
  | { kind: 'toggle'; flag: 'timestamps' | 'compactMode' | 'multiline' }
  | { kind: 'tutorial' }
  | { kind: 'changelog' }
  | { kind: 'alwaysApprove' }
  | { kind: 'pass' };

const ALIASES: Record<string, string> = {
  clear: 'new',
  welcome: 'home',
  config: 'settings',
  preferences: 'settings',
  prefs: 'settings',
  howto: 'docs',
  guides: 'docs',
  undo: 'rewind',
  title: 'rename',
  status: 'session-info',
  info: 'session-info',
  cost: 'usage',
  m: 'model',
  tour: 'tutorial',
  onboarding: 'tutorial',
  changelog: 'release-notes',
  t: 'theme',
  ml: 'multiline',
  mem: 'memory',
  worktree: 'worktrees',
  sessions: 'dashboard',
  'agents-dashboard': 'dashboard',
  agents: 'agents',
  'config-agents': 'agents',
  personas: 'agents',
  'show-plan': 'view-plan',
  'plan-view': 'view-plan',
};

export const HOST_COMMANDS = new Set([
  'new',
  'resume',
  'dashboard',
  'agents',
  'home',
  'login',
  'logout',
  'settings',
  'docs',
  'copy',
  'export',
  'quit',
  'exit',
  'compact',
  'rewind',
  'fork',
  'rename',
  'delete',
  'session-info',
  'context',
  'usage',
  'privacy',
  'plan',
  'model',
  'effort',
  'history',
  'feedback',
  'btw',
  'mcps',
  'skills',
  'plugins',
  'hooks',
  'marketplace',
  'workflows',
  'edit-prompt',
  'timestamps',
  'compact-mode',
  'multiline',
  'tutorial',
  'release-notes',
  'always-approve',
  'theme',
  'worktrees',
  'tasks',
  'memory',
  'view-plan',
]);

export function parseSlash(text: string): { command: string; args: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return undefined;
  }
  const match = trimmed.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return undefined;
  }
  return { command: match[1].toLowerCase(), args: (match[2] ?? '').trim() };
}

export function resolveAlias(name: string): string {
  return ALIASES[name] ?? name;
}

export function classifySlash(text: string): HostAction {
  const parsed = parseSlash(text);
  if (!parsed) {
    return { kind: 'pass' };
  }
  const command = resolveAlias(parsed.command);
  const args = parsed.args;
  if (!HOST_COMMANDS.has(command) && command !== 'exit') {
    return { kind: 'pass' };
  }
  switch (command) {
    case 'new':
      return { kind: 'newSession' };
    case 'resume':
      return { kind: 'resume' };
    case 'dashboard':
      return { kind: 'dashboard' };
    case 'agents':
      return { kind: 'agents' };
    case 'home':
      return { kind: 'home' };
    case 'login':
      return { kind: 'login' };
    case 'logout':
      return { kind: 'logout' };
    case 'settings':
    case 'theme':
      return { kind: 'settings' };
    case 'docs':
      return { kind: 'docs', target: args || undefined };
    case 'copy': {
      const asNum = Number(args);
      if (args && !Number.isNaN(asNum) && !args.includes('/') && !args.includes('\\')) {
        return { kind: 'copy', n: asNum };
      }
      return { kind: 'copy', path: args || undefined };
    }
    case 'export':
      return { kind: 'export' };
    case 'quit':
    case 'exit':
      return { kind: 'quit' };
    case 'compact':
      return { kind: 'compact', note: args || undefined };
    case 'rewind':
      return { kind: 'rewind' };
    case 'fork':
      return { kind: 'fork' };
    case 'rename':
      if (args === '--auto') {
        return { kind: 'rename', auto: true };
      }
      return { kind: 'rename', title: args || undefined };
    case 'delete':
      return { kind: 'delete' };
    case 'session-info':
    case 'context':
      return { kind: 'sessionInfo' };
    case 'usage':
      return { kind: 'usage', manage: args === 'manage' };
    case 'privacy':
      return { kind: 'privacy' };
    case 'plan':
      return { kind: 'plan', text: args || undefined };
    case 'model':
      return { kind: 'model', name: args || undefined };
    case 'effort':
      return { kind: 'effort', level: args || undefined };
    case 'history':
      return { kind: 'history' };
    case 'feedback':
      return { kind: 'feedback', text: args || undefined };
    case 'btw':
      return { kind: 'btw', text: args || undefined };
    case 'mcps':
      return { kind: 'mcpSettings' };
    case 'worktrees':
      return { kind: 'worktrees' };
    case 'tasks':
      return { kind: 'tasks' };
    case 'memory':
      return { kind: 'memory' };
    case 'view-plan':
      return { kind: 'viewPlan' };
    case 'skills':
    case 'plugins':
    case 'hooks':
    case 'marketplace':
    case 'workflows':
      return { kind: 'extensions', tab: command };
    case 'edit-prompt':
      return { kind: 'editPrompt' };
    case 'timestamps':
      return { kind: 'toggle', flag: 'timestamps' };
    case 'compact-mode':
      return { kind: 'toggle', flag: 'compactMode' };
    case 'multiline':
      return { kind: 'toggle', flag: 'multiline' };
    case 'tutorial':
      return { kind: 'tutorial' };
    case 'release-notes':
      return { kind: 'changelog' };
    case 'always-approve':
      return { kind: 'alwaysApprove' };
    default:
      return { kind: 'pass' };
  }
}

export function filterCommands(
  commands: SlashCommand[],
  query: string,
): SlashCommand[] {
  const q = query.replace(/^\//, '').toLowerCase();
  if (!q) {
    return commands.slice(0, 40);
  }
  return commands
    .filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q),
    )
    .slice(0, 40);
}

export const FALLBACK_COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'Start a fresh session' },
  { name: 'resume', description: 'Reload a previous session' },
  { name: 'compact', description: 'Compress conversation history', hint: 'optional note' },
  { name: 'rewind', description: 'Roll back to an earlier turn' },
  { name: 'plan', description: 'Enter plan mode', hint: 'optional description' },
  { name: 'model', description: 'Switch models', hint: '<name> [effort]' },
  { name: 'effort', description: 'Set reasoning effort', hint: 'low|medium|high|xhigh' },
  { name: 'always-approve', description: 'Skip tool permission prompts' },
  { name: 'imagine', description: 'Generate an image', hint: '<description>' },
  { name: 'imagine-video', description: 'Generate a video', hint: '<description>' },
  { name: 'workflow', description: 'Launch or manage a workflow', hint: '<name> | runs | pause|resume|stop' },
  { name: 'goal', description: 'Set or manage an autonomous goal' },
  { name: 'deep-research', description: 'Background research workflow', hint: '<query>' },
  { name: 'loop', description: 'Run a prompt on an interval', hint: '[30m] <prompt>' },
  { name: 'remember', description: 'Save a note to memory' },
  { name: 'flush', description: 'Flush session knowledge to memory' },
  { name: 'memory', description: 'Browse or toggle memory' },
  { name: 'mcps', description: 'MCP servers' },
  { name: 'skills', description: 'Skills' },
  { name: 'plugins', description: 'Plugins' },
  { name: 'hooks', description: 'Hooks' },
  { name: 'marketplace', description: 'Plugin marketplace' },
  { name: 'workflows', description: 'Saved workflow catalog' },
  { name: 'worktrees', description: 'List, apply, or remove git worktrees' },
  { name: 'tasks', description: 'Background tasks' },
  { name: 'memory', description: 'Browse memory files' },
  { name: 'view-plan', description: 'View the current plan' },
  { name: 'dashboard', description: 'Multi-agent session dashboard' },
  { name: 'agents', description: 'Manage agent definitions and personas' },
  { name: 'fork', description: 'Branch this session (optional git worktree)' },
  { name: 'rename', description: 'Rename this session', hint: '<title> | --auto' },
  { name: 'delete', description: 'Delete this session' },
  { name: 'session-info', description: 'Show session details' },
  { name: 'context', description: 'Show context-window usage' },
  { name: 'usage', description: 'Credit usage / billing' },
  { name: 'privacy', description: 'Coding-data retention' },
  { name: 'login', description: 'Sign in again' },
  { name: 'logout', description: 'Sign out' },
  { name: 'settings', description: 'Open VS Code settings' },
  { name: 'docs', description: 'Open Grok Build docs' },
  { name: 'copy', description: 'Copy the last reply' },
  { name: 'export', description: 'Export the conversation' },
  { name: 'feedback', description: 'Send feedback' },
  { name: 'btw', description: 'Ask a side question mid-turn' },
  { name: 'history', description: 'Prompt history' },
  { name: 'doctor', description: 'Check session health' },
];

export function modeLabel(id: string): string {
  switch (id) {
    case 'plan':
      return 'Plan';
    case 'ask':
      return 'Ask';
    default:
      return 'Agent';
  }
}

/** `_meta.mode` on session/prompt. CLI maps ask/plan; anything else is Agent. */
export function promptModeMeta(modeId: string): string {
  if (modeId === 'ask' || modeId === 'plan') {
    return modeId;
  }
  return 'agent';
}
