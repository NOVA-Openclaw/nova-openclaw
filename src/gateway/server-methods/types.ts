import type { ModelCatalogEntry } from "../../agents/model-catalog.js";
import type { createDefaultDeps } from "../../cli/deps.js";
import type { HealthSummary } from "../../commands/health.js";
import type { CronService } from "../../cron/service.js";
import type { createSubsystemLogger } from "../../logging/subsystem.js";
import type { WizardSession } from "../../wizard/session.js";
import type { ChatAbortControllerEntry } from "../chat-abort.js";
import type { NodeRegistry } from "../node-registry.js";
import type { ConnectParams, ErrorShape, RequestFrame } from "../protocol/index.js";
import type { ChannelRuntimeSnapshot } from "../server-channels.js";
import type { DedupeEntry } from "../server-shared.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export type GatewayClient = {
  connect: ConnectParams;
};

export type RespondFn = (
  ok: boolean,
  payload?: unknown,
  error?: ErrorShape,
  meta?: Record<string, unknown>,
) => void;

export type GatewayRequestContext = {
  deps: ReturnType<typeof createDefaultDeps>;
  cron: CronService;
  cronStorePath: string;
  loadGatewayModelCatalog: () => Promise<ModelCatalogEntry[]>;
  getHealthCache: () => HealthSummary | null;
  refreshHealthSnapshot: (opts?: { probe?: boolean }) => Promise<HealthSummary>;
  logHealth: { error: (message: string) => void };
  logGateway: SubsystemLogger;
  incrementPresenceVersion: () => number;
  getHealthVersion: () => number;
  broadcast: (
    event: string,
    payload: unknown,
    opts?: {
      dropIfSlow?: boolean;
      stateVersion?: { presence?: number; health?: number };
    },
  ) => void;
  nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => void;
  nodeSendToAllSubscribed: (event: string, payload: unknown) => void;
  nodeSubscribe: (nodeId: string, sessionKey: string) => void;
  nodeUnsubscribe: (nodeId: string, sessionKey: string) => void;
  nodeUnsubscribeAll: (nodeId: string) => void;
  hasConnectedMobileNode: () => boolean;
  nodeRegistry: NodeRegistry;
  agentRunSeq: Map<string, number>;
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  chatAbortedRuns: Map<string, number>;
  chatRunBuffers: Map<string, string>;
  chatDeltaSentAt: Map<string, number>;
  addChatRun: (sessionId: string, entry: { sessionKey: string; clientRunId: string }) => void;
  removeChatRun: (
    sessionId: string,
    clientRunId: string,
    sessionKey?: string,
  ) => { sessionKey: string; clientRunId: string } | undefined;
  dedupe: Map<string, DedupeEntry>;
  wizardSessions: Map<string, WizardSession>;
  findRunningWizard: () => string | null;
  purgeWizardSession: (id: string) => void;
  getRuntimeSnapshot: () => ChannelRuntimeSnapshot;
  startChannel: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => Promise<void>;
  stopChannel: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => Promise<void>;
  markChannelLoggedOut: (
    channelId: import("../../channels/plugins/types.js").ChannelId,
    cleared: boolean,
    accountId?: string,
  ) => void;
  setChannelEnabled: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    enabled: boolean,
    accountId?: string,
  ) => Promise<void>;
  getChannelEnabled: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => boolean | undefined;
  clearChannelEnabledOverride: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => void;
  setChannelDnd: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    enabled: boolean,
    message?: string,
    accountId?: string,
  ) => void;
  getChannelDnd: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => { enabled: boolean; message?: string } | undefined;
  setChannelMode: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    mode: import("../../channels/channel-mode.js").ChannelMode,
    options?: { dndMessage?: string; accountId?: string },
  ) => Promise<void>;
  getChannelMode: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => import("../../channels/channel-mode.js").ChannelMode | undefined;
  getChannelModeState: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => { mode: import("../../channels/channel-mode.js").ChannelMode; dndMessage?: string } | undefined;
  clearChannelModeOverride: (
    channel: import("../../channels/plugins/types.js").ChannelId,
    accountId?: string,
  ) => void;
  wizardRunner: (
    opts: import("../../commands/onboard-types.js").OnboardOptions,
    runtime: import("../../runtime.js").RuntimeEnv,
    prompter: import("../../wizard/prompts.js").WizardPrompter,
  ) => Promise<void>;
  broadcastVoiceWakeChanged: (triggers: string[]) => void;
};

export type GatewayRequestOptions = {
  req: RequestFrame;
  client: GatewayClient | null;
  isWebchatConnect: (params: ConnectParams | null | undefined) => boolean;
  respond: RespondFn;
  context: GatewayRequestContext;
};

export type GatewayRequestHandlerOptions = {
  req: RequestFrame;
  params: Record<string, unknown>;
  client: GatewayClient | null;
  isWebchatConnect: (params: ConnectParams | null | undefined) => boolean;
  respond: RespondFn;
  context: GatewayRequestContext;
};

export type GatewayRequestHandler = (opts: GatewayRequestHandlerOptions) => Promise<void> | void;

export type GatewayRequestHandlers = Record<string, GatewayRequestHandler>;
