import * as path from 'node:path';
import {
  findInteractiveAuthMethod,
  isSessionAuthMethod,
  needsInteractiveLogin,
  resolveSessionAuthMethodId,
} from '../billing/authMethods';
import { AUTH_METHODS } from '../core/constants';
import { GrokAgent } from '../agent/agent';
import {
  addActiveFile,
  addSelection,
  attachFromUi,
  attachPath,
  pasteClipboard,
  quoteText,
  removeAttachment,
} from './prompt/attachments';
import { installHint, resolveGrokBinary } from '../core/runtime/cli';
import { ContextMeter } from '../context/contextMeter';
import { EditJournal } from '../edits/editJournal';
import { slimFileDiffs } from '../edits/diff';
import { applyDiffStats, publicEdits } from '../edits/edits';
import type { EditStatsItem } from '../edits/editStats';
import { handleIncoming } from '../agent/incoming';
import {
  cacheKey,
  failedBinaryImagePath,
  imageFromBase64,
  type WorkspaceImage,
} from '../workspace/workspaceImages';
import { tr, uiLocale } from '../core/i18n/locale';
import { logError, logInfo, logWarn, showLog } from '../core/logger';
import { buildPromptBlocks } from './prompt';
import { formatAgentError, formatErrorLine, isCancelError } from '../core/errors';
import { readGrokSettings } from '../settings/settings';
import {
  CRON_STATE_KEY,
  CRON_TICK_MS,
  dueJobs,
  jobFromDraft,
  markJobRan,
  readCronJobs,
  stampJob,
  type CronDraft,
} from './cronJobs';
import type { CronJob } from '../core/types';
import {
  applyRestoredTurnModels,
  applySessionUpdate,
  finalizeReplayTimes,
  freezeTurnSteps,
  mergeCommands,
  mergeModelCatalog,
  modelsFromResult,
} from '../session/sessionUpdates';
import {
  applyStoredTurnModels,
  isCustomModelId,
  isRelayEndpoint,
  overlayApiModels,
  persistTurnModels,
  readStoredTurnModels,
} from '../models/turnModels';
import { FALLBACK_COMMANDS, classifySlash, modeLabel, promptModeMeta, type HostAction } from './prompt/slash';
import { imageMcpServersMeta } from '../core/runtime/imageTool';
import { isOfficialGrokAccount, parseBilling, type BillingQuota } from '../billing/billing';
import { withCachedSubscription } from '../billing/billingCache';
import { loadLocalHeatmap } from '../billing/heatmapLoad';
import type { HeatmapDay } from '../billing/heatmapStats';
import { bindPlatform, plat, type Platform } from '../core/platform';
import { dispatchUi } from './dispatch';
import {
  ensureOgPluginsDir,
  publicOgPlugins,
  readPluginState,
  scanOgPlugins,
  writePluginDisabled,
} from '../ogPlugins/scan';
import { bindOgPostToUi, loadOgHostPlugins } from '../ogPlugins/hostRuntime';
import type { OgPluginInfo } from '../ogPlugins/types';
import { pathToFileURL } from 'node:url';
import {
  buildStreamTail,
  emptyStreamCursor,
  type StreamDeltaCursor,
} from './streamTail';

import { gitProbePaths } from '../core/runtime/fork';
import { runSlashAction, type SlashRuntime } from './prompt/slashHost';
import {
  abortClientRpcs,
  answerAsk as answerAskRpc,
  askUserQuestion as askUserQuestionRpc,
  cancelAsk as cancelAskRpc,
  cancelPermission as cancelPermissionRpc,
  choosePermission as choosePermissionRpc,
  requestToolPermission as requestToolPermissionRpc,
  reviewPlan as reviewPlanRpc,
  type PendingAsk,
  type PendingPermission,
  type ReverseHost,
} from '../agent/reverseRpc';
import * as drawers from '../settings/settingsDrawers';
import type { SettingsHost } from '../settings/settingsDrawers';
import type {
  AccountInfo,
  AgentDefItem,
  Attachment,
  ChatMessage,
  ChatState,
  ChatStatus,
  DrawerId,
  AskCard,
  GrokSettings,
  PermissionPrompt,
  PersonaItem,
  RosterEntry,
  RuleItem,
  SessionRow,
  SkillItem,
  SessionUpdate,
  SettingsPage,
  SlashCommandInfo,
  SubagentLive,
  ApiEndpoint,
  McpItem,
  ThemeColors,
  WorktreeItem,
  PluginItem,
  HookItem,
  MarketplacePlugin,
  WorkflowItem,
  TaskItem,
  MemoryFile,
} from '../core/types';
import { sessionPermissionMeta } from '../core/permissions';
import { disposeAllTerminals } from '../agent/acpTerminal';
import { AGENT_RECONNECT_MAX, reconnectDelayMs } from '../agent/reconnect';
import { workspaceStartupHints } from '../core/runtime/startup';
import { DEFAULT_THEME, normalizeTheme } from '../settings/theme';
import { listApiEndpoints } from '../models/apiEndpoints';
import {
  DEFAULT_REMOTE_PORT,
  RemoteGateway,
  clampRemotePort,
  normalizePublicUrl,
  remoteBindHost,
  resolveRemoteAssets,
  sanitizeRemoteSecret,
  type RemotePairMode,
} from '../remote/remoteGateway';
import {
  pushWorkspaceFile,
  pushWorkspaceIndex,
  mutateWorkspace,
  saveWorkspaceFile,
  type WorkspaceBus,
} from '../hosts/workspace/workspaceHost';
import {
  advertisedPublicUrl,
  clampSshPort,
  DEFAULT_FORWARD_PORT,
  DEFAULT_PUBLIC_USER,
  DEFAULT_SSH_PORT,
  ReverseTunnel,
  DEFAULT_PUBLIC_HOST,
  ensureTunnelIdentity,
  resolveForwardPort,
  parseRelayEndpoint,
  resolvePublicHost,
  sanitizeTunnelUser,
} from '../remote/remoteTunnel';
import { BUNDLED_RELAY_TOKEN, PublicRelay } from '../remote/publicRelay';
import type { RemoteAccessInfo } from '../core/types';
import type { NotifyCue } from '../core/runtime/notify';
import {
  goalDelivered,
  parseGoalWireStatus,
  pauseGoalClock,
  resumeGoalClock,
  type GoalState,
} from './goal';
import { emptyParked, overlayLiveSessions, type ParkedSession } from './liveSessions';

export class GrokController implements SlashRuntime, SettingsHost, ReverseHost {
  agent?: GrokAgent;
  status: ChatStatus = 'connecting';
  messages: ChatMessage[] = [];
  attachments: Attachment[] = [];
  queue: string[] = [];
  goal?: GoalState;
  compactMode = false;
  timestamps = false;
  multiline = false;
  private notify?: NotifyCue;
  settingsOpen = false;
  settingsPage: SettingsPage = 'main';
  apiEditId?: string;
  rules: RuleItem[] = [];
  skills: SkillItem[] = [];
  apis: ApiEndpoint[] = [];
  mcps: McpItem[] = [];
  agents: AgentDefItem[] = [];
  personas: PersonaItem[] = [];
  roster: RosterEntry[] = [];
  subagents: SubagentLive[] = [];
  agentProfile?: string;
  worktrees: WorktreeItem[] = [];
  plugins: PluginItem[] = [];
  ogPlugins: OgPluginInfo[] = [];
  hooks: HookItem[] = [];
  marketplace: MarketplacePlugin[] = [];
  workflows: WorkflowItem[] = [];
  tasks: TaskItem[] = [];
  memoryFiles: MemoryFile[] = [];
  extTab: 'plugins' | 'marketplace' | 'hooks' | 'workflows' = 'plugins';
  theme: ThemeColors = DEFAULT_THEME;
  private remote?: RemoteGateway;
  private remoteWatch: Array<{ dispose(): void }> = [];
  private remoteLocal = false;
  private remotePublic = false;
  private remotePort = DEFAULT_REMOTE_PORT;
  private remotePublicUrl = '';
  private remoteHost = '';
  private remoteUser = DEFAULT_PUBLIC_USER;
  private remoteSshPort = DEFAULT_SSH_PORT;
  private remoteForwardPort = DEFAULT_FORWARD_PORT;
  private remoteCodeMode: RemotePairMode = 'random';
  private remoteCustomCode = '';
  private remoteRelayKind: 'official' | 'custom' = 'official';
  private remoteRelayKey = '';
  private remoteRelayPort = 80;
  private readonly tunnel = new ReverseTunnel();
  private readonly relay = new PublicRelay();
  history?: string[];
  drawer?: DrawerId;
  drawerTab?: string;
  drawerBody?: string;
  fileHits?: Array<{ path: string; label: string }>;
  private error?: string;
  private account?: AccountInfo;
  billing?: BillingQuota;
  billingLoading = false;
  private billingSeq = 0;
  private billingTimer?: ReturnType<typeof setInterval>;
  heatmap: HeatmapDay[] = [];
  heatmapLongestSecs = 0;
  heatmapLoading = false;
  private heatmapSeq = 0;
  private loginView?: ChatState['login'];
  models?: ChatState['models'];
  permission?: PermissionPrompt;
  ask?: AskCard;
  askPending?: PendingAsk;
  private cliPath?: string;
  private agentVersion?: string;
  modeId = 'default';
  private commands: SlashCommandInfo[] = FALLBACK_COMMANDS;
  sessions?: SessionRow[];
  currentSessionId?: string;
  private readonly parked = new Map<string, ParkedSession>();
  private sessionCwd?: string;
  private restoringSession = false;
  private replaying = false;
  private authSeq = 0;
  turn = 0;
  private starting?: Promise<void>;
  private wantAgent = false;
  private reconnectFails = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly listeners = new Set<(state: ChatState) => void>();
  private readonly extraUi = new Set<(msg: unknown) => void>();
  private readonly streamListeners = new Set<(tail: import('../core/types').StreamTail) => void>();
  private emitTimer?: ReturnType<typeof setTimeout>;
  private streamCursor: StreamDeltaCursor = emptyStreamCursor();
  private streamPosted = false;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private searchSeq = 0;
  modelsReloadSeq = 0;
  lastApiMutation?: { id: string; at: number };
  private pendingModelId?: string;
  private pendingEffort?: string;
  private catalogModels?: ChatState['models'];
  apisLoaded = false;
  /** grok.com / cached_token id to restore after a relay turn used xai.api_key. */
  private sessionAuthMethodId?: string;
  private runGen = 0;
  private goalFinishTimer?: ReturnType<typeof setTimeout>;
  private agentGen = 0;
  private sessionOp = 0;
  private hideSessionPreview = false;
  private skipInteractiveLogin = false;
  dashSeq = 0;
  dashTimer?: ReturnType<typeof setTimeout>;
  taskSeq = 0;
  taskTimer?: ReturnType<typeof setTimeout>;
  cronJobs: CronJob[] = [];
  private cronTimer?: ReturnType<typeof setInterval>;
  private cronBusy = false;
  private readonly disposables: Array<{ dispose(): void }> = [];
  readonly journal: EditJournal;
  private readonly workspaceImages = new Map<string, WorkspaceImage>();
  private readonly rescuedImages = new Set<string>();
  readonly meter: ContextMeter;

  constructor(host?: Platform) {
    if (host) {
      bindPlatform(host);
    }
    bindOgPostToUi((payload) => {
      for (const fn of this.extraUi) {
        fn(payload);
      }
    });
    this.compactMode = Boolean(plat().getState('ui.compactMode', false));
    this.timestamps = plat().getState('ui.timestamps', true);
    this.multiline = Boolean(plat().getState('ui.multiline', false));
    this.theme = normalizeTheme(plat().getState('ui.theme', DEFAULT_THEME));
    const profile = plat().getState('ui.agentProfile', '');
    this.agentProfile = typeof profile === 'string' && profile.trim() ? profile.trim() : undefined;
    this.skipInteractiveLogin = Boolean(plat().getState('ui.skipLogin', false));
    this.pendingModelId = savedPickerId(plat().getState('ui.modelId', ''));
    this.pendingEffort = savedPickerEffort(plat().getState('ui.effort', ''));
    this.remotePort = clampRemotePort(plat().getState('ui.remotePort', DEFAULT_REMOTE_PORT));
    this.remoteHost = resolvePublicHost(plat().getState('ui.remoteHost', ''));
    this.remoteUser = sanitizeTunnelUser(plat().getState('ui.remoteSshUser', DEFAULT_PUBLIC_USER));
    this.remoteSshPort = clampSshPort(plat().getState('ui.remoteSshPort', DEFAULT_SSH_PORT));
    this.remoteForwardPort = resolveForwardPort(plat().getState('ui.remoteForwardPort', DEFAULT_FORWARD_PORT));
    const relayKind = plat().getState('ui.remoteRelayKind', '');
    this.remoteRelayKind = relayKind === 'custom' ? 'custom' : 'official';
    this.remoteRelayKey = String(plat().getState('ui.remoteRelayKey', '') ?? '').trim();
    this.remoteRelayPort = clampSshPort(plat().getState('ui.remoteRelayPort', 8788));
    const savedUrl = normalizePublicUrl(plat().getState('ui.remotePublicUrl', ''));
    this.remotePublicUrl =
      savedUrl === advertisedPublicUrl(this.remoteHost, 8787) ? '' : savedUrl;
    this.remoteCodeMode = plat().getState('ui.remoteCodeMode', 'random') === 'custom' ? 'custom' : 'random';
    this.remoteCustomCode = sanitizeRemoteSecret(plat().getState('ui.remoteCustomCode', ''));
    this.cronJobs = readCronJobs(plat().getState(CRON_STATE_KEY, []));
    this.startCronTimer();
    this.disposables.push(this.tunnel.onChange(() => this.emit()));
    this.disposables.push(this.relay.onChange(() => this.emit()));
    this.journal = new EditJournal({
      messages: () => this.messages,
      replaying: () => this.replaying,
      cwd: () => this.cwd(),
      sessionId: () => this.currentSessionId,
      displayPath: (filePath) => this.displayPath(filePath),
      emit: () => this.emit(),
    });
    this.meter = new ContextMeter({
      replaying: () => this.replaying,
      fetchInfo: async () => this.agent?.sessionInfo() ?? {},
      emit: () => this.emit(),
    });
    this.disposables.push(
      plat().onTrustChange(() => {
        if (this.wantAgent) {
          void this.start();
        }
      }),
      plat().onConfigChange(() => {
        this.emit();
      }),
    );
  }

  dispose(): void {
    this.wantAgent = false;
    abortClientRpcs(this, 'cancel');
    this.flushEmitTimer();
    drawers.stopDashboardPoll(this);
    drawers.stopTaskPoll(this);
    this.stopBillingPoll();
    this.stopCronTimer();
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = undefined;
    }
    this.clearReconnectTimer();
    this.reconnectFails = 0;
    this.dropAgent();
    void this.stopRemoteAccess();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  onDidChange(listener: (state: ChatState) => void): { dispose(): void } {
    this.listeners.add(listener);
    listener(this.snapshot());
    return { dispose: () => this.listeners.delete(listener) };
  }

  onDidStream(listener: (tail: import('../core/types').StreamTail) => void): { dispose(): void } {
    this.streamListeners.add(listener);
    return { dispose: () => this.streamListeners.delete(listener) };
  }

  onDidExtraUi(listener: (msg: unknown) => void): { dispose(): void } {
    this.extraUi.add(listener);
    return { dispose: () => this.extraUi.delete(listener) };
  }

  snapshot(opts?: { messages?: 'all' | 'none' | 'tail' }): ChatState {
    const settings = readGrokSettings();
    const mode = opts?.messages ?? 'all';
    const source =
      mode === 'none' ? [] : mode === 'tail' ? this.messages.slice(-2) : this.messages;
    return {
      status: this.status,
      error: this.error,
      cliPath: this.cliPath,
      cliInstallHint: installHint(process.platform),
      account: this.account,
      billing: this.billing,
      billingLoading: this.billingLoading,
      heatmap: this.heatmap,
      heatmapLongestSecs: this.heatmapLongestSecs,
      heatmapLoading: this.heatmapLoading,
      login: this.loginView,
      models: this.models,
      modeId: this.modeId,
      messages: source.map((message) => ({
        ...message,
        tools: message.tools.map((tool) => ({ ...tool })),
        steps: message.steps?.map((step) => ({ ...step })),
        edits: message.edits?.length ? publicEdits(message.edits) : message.edits,
      })),
      mergeTranscript: mode !== 'all',
      permission: this.permission,
      ask: this.ask,
      attachments: this.attachments,
      agentVersion: this.agentVersion,
      commands: this.commands,
      sessions: this.overlaySessionCwd(
        overlayLiveSessions(
          this.sessions,
          this.currentSessionId,
          this.status,
          this.parked,
        ),
      ),
      history: this.history,
      drawer: this.drawer,
      drawerTab: this.drawerTab,
      drawerBody: this.drawerBody,
      fileHits: this.fileHits,
      compactMode: this.compactMode,
      timestamps: this.timestamps,
      goal: this.goal,
      multiline: this.multiline,
      queue: this.queue,
      currentSessionId: this.currentSessionId,
      restoringSession: this.restoringSession,
      hideSessionPreview: this.hideSessionPreview,
      workspacePath: this.cwd(),
      sessionCwd: this.sessionCwd ?? this.cwd(),
      alwaysApprove: settings.alwaysApprove,
      notify: this.notify,
      locale: uiLocale(),
      context: this.meter.usage,
      settings,
      settingsOpen: this.settingsOpen,
      settingsPage: this.settingsPage,
      apiEditId: this.apiEditId,
      rules: this.rules,
      skills: this.skills,
      apis: this.apis,
      mcps: this.mcps,
      agents: this.agents,
      personas: this.personas,
      roster: this.roster,
      subagents: this.subagents,
      agentProfile: this.agentProfile,
      worktrees: this.worktrees,
      plugins: this.plugins,
      ogPlugins: publicOgPlugins(this.ogPlugins),
      hooks: this.hooks,
      marketplace: this.marketplace,
      workflows: this.workflows,
      tasks: this.tasks,
      cronJobs: this.cronJobs,
      memoryFiles: this.memoryFiles,
      extTab: this.extTab,
      theme: drawers.themeForUi(this.theme),
      hostChrome: plat().hostChrome?.(),
      remote: this.remoteInfo(),
    };
  }

  async start(): Promise<void> {
    this.wantAgent = true;
    if (this.agent) {
      this.emit();
      return;
    }
    this.clearReconnectTimer();
    if (this.starting) {
      return this.starting;
    }
    this.reconnectFails = 0;
    return this.beginStart();
  }

  private beginStart(): Promise<void> {
    const run = this.startInner().finally(() => {
      if (this.starting === run) {
        this.starting = undefined;
      }
    });
    this.starting = run;
    return run;
  }

  private async ensureAgent(): Promise<void> {
    if (this.agent) {
      return;
    }
    await this.start();
  }

  async restart(): Promise<void> {
    this.wantAgent = true;
    this.runGen += 1;
    this.sessionOp += 1;
    this.reconnectFails = 0;
    abortClientRpcs(this, 'cancel');
    this.queue = [];
    this.dropAgent();
    this.messages = [];
    this.journal.clear();
    this.workspaceImages.clear();
    this.rescuedImages.clear();
    await this.beginStart();
  }

  async newSession(): Promise<void> {
    this.sessionOp += 1;
    this.parkForeground();
    this.clearGoalFinishTimer();
    this.goal = undefined;
    this.agent?.clearSession();
    this.messages = [];
    this.journal.clear();
    this.workspaceImages.clear();
    this.rescuedImages.clear();
    this.drawer = undefined;
    drawers.stopDashboardPoll(this);
    this.replaying = false;
    this.restoringSession = false;
    this.hideSessionPreview = true;
    this.currentSessionId = undefined;
    this.sessionCwd = undefined;
    this.permission = undefined;
    this.ask = undefined;
    this.attachments = [];
    this.queue = [];
    this.error = undefined;
    this.setStatus('ready');
  }

  async login(): Promise<void> {
    if (!this.agent) {
      await this.start();
    }
    const agent = this.agent;
    if (!agent) {
      return;
    }
    const methods = agent.authMethods();
    const interactive = findInteractiveAuthMethod(methods);
    if (!interactive) {
      this.fail('No browser login method is available. Set an API key instead.');
      return;
    }
    const requestSeq = ++this.authSeq;
    this.loginView = { label: interactive.name };
    this.setStatus('authenticating');
    const authPromise = agent.authenticate(interactive.id, {
      use_oauth: true,
      request_seq: requestSeq,
      force_interactive: true,
    });
    void this.openAuthUrl(agent);
    try {
      await authPromise;
      this.account = await agent.authInfo().catch(() => undefined);
      this.sessionAuthMethodId =
        this.account?.methodId && isSessionAuthMethod(this.account.methodId)
          ? this.account.methodId
          : interactive.id;
      await this.createSession(agent);
      this.loginView = undefined;
      this.setStatus('ready');
      this.refreshBilling();
      void this.refreshSessionsSilent();
      plat().info('Signed in to Grok Build.');
    } catch (error) {
      if (this.status === 'authenticating') {
        this.loginView = { ...this.loginView, label: interactive.name };
        this.fail('Sign-in did not complete', error);
        this.status = 'login';
        this.emit();
      }
    }
  }

  async useApiLogin(): Promise<void> {
    await this.skipLogin();
    this.openApis();
  }

  async skipLogin(): Promise<void> {
    this.skipInteractiveLogin = true;
    void plat().setState('ui.skipLogin', true);
    try {
      await this.agent?.cancelAuth(this.authSeq);
    } catch (error) {
      logWarn(`cancel auth: ${error instanceof Error ? error.message : error}`);
    }
    const agent = this.agent;
    if (!agent) {
      await this.start();
      return;
    }
    try {
      await this.enterReady(agent, this.agentGen);
    } catch (error) {
      this.fail('Could not start without sign-in', error);
    }
  }

  async cancelLogin(): Promise<void> {
    try {
      await this.agent?.cancelAuth(this.authSeq);
    } catch (error) {
      logWarn(`cancel auth: ${error instanceof Error ? error.message : error}`);
    }
    this.status = 'login';
    this.error = undefined;
    this.emit();
  }

  async submitAuthCode(code: string): Promise<void> {
    try {
      await this.agent?.submitAuthCode(code.trim());
    } catch (error) {
      this.fail('Could not submit the login code', error);
    }
  }

  async openLoginUrl(): Promise<void> {
    const url = this.loginView?.url;
    if (url) {
      await plat().openExternal(url);
    }
  }

  async logout(): Promise<void> {
    try {
      await this.agent?.logout();
    } catch (error) {
      logError('logout failed', error);
    }
    abortClientRpcs(this, 'cancel');
    this.account = undefined;
    this.sessionAuthMethodId = undefined;
    this.billing = undefined;
    this.billingLoading = false;
    this.billingSeq += 1;
    this.stopBillingPoll();
    this.messages = [];
    this.journal.clear();
    this.status = 'login';
    this.emit();
  }

  async setApiKey(key?: string): Promise<void> {
    const value =
      key ??
      (await plat().input('xAI API key', {
        prompt: 'Paste an API key from console.x.ai',
        password: true,
      }));
    if (!value) {
      return;
    }
    if (!this.agent) {
      await this.start();
    }
    const agent = this.agent;
    if (!agent) {
      return;
    }
    try {
      await agent.setApiKey(value.trim());
      await agent.authenticate('xai.api_key');
      this.account = await agent.authInfo().catch(() => ({ methodId: 'xai.api_key' }));
      await this.createSession(agent);
      this.status = 'ready';
      this.error = undefined;
      this.refreshBilling();
      this.emit();
    } catch (error) {
      this.fail('API key sign-in failed', error);
    }
  }

  async send(text: string, opts?: { hidden?: boolean }): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && this.attachments.length === 0) {
      return;
    }
    await this.ensureAgent();
    const action = classifySlash(trimmed);
    if (action.kind !== 'pass') {
      await this.runHostAction(action);
      return;
    }
    const agent = this.agent;
    if (!agent || (this.status !== 'ready' && this.status !== 'streaming')) {
      return;
    }
    if (!agent.sessionId) {
      try {
        await this.createSession(agent);
        this.currentSessionId = agent.sessionId;
      } catch (error) {
        this.fail('Could not create a session', error);
        return;
      }
    }
    const sid = agent.sessionId;
    if (!sid) {
      return;
    }
    if (this.status === 'streaming') {
      if (this.modeId === 'goal') {
        return;
      }
      this.queue = [...this.queue, trimmed];
      this.emit();
      return;
    }
    let outgoing = trimmed;
    if (this.modeId === 'goal' && !opts?.hidden && !trimmed.startsWith('/goal')) {
      outgoing = this.prepareGoalPrompt(trimmed);
      this.emit();
    }
    await this.applySelectedCustomModel(agent);
    this.error = undefined;
    const run = ++this.runGen;
    const blocks = await buildPromptBlocks(outgoing, this.attachments);
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `user-${++this.turn}`,
      role: 'user',
      text: trimmed || this.attachments.map((item) => item.label).join(', '),
      tools: [],
      createdAt: now,
      images: this.attachments
        .filter((item) => item.data && item.mimeType?.startsWith('image/'))
        .map((item) => ({
          mimeType: item.mimeType ?? 'image/png',
          data: item.data,
        })),
    };
    const assistant: ChatMessage = {
      id: `assistant-${this.turn}`,
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      streaming: true,
      createdAt: now,
      ...this.turnModelFields(),
    };
    this.messages = opts?.hidden
      ? [...this.messages, assistant]
      : [...this.messages, userMessage, assistant];
    void persistTurnModels(this.currentSessionId ?? sid, this.messages);
    this.attachments = [];
    this.setStatus('streaming');
    try {
      await agent.prompt(blocks, { mode: promptModeMeta(this.modeId) }, sid);
    } catch (error) {
      if (!this.runBelongs(sid, run)) {
        return;
      }
      if (isCancelError(error)) {
        this.endTurnOn(sid);
        return;
      }
      this.failOn(sid, tr('turnError'), error);
      return;
    }
    if (!this.runBelongs(sid, run)) {
      return;
    }
    this.endTurnOn(sid, 'done');
    if (this.currentSessionId === sid) {
      await this.flushQueue();
    }
  }

  cancelTurn(): void {
    const pauseGoal = this.modeId === 'goal' && this.goal?.status === 'running';
    this.clearGoalFinishTimer();
    this.runGen += 1;
    abortClientRpcs(this, 'cancel');
    this.agent?.cancelTurn();
    this.queue = [];
    if (this.status === 'streaming') {
      this.endStreaming();
    }
    if (pauseGoal) {
      this.pauseActiveGoal();
      void this.nudgeGoalSlash('pause');
    }
  }

  async pauseGoal(): Promise<void> {
    if (!this.goal || this.goal.status !== 'running') {
      return;
    }
    if (this.status === 'streaming') {
      this.cancelTurn();
      return;
    }
    this.pauseActiveGoal();
    void this.nudgeGoalSlash('pause');
    this.emit();
  }

  async resumeGoal(): Promise<void> {
    if (!this.goal || this.goal.status !== 'paused') {
      return;
    }
    this.goal = resumeGoalClock(this.goal);
    this.emit();
    await this.send('/goal resume', { hidden: true });
  }

  async clearGoal(): Promise<void> {
    this.clearGoalFinishTimer();
    if (this.status === 'streaming') {
      this.runGen += 1;
      abortClientRpcs(this, 'cancel');
      this.agent?.cancelTurn();
      this.endStreaming();
    }
    const had = Boolean(this.goal);
    this.goal = undefined;
    this.emit();
    if (had) {
      void this.nudgeGoalSlash('clear');
    }
  }

  async editGoal(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (this.status === 'streaming') {
      this.runGen += 1;
      abortClientRpcs(this, 'cancel');
      this.agent?.cancelTurn();
      this.endStreaming();
    }
    this.goal = undefined;
    await this.send(trimmed);
  }

  private prepareGoalPrompt(text: string): string {
    if (!this.goal) {
      this.goal = { text, status: 'running', startedAt: Date.now(), elapsedMs: 0 };
      return `/goal ${text}`;
    }
    if (this.goal.status === 'paused') {
      this.goal = resumeGoalClock(this.goal);
      return text ? `/goal resume\n${text}` : '/goal resume';
    }
    return text;
  }

  private pauseActiveGoal(): void {
    if (this.goal?.status === 'running') {
      this.goal = pauseGoalClock(this.goal);
    }
  }

  private async nudgeGoalSlash(verb: 'pause' | 'resume' | 'clear'): Promise<void> {
    const agent = this.agent;
    if (!agent?.sessionId) {
      return;
    }
    try {
      await agent.prompt([{ type: 'text', text: `/goal ${verb}` }], { mode: 'agent' });
    } catch {
      /* CLI may already have stopped. */
    }
  }

  private clearGoalFinishTimer(): void {
    if (this.goalFinishTimer) {
      clearTimeout(this.goalFinishTimer);
      this.goalFinishTimer = undefined;
    }
  }

  private applyGoalUpdated(update: SessionUpdate): void {
    const wire = parseGoalWireStatus(update.status);
    if (!wire) {
      return;
    }
    if (wire === 'done') {
      void this.finishGoal({ stopLoop: false });
      return;
    }
    this.clearGoalFinishTimer();
    if (wire === 'paused') {
      this.pauseActiveGoal();
      this.emit();
      return;
    }
    const text = update.objective?.trim() || this.goal?.text || '';
    if (!this.goal) {
      this.goal = { text, status: 'running', startedAt: Date.now(), elapsedMs: 0 };
    } else if (this.goal.status === 'paused') {
      this.goal = resumeGoalClock({ ...this.goal, text: text || this.goal.text });
    } else if (text && text !== this.goal.text) {
      this.goal = { ...this.goal, text };
    }
    this.emit();
  }

  private maybeFinishGoalFromWork(): void {
    if (this.modeId !== 'goal' || this.goal?.status !== 'running') {
      this.clearGoalFinishTimer();
      return;
    }
    const last = this.messages.filter((item) => item.role === 'assistant').at(-1);
    if (!goalDelivered(last?.steps, last?.text)) {
      this.clearGoalFinishTimer();
      return;
    }
    if (this.goalFinishTimer) {
      return;
    }
    this.goalFinishTimer = setTimeout(() => {
      this.goalFinishTimer = undefined;
      void this.finishGoal({ stopLoop: true });
    }, 1200);
  }

  private async finishGoal(opts: { stopLoop: boolean }): Promise<void> {
    this.clearGoalFinishTimer();
    if (!this.goal) {
      return;
    }
    if (opts.stopLoop && this.status === 'streaming') {
      this.runGen += 1;
      abortClientRpcs(this, 'cancel');
      this.agent?.cancelTurn();
    }
    this.goal = undefined;
    if (this.status === 'streaming') {
      this.endStreaming();
    } else {
      this.emit();
    }
    if (opts.stopLoop) {
      void this.nudgeGoalSlash('clear');
    }
  }

  async choosePermission(optionId: string): Promise<void> {
    await choosePermissionRpc(this, optionId);
  }

  cancelPermission(): void {
    cancelPermissionRpc(this);
  }

  async askUserQuestion(params: unknown): Promise<unknown> {
    return askUserQuestionRpc(this, params);
  }

  async reviewPlan(params: unknown): Promise<unknown> {
    return reviewPlanRpc(this, params);
  }

  answerAsk(choiceIds: string[], notes?: string): void {
    answerAskRpc(this, choiceIds, notes);
  }

  cancelAsk(): void {
    cancelAskRpc(this);
  }

  private dropAgent(): void {
    this.agentGen += 1;
    this.clearReconnectTimer();
    const agent = this.agent;
    this.agent = undefined;
    try {
      agent?.dispose();
    } catch {
      /* already dead */
    }
    disposeAllTerminals();
    this.parked.clear();
  }

  private parkForeground(): void {
    const id = this.currentSessionId;
    if (!id) {
      return;
    }
    this.parked.set(id, {
      id,
      cwd: this.sessionCwd,
      messages: this.messages,
      turn: this.turn,
      status: this.status,
      error: this.error,
      goal: this.goal,
      modeId: this.modeId,
      attachments: this.attachments,
      queue: this.queue,
      runGen: this.runGen,
      permission: this.permission,
      ask: this.ask,
    });
  }

  private restoreParked(id: string): void {
    const row = this.parked.get(id);
    if (!row) {
      return;
    }
    this.parked.delete(id);
    this.currentSessionId = id;
    this.sessionCwd = row.cwd;
    this.messages = row.messages;
    this.turn = row.turn;
    this.error = row.error;
    this.goal = row.goal;
    this.modeId = row.modeId;
    this.attachments = row.attachments;
    this.queue = row.queue;
    this.runGen = row.runGen;
    this.permission = row.permission;
    this.ask = row.ask;
    this.status = row.status === 'streaming' ? 'streaming' : 'ready';
  }

  private runBelongs(sid: string, run: number): boolean {
    if (this.currentSessionId === sid) {
      return this.runGen === run;
    }
    return this.parked.get(sid)?.runGen === run;
  }

  private endTurnOn(sid: string, cue?: NotifyCue): void {
    if (this.currentSessionId === sid) {
      this.endStreaming(cue);
      return;
    }
    const row = this.parked.get(sid);
    if (!row) {
      return;
    }
    const assistant = row.messages.filter((item) => item.role === 'assistant').at(-1);
    if (assistant) {
      assistant.streaming = false;
      freezeTurnSteps(assistant);
    }
    row.status = 'ready';
    void persistTurnModels(sid, row.messages);
    this.emit();
  }

  private failOn(sid: string, message: string, error?: unknown): void {
    if (this.currentSessionId === sid) {
      this.fail(message, error);
      return;
    }
    const parsed = error !== undefined ? formatAgentError(error) : { message };
    const line =
      parsed.message === message ? formatErrorLine(parsed) : `${message}: ${formatErrorLine(parsed)}`;
    const row = this.parked.get(sid);
    if (!row) {
      return;
    }
    row.error = line;
    row.status = 'ready';
    const assistant = row.messages.filter((item) => item.role === 'assistant').at(-1);
    if (assistant) {
      assistant.error = parsed;
      assistant.streaming = false;
      freezeTurnSteps(assistant);
    }
    this.emit();
  }

  private applyBackgroundUpdate(sessionId: string, update: SessionUpdate, isReplay: boolean): void {
    let row = this.parked.get(sessionId);
    if (!row) {
      row = emptyParked(sessionId);
      this.parked.set(sessionId, row);
    }
    const parked = row;
    const view = {
      replaying: isReplay,
      replayUpdate: isReplay,
      messages: parked.messages,
      nextTurn: () => {
        parked.turn += 1;
        return parked.turn;
      },
      modeId: parked.modeId,
      models: this.models,
      commands: this.commands,
      meter: this.meter,
      rememberFile: async () => {},
      capturePrevious: () => {},
      displayPath: (filePath: string) => this.displayPath(filePath),
      emitUnlessReplaying: () => this.emit(),
      termEncoding: readGrokSettings().termEncoding,
    };
    applySessionUpdate(view, update);
    parked.modeId = view.modeId;
    if (update.sessionUpdate === 'goal_updated') {
      const wire = parseGoalWireStatus(update.status);
      if (wire === 'done') {
        parked.goal = undefined;
      } else if (wire === 'paused' && parked.goal) {
        parked.goal = pauseGoalClock(parked.goal);
      }
    }
    const last = parked.messages.filter((item) => item.role === 'assistant').at(-1);
    if (last?.streaming) {
      parked.status = 'streaming';
    }
    this.emit();
  }

  private async adoptBackgroundSessions(): Promise<void> {
    try {
      const roster = (await this.agent?.listRoster()) ?? [];
      this.roster = roster;
      for (const item of roster) {
        if (item.id === this.currentSessionId) {
          continue;
        }
        if (item.activity !== 'working' && item.activity !== 'needs_input') {
          continue;
        }
        if (this.parked.has(item.id)) {
          continue;
        }
        const stub = emptyParked(item.id, item.cwd);
        stub.status = item.activity === 'working' ? 'streaming' : 'ready';
        this.parked.set(item.id, stub);
      }
      this.emit();
    } catch (error) {
      logWarn(`adopt sessions: ${error instanceof Error ? error.message : error}`);
    }
  }

  private onAgentLost(epoch: number, error: Error): void {
    if (epoch !== this.agentGen) {
      return;
    }
    this.agent = undefined;
    abortClientRpcs(this, 'cancel');
    disposeAllTerminals();
    this.agentGen += 1;
    if (!this.wantAgent) {
      return;
    }
    void this.afterAgentLost(error);
  }

  private async afterAgentLost(error: Error): Promise<void> {
    const quarantined = await drawers.quarantineRecentApi(this);
    if (quarantined) {
      this.reconnectFails = 0;
    }
    this.scheduleReconnect(error);
  }

  respawnAgent(): void {
    abortClientRpcs(this, 'cancel');
    this.reconnectFails = 0;
    this.dropAgent();
    if (this.wantAgent && !this.starting) {
      void this.beginStart();
    }
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private scheduleReconnect(error: Error): void {
    if (this.status === 'streaming') {
      this.endStreaming('fail');
    }
    this.reconnectFails += 1;
    const delay = reconnectDelayMs(this.reconnectFails);
    if (delay === undefined) {
      logWarn(`agent exited, giving up after ${this.reconnectFails} attempts: ${error.message}`);
      this.fail(tr('agentExitedGiveUp'), error);
      return;
    }
    logWarn(
      `agent exited, retry ${this.reconnectFails}/${AGENT_RECONNECT_MAX} in ${delay}ms: ${error.message}`,
    );
    this.error = tr('agentExited');
    this.emit();
    this.clearReconnectTimer();
    const epoch = this.agentGen;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.wantAgent || epoch !== this.agentGen || this.agent || this.starting) {
        return;
      }
      void this.beginStart();
    }, delay);
  }

  addSelection(): void {
    addSelection(this);
  }

  addActiveFile(): void {
    addActiveFile(this);
  }

  quoteText(text: string): void {
    quoteText(this, text);
  }

  async addFiles(paths: string[]): Promise<void> {
    for (const filePath of paths) {
      if (filePath.trim()) {
        await attachPath(this, filePath);
      }
    }
    plat().focusChat();
  }

  removeAttachment(id: string): void {
    removeAttachment(this, id);
  }

  async attachFromUi(): Promise<void> {
    await attachFromUi(this);
  }

  async pasteClipboard(payload: {
    text?: string;
    uris?: string[];
    images?: Array<{ name: string; mimeType: string; data: string }>;
    files?: Array<{ name: string; mimeType?: string; text?: string }>;
  }): Promise<void> {
    await pasteClipboard(this, payload);
  }

  pickFile(filePath: string): void {
    void attachPath(this, filePath);
  }

  async setEffort(level: string): Promise<void> {
    if (this.busyTurn()) {
      return;
    }
    this.pendingEffort = level;
    this.patchCurrentEffort(level);
    this.persistPicker();
    const modelId = this.selectedModelId();
    if (!this.agent?.sessionId || !modelId) {
      this.emit();
      return;
    }
    try {
      await this.agent.setModel(modelId, { reasoningEffort: level });
    } catch (error) {
      logWarn(`set effort via model meta failed: ${error}`);
      await this.sendAgentSlash(`/effort ${level}`);
    }
  }

  async setModel(modelId: string): Promise<void> {
    if (this.busyTurn()) {
      return;
    }
    this.pendingModelId = modelId;
    this.persistPicker();
    if (this.catalogModels) {
      this.catalogModels = { ...this.catalogModels, currentId: modelId };
    }
    if (this.models) {
      this.models = { ...this.models, currentId: modelId };
      const effort = this.selectedEffort();
      if (effort) {
        this.applyEffortToModels(effort);
      }
      this.emit();
    }
    if (!this.agent?.sessionId) {
      return;
    }
    try {
      await this.syncAuthForModel(this.agent, modelId);
      const effort = this.selectedEffort();
      await this.agent.setModel(modelId, effort ? { reasoningEffort: effort } : undefined);
    } catch (error) {
      this.fail('Could not switch models', error);
    }
  }

  async installCli(): Promise<void> {
    plat().createTerminal('Install Grok CLI', installHint(plat().os()));
  }

  showLog(): void {
    showLog();
  }

  async cycleMode(): Promise<void> {
    if (this.busyTurn()) {
      plat().info(tr('busyLock'));
      return;
    }
    const order = ['ask', 'plan', 'default', 'goal'];
    const i = order.indexOf(this.modeId);
    const next = order[(i + 1) % order.length];
    await this.setMode(next);
  }

  async setMode(modeId: string): Promise<void> {
    if (this.busyTurn()) {
      return;
    }
    try {
      await this.applySessionMode(modeId);
    } catch (error) {
      this.fail('Could not change mode', error);
    }
  }

  async applySessionMode(modeId: string): Promise<void> {
    if (this.modeId === 'goal' && modeId !== 'goal' && this.goal) {
      await this.clearGoal();
    }
    this.modeId = modeId;
    if (modeId === 'goal') {
      this.queue = [];
      this.note(`Mode: ${modeLabel(modeId)}`);
      this.emit();
      return;
    }
    await this.agent?.setMode(modeId);
    this.note(`Mode: ${modeLabel(modeId)}`);
    this.emit();
  }

  async compact(note?: string): Promise<void> {
    if (this.status === 'streaming') {
      plat().warn(tr('compactBusy'));
      return;
    }
    const now = new Date().toISOString();
    const card: ChatMessage = {
      id: `assistant-${++this.turn}`,
      role: 'assistant',
      text: tr('compacting'),
      tools: [],
      streaming: true,
      createdAt: now,
      ...this.turnModelFields(),
    };
    this.messages = [...this.messages, card];
    this.setStatus('streaming');
    try {
      await this.agent?.compact(note);
      card.text = tr('compactDone');
      card.streaming = false;
      card.endedAt = new Date().toISOString();
      this.notify = 'done';
      this.setStatus('ready');
      this.notify = undefined;
    } catch (error) {
      this.fail(tr('compactFailed'), error);
    }
  }

  async rewind(): Promise<void> {
    try {
      const points = await this.agent?.rewindPoints();
      if (!points?.length) {
        this.note(tr('rewindEmpty'));
        return;
      }
      const picked = await plat().pick(
        tr('rewindPick'),
        points.map((point) => ({
          label: `#${point.index}`,
          description: point.preview?.slice(0, 80),
          value: point.index,
        })),
      );
      if (picked !== undefined) {
        await this.rewindTo(picked);
      }
    } catch (error) {
      this.fail('Rewind failed', error);
    }
  }

  async forkCurrent(): Promise<void> {
    const agent = this.agent;
    const sourceId = this.currentSessionId ?? agent?.sessionId;
    if (!agent || !sourceId) {
      plat().warn(tr('forkNeedSession'));
      return;
    }
    const sourceCwd = this.sessionCwd ?? this.cwd();
    try {
      let worktree = false;
      if (await isGitCwd(sourceCwd)) {
        const pick = await plat().pick(tr('forkWorktreeQ'), [
          { label: tr('forkWorktreeYes'), description: tr('forkWorktreeYesHint'), value: 'yes' },
          { label: tr('forkWorktreeNo'), description: tr('forkWorktreeNoHint'), value: 'no' },
        ]);
        if (!pick) {
          return;
        }
        worktree = pick === 'yes';
      }
      if (worktree) {
        const resumed = await agent.resumeInWorktree(sourceId, sourceCwd);
        if (!resumed?.sessionId) {
          plat().warn(tr('forkWorktreeFailed'));
          return;
        }
        await this.loadSession(resumed.sessionId, resumed.cwd || sourceCwd);
        return;
      }
      const id = await agent.forkSession({
        sourceSessionId: sourceId,
        sourceCwd,
        newCwd: sourceCwd,
        sessionKind: 'fork',
      });
      if (!id) {
        plat().warn(tr('forkFailed'));
        return;
      }
      await this.loadSession(id, sourceCwd);
    } catch (error) {
      this.fail('Fork failed', error);
    }
  }

  async renameListedSession(id?: string, title?: string, auto?: boolean): Promise<void> {
    const sessionId = id ?? this.currentSessionId;
    if (!sessionId) {
      return;
    }
    const name = auto ? '' : title ?? (await plat().input(tr('sessionsRename')));
    if (!auto && !name) {
      return;
    }
    try {
      await this.agent?.renameSession(name ?? '', Boolean(auto), sessionId);
      if (this.sessions) {
        this.sessions = this.sessions.map((row) =>
          row.id === sessionId && name ? { ...row, title: name } : row,
        );
      }
      this.emit();
      void this.refreshSessionsSilent();
      if (name) {
        this.note(tr('sessionsRenamed', { name }));
      }
    } catch (error) {
      this.fail('Rename failed', error);
    }
  }

  async deleteListedSession(id?: string): Promise<void> {
    const sessionId = id ?? this.currentSessionId;
    if (!sessionId) {
      return;
    }
    const row = this.sessions?.find((item) => item.id === sessionId);
    const ok = await plat().confirm(
      tr('sessionsDeleteConfirm', { name: row?.title ?? sessionId }),
      tr('sessionsDelete'),
    );
    if (!ok) {
      return;
    }
    try {
      await this.agent?.deleteSession(sessionId);
      await this.journal.dropSession(sessionId);
      this.parked.delete(sessionId);
      if (sessionId === this.currentSessionId) {
        this.currentSessionId = undefined;
        await this.newSession();
      }
      await this.refreshSessionsSilent();
    } catch (error) {
      this.fail('Delete failed', error);
    }
  }

  async rewindTo(index: number): Promise<void> {
    await this.agent?.rewindTo(index);
    this.messages = this.messages.slice(0, Math.max(0, index * 2));
    this.journal.trimStoredTurns();
    this.note(`Rewound to turn ${index}.`);
  }

  async rewindTurn(messageId: string): Promise<void> {
    const index = rewindIndexFor(this.messages, messageId);
    if (index === undefined) {
      return;
    }
    if (!(await plat().confirm(tr('rewindConfirm'), tr('rewindAction')))) {
      return;
    }
    if (this.status === 'streaming') {
      this.cancelTurn();
    }
    try {
      await this.rewindTo(index);
    } catch (error) {
      this.fail('Rewind failed', error);
    }
  }

  async resumePicker(): Promise<void> {
    await this.refreshSessionsSilent();
    this.drawer = 'sessions';
    this.emit();
  }

  async refreshSessionsSilent(): Promise<void> {
    try {
      this.sessions = (await this.agent?.listRecentSessions(50)) ?? [];
      this.emit();
    } catch (error) {
      logWarn(`session list: ${error instanceof Error ? error.message : error}`);
    }
  }

  async pickSessionProject(): Promise<void> {
    const picked = await plat().openFolders({ title: tr('railPickProject') });
    const folder = picked?.[0]?.trim();
    if (!folder) {
      return;
    }
    this.sessionCwd = folder;
    this.emit();
  }

  private overlaySessionCwd(rows?: SessionRow[]): SessionRow[] | undefined {
    if (!rows) {
      return rows;
    }
    const cwd = this.sessionCwd?.trim();
    const id = this.currentSessionId;
    if (!cwd || !id) {
      return rows;
    }
    return rows.map((row) => (row.id === id ? { ...row, cwd } : row));
  }

  async loadSession(sessionId: string, sessionCwd?: string): Promise<void> {
    const agent = this.agent;
    if (!agent) {
      return;
    }
    const op = ++this.sessionOp;
    this.parkForeground();
    const parked = this.parked.get(sessionId);
    if (parked && parked.messages.length > 0) {
      this.restoreParked(sessionId);
      agent.sessionId = sessionId;
      this.hideSessionPreview = false;
      this.restoringSession = false;
      this.replaying = false;
      this.emit();
      return;
    }
    this.parked.delete(sessionId);
    const cwd =
      sessionCwd ??
      this.sessions?.find((row) => row.id === sessionId)?.cwd ??
      parked?.cwd ??
      this.cwd();
    this.messages = [];
    this.journal.clear();
    this.workspaceImages.clear();
    this.rescuedImages.clear();
    this.drawer = undefined;
    drawers.stopDashboardPoll(this);
    this.hideSessionPreview = false;
    this.restoringSession = true;
    this.replaying = true;
    this.currentSessionId = sessionId;
    this.sessionCwd = cwd;
    this.emit();
    try {
      const result = await agent.loadSession(sessionId, cwd, this.sessionMeta());
      if (op !== this.sessionOp) {
        return;
      }
      this.models = this.overlayModels(modelsFromResult(result));
      this.currentSessionId = agent.sessionId ?? sessionId;
      finalizeReplayTimes(this.messages);
      applyStoredTurnModels(this.messages, readStoredTurnModels(this.currentSessionId));
      applyRestoredTurnModels(this.messages, this.models);
      this.status = 'ready';
      this.error = undefined;
      void this.journal.hydrateFromGit().then(async () => {
        await this.syncAllEditStats();
        this.emit();
        this.pushEditStats();
      });
      void this.meter.refresh();
    } catch (error) {
      if (op !== this.sessionOp) {
        return;
      }
      this.fail('Could not restore that session', error);
    } finally {
      if (op === this.sessionOp) {
        this.replaying = false;
        this.restoringSession = false;
        finalizeReplayTimes(this.messages);
        applyStoredTurnModels(this.messages, readStoredTurnModels(this.currentSessionId));
        applyRestoredTurnModels(this.messages, this.models);
        void persistTurnModels(this.currentSessionId, this.messages);
        this.emit();
      }
    }
  }

  async exportChat(): Promise<void> {
    const md = this.messages
      .map((m) => `## ${m.role === 'user' ? 'You' : 'Grok'}\n\n${m.text}`)
      .join('\n\n');
    const filePath = await plat().saveFile(path.join(this.cwd(), 'grok-session.md'));
    if (!filePath) {
      return;
    }
    await plat().writeFile(filePath, Buffer.from(md, 'utf8'));
    this.note(`Exported to ${filePath}.`);
  }

  copyLast(n = 1): void {
    const replies = this.messages.filter((m) => m.role === 'assistant' && m.text);
    const msg = replies[replies.length - n];
    if (!msg) {
      return;
    }
    void plat().clipboardWrite(msg.text);
    this.note('Copied last reply.');
  }

  async searchFiles(query: string): Promise<void> {
    const seq = ++this.searchSeq;
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    await new Promise<void>((resolve) => {
      this.searchTimer = setTimeout(resolve, 180);
    });
    if (seq !== this.searchSeq) {
      return;
    }
    const hits = await plat().findFiles(query);
    if (seq !== this.searchSeq) {
      return;
    }
    this.fileHits = hits;
    this.emit();
  }

  async undoEdits(messageId?: string): Promise<void> {
    await this.journal.revert(messageId);
  }

  async editUserPrompt(messageId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const userIdx = this.messages.findIndex((item) => item.id === messageId);
    if (userIdx < 0 || this.messages[userIdx]?.role !== 'user') {
      return;
    }
    const later = this.messages.slice(userIdx + 1);
    if (later.some((item) => item.role === 'user')) {
      return;
    }
    const assistant = later.find((item) => item.role === 'assistant');
    const userCount = this.messages.filter((item) => item.role === 'user').length;
    const rewindTo = Math.max(0, userCount - 1);
    if (this.status === 'streaming') {
      this.cancelTurn();
    }
    if (assistant?.edits?.length) {
      await this.journal.revert(assistant.id, { silent: true });
    }
    try {
      await this.agent?.rewindTo(rewindTo);
    } catch (error) {
      logWarn(`rewind before edit: ${error instanceof Error ? error.message : error}`);
    }
    this.messages = this.messages.slice(0, userIdx);
    this.emit();
    await this.send(trimmed);
  }

  async reviewEdits(messageId?: string, onlyPath?: string): Promise<void> {
    const assistant = this.journal.assistant(messageId);
    const files = await this.journal.diffs(messageId, onlyPath);
    if (
      assistant &&
      files.length > 0 &&
      !onlyPath &&
      this.journal.hasDiskSnapshot(assistant.id)
    ) {
      assistant.edits = applyDiffStats(assistant.edits ?? [], files);
      this.emit();
      this.pushEditStats(assistant.id);
    }
    if (files.length === 0) {
      if (onlyPath) {
        await this.previewFileOnRemote(onlyPath);
        try {
          await plat().openFile(onlyPath, true);
        } catch {
          /* preview already sent to the browser */
        }
      }
      plat().info(
        tr(onlyPath ? 'reviewMissing' : 'reviewEmpty', {
          name: onlyPath ? path.basename(onlyPath) : '',
        }),
      );
      return;
    }
    const payload = {
      locale: uiLocale(),
      files,
      messageId: assistant?.id,
      theme: drawers.themeForUi(this.theme),
    };
    this.remote?.broadcast({ type: 'diff', payload: { ...payload, files: slimFileDiffs(files) } });
    try {
      plat().showDiff?.({
        ...payload,
        onRevert: () => {
          void this.journal.revert(assistant?.id).then(async (result) => {
            if (result === 'cancelled' || result === 'empty') {
              return;
            }
            const still = this.journal.assistant(assistant?.id)?.edits?.length;
            if (!still) {
              return;
            }
            await this.reviewEdits(assistant?.id);
          });
        },
      });
    } catch {
      /* Remote overlay still received the payload. */
    }
  }

  async previewFileOnRemote(filePath: string): Promise<void> {
    if (!this.remote?.info().running) {
      return;
    }
    try {
      const raw = await plat().readFile(filePath);
      if (raw.byteLength > 400 * 1024) {
        this.remote.broadcast({ type: 'filePreview', path: filePath, tooLarge: true });
        return;
      }
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      if (bytes.includes(0)) {
        this.remote.broadcast({ type: 'filePreview', path: filePath, binary: true });
        return;
      }
      this.remote.broadcast({
        type: 'filePreview',
        path: filePath,
        text: new TextDecoder('utf-8').decode(bytes),
      });
    } catch {
      this.remote.broadcast({ type: 'filePreview', path: filePath, missing: true });
    }
  }

  openEdit(filePath: string, messageId?: string): void {
    void this.reviewEdits(messageId, filePath);
  }

  async listWorkspace(dir?: string): Promise<void> {
    await pushWorkspaceIndex(this.workspaceBus(), dir);
  }

  async openWorkspaceFile(relOrAbs: string): Promise<void> {
    await pushWorkspaceFile(this.workspaceBus(), relOrAbs);
  }

  async saveWorkspaceFile(relOrAbs: string, hash: string, text: string): Promise<void> {
    await saveWorkspaceFile(this.workspaceBus(), relOrAbs, hash, text);
  }

  async mutateWorkspace(op: {
    action: 'create' | 'rename' | 'delete';
    dir?: string;
    path?: string;
    name?: string;
    kind?: 'file' | 'dir';
  }): Promise<void> {
    await mutateWorkspace(this.workspaceBus(), op);
  }

  private workspaceBus(): WorkspaceBus {
    return {
      running: () => Boolean(this.remote?.info().running),
      broadcast: (payload) => {
        this.remote?.broadcast(payload);
      },
      busyFile: (filePath) => this.workspaceBusy(filePath),
    };
  }

  private workspaceBusy(filePath: string): boolean {
    if (this.status !== 'streaming') {
      return false;
    }
    const abs = (this.journal.resolvePath(filePath) ?? filePath).replace(/\\/g, '/').toLowerCase();
    for (const edit of this.journal.assistant()?.edits ?? []) {
      const other = (this.journal.resolvePath(edit.path) ?? edit.path).replace(/\\/g, '/').toLowerCase();
      if (other === abs) {
        return true;
      }
    }
    return false;
  }

  closeDrawer(): void { drawers.closeDrawer(this); }
  async openDashboard(): Promise<void> { await drawers.openDashboard(this); }
  refreshDashboard(): void { drawers.refreshDashboard(this); }
  stopRosterSession(sessionId: string): void { drawers.stopRosterSession(this, sessionId); }
  async cancelSubagent(subagentId: string): Promise<void> { await drawers.cancelSubagent(this, subagentId); }
  async dashboardDispatch(text: string, sessionId?: string): Promise<void> {
    await drawers.dashboardDispatch(this, text, sessionId);
  }
  refreshBilling(): void {
    if (!isOfficialGrokAccount(this.account) || !this.agent) {
      if (this.billing || this.billingLoading) {
        this.billing = undefined;
        this.billingLoading = false;
        this.emit();
      }
      return;
    }
    const seeded = withCachedSubscription(this.billing);
    if (seeded && seeded.subscriptionTier !== this.billing?.subscriptionTier) {
      this.billing = seeded;
      this.emit();
    } else if (!this.billing) {
      const cached = withCachedSubscription(undefined);
      if (cached) {
        this.billing = cached;
        this.emit();
      }
    }
    if (!this.billing && !this.billingLoading) {
      this.billingLoading = true;
      this.emit();
    }
    void this.pullBilling();
  }

  private startBillingPoll(): void {
    this.stopBillingPoll();
    this.billingTimer = setInterval(() => this.refreshBilling(), 60_000);
  }

  private stopBillingPoll(): void {
    if (this.billingTimer) {
      clearInterval(this.billingTimer);
      this.billingTimer = undefined;
    }
  }

  refreshHeatmap(): void {
    const seq = ++this.heatmapSeq;
    if (!this.heatmap.length) {
      this.heatmapLoading = true;
      this.emit();
    }
    void Promise.resolve()
      .then(() => loadLocalHeatmap(371))
      .then((bundle) => {
        if (seq !== this.heatmapSeq) {
          return;
        }
        this.heatmap = bundle.days;
        this.heatmapLongestSecs = bundle.longestSecs;
        this.heatmapLoading = false;
        this.emit();
      })
      .catch(() => {
        if (seq !== this.heatmapSeq) {
          return;
        }
        this.heatmapLoading = false;
        this.emit();
      });
  }

  private async pullBilling(): Promise<void> {
    if (!isOfficialGrokAccount(this.account) || !this.agent) {
      if (this.billing || this.billingLoading) {
        this.billing = undefined;
        this.billingLoading = false;
        this.emit();
      }
      return;
    }
    const seq = ++this.billingSeq;
    try {
      const parsed = withCachedSubscription(parseBilling(await this.agent.billing()));
      if (seq !== this.billingSeq) {
        return;
      }
      this.billing = parsed;
      this.billingLoading = false;
      this.emit();
    } catch (error) {
      if (seq !== this.billingSeq) {
        return;
      }
      logWarn(`billing: ${error instanceof Error ? error.message : error}`);
      this.billingLoading = false;
      this.emit();
    }
  }

  openSettings(): void { drawers.openSettings(this); }
  closeSettings(): void { drawers.closeSettings(this); }
  openRules(): void { drawers.openRules(this); }
  closeRules(): void { drawers.closeRules(this); }
  async importRules(): Promise<void> { await drawers.importRules(this); }
  async toggleRule(id: string): Promise<void> { await drawers.toggleRule(this, id); }
  async deleteRule(id: string): Promise<void> { await drawers.deleteRule(this, id); }
  openRule(id: string): void { drawers.openRule(id); }
  openSkills(): void { drawers.openSkills(this); }
  closeSkills(): void { drawers.closeSkills(this); }
  async importSkillZip(): Promise<void> { await drawers.importSkillZip(this); }
  async importSkillFolder(): Promise<void> { await drawers.importSkillFolder(this); }
  async toggleSkill(id: string): Promise<void> { await drawers.toggleSkill(this, id); }
  async deleteSkill(id: string): Promise<void> { await drawers.deleteSkill(this, id); }
  openSkill(id: string): void { drawers.openSkill(this, id); }
  openApis(): void { drawers.openApis(this); }
  closeApis(): void { drawers.closeApis(this); }
  openApiForm(id?: string): void { drawers.openApiForm(this, id); }
  closeApiForm(): void { drawers.closeApiForm(this); }
  openTheme(): void { drawers.openTheme(this); }
  closeTheme(): void { drawers.closeTheme(this); }
  openRemote(): void { drawers.openRemote(this); }
  closeRemote(): void { drawers.closeRemote(this); }
  async startRemoteAccess(
    port?: number,
    flags?: {
      local?: boolean;
      public?: boolean;
      host?: string;
      user?: string;
      sshPort?: number;
      forwardPort?: number;
      publicUrl?: string;
    },
  ): Promise<void> {
    if (port !== undefined) {
      this.remotePort = clampRemotePort(port);
      void plat().setState('ui.remotePort', this.remotePort);
    }
    this.applyTunnelFields(flags);
    if (!flags || (flags.local === undefined && flags.public === undefined)) {
      this.remoteLocal = true;
      this.remotePublic = false;
    } else {
      if (flags.local !== undefined) {
        this.remoteLocal = flags.local;
      }
      if (flags.public !== undefined) {
        this.remotePublic = flags.public;
      }
    }
    if (!this.remoteLocal && !this.remotePublic) {
      await this.stopRemoteAccess();
      return;
    }
    if (!this.remote) {
      const gateway = new RemoteGateway(resolveRemoteAssets(__filename), {
        onClientMessage: (message) => {
          void dispatchUi(this, message);
        },
        snapshot: () => this.snapshot(),
        onClients: () => {
          this.emit();
          if ((this.remote?.info().clients ?? 0) > 0) {
            void this.listWorkspace();
          }
        },
      });
      this.remote = gateway;
      this.remoteWatch = [
        this.onDidChange((state) =>
          gateway.broadcast({ type: 'state', state, merge: Boolean(state.mergeTranscript) }),
        ),
        this.onDidStream((tail) => gateway.broadcast(tail)),
      ];
    }
    this.syncPairSecret();
    try {
      await this.remote.apply({
        port: this.remotePort,
        local: this.remoteLocal,
        public: this.remotePublic,
        publicUrl: this.effectivePublicUrl(),
      });
    } catch (error) {
      this.syncTunnel();
      this.emit();
      logWarn(`remote listen: ${error instanceof Error ? error.message : error}`);
      return;
    }
    this.syncTunnel();
    logInfo(`remote access on ${this.remote.info().bind}:${this.remote.info().port}`);
    this.emit();
  }
  async stopRemoteAccess(): Promise<void> {
    this.remoteLocal = false;
    this.remotePublic = false;
    this.tunnel.stop();
    this.relay.stop();
    for (const d of this.remoteWatch.splice(0)) {
      d.dispose();
    }
    const gw = this.remote;
    this.remote = undefined;
    if (gw) {
      await gw.stop();
    }
    this.emit();
  }
  async setRemotePublicUrl(url: string): Promise<void> {
    this.remotePublicUrl = normalizePublicUrl(url);
    void plat().setState('ui.remotePublicUrl', this.remotePublicUrl);
    if (this.remote && (this.remoteLocal || this.remotePublic)) {
      await this.remote.apply({
        port: this.remotePort,
        local: this.remoteLocal,
        public: this.remotePublic,
        publicUrl: this.effectivePublicUrl(),
      });
    }
    this.emit();
  }
  setRemoteRelay(fields: {
    kind?: 'official' | 'custom';
    host?: string;
    port?: number;
    key?: string;
  }): void {
    if (fields.kind === 'official' || fields.kind === 'custom') {
      this.remoteRelayKind = fields.kind;
      void plat().setState('ui.remoteRelayKind', fields.kind);
    }
    if (fields.host !== undefined) {
      const parsed = parseRelayEndpoint(fields.host);
      this.remoteHost = parsed.host;
      this.remoteRelayPort = parsed.port;
      void plat().setState('ui.remoteHost', this.remoteHost);
      void plat().setState('ui.remoteRelayPort', this.remoteRelayPort);
    }
    if (fields.port !== undefined && Number(fields.port) > 0) {
      this.remoteRelayPort = clampSshPort(fields.port);
      void plat().setState('ui.remoteRelayPort', this.remoteRelayPort);
    }
    if (fields.key !== undefined && fields.key.trim()) {
      this.remoteRelayKey = fields.key.trim();
      void plat().setState('ui.remoteRelayKey', this.remoteRelayKey);
    }
    this.syncTunnel();
    this.emit();
  }

  async setRemoteTunnel(fields: {
    host?: string;
    user?: string;
    sshPort?: number;
    forwardPort?: number;
    publicUrl?: string;
  }): Promise<void> {
    this.applyTunnelFields(fields);
    if (this.remote && (this.remoteLocal || this.remotePublic)) {
      await this.remote.apply({
        port: this.remotePort,
        local: this.remoteLocal,
        public: this.remotePublic,
        publicUrl: this.effectivePublicUrl(),
      });
    }
    this.syncTunnel();
    this.emit();
  }
  private applyTunnelFields(fields?: {
    host?: string;
    user?: string;
    sshPort?: number;
    forwardPort?: number;
    publicUrl?: string;
  }): void {
    if (!fields) {
      return;
    }
    if (fields.host !== undefined) {
      this.remoteHost = resolvePublicHost(fields.host);
      void plat().setState('ui.remoteHost', this.remoteHost);
    }
    if (fields.user !== undefined) {
      this.remoteUser = sanitizeTunnelUser(fields.user);
      void plat().setState('ui.remoteSshUser', this.remoteUser);
    }
    if (fields.sshPort !== undefined && Number(fields.sshPort) > 0) {
      this.remoteSshPort = clampSshPort(fields.sshPort);
      void plat().setState('ui.remoteSshPort', this.remoteSshPort);
    }
    if (fields.forwardPort !== undefined) {
      this.remoteForwardPort = resolveForwardPort(fields.forwardPort);
      void plat().setState('ui.remoteForwardPort', this.remoteForwardPort);
    }
    if (fields.publicUrl !== undefined) {
      this.remotePublicUrl = normalizePublicUrl(fields.publicUrl);
      void plat().setState('ui.remotePublicUrl', this.remotePublicUrl);
    }
  }
  private tunnelPublicKey(): string | undefined {
    try {
      return ensureTunnelIdentity().publicKey;
    } catch {
      return undefined;
    }
  }

  private effectivePublicUrl(): string {
    if (this.usesHttpRelay()) {
      const rel = this.relay.info();
      if (rel.state === 'up' && rel.publicUrl) {
        return rel.publicUrl;
      }
      return this.remotePublicUrl;
    }
    const tun = this.tunnel.info();
    if (tun.state === 'up' && tun.remotePort > 0) {
      return advertisedPublicUrl(tun.host || this.remoteHost, tun.remotePort);
    }
    return this.remotePublicUrl;
  }
  private usesHttpRelay(): boolean {
    return this.remoteRelayKind !== 'custom' || Boolean(this.remoteRelayKey);
  }
  private syncTunnel(): void {
    if (!this.remotePublic) {
      this.tunnel.stop();
      this.relay.stop();
      return;
    }
    const localPort = this.remote?.info().port || this.remotePort;
    if (this.remoteRelayKind !== 'custom') {
      this.tunnel.stop();
      this.relay.start({
        host: DEFAULT_PUBLIC_HOST,
        localPort,
        token: BUNDLED_RELAY_TOKEN,
        official: true,
      });
      return;
    }
    if (!this.remoteHost || !this.remoteRelayKey) {
      this.tunnel.stop();
      this.relay.stop();
      return;
    }
    this.tunnel.stop();
    this.relay.start({
      host: this.remoteHost,
      port: this.remoteRelayPort,
      localPort,
      token: this.remoteRelayKey,
      official: false,
    });
  }
  rotateRemoteCode(): void {
    if (this.remoteCodeMode === 'custom') {
      return;
    }
    this.remote?.rotateCode();
    this.emit();
  }

  setRemoteAuth(fields: { mode?: RemotePairMode; secret?: string }): void {
    if (fields.mode === 'random' || fields.mode === 'custom') {
      this.remoteCodeMode = fields.mode;
      void plat().setState('ui.remoteCodeMode', fields.mode);
    }
    if (fields.secret !== undefined) {
      const next = sanitizeRemoteSecret(fields.secret);
      if (next) {
        this.remoteCustomCode = next;
        void plat().setState('ui.remoteCustomCode', next);
      }
    }
    this.syncPairSecret();
    this.emit();
  }

  private syncPairSecret(): void {
    if (!this.remote) {
      return;
    }
    if (this.remoteCodeMode === 'custom') {
      this.remote.setPairSecret(this.remoteCustomCode, 'custom');
      return;
    }
    if (this.remote.info().codeMode !== 'random' || !this.remote.info().code) {
      this.remote.rotateCode();
    }
  }
  private remoteInfo(): RemoteAccessInfo {
    const live = this.remote?.info();
    const httpRelay = this.usesHttpRelay();
    const path = httpRelay ? this.relay.info() : this.tunnel.info();
    const tunnel = this.remotePublic
      ? this.remoteRelayKind === 'custom' && (!this.remoteHost || !this.remoteRelayKey)
        ? 'error'
        : path.state
      : 'off';
    const tunnelError = !this.remotePublic
      ? path.error
      : this.remoteRelayKind === 'custom' && !this.remoteRelayKey
        ? 'need-key'
        : this.remoteRelayKind === 'custom' && !this.remoteHost
          ? 'missing'
          : path.error;
    const extra = {
      tunnel,
      tunnelError,
      tunnelHost: this.remoteRelayKind === 'custom' ? this.remoteHost : DEFAULT_PUBLIC_HOST,
      tunnelUser: this.remoteUser,
      sshPort: this.remoteSshPort,
      forwardPort: this.remoteForwardPort,
      sshPublicKey: httpRelay ? undefined : this.tunnel.info().sshPublicKey ?? this.tunnelPublicKey(),
      bundledRelay: this.remoteRelayKind !== 'custom',
      relayKind: this.remoteRelayKind,
      relayPort: this.remoteRelayPort,
      hasRelayKey: Boolean(this.remoteRelayKey),
    };
    if (live?.running) {
      const publicUrl = this.effectivePublicUrl();
      const urls = live.urls.filter((url) => url !== live.publicUrl);
      if (this.remotePublic && publicUrl) {
        urls.push(publicUrl);
      }
      return { ...live, publicUrl, urls: [...new Set(urls)], codeMode: live.codeMode, ...extra };
    }
    return {
      running: false,
      port: this.remotePort,
      bind: remoteBindHost(this.remoteLocal),
      local: false,
      public: false,
      code: this.remoteCodeMode === 'custom' ? this.remoteCustomCode : '',
      codeMode: this.remoteCodeMode,
      publicUrl: this.effectivePublicUrl(),
      urls: [],
      clients: 0,
      error: live?.error,
      ...extra,
    };
  }
  openThemePreview(): void { drawers.openThemePreview(this); }
  closeThemePreview(): void { drawers.closeThemePreview(this); }
  openMcps(): void { drawers.openMcps(this); }
  closeMcps(): void { drawers.closeMcps(this); }
  openAgents(): void { drawers.openAgents(this); }
  closeAgents(): void { drawers.closeAgents(this); }
  async importAgents(): Promise<void> { await drawers.importAgents(this); }
  async toggleAgent(id: string): Promise<void> { await drawers.toggleAgent(this, id); }
  async deleteAgent(id: string): Promise<void> { await drawers.deleteAgent(this, id); }
  openAgent(id: string): void { drawers.openAgent(this, id); }
  async setAgentProfile(name: string): Promise<void> { await drawers.setAgentProfile(this, name); }
  async importPersonas(): Promise<void> { await drawers.importPersonas(this); }
  async togglePersona(id: string): Promise<void> { await drawers.togglePersona(this, id); }
  async deletePersona(id: string): Promise<void> { await drawers.deletePersona(this, id); }
  openPersona(id: string): void { drawers.openPersona(this, id); }
  openWorktrees(): void { drawers.openWorktrees(this); }
  closeWorktrees(): void { drawers.closeWorktrees(this); }
  async applyWorktree(id: string): Promise<void> { await drawers.applyWorktree(this, id); }
  async removeWorktree(id: string): Promise<void> { await drawers.removeWorktree(this, id); }
  openExt(tab?: string): void { drawers.openExt(this, tab); }
  closeExt(): void { drawers.closeExt(this); }
  openOgPlugins(): void {
    this.drawer = undefined;
    this.settingsOpen = true;
    this.settingsPage = 'og-plugins';
    this.emit();
  }
  async toggleOgPlugin(id: string): Promise<void> {
    const home = plat().homeDir();
    const disabled = await readPluginState(home);
    if (disabled.has(id)) {
      disabled.delete(id);
    } else {
      disabled.add(id);
    }
    await writePluginDisabled(home, disabled);
    await this.reloadOgPlugins();
  }
  async openOgPluginsDir(): Promise<void> {
    const dir = await ensureOgPluginsDir(plat().homeDir());
    await plat().openExternal(pathToFileURL(dir).href);
  }
  private async reloadOgPlugins(): Promise<void> {
    try {
      this.ogPlugins = await scanOgPlugins({
        homeDir: plat().homeDir(),
        workspaceFolder: plat().workspaceFolders()[0],
      });
      await loadOgHostPlugins(this, this.ogPlugins);
    } catch (error) {
      logWarn(`opengrok plugins: ${error instanceof Error ? error.message : error}`);
      this.ogPlugins = [];
    }
    this.emit();
  }
  setExtTab(tab: 'plugins' | 'marketplace' | 'hooks' | 'workflows'): void { drawers.setExtTab(this, tab); }
  async togglePlugin(id: string): Promise<void> { await drawers.togglePlugin(this, id); }
  async uninstallPlugin(id: string): Promise<void> { await drawers.uninstallPlugin(this, id); }
  async toggleHook(id: string): Promise<void> { await drawers.toggleHook(this, id); }
  async installMarketplace(id: string): Promise<void> { await drawers.installMarketplace(this, id); }
  async refreshMarketplace(): Promise<void> { await drawers.refreshMarketplace(this); }
  async runWorkflow(name: string): Promise<void> { await drawers.runWorkflow(this, name); }
  async openTasks(): Promise<void> { await drawers.openTasks(this); }
  async killTask(taskId: string): Promise<void> { await drawers.killTask(this, taskId); }
  openMemory(): void { drawers.openMemory(this); }
  closeMemory(): void { drawers.closeMemory(this); }
  openMemoryFile(id: string): void { drawers.openMemoryFile(this, id); }
  async flushMemory(): Promise<void> { await drawers.flushMemory(this); }
  openPlan(): void { drawers.openPlan(this); }
  refreshMcps(): void { drawers.refreshMcps(this); }
  async toggleMcp(id: string): Promise<void> { await drawers.toggleMcp(this, id); }
  setTheme(
    primary: string,
    secondary: string,
    background?: string,
    patch?: import('../core/types').ThemePatch,
  ): void {
    drawers.setTheme(this, primary, secondary, background, patch);
  }
  async pickThemeWallpaper(): Promise<void> {
    await drawers.pickThemeWallpaper(this);
  }
  async pickThemeFont(): Promise<void> {
    await drawers.pickThemeFont(this);
  }
  async saveApi(input: {
    id?: string;
    name: string;
    model: string;
    baseUrl: string;
    backend: ApiEndpoint['backend'];
    apiKey?: string;
    contextWindow?: number;
  }): Promise<void> { await drawers.saveApi(this, input); }
  async deleteApi(id: string): Promise<void> { await drawers.deleteApi(this, id); }
  async toggleApi(id: string): Promise<void> { await drawers.toggleApi(this, id); }
  async updateSetting(key: keyof GrokSettings, value: string | boolean): Promise<void> {
    await drawers.updateSetting(this, key, value);
  }
  toggleUiFlag(flag: 'compactMode' | 'timestamps' | 'multiline'): void {
    drawers.toggleUiFlag(this, flag);
  }

  async sendAgentSlash(text: string): Promise<void> {
    const agent = this.agent;
    if (!agent || this.status === 'streaming') {
      return;
    }
    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: `user-${++this.turn}`,
      role: 'user',
      text,
      tools: [],
      createdAt: now,
    };
    const assistant: ChatMessage = {
      id: `assistant-${this.turn}`,
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      streaming: true,
      createdAt: now,
      ...this.turnModelFields(),
    };
    this.messages = [...this.messages, userMessage, assistant];
    const run = ++this.runGen;
    this.setStatus('streaming');
    try {
      await agent.prompt([{ type: 'text', text }], { mode: promptModeMeta(this.modeId) });
    } catch (error) {
      if (run !== this.runGen) {
        return;
      }
      if (isCancelError(error)) {
        this.endStreaming();
        return;
      }
      this.fail('Command failed', error);
      return;
    }
    if (run !== this.runGen) {
      return;
    }
    this.endStreaming('done');
  }

  resolveModelId(name: string): string | undefined {
    const q = name.toLowerCase();
    const hit = this.models?.available.find(
      (model) => model.id.toLowerCase() === q || model.name.toLowerCase().includes(q),
    );
    return hit?.id;
  }

  note(text: string): void {
    this.messages = [
      ...this.messages,
      {
        id: `note-${++this.turn}`,
        role: 'assistant',
        text,
        tools: [],
      },
    ];
    this.emit();
  }

  cwd(): string {
    return plat().cwd();
  }

  private busyTurn(): boolean {
    return this.status === 'streaming';
  }

  emit(): void {
    this.models = this.overlayModels();
    this.syncPickerOntoModels();
    this.dropUnknownPicker();
    this.flushEmitTimer();
    if (this.status === 'streaming') {
      this.publishSnapshot(this.streamPosted ? 'none' : 'tail');
      this.streamPosted = true;
      this.emitTail();
      return;
    }
    this.streamPosted = false;
    this.streamCursor = emptyStreamCursor();
    this.publishSnapshot('all');
  }

  applyModelsUpdate(params: unknown): void {
    const next = mergeModelCatalog(this.catalogModels ?? this.models, params);
    if (!next) {
      return;
    }
    this.models = this.overlayModels(next);
    this.emit();
  }

  applyIncomingUpdate(update: SessionUpdate, isReplay = false, sessionId?: string): void {
    if (this.hideSessionPreview && !this.agent?.sessionId) {
      return;
    }
    if (sessionId && this.currentSessionId && sessionId !== this.currentSessionId) {
      this.applyBackgroundUpdate(sessionId, update, isReplay);
      return;
    }
    const view = {
      replaying: this.replaying || isReplay,
      replayUpdate: isReplay,
      messages: this.messages,
      nextTurn: () => ++this.turn,
      modeId: this.modeId,
      models: this.models,
      commands: this.commands,
      meter: this.meter,
      rememberFile: (filePath: string) =>
        this.journal.remember(filePath).then(() => {
          const live = this.journal.assistant();
          if (live?.edits?.length) {
            void this.syncEditStats(live);
          }
        }),
      capturePrevious: (filePath: string, previous: string) =>
        this.journal.capturePrevious(filePath, previous),
      displayPath: (filePath: string) => this.displayPath(filePath),
      emitUnlessReplaying: () => this.emitUnlessReplaying(),
      refreshEditStats: (assistant) => {
        void this.syncEditStats(assistant);
      },
      termEncoding: readGrokSettings().termEncoding,
    };
    const last = this.messages.at(-1);
    const before = last?.role === 'assistant' ? stepsStamp(last.steps) : '';
    applySessionUpdate(view, update);
    this.modeId = view.modeId;
    this.models = view.models;
    this.commands = view.commands;
    if (!isReplay && !this.replaying) {
      void this.rescueWorkspaceImage(update);
      if (update.sessionUpdate === 'goal_updated') {
        this.applyGoalUpdated(update);
      } else {
        this.maybeFinishGoalFromWork();
      }
    }
    const next = this.messages.at(-1);
    const after = next?.role === 'assistant' ? stepsStamp(next.steps) : '';
    if (after && after !== before) {
      this.flushEmitTimer();
      // Tail is the last assistant only — a full snapshot over a tunneled WS stalls the browser.
      this.emitTail();
    }
  }

  allowsFileWrites(): boolean {
    return this.modeId !== 'ask';
  }

  rememberWorkspaceImage(filePath: string, data: string): void {
    const image = imageFromBase64(filePath, data);
    if (!image) {
      return;
    }
    this.workspaceImages.set(cacheKey(filePath), image);
  }

  private async rescueWorkspaceImage(update: SessionUpdate): Promise<void> {
    const filePath = failedBinaryImagePath(update);
    if (!filePath) {
      return;
    }
    const key = cacheKey(filePath);
    if (this.rescuedImages.has(key)) {
      return;
    }
    let image = this.workspaceImages.get(key);
    if (!image) {
      for (const [cached, value] of this.workspaceImages) {
        if (cached.endsWith(`/${key}`) || key.endsWith(`/${cached}`)) {
          image = value;
          break;
        }
      }
    }
    if (!image) {
      return;
    }
    this.rescuedImages.add(key);
    try {
      await this.agent?.interject(`Workspace image: ${path.basename(filePath)}`, [image]);
    } catch (error) {
      this.rescuedImages.delete(key);
      logWarn(`workspace image rescue: ${error instanceof Error ? error.message : error}`);
    }
  }

  async requestToolPermission(params: unknown): Promise<unknown> {
    return requestToolPermissionRpc(this, params);
  }

  private async runHostAction(action: HostAction): Promise<void> {
    await runSlashAction(this, action);
  }

  private applyEffortToModels(level: string): void {
    if (!this.models) {
      return;
    }
    this.models = {
      ...this.models,
      available: this.models.available.map((model) =>
        model.id === this.models?.currentId ? { ...model, currentEffort: level } : model,
      ),
    };
  }

  private patchCurrentEffort(level: string): void {
    this.applyEffortToModels(level);
    this.emit();
  }

  dropQueue(index: number): void {
    if (index < 0 || index >= this.queue.length) {
      return;
    }
    this.queue = this.queue.filter((_, i) => i !== index);
    this.emit();
  }

  openCron(): void {
    this.settingsOpen = true;
    this.settingsPage = 'cron';
    this.emit();
  }

  closeCron(): void {
    if (this.settingsPage === 'cron') {
      this.settingsPage = 'main';
    }
    this.emit();
  }

  addCronJob(draft: CronDraft): void {
    const job = jobFromDraft(draft);
    if (!job) {
      return;
    }
    this.cronJobs = [...this.cronJobs, job];
    this.persistCronJobs();
    this.emit();
  }

  patchCronJob(id: string, patch: { enabled?: boolean }): void {
    this.cronJobs = this.cronJobs.map((job) => {
      if (job.id !== id) {
        return job;
      }
      return stampJob({ ...job, enabled: patch.enabled ?? job.enabled });
    });
    this.persistCronJobs();
    this.emit();
  }

  deleteCronJob(id: string): void {
    this.cronJobs = this.cronJobs.filter((job) => job.id !== id);
    this.persistCronJobs();
    this.emit();
  }

  async runCronJob(id: string): Promise<void> {
    const job = this.cronJobs.find((row) => row.id === id);
    if (!job) {
      return;
    }
    await this.fireCronJob(job);
  }

  private startCronTimer(): void {
    if (this.cronTimer) {
      return;
    }
    this.cronTimer = setInterval(() => {
      void this.tickCronJobs();
    }, CRON_TICK_MS);
  }

  private stopCronTimer(): void {
    if (!this.cronTimer) {
      return;
    }
    clearInterval(this.cronTimer);
    this.cronTimer = undefined;
  }

  private persistCronJobs(): void {
    void plat().setState(CRON_STATE_KEY, this.cronJobs);
  }

  private async tickCronJobs(): Promise<void> {
    if (this.cronBusy) {
      return;
    }
    if (this.status !== 'ready' && this.status !== 'streaming') {
      return;
    }
    const due = dueJobs(this.cronJobs, Date.now());
    if (!due.length) {
      return;
    }
    this.cronBusy = true;
    try {
      for (const job of due) {
        await this.fireCronJob(job);
      }
    } finally {
      this.cronBusy = false;
    }
  }

  private async fireCronJob(job: CronJob): Promise<void> {
    this.cronJobs = this.cronJobs.map((row) => (row.id === job.id ? markJobRan(row) : row));
    this.persistCronJobs();
    this.emit();
    try {
      plat().info(tr('cronFired', { title: job.title }));
      await this.send(job.prompt);
    } catch (error) {
      logWarn(`cron ${job.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  async sendNow(index = 0): Promise<void> {
    if (index < 0 || index >= this.queue.length) {
      return;
    }
    const next = this.queue[index];
    if (!next) {
      return;
    }
    this.queue = this.queue.filter((_, i) => i !== index);
    if (this.status === 'streaming') {
      this.runGen += 1;
      abortClientRpcs(this, 'cancel');
      this.agent?.cancelTurn();
      if (this.status === 'streaming') {
        this.endStreaming();
      }
    }
    await this.send(next);
  }

  private async flushQueue(): Promise<void> {
    const next = this.queue[0];
    if (!next) {
      return;
    }
    this.queue = this.queue.slice(1);
    this.emit();
    await this.send(next);
  }

  private async startInner(): Promise<void> {
    await this.reloadOgPlugins();
    const epoch = this.agentGen;
    this.error = undefined;
    if (this.messages.length === 0) {
      this.setStatus('connecting');
    }
    if (!plat().isTrusted()) {
      this.setStatus('untrusted');
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (epoch !== this.agentGen) {
      return;
    }
    try {
      this.apis = await listApiEndpoints();
      this.apisLoaded = true;
    } catch (error) {
      logWarn(`api list: ${error instanceof Error ? error.message : error}`);
    }
    if (epoch !== this.agentGen) {
      return;
    }
    const cliPath = resolveGrokBinary({
      configuredPath: plat().getConfig('cliPath', ''),
      preferWorkspaceBinary: plat().getConfig('preferWorkspaceBinary', false),
      workspaceFolders: plat().workspaceFolders(),
      homeDir: plat().homeDir(),
      pathEnv: plat().pathEnv(),
      platform: plat().os(),
    });
    if (!cliPath) {
      this.setStatus('missingCli');
      return;
    }
    this.cliPath = cliPath;
    let spawned: GrokAgent | undefined;
    try {
      const hints = this.startupHints();
      if (hints) {
        logInfo('heavy workspace: skip git status and project layout at session start');
      }
      spawned = GrokAgent.spawn(
        {
          cliPath,
          cwd: this.cwd(),
          extensionVersion: plat().extensionVersion(),
          startupHints: hints,
        },
        (method, params, id) => this.onIncoming(method, params, id),
        (error) => this.onAgentLost(epoch, error),
      );
      if (epoch !== this.agentGen) {
        spawned.dispose();
        return;
      }
      const init = await spawned.initialize();
      if (epoch !== this.agentGen) {
        spawned.dispose();
        return;
      }
      this.agent = spawned;
      this.reconnectFails = 0;
      this.agentVersion = spawned.agentVersion();
      this.models = this.overlayModels(modelsFromResult(init));
      this.applyPendingModelSelection();
      const methods = spawned.authMethods();
      const defaultId = spawned.defaultAuthMethodId();
      logInfo(
        `initialize methods=${methods.map((m) => m.id).join(',')} default=${defaultId ?? ''}`,
      );
      if ((methods.length === 0 || needsInteractiveLogin(methods)) && !this.skipInteractiveLogin) {
        const interactive = findInteractiveAuthMethod(methods);
        this.loginView = { label: interactive?.name ?? 'Grok' };
        this.setStatus('login');
        return;
      }
      await this.enterReady(spawned, epoch);
    } catch (error) {
      const stillThisAttempt = epoch === this.agentGen;
      if (this.agent === spawned) {
        this.agent = undefined;
      }
      if (stillThisAttempt) {
        this.agentGen += 1;
      }
      try {
        spawned?.dispose();
      } catch {
        /* already dead */
      }
      if (!stillThisAttempt) {
        return;
      }
      this.fail('Could not start the Grok agent', error);
    }
  }

  private async onIncoming(
    method: string,
    params: unknown,
    id: number | string,
  ): Promise<unknown> {
    return handleIncoming(this, method, params, id);
  }

  private emitUnlessReplaying(): void {
    if (this.replaying) {
      return;
    }
    if (this.status === 'streaming') {
      this.emitSoon();
      return;
    }
    this.emit();
  }

  private emitSoon(): void {
    if (this.emitTimer) {
      return;
    }
    const n = this.messages.at(-1)?.text.length ?? 0;
    const delay = Math.min(220, 80 + Math.floor(n / 3000));
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined;
      this.emitTail();
    }, delay);
  }

  private flushEmitTimer(): void {
    if (!this.emitTimer) {
      return;
    }
    clearTimeout(this.emitTimer);
    this.emitTimer = undefined;
  }

  private emitTail(): void {
    const last = this.messages.at(-1);
    if (!last || last.role !== 'assistant' || !last.streaming || this.streamListeners.size === 0) {
      return;
    }
    const { tail, cursor } = buildStreamTail(this.streamCursor, last, {
      status: this.status,
      context: this.meter.usage,
      queue: this.queue,
    });
    this.streamCursor = cursor;
    for (const listener of this.streamListeners) {
      listener(tail);
    }
  }

  private publishSnapshot(messages: 'all' | 'none' | 'tail'): void {
    const state = this.snapshot({ messages });
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private async openAuthUrl(agent: GrokAgent): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && this.status === 'authenticating') {
      try {
        const info = await agent.getAuthUrl();
        if (info.url) {
          this.loginView = {
            ...this.loginView,
            url: info.url,
            mode: info.mode,
          };
          this.emit();
          await plat().openExternal(info.url);
          return;
        }
      } catch (error) {
        logWarn(`get_url: ${error instanceof Error ? error.message : error}`);
      }
      await sleep(80);
    }
  }

  private displayPath(filePath: string): string {
    return plat().relativePath(filePath);
  }

  private async syncEditStats(
    assistant: ChatMessage,
    opts?: { silent?: boolean },
  ): Promise<void> {
    const files = await this.journal.diffs(assistant.id);
    if (!files.length || !this.messages.includes(assistant)) {
      return;
    }
    if (!this.journal.hasDiskSnapshot(assistant.id)) {
      return;
    }
    assistant.edits = applyDiffStats(assistant.edits ?? [], files);
    if (!opts?.silent) {
      this.emitUnlessReplaying();
      this.pushEditStats(assistant.id);
    }
  }

  private async syncAllEditStats(): Promise<void> {
    for (const message of this.messages) {
      if (message.role === 'assistant' && message.edits?.length) {
        await this.syncEditStats(message, { silent: true });
      }
    }
  }

  private pushEditStats(messageId?: string): void {
    const items: EditStatsItem[] = [];
    for (const message of this.messages) {
      if (message.role !== 'assistant' || !message.edits?.length) {
        continue;
      }
      if (messageId && message.id !== messageId) {
        continue;
      }
      items.push({ messageId: message.id, edits: publicEdits(message.edits) });
    }
    if (!items.length) {
      return;
    }
    this.remote?.broadcast({ type: 'editStats', items });
  }

  private startupHints(): { skipGitStatus: boolean; skipProjectLayout: boolean } | undefined {
    const folders = plat().workspaceFolders();
    return workspaceStartupHints(folders.length ? folders : [this.cwd()]);
  }

  private sessionMeta(): Record<string, unknown> {
    const extra: Record<string, unknown> = { ...sessionPermissionMeta(readGrokSettings()) };
    extra['x.ai/mcp/servers'] = imageMcpServersMeta();
    const hints = this.startupHints();
    if (hints) {
      extra.startupHints = hints;
    }
    const wantedId = this.selectedModelId();
    const wantedEffort = this.selectedEffort();
    if (wantedId) {
      extra.modelId = wantedId;
    }
    if (wantedEffort) {
      extra.reasoningEffort = wantedEffort;
    }
    if (this.agentProfile) {
      extra.agentProfile = this.agentProfile;
    }
    const authMethodId = resolveSessionAuthMethodId({
      accountMethodId: this.account?.methodId,
      sessionAuthMethodId: this.sessionAuthMethodId,
      skipInteractive: this.skipInteractiveLogin,
      methods: this.agent?.authMethods() ?? [],
      defaultId: this.agent?.defaultAuthMethodId(),
    });
    if (authMethodId) {
      extra.authMethodId = authMethodId;
    }
    return extra;
  }

  private async enterReady(agent: GrokAgent, epoch: number): Promise<void> {
    const methods = agent.authMethods();
    const defaultId = agent.defaultAuthMethodId();
    const methodId = resolveSessionAuthMethodId({
      skipInteractive: this.skipInteractiveLogin,
      methods,
      defaultId,
    });
    if (methodId) {
      try {
        await agent.authenticate(methodId);
      } catch (error) {
        if (!this.skipInteractiveLogin) {
          throw error;
        }
        logWarn(
          `skip login authenticate ${methodId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (epoch !== this.agentGen) {
      return;
    }
    this.loginView = undefined;
    this.account = await agent.authInfo().catch(() => undefined);
    if (this.account?.methodId && isSessionAuthMethod(this.account.methodId)) {
      this.sessionAuthMethodId = this.account.methodId;
    }
    if (epoch !== this.agentGen) {
      return;
    }
    this.commands = mergeCommands(agent.availableCommands(), FALLBACK_COMMANDS);
    void agent.commandsList().then((cmds) => {
      if (epoch !== this.agentGen) {
        return;
      }
      this.commands = mergeCommands(cmds, FALLBACK_COMMANDS);
      this.emit();
    });
    this.setStatus('ready');
    this.refreshBilling();
    this.startBillingPoll();
    this.refreshHeatmap();
    void drawers.refreshApis(this);
    setTimeout(() => {
      if (epoch === this.agentGen) {
        void this.refreshSessionsSilent();
        void this.adoptBackgroundSessions();
      }
    }, 800);
  }

  private async createSession(agent: GrokAgent): Promise<void> {
    const extra = this.sessionMeta();
    const wantedId = this.selectedModelId();
    const wantedEffort = this.selectedEffort();
    const cwd = this.sessionCwd ?? this.cwd();
    const result = await agent.newSession(cwd, extra);
    this.currentSessionId = agent.sessionId ?? result.sessionId;
    this.sessionCwd = cwd;
    this.models = this.overlayModels(modelsFromResult(result));
    if (wantedId) {
      try {
        await this.syncAuthForModel(agent, wantedId);
        if (this.models?.currentId !== wantedId || this.isRelayModel(wantedId)) {
          await agent.setModel(
            wantedId,
            wantedEffort ? { reasoningEffort: wantedEffort } : undefined,
          );
        }
      } catch (error) {
        logWarn(`apply selected model: ${error instanceof Error ? error.message : error}`);
      }
    }
    this.applyPendingModelSelection();
    if (this.modeId === 'ask' || this.modeId === 'plan') {
      try {
        await agent.setMode(this.modeId);
      } catch (error) {
        logWarn(`apply session mode: ${error instanceof Error ? error.message : error}`);
      }
    }
    void this.meter.refresh();
    if (this.settingsOpen && this.settingsPage === 'mcps') {
      void drawers.refreshMcpsInner(this);
    }
  }

  private turnModelFields(): Pick<ChatMessage, 'modelId' | 'modelName' | 'effort'> {
    const id = this.selectedModelId();
    const model = this.models?.available.find((item) => item.id === id);
    const api = this.apis.find((row) => row.enabled && row.id === id);
    return {
      modelId: id,
      modelName: api?.name ?? model?.name ?? id,
      effort: this.selectedEffort(),
    };
  }

  private selectedModelId(): string | undefined {
    const wanted = this.pendingModelId ?? this.models?.currentId;
    if (!wanted) {
      return undefined;
    }
    if (!this.models?.available.length) {
      return wanted;
    }
    if (this.models.available.some((item) => item.id === wanted)) {
      return wanted;
    }
    return this.models.currentId;
  }

  private selectedEffort(): string | undefined {
    const id = this.selectedModelId();
    const model = this.models?.available.find((item) => item.id === id);
    if (this.pendingEffort && (!model?.efforts?.length || model.efforts.includes(this.pendingEffort))) {
      return this.pendingEffort;
    }
    if (model?.currentEffort) {
      return model.currentEffort;
    }
    if (model?.efforts?.length) {
      return model.efforts.includes('high') ? 'high' : model.efforts[0];
    }
    if (id && this.apis.some((item) => item.id === id)) {
      return 'high';
    }
    return undefined;
  }

  private applyPendingModelSelection(): void {
    this.models = this.overlayModels();
    this.syncPickerOntoModels();
  }

  private syncPickerOntoModels(): void {
    if (!this.models) {
      return;
    }
    const wantedId = this.pendingModelId ?? this.models.currentId;
    const known = Boolean(wantedId && this.models.available.some((item) => item.id === wantedId));
    if (wantedId && known && this.models.currentId !== wantedId) {
      this.models = { ...this.models, currentId: wantedId };
    } else if (wantedId && !known && (this.apisLoaded || !isCustomModelId(wantedId))) {
      if (this.models.available.length) {
        this.pendingModelId = this.models.currentId;
        this.persistPicker();
      }
    }
    const effort = this.selectedEffort();
    if (effort) {
      this.applyEffortToModels(effort);
    }
  }

  private rememberCatalog(catalog?: ChatState['models']): void {
    if (catalog?.available) {
      this.catalogModels = catalog;
    }
  }

  private overlayModels(catalog?: ChatState['models']): ChatState['models'] {
    if (catalog && catalog !== this.models) {
      this.rememberCatalog(catalog);
    }
    const source = this.catalogModels ?? catalog ?? this.models;
    return overlayApiModels(source, this.apis) ?? source;
  }

  private persistPicker(): void {
    void plat().setState('ui.modelId', this.pendingModelId ?? this.models?.currentId ?? '');
    void plat().setState('ui.effort', this.pendingEffort ?? this.selectedEffort() ?? '');
  }

  private dropUnknownPicker(): void {
    const wanted = this.pendingModelId;
    if (!wanted || !this.models?.available.length) {
      return;
    }
    if (this.models.available.some((item) => item.id === wanted)) {
      return;
    }
    if (isCustomModelId(wanted) && !this.apisLoaded) {
      return;
    }
    this.pendingModelId = this.models.currentId;
    this.persistPicker();
  }

  private isRelayModel(modelId: string | undefined): boolean {
    return isRelayEndpoint(modelId, this.apis);
  }

  /**
   * Official grok.com login leaves the ACP method on cached_token / oidc, so the
   * CLI treats relay 401s as session expiry and refreshes the grok.com JWT.
   * Switch to xai.api_key for a custom endpoint (does not wipe auth.json);
   * switch back to the saved session method for official models.
   */
  private async syncAuthForModel(agent: GrokAgent, modelId: string): Promise<void> {
    try {
      const current = this.account?.methodId;
      if (this.isRelayModel(modelId)) {
        if (current && isSessionAuthMethod(current) && !this.sessionAuthMethodId) {
          this.sessionAuthMethodId = current;
        }
        if (current === AUTH_METHODS.apiKey) {
          return;
        }
        await agent.authenticate(AUTH_METHODS.apiKey);
        this.account = await agent.authInfo().catch(() => ({ methodId: AUTH_METHODS.apiKey }));
        return;
      }
      const restore = this.sessionAuthMethodId;
      if (!restore || current !== AUTH_METHODS.apiKey) {
        return;
      }
      await agent.authenticate(restore);
      this.account = await agent.authInfo().catch(() => undefined);
    } catch (error) {
      logWarn(`model auth: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** After grok.com login, put the selected relay on the wire with its own key. */
  private async applySelectedCustomModel(agent: GrokAgent): Promise<void> {
    const modelId = this.selectedModelId();
    if (!modelId || !this.isRelayModel(modelId) || !agent.sessionId) {
      return;
    }
    const effort = this.selectedEffort();
    try {
      await this.syncAuthForModel(agent, modelId);
      await agent.setModel(modelId, effort ? { reasoningEffort: effort } : undefined);
      if (this.models) {
        this.models = { ...this.models, currentId: modelId };
      }
    } catch (error) {
      logWarn(`apply custom model: ${error instanceof Error ? error.message : error}`);
    }
  }

  private finishAssistant(): void {
    const assistant = this.messages.filter((m) => m.role === 'assistant').at(-1);
    if (assistant) {
      assistant.streaming = false;
      assistant.endedAt = assistant.endedAt ?? new Date().toISOString();
      freezeTurnSteps(assistant);
      void this.syncEditStats(assistant);
    }
    void this.meter.refresh();
  }

  private endStreaming(cue?: NotifyCue): void {
    this.finishAssistant();
    void persistTurnModels(this.currentSessionId, this.messages);
    this.notify = cue;
    this.setStatus('ready');
    this.notify = undefined;
    if (this.goal?.status === 'running') {
      const last = this.messages.filter((item) => item.role === 'assistant').at(-1);
      if (goalDelivered(last?.steps, last?.text)) {
        void this.finishGoal({ stopLoop: true });
      }
    }
  }

  private setStatus(status: ChatStatus): void {
    this.status = status;
    if (status !== 'error') {
      this.error = undefined;
    }
    this.emit();
  }

  fail(message: string, error?: unknown): void {
    const parsed = error !== undefined ? formatAgentError(error) : { message };
    const line =
      parsed.message === message ? formatErrorLine(parsed) : `${message}: ${formatErrorLine(parsed)}`;
    this.error = line;
    const assistant = this.messages.filter((item) => item.role === 'assistant').at(-1);
    if (assistant) {
      assistant.error = parsed;
      assistant.streaming = false;
      freezeTurnSteps(assistant);
    }
    const interrupted = this.status === 'streaming';
    if (this.status === 'streaming' || this.status === 'ready') {
      this.status = 'ready';
      plat().warn(line);
    } else if (this.status !== 'login' && this.status !== 'authenticating') {
      this.status = 'error';
    }
    this.notify = interrupted ? 'fail' : undefined;
    logError(message, error);
    if (interrupted && this.modeId === 'goal' && this.goal?.status === 'running') {
      this.pauseActiveGoal();
      if (this.agent) {
        void this.nudgeGoalSlash('pause');
      }
    }
    this.emit();
    this.notify = undefined;
  }
}

/** Keep this assistant turn, or drop it when it is already the latest. */
export function rewindIndexFor(
  messages: Array<{ id: string; role: string }>,
  messageId: string,
): number | undefined {
  const idx = messages.findIndex((item) => item.id === messageId);
  if (idx < 0 || messages[idx]?.role !== 'assistant') {
    return undefined;
  }
  const keep = (idx + 1) >> 1;
  let last: { id: string; role: string } | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'assistant') {
      last = messages[i];
      break;
    }
  }
  if (last?.id === messageId) {
    return Math.max(0, keep - 1);
  }
  return keep;
}

function stepsStamp(steps: ChatMessage['steps']): string {
  return (steps ?? []).map((step) => `${step.status}:${step.content}`).join('\n');
}

async function isGitCwd(cwd: string): Promise<boolean> {
  for (const gitPath of gitProbePaths(cwd)) {
    if (await plat().fileExists(gitPath)) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function savedPickerId(raw: unknown): string | undefined {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 80 || /[\r\n]/.test(text)) {
    return undefined;
  }
  return text;
}

function savedPickerEffort(raw: unknown): string | undefined {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,15}$/.test(text)) {
    return undefined;
  }
  return text;
}
