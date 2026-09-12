export const EXTENSION_ID = 'grok-for-vs-code';
export const EXTENSION_QUALIFIED_ID = 'kafei520cn.grok-for-vs-code';
export const VIEW_ID = 'grok.chat';
export const OUTPUT_CHANNEL = 'Grok Build';

export const COMMANDS = {
  openChat: 'grok.openChat',
  newSession: 'grok.newSession',
  login: 'grok.login',
  logout: 'grok.logout',
  setApiKey: 'grok.setApiKey',
  addSelection: 'grok.addSelection',
  addActiveFile: 'grok.addActiveFile',
  addFiles: 'grok.addFiles',
  restartAgent: 'grok.restartAgent',
  showLog: 'grok.showLog',
  cancel: 'grok.cancel',
  compact: 'grok.compact',
  rewind: 'grok.rewind',
  resume: 'grok.resumeSession',
  cycleMode: 'grok.cycleMode',
  fork: 'grok.forkSession',
  export: 'grok.exportSession',
  usage: 'grok.usage',
} as const;

export const CLIENT_IDENTIFIER = 'grok-code-extension';
export const PROTOCOL_VERSION = 1;

export const AUTH_METHODS = {
  grokCom: 'grok.com',
  oidc: 'oidc',
  cachedToken: 'cached_token',
  apiKey: 'xai.api_key',
} as const;

export const EXT = {
  authGetUrl: 'x.ai/auth/get_url',
  authSubmitCode: 'x.ai/auth/submit_code',
  authCancel: 'x.ai/auth/cancel',
  authLogout: 'x.ai/auth/logout',
  authInfo: 'x.ai/auth/info',
  setApiKey: 'x.ai/setApiKey',
  sessionList: 'x.ai/session/list',
  sessionRecent: 'x.ai/session_summaries/workspace_list_recent',
  sessionInfo: 'x.ai/session/info',
  sessionRename: 'x.ai/session/rename',
  sessionDelete: 'x.ai/session/delete',
  sessionFork: 'x.ai/session/fork',
  sessionsRoster: 'x.ai/sessions/list',
  subagentList: 'x.ai/subagent/list_running',
  subagentCancel: 'x.ai/subagent/cancel',
  worktreeResume: 'x.ai/git/worktree/resume_session',
  worktreeList: 'x.ai/git/worktree/list',
  worktreeApply: 'x.ai/git/worktree/apply',
  worktreeRemove: 'x.ai/git/worktree/remove',
  pluginsAction: 'x.ai/plugins/action',
  hooksAction: 'x.ai/hooks/action',
  marketplaceAction: 'x.ai/marketplace/action',
  taskList: 'x.ai/task/list',
  taskKill: 'x.ai/task/kill',
  memoryFlush: 'x.ai/memory/flush',
  sessionUsage: 'x.ai/session/usage',
  billing: 'x.ai/billing',
  compact: 'x.ai/compact_conversation',
  rewindPoints: 'x.ai/rewind/points',
  rewindExecute: 'x.ai/rewind/execute',
  commandsList: 'x.ai/commands/list',
  promptHistory: 'x.ai/prompt_history',
  mcpList: 'x.ai/mcp/list',
  mcpToggle: 'x.ai/mcp/toggle',
  mcpSdkCall: 'x.ai/mcp/sdk_call',
  skillsList: 'x.ai/skills/list',
  pluginsList: 'x.ai/plugins/list',
  hooksList: 'x.ai/hooks/list',
  workflowsList: 'x.ai/workflows/list',
  marketplaceList: 'x.ai/marketplace/list',
  privacySet: 'x.ai/privacy/setCodingDataRetention',
  feedback: 'x.ai/feedback',
  interject: 'x.ai/interject',
  modelsList: 'x.ai/models/list',
  modelsReload: 'x.ai/internal/reload_models',
} as const;

/** Local config reload must not block the ACP session if the CLI stalls. */
export const RELOAD_MODELS_TIMEOUT_MS = 8_000;

/** Agent death shortly after an endpoint write is treated as that endpoint's fault. */
export const API_MUTATION_GUARD_MS = 20_000;
