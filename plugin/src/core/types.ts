import type { TermEncoding } from '../terminal/termEncoding';

export type { TermEncoding };

export type ChatStatus =
  | 'untrusted'
  | 'missingCli'
  | 'connecting'
  | 'login'
  | 'authenticating'
  | 'ready'
  | 'streaming'
  | 'error';

export type AuthUrlMode = 'loopback' | 'device' | 'command';

export interface AccountInfo {
  email?: string;
  firstName?: string;
  lastName?: string;
  methodId?: string;
  avatarUrl?: string;
}

export interface BillingProduct {
  id: string;
  label: string;
  usagePercent: number;
}

/** grok.com 订阅余量，仅官方登录。 */
export interface BillingQuota {
  usagePercent: number;
  periodType?: 'weekly' | 'monthly';
  periodEnd?: string;
  subscriptionTier?: string;
  products: BillingProduct[];
}

export interface ModelOption {
  id: string;
  name: string;
  efforts?: string[];
  currentEffort?: string;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  hint?: string;
}

export interface ContextCategory {
  label: string;
  tokens: number;
  detail?: string;
}

export interface ContextUsage {
  used: number;
  total: number;
  percent: number;
  free?: number;
  systemTokens?: number;
  messageTokens?: number;
  toolTokens?: number;
  compactAt?: number;
  categories?: ContextCategory[];
}

export type CronKind = 'once' | 'daily' | 'weekly' | 'interval';

export interface CronJob {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  kind: CronKind;
  at?: string;
  weekday?: number;
  everyMs?: number;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
}

export type SettingsPage =
  | 'main'
  | 'rules'
  | 'skills'
  | 'apis'
  | 'api-form'
  | 'theme'
  | 'theme-preview'
  | 'mcps'
  | 'agents'
  | 'worktrees'
  | 'cron'
  | 'extensions'
  | 'og-plugins'
  | 'memory'
  | 'remote';

export interface ThemeColors {
  primary: string;
  secondary: string;
  background?: string;
  /** Bundled Grok mark, or a user-picked image/video copied into ~/.grok. */
  wallpaper?: 'icon' | 'custom';
  /** 0–100. Media layer only; empty areas keep the background color. */
  wallpaperOpacity?: number;
  wallpaperPath?: string;
  /** Host-resolved webview / file URL. Not persisted. */
  wallpaperUrl?: string;
  /** Zoom 20–800 percent of the viewport width. When set, the media is placed manually instead of auto-fit. */
  wallpaperScale?: number;
  wallpaperX?: number;
  wallpaperY?: number;
  /** Chat chrome: frosted glass, opaque sheet, or a named surface pack. */
  surface?: 'glass' | 'solid' | 'endfield';
  /** 0–100 mix of --bg into the frosted panel. */
  glassOpacity?: number;
  /** Wallpaper blur in px, 0–40. */
  glassBlur?: number;
  /** Component frost blur in px, 0–40. Independent of wallpaper blur. */
  chromeBlur?: number;
  /** Frost cards and buttons as well as the main plate. */
  chromeGlass?: boolean;
  /** 0–100 mix of --bg into frosted cards/buttons. */
  chromeGlassOpacity?: number;
  /** Copied into ~/.grok. Host fills fontUrl for the webview. */
  fontPath?: string;
  /** Host-resolved webview / file URL. Not persisted. */
  fontUrl?: string;
  /** Chat UI font size in px, 10–22. Default 13. */
  fontSize?: number;
  /** letter-spacing in px, -4–8. Default 0. */
  letterSpacing?: number;
  /** Custom text color. Ignored while lockContrast is on. */
  fontColor?: string;
  /**
   * When not false, --fg stays auto contrast (or the editor chrome).
   * Custom fontColor does not apply.
   */
  lockContrast?: boolean;
}

/** Fields the webview may patch on setTheme besides primary/secondary/background. */
export type ThemePatch = {
  wallpaper?: 'icon' | 'custom' | '';
  wallpaperOpacity?: number;
  wallpaperScale?: number;
  wallpaperX?: number;
  wallpaperY?: number;
  surface?: 'glass' | 'solid' | 'endfield' | '';
  glassOpacity?: number;
  glassBlur?: number;
  chromeBlur?: number;
  chromeGlass?: boolean;
  chromeGlassOpacity?: number;
  fontPath?: string;
  fontSize?: number;
  letterSpacing?: number;
  fontColor?: string;
  lockContrast?: boolean;
};

export type ApiBackend = 'chat_completions' | 'responses' | 'messages';

export interface ApiEndpoint {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  backend: ApiBackend;
  hasKey: boolean;
  enabled: boolean;
  /** Token window written to grok config.toml as context_window. */
  contextWindow?: number;
  /** Built-in grok.com catalog model. Cannot be deleted. */
  builtin?: boolean;
}

export interface RuleItem {
  id: string;
  name: string;
  filePath: string;
  scope: 'global' | 'project';
  /** Where Grok actually discovered the file. */
  origin?: 'grok' | 'claude' | 'cursor';
  enabled: boolean;
}

export interface SkillItem {
  id: string;
  name: string;
  description?: string;
  dirPath: string;
  skillFile: string;
  scope: 'global' | 'project' | 'bundled';
  enabled: boolean;
}

export interface McpItem {
  id: string;
  name: string;
  source: 'managed' | 'local';
  enabled: boolean;
  status?: string;
  toolCount: number;
  sourceLabel?: string;
}

export type RosterActivity =
  | 'working'
  | 'idle'
  | 'needs_input'
  | 'dormant'
  | 'completed'
  | 'dead';

export interface RosterEntry {
  id: string;
  title: string;
  cwd: string;
  isWorktree: boolean;
  modelId?: string;
  activity: RosterActivity;
  lastTurnSummary?: string;
  resident?: boolean;
}

export interface SubagentLive {
  id: string;
  parentSessionId: string;
  childSessionId?: string;
  type: string;
  description: string;
  durationMs: number;
  contextUsagePct?: number;
}

export interface AgentDefItem {
  id: string;
  name: string;
  description?: string;
  filePath?: string;
  scope: 'builtin' | 'global' | 'project';
  enabled: boolean;
}

export interface PersonaItem {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  scope: 'global' | 'project';
  enabled: boolean;
}

export interface WorktreeItem {
  id: string;
  path: string;
  repoName: string;
  sourceRepo: string;
  kind: string;
  status: 'alive' | 'dead';
  sessionId?: string;
  gitRef?: string;
  label?: string;
  createdAt?: number;
}

export interface WorktreeApplyResult {
  ok: boolean;
  files?: number;
  conflicts?: number;
  message?: string;
}

export interface PluginItem {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  version?: string;
  scope?: string;
  skillCount: number;
  source?: string;
}

export interface HookItem {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  matcher?: string;
  command?: string;
}

export interface MarketplacePlugin {
  id: string;
  name: string;
  description?: string;
  sourceUrl: string;
  sourceName: string;
  relativePath: string;
  installStatus: string;
  version?: string;
}

export interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  source: string;
  path?: string;
}

export interface TaskItem {
  id: string;
  command: string;
  cwd: string;
  kind: string;
  completed: boolean;
  exitCode?: number;
  truncated?: boolean;
}

export interface MemoryFile {
  id: string;
  name: string;
  filePath: string;
  scope: 'global' | 'workspace';
}

export type SessionRunState = 'running' | 'done' | 'stopped';

export interface SessionRow {
  id: string;
  title: string;
  updatedAt?: string;
  cwd?: string;
  hidden?: boolean;
  sessionKind?: string;
  numChatMessages?: number;
  numMessages?: number;
  /** True when this session still has a turn running in the background. */
  live?: boolean;
  /** History-list status: running yellow, unread-complete green, interrupted red. Idle rows omit this. */
  runState?: SessionRunState;
}

export interface MediaItem {
  mimeType: string;
  data?: string;
  uri?: string;
}

export interface Attachment {
  id: string;
  label: string;
  path?: string;
  text?: string;
  mimeType?: string;
  data?: string;
}

export interface FileEdit {
  path: string;
  added: number;
  removed: number;
  previous?: string;
  next?: string;
}

export interface ToolCard {
  id: string;
  title: string;
  kind?: string;
  status: string;
  detail?: string;
  /** Clipped terminal stdout for execute/terminal tools. */
  output?: string;
  command?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface TurnError {
  message: string;
  code?: string;
  retrying?: boolean;
  attempt?: number;
  maxAttempts?: number;
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'abandoned';

export interface PlanStep {
  content: string;
  status: PlanStepStatus;
  id?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  tools: ToolCard[];
  images?: MediaItem[];
  edits?: FileEdit[];
  plan?: string;
  steps?: PlanStep[];
  streaming?: boolean;
  createdAt?: string;
  endedAt?: string;
  /** `null` on a stream tail means the retry/error card was cleared. */
  error?: TurnError | null;
  /** User or host stopped this assistant turn before it finished. */
  stopped?: boolean;
  /** Catalog id at the time this assistant turn started. */
  modelId?: string;
  /** Picker display name for that model. */
  modelName?: string;
  /** Reasoning effort sent with this turn. */
  effort?: string;
  /** Host compact card: auto prefire vs /compact. */
  compact?: 'auto' | 'manual';
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionPrompt {
  requestId: string;
  title: string;
  details?: string;
  toolKind?: string;
  options: PermissionOption[];
  /** Real ACP allow id when this card is the Ask-mode switch gate. */
  allowOptionId?: string;
}

export interface AskChoice {
  id: string;
  label: string;
  description?: string;
  other?: boolean;
}

export interface AskCard {
  requestId: string;
  kind: 'question' | 'plan';
  title: string;
  body?: string;
  choices: AskChoice[];
  index?: number;
  total?: number;
  multiSelect?: boolean;
}

export interface LoginView {
  url?: string;
  mode?: AuthUrlMode;
  label?: string;
}

export type DrawerId = 'sessions' | 'extensions' | 'history' | 'dashboard' | 'tasks' | 'plan' | undefined;

export interface GrokSettings {
  cliPath: string;
  preferWorkspaceBinary: boolean;
  minCliVersion: string;
  permissionMode: 'ask' | 'auto' | 'acceptEdits';
  includeSelectionOnSend: boolean;
  alwaysApprove: boolean;
  /** Allow execute / terminal / shell tools. Off by default. */
  useTerminal: boolean;
  locale: 'auto' | 'en' | 'zh-CN';
  /** Play a chime when a turn finishes or is interrupted. */
  notifySound: boolean;
  /** Decode terminal tool bytes for display. */
  termEncoding: TermEncoding;
}

export const DEFAULT_SETTINGS: GrokSettings = {
  cliPath: '',
  preferWorkspaceBinary: false,
  minCliVersion: '0.1.0',
  permissionMode: 'ask',
  includeSelectionOnSend: true,
  alwaysApprove: false,
  useTerminal: false,
  locale: 'auto',
  notifySound: true,
  termEncoding: 'utf-8',
};

export function settingNeedsRestart(key: keyof GrokSettings): boolean {
  return key === 'cliPath' || key === 'preferWorkspaceBinary' || key === 'minCliVersion';
}

export interface ChatState {
  status: ChatStatus;
  error?: string;
  cliPath?: string;
  cliInstallHint?: string;
  account?: AccountInfo;
  billing?: BillingQuota;
  billingLoading?: boolean;
  heatmap?: Array<{ date: string; requests: number; tokens: number }>;
  heatmapLongestSecs?: number;
  heatmapLoading?: boolean;
  login?: LoginView;
  models?: { currentId: string; available: ModelOption[] };
  modeId?: string;
  messages: ChatMessage[];
  permission?: PermissionPrompt;
  ask?: AskCard;
  attachments: Attachment[];
  agentVersion?: string;
  commands: SlashCommandInfo[];
  sessions?: SessionRow[];
  history?: string[];
  drawer?: DrawerId;
  drawerTab?: string;
  drawerBody?: string;
  fileHits?: Array<{ path: string; label: string }>;
  compactMode?: boolean;
  timestamps?: boolean;
  multiline?: boolean;
  queue?: string[];
  goal?: {
    text: string;
    status: 'running' | 'paused';
    startedAt: number;
    elapsedMs: number;
  };
  alwaysApprove?: boolean;
  notify?: 'done' | 'fail';
  currentSessionId?: string;
  restoringSession?: boolean;
  /** Live snapshot omitted history; the webview must keep its transcript. */
  mergeTranscript?: boolean;
  hideSessionPreview?: boolean;
  workspacePath?: string;
  /** Folder bound to the current chat only; used to classify history. */
  sessionCwd?: string;
  locale?: 'en' | 'zh-CN';
  context?: ContextUsage;
  settings?: GrokSettings;
  settingsOpen?: boolean;
  settingsPage?: SettingsPage;
  apiEditId?: string;
  rules?: RuleItem[];
  skills?: SkillItem[];
  apis?: ApiEndpoint[];
  mcps?: McpItem[];
  agents?: AgentDefItem[];
  personas?: PersonaItem[];
  roster?: RosterEntry[];
  subagents?: SubagentLive[];
  agentProfile?: string;
  worktrees?: WorktreeItem[];
  plugins?: PluginItem[];
  /** Local OpenGrok UI/host scripts from ~/.opengrok/plugins — not Grok CLI marketplace plugins. */
  ogPlugins?: import('../ogPlugins/types').OgPluginInfo[];
  hooks?: HookItem[];
  marketplace?: MarketplacePlugin[];
  workflows?: WorkflowItem[];
  tasks?: TaskItem[];
  cronJobs?: CronJob[];
  memoryFiles?: MemoryFile[];
  extTab?: 'plugins' | 'marketplace' | 'hooks' | 'workflows';
  theme?: ThemeColors;
  /** Host workbench colors so Ice/default is not white on remote / IDEA. */
  hostChrome?: { background: string; foreground: string };
  remote?: RemoteAccessInfo;
}

export interface RemoteAccessInfo {
  running: boolean;
  port: number;
  bind?: '0.0.0.0' | '127.0.0.1';
  local?: boolean;
  public?: boolean;
  code: string;
  codeMode?: 'random' | 'custom';
  localCode?: string;
  publicUrl?: string;
  urls: string[];
  clients: number;
  error?: string;
  tunnel?: 'off' | 'connecting' | 'up' | 'error';
  tunnelError?: string;
  tunnelHost?: string;
  tunnelUser?: string;
  sshPort?: number;
  forwardPort?: number;
  sshPublicKey?: string;
  bundledRelay?: boolean;
  relayKind?: 'official' | 'custom';
  relayPort?: number;
  hasRelayKey?: boolean;
}

export interface AuthMethodWire {
  type?: string;
  id?: string;
  name?: string;
  description?: string;
  _meta?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface InitializeResult {
  protocolVersion?: number | string;
  authMethods?: AuthMethodWire[];
  agentCapabilities?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

export interface SessionNewResult {
  sessionId: string;
  _meta?: Record<string, unknown>;
  models?: {
    currentModelId?: string;
    availableModels?: Array<{ modelId?: string; name?: string }>;
  };
}

export interface ContentBlock {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  path?: string;
  oldText?: string;
  newText?: string;
  resource?: { uri?: string; text?: string; mimeType?: string };
}

export interface SessionUpdate {
  sessionUpdate?: string;
  content?: ContentBlock | ContentBlock[];
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  type?: string;
  attempt?: number;
  maxRetries?: number;
  attempts?: number;
  reason?: string;
  errorType?: string;
  message?: string;
  error?: string;
  isRateLimited?: boolean;
  rawInput?: unknown;
  rawOutput?: unknown;
  locations?: Array<{ path?: string }>;
  currentModelId?: string;
  currentModeId?: string;
  modeId?: string;
  availableCommands?: SlashCommandInfo[];
  used?: number;
  size?: number;
  total?: number;
  turnStartMs?: number;
  streamStartMs?: number;
  agentTimestampMs?: number;
  entries?: unknown;
  objective?: string;
}

export interface HostToWebview {
  type: 'state';
  state: ChatState;
}

export interface StreamTail {
  type: 'tail';
  message: ChatMessage;
  /** Suffix of message.text when the host only sends the new bytes. */
  appendText?: string;
  /** Suffix of thinking when the host only sends the new bytes. */
  appendThinking?: string;
  /** Suffix of plan when the host only sends the new bytes. */
  appendPlan?: string;
  status: ChatStatus;
  context?: ContextUsage;
  queue?: string[];
}

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'alive' }
  | { type: 'login' }
  | { type: 'skipLogin' }
  | { type: 'useApiLogin' }
  | { type: 'openLoginUrl' }
  | { type: 'submitAuthCode'; code: string }
  | { type: 'cancelLogin' }
  | { type: 'setApiKey'; key: string }
  | { type: 'logout' }
  | { type: 'send'; text: string }
  | { type: 'dropQueue'; index: number }
  | { type: 'sendNow'; index?: number }
  | { type: 'openCron' }
  | { type: 'closeCron' }
  | {
      type: 'addCronJob';
      title: string;
      prompt: string;
      kind: CronKind;
      at?: string;
      weekday?: number;
      everyMs?: number;
    }
  | { type: 'patchCronJob'; id: string; enabled?: boolean }
  | { type: 'deleteCronJob'; id: string }
  | { type: 'runCronJob'; id: string }
  | { type: 'cancel' }
  | { type: 'pauseGoal' }
  | { type: 'resumeGoal' }
  | { type: 'clearGoal' }
  | { type: 'editGoal'; text: string }
  | { type: 'goalStatus' }
  | { type: 'newSession' }
  | { type: 'restart' }
  | { type: 'choosePermission'; optionId: string }
  | { type: 'cancelPermission' }
  | { type: 'answerAsk'; choiceId?: string; choiceIds?: string[]; notes?: string }
  | { type: 'cancelAsk' }
  | { type: 'removeAttachment'; id: string }
  | { type: 'openFile'; path: string }
  | { type: 'openUrl'; url: string }
  | { type: 'setModel'; modelId: string }
  | { type: 'setMode'; modeId: string }
  | { type: 'setEffort'; level: string }
  | { type: 'installCli' }
  | {
      type: 'openDrawer';
      drawer: 'sessions' | 'extensions' | 'history' | 'dashboard' | 'tasks' | 'plan';
      tab?: string;
    }
  | { type: 'closeDrawer' }
  | { type: 'loadSession'; sessionId: string; cwd?: string }
  | { type: 'renameSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'rewindTo'; index: number }
  | { type: 'rewindTurn'; messageId: string }
  | { type: 'searchFiles'; query: string }
  | { type: 'pickFile'; path: string }
  | { type: 'copyLast' }
  | { type: 'copyText'; text: string }
  | { type: 'editUserPrompt'; messageId: string; text: string }
  | { type: 'exportChat' }
  | { type: 'quoteSelection'; text: string }
  | { type: 'attach' }
  | { type: 'openSettings' }
  | { type: 'pickProject' }
  | { type: 'pickSessionProject' }
  | {
      type: 'petConfig';
      enabled?: boolean;
      size?: number;
      color?: string;
      shape?: string;
      eyeColor?: string;
      expression?: string;
      bubbles?: boolean;
    }
  | { type: 'closeSettings' }
  | { type: 'openRules' }
  | { type: 'closeRules' }
  | { type: 'importRules' }
  | { type: 'toggleRule'; id: string }
  | { type: 'deleteRule'; id: string }
  | { type: 'openRule'; id: string }
  | { type: 'openSkills' }
  | { type: 'closeSkills' }
  | { type: 'importSkillZip' }
  | { type: 'importSkillFolder' }
  | { type: 'toggleSkill'; id: string }
  | { type: 'deleteSkill'; id: string }
  | { type: 'openSkill'; id: string }
  | { type: 'openApis' }
  | { type: 'closeApis' }
  | { type: 'openApiForm'; id?: string }
  | { type: 'closeApiForm' }
  | { type: 'toggleApi'; id: string }
  | { type: 'openTheme' }
  | { type: 'closeTheme' }
  | { type: 'openRemote' }
  | { type: 'closeRemote' }
  | {
      type: 'startRemote';
      port?: number;
      local?: boolean;
      public?: boolean;
      host?: string;
      user?: string;
      sshPort?: number;
      forwardPort?: number;
      publicUrl?: string;
    }
  | { type: 'stopRemote' }
  | { type: 'rotateRemoteCode' }
  | { type: 'setRemoteAuth'; mode?: 'random' | 'custom'; secret?: string }
  | { type: 'setRemotePublicUrl'; url: string }
  | {
      type: 'setRemoteRelay';
      kind?: 'official' | 'custom';
      host?: string;
      port?: number;
      key?: string;
    }
  | {
      type: 'setRemoteTunnel';
      host?: string;
      user?: string;
      sshPort?: number;
      forwardPort?: number;
      publicUrl?: string;
    }
  | ({
      type: 'setTheme';
      primary: string;
      secondary: string;
      background?: string;
    } & ThemePatch)
  | { type: 'pickThemeWallpaper' }
  | { type: 'pickThemeFont' }
  | { type: 'openThemePreview' }
  | { type: 'closeThemePreview' }
  | { type: 'openMcps' }
  | { type: 'closeMcps' }
  | { type: 'toggleMcp'; id: string }
  | { type: 'openAgents' }
  | { type: 'closeAgents' }
  | { type: 'importAgents' }
  | { type: 'toggleAgent'; id: string }
  | { type: 'deleteAgent'; id: string }
  | { type: 'openAgent'; id: string }
  | { type: 'setAgentProfile'; name: string }
  | { type: 'importPersonas' }
  | { type: 'togglePersona'; id: string }
  | { type: 'deletePersona'; id: string }
  | { type: 'openPersona'; id: string }
  | { type: 'switchRosterSession'; sessionId: string; cwd?: string }
  | { type: 'stopRosterSession'; sessionId: string }
  | { type: 'cancelSubagent'; subagentId: string }
  | { type: 'dashboardDispatch'; text: string; sessionId?: string }
  | { type: 'openWorktrees' }
  | { type: 'closeWorktrees' }
  | { type: 'applyWorktree'; id: string }
  | { type: 'removeWorktree'; id: string }
  | { type: 'openExt' }
  | { type: 'closeExt' }
  | { type: 'openOgPlugins' }
  | { type: 'toggleOgPlugin'; id: string }
  | { type: 'openOgPluginsDir' }
  | { type: 'reloadOgPlugins' }
  | { type: 'setExtTab'; tab: 'plugins' | 'marketplace' | 'hooks' | 'workflows' }
  | { type: 'togglePlugin'; id: string }
  | { type: 'uninstallPlugin'; id: string }
  | { type: 'toggleHook'; id: string }
  | { type: 'installMarketplace'; id: string }
  | { type: 'refreshMarketplace' }
  | { type: 'refreshBilling' }
  | { type: 'runWorkflow'; name: string }
  | { type: 'killTask'; taskId: string }
  | { type: 'openMemory' }
  | { type: 'closeMemory' }
  | { type: 'openMemoryFile'; id: string }
  | { type: 'flushMemory' }
  | {
      type: 'saveApi';
      id?: string;
      name: string;
      model: string;
      baseUrl: string;
      backend: ApiBackend;
      apiKey?: string;
      contextWindow?: number;
    }
  | { type: 'deleteApi'; id: string }
  | {
      type: 'updateSetting';
      key: keyof GrokSettings;
      value: string | boolean;
    }
  | { type: 'toggleFlag'; flag: 'compactMode' | 'timestamps' | 'multiline' }
  | { type: 'runSlash'; command: string }
  | {
      type: 'pasteClipboard';
      text?: string;
      uris?: string[];
      images?: Array<{ name: string; mimeType: string; data: string }>;
      files?: Array<{ name: string; mimeType?: string; text?: string; data?: string }>;
    }
  | { type: 'undoEdits'; messageId?: string }
  | { type: 'reviewEdits'; messageId?: string; path?: string }
  | { type: 'openEdit'; path: string; messageId?: string }
  | { type: 'setRemoteView'; view: 'sidebar' | 'workspace' }
  | { type: 'listWorkspace'; dir?: string }
  | { type: 'openWorkspaceFile'; path: string }
  | { type: 'saveWorkspaceFile'; path: string; hash: string; text: string }
  | {
      type: 'mutateWorkspace';
      action: 'create' | 'rename' | 'delete';
      dir?: string;
      path?: string;
      name?: string;
      kind?: 'file' | 'dir';
    };
