import type { ChannelAccountSnapshot } from "../channels/plugins/types.js";
import type { OpenClawConfig } from "../config/config.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveChannelDefaultAccountId } from "../channels/plugins/helpers.js";
import { type ChannelId, getChannelPlugin, listChannelPlugins } from "../channels/plugins/index.js";
import { formatErrorMessage } from "../infra/errors.js";
import { resetDirectoryCache } from "../infra/outbound/target-resolver.js";
import { DEFAULT_ACCOUNT_ID } from "../routing/session-key.js";

export type ChannelRuntimeSnapshot = {
  channels: Partial<Record<ChannelId, ChannelAccountSnapshot>>;
  channelAccounts: Partial<Record<ChannelId, Record<string, ChannelAccountSnapshot>>>;
};

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

type ChannelModeState = {
  mode: import("../channels/channel-mode.js").ChannelMode;
  dndMessage?: string;
};

type ChannelRuntimeStore = {
  aborts: Map<string, AbortController>;
  tasks: Map<string, Promise<unknown>>;
  runtimes: Map<string, ChannelAccountSnapshot>;
  modeOverrides: Map<string, ChannelModeState>; // Runtime mode overrides
};

function createRuntimeStore(): ChannelRuntimeStore {
  return {
    aborts: new Map(),
    tasks: new Map(),
    runtimes: new Map(),
    modeOverrides: new Map(),
  };
}

function isAccountEnabled(account: unknown): boolean {
  if (!account || typeof account !== "object") {
    return true;
  }
  const enabled = (account as { enabled?: boolean }).enabled;
  return enabled !== false;
}

function resolveDefaultRuntime(channelId: ChannelId): ChannelAccountSnapshot {
  const plugin = getChannelPlugin(channelId);
  return plugin?.status?.defaultRuntime ?? { accountId: DEFAULT_ACCOUNT_ID };
}

function cloneDefaultRuntime(channelId: ChannelId, accountId: string): ChannelAccountSnapshot {
  return { ...resolveDefaultRuntime(channelId), accountId };
}

type ChannelManagerOptions = {
  loadConfig: () => OpenClawConfig;
  channelLogs: Record<ChannelId, SubsystemLogger>;
  channelRuntimeEnvs: Record<ChannelId, RuntimeEnv>;
};

export type ChannelManager = {
  getRuntimeSnapshot: () => ChannelRuntimeSnapshot;
  startChannels: () => Promise<void>;
  startChannel: (channel: ChannelId, accountId?: string) => Promise<void>;
  stopChannel: (channel: ChannelId, accountId?: string) => Promise<void>;
  markChannelLoggedOut: (channelId: ChannelId, cleared: boolean, accountId?: string) => void;
  // Channel mode control (unified system)
  setChannelMode: (
    channel: ChannelId,
    mode: import("../channels/channel-mode.js").ChannelMode,
    options?: { dndMessage?: string; accountId?: string },
  ) => Promise<void>;
  getChannelMode: (
    channel: ChannelId,
    accountId?: string,
  ) => import("../channels/channel-mode.js").ChannelMode | undefined;
  getChannelModeState: (
    channel: ChannelId,
    accountId?: string,
  ) => { mode: import("../channels/channel-mode.js").ChannelMode; dndMessage?: string } | undefined;
  clearChannelModeOverride: (channel: ChannelId, accountId?: string) => void;
  // Legacy methods for backward compatibility
  setChannelEnabled: (channel: ChannelId, enabled: boolean, accountId?: string) => Promise<void>;
  getChannelEnabled: (channel: ChannelId, accountId?: string) => boolean | undefined;
  clearChannelEnabledOverride: (channel: ChannelId, accountId?: string) => void;
  setChannelDnd: (
    channel: ChannelId,
    enabled: boolean,
    message?: string,
    accountId?: string,
  ) => void;
  getChannelDnd: (
    channel: ChannelId,
    accountId?: string,
  ) => { enabled: boolean; message?: string } | undefined;
};

// Channel docking: lifecycle hooks (`plugin.gateway`) flow through this manager.
export function createChannelManager(opts: ChannelManagerOptions): ChannelManager {
  const { loadConfig, channelLogs, channelRuntimeEnvs } = opts;

  const channelStores = new Map<ChannelId, ChannelRuntimeStore>();

  // Create a reference that will be populated later for self-reference
  let manager: ChannelManager;

  const getStore = (channelId: ChannelId): ChannelRuntimeStore => {
    const existing = channelStores.get(channelId);
    if (existing) {
      return existing;
    }
    const next = createRuntimeStore();
    channelStores.set(channelId, next);

    // Initialize mode overrides from config
    const cfg = loadConfig();
    const plugin = getChannelPlugin(channelId);
    if (plugin) {
      const accountIds = plugin.config.listAccountIds(cfg);
      for (const accountId of accountIds) {
        const account = plugin.config.resolveAccount(cfg, accountId);
        // Check if account has mode or DND config
        if (account && typeof account === "object") {
          const accountWithMode = account as {
            mode?: string;
            dnd?: { enabled?: boolean; message?: string };
          };

          // If mode is set in config, use it as the initial mode
          const configMode = accountWithMode.mode;
          if (configMode && configMode !== "enabled") {
            next.modeOverrides.set(accountId, {
              mode: configMode as import("../channels/channel-mode.js").ChannelMode,
              dndMessage: configMode === "dnd" ? accountWithMode.dnd?.message : undefined,
            });
          }
          // Fall back to legacy DND config if no explicit mode is set
          else {
            const dndConfig = accountWithMode.dnd;
            if (dndConfig?.enabled) {
              next.modeOverrides.set(accountId, {
                mode: "dnd",
                dndMessage: dndConfig.message,
              });
            }
          }
        }
      }
    }

    return next;
  };

  const getRuntime = (channelId: ChannelId, accountId: string): ChannelAccountSnapshot => {
    const store = getStore(channelId);
    return store.runtimes.get(accountId) ?? cloneDefaultRuntime(channelId, accountId);
  };

  const setRuntime = (
    channelId: ChannelId,
    accountId: string,
    patch: ChannelAccountSnapshot,
  ): ChannelAccountSnapshot => {
    const store = getStore(channelId);
    const current = getRuntime(channelId, accountId);
    const next = { ...current, ...patch, accountId };
    store.runtimes.set(accountId, next);
    return next;
  };

  const startChannel = async (channelId: ChannelId, accountId?: string) => {
    const plugin = getChannelPlugin(channelId);
    const startAccount = plugin?.gateway?.startAccount;
    if (!startAccount) {
      return;
    }
    const cfg = loadConfig();
    resetDirectoryCache({ channel: channelId, accountId });
    const store = getStore(channelId);
    const accountIds = accountId ? [accountId] : plugin.config.listAccountIds(cfg);
    if (accountIds.length === 0) {
      return;
    }

    await Promise.all(
      accountIds.map(async (id) => {
        if (store.tasks.has(id)) {
          return;
        }
        const account = plugin.config.resolveAccount(cfg, id);

        // Check runtime mode override first, then fall back to config enabled state
        const modeState = store.modeOverrides.get(id);
        const runtimeMode = modeState?.mode;

        // Determine effective mode
        let effectiveMode: import("../channels/channel-mode.js").ChannelMode;
        if (runtimeMode) {
          effectiveMode = runtimeMode;
        } else {
          // Fall back to config: enabled = "enabled", disabled = "disabled"
          const configEnabled = plugin.config.isEnabled
            ? plugin.config.isEnabled(account, cfg)
            : isAccountEnabled(account);
          effectiveMode = configEnabled ? "enabled" : "disabled";
        }

        // Import capabilities checker
        const { getChannelModeCapabilities } = await import("../channels/channel-mode.js");
        const capabilities = getChannelModeCapabilities(effectiveMode);

        if (!capabilities.shouldConnect) {
          setRuntime(channelId, id, {
            accountId: id,
            running: false,
            lastError:
              runtimeMode === "disabled"
                ? "disabled at runtime"
                : (plugin.config.disabledReason?.(account, cfg) ?? "disabled"),
          });
          return;
        }

        let configured = true;
        if (plugin.config.isConfigured) {
          configured = await plugin.config.isConfigured(account, cfg);
        }
        if (!configured) {
          setRuntime(channelId, id, {
            accountId: id,
            running: false,
            lastError: plugin.config.unconfiguredReason?.(account, cfg) ?? "not configured",
          });
          return;
        }

        const abort = new AbortController();
        store.aborts.set(id, abort);
        setRuntime(channelId, id, {
          accountId: id,
          running: true,
          lastStartAt: Date.now(),
          lastError: null,
        });

        const log = channelLogs[channelId];
        const task = startAccount({
          cfg,
          accountId: id,
          account,
          runtime: channelRuntimeEnvs[channelId],
          abortSignal: abort.signal,
          log,
          getStatus: () => getRuntime(channelId, id),
          setStatus: (next) => setRuntime(channelId, id, next),
          channelManager: manager,
        });
        const tracked = Promise.resolve(task)
          .catch((err) => {
            const message = formatErrorMessage(err);
            setRuntime(channelId, id, { accountId: id, lastError: message });
            log.error?.(`[${id}] channel exited: ${message}`);
          })
          .finally(() => {
            store.aborts.delete(id);
            store.tasks.delete(id);
            setRuntime(channelId, id, {
              accountId: id,
              running: false,
              lastStopAt: Date.now(),
            });
          });
        store.tasks.set(id, tracked);
      }),
    );
  };

  const stopChannel = async (channelId: ChannelId, accountId?: string) => {
    const plugin = getChannelPlugin(channelId);
    const cfg = loadConfig();
    const store = getStore(channelId);
    const knownIds = new Set<string>([
      ...store.aborts.keys(),
      ...store.tasks.keys(),
      ...(plugin ? plugin.config.listAccountIds(cfg) : []),
    ]);
    if (accountId) {
      knownIds.clear();
      knownIds.add(accountId);
    }

    await Promise.all(
      Array.from(knownIds.values()).map(async (id) => {
        const abort = store.aborts.get(id);
        const task = store.tasks.get(id);
        if (!abort && !task && !plugin?.gateway?.stopAccount) {
          return;
        }
        abort?.abort();
        if (plugin?.gateway?.stopAccount) {
          const account = plugin.config.resolveAccount(cfg, id);
          await plugin.gateway.stopAccount({
            cfg,
            accountId: id,
            account,
            runtime: channelRuntimeEnvs[channelId],
            abortSignal: abort?.signal ?? new AbortController().signal,
            log: channelLogs[channelId],
            getStatus: () => getRuntime(channelId, id),
            setStatus: (next) => setRuntime(channelId, id, next),
            channelManager: manager,
          });
        }
        try {
          await task;
        } catch {
          // ignore
        }
        store.aborts.delete(id);
        store.tasks.delete(id);
        setRuntime(channelId, id, {
          accountId: id,
          running: false,
          lastStopAt: Date.now(),
        });
      }),
    );
  };

  const startChannels = async () => {
    for (const plugin of listChannelPlugins()) {
      await startChannel(plugin.id);
    }
  };

  const markChannelLoggedOut = (channelId: ChannelId, cleared: boolean, accountId?: string) => {
    const plugin = getChannelPlugin(channelId);
    if (!plugin) {
      return;
    }
    const cfg = loadConfig();
    const resolvedId =
      accountId ??
      resolveChannelDefaultAccountId({
        plugin,
        cfg,
      });
    const current = getRuntime(channelId, resolvedId);
    const next: ChannelAccountSnapshot = {
      accountId: resolvedId,
      running: false,
      lastError: cleared ? "logged out" : current.lastError,
    };
    if (typeof current.connected === "boolean") {
      next.connected = false;
    }
    setRuntime(channelId, resolvedId, next);
  };

  const getRuntimeSnapshot = (): ChannelRuntimeSnapshot => {
    const cfg = loadConfig();
    const channels: ChannelRuntimeSnapshot["channels"] = {};
    const channelAccounts: ChannelRuntimeSnapshot["channelAccounts"] = {};
    for (const plugin of listChannelPlugins()) {
      const store = getStore(plugin.id);
      const accountIds = plugin.config.listAccountIds(cfg);
      const defaultAccountId = resolveChannelDefaultAccountId({
        plugin,
        cfg,
        accountIds,
      });
      const accounts: Record<string, ChannelAccountSnapshot> = {};
      for (const id of accountIds) {
        const account = plugin.config.resolveAccount(cfg, id);
        const enabled = plugin.config.isEnabled
          ? plugin.config.isEnabled(account, cfg)
          : isAccountEnabled(account);
        const described = plugin.config.describeAccount?.(account, cfg);
        const configured = described?.configured;
        const current = store.runtimes.get(id) ?? cloneDefaultRuntime(plugin.id, id);
        const next = { ...current, accountId: id };
        if (!next.running) {
          if (!enabled) {
            next.lastError ??= plugin.config.disabledReason?.(account, cfg) ?? "disabled";
          } else if (configured === false) {
            next.lastError ??= plugin.config.unconfiguredReason?.(account, cfg) ?? "not configured";
          }
        }
        accounts[id] = next;
      }
      const defaultAccount =
        accounts[defaultAccountId] ?? cloneDefaultRuntime(plugin.id, defaultAccountId);
      channels[plugin.id] = defaultAccount;
      channelAccounts[plugin.id] = accounts;
    }
    return { channels, channelAccounts };
  };

  // New unified mode system
  const setChannelMode = async (
    channelId: ChannelId,
    mode: import("../channels/channel-mode.js").ChannelMode,
    options?: { dndMessage?: string; accountId?: string },
  ): Promise<void> => {
    const plugin = getChannelPlugin(channelId);
    if (!plugin) {
      throw new Error(`Unknown channel: ${channelId}`);
    }
    const cfg = loadConfig();
    const store = getStore(channelId);
    const accountIds = options?.accountId ? [options.accountId] : plugin.config.listAccountIds(cfg);
    const { getChannelModeCapabilities } = await import("../channels/channel-mode.js");

    for (const id of accountIds) {
      const modeState: ChannelModeState = {
        mode,
        dndMessage: options?.dndMessage,
      };
      store.modeOverrides.set(id, modeState);

      const capabilities = getChannelModeCapabilities(mode);

      if (capabilities.shouldConnect) {
        // Start the channel if mode requires connection
        await startChannel(channelId, id);
      } else {
        // Stop the channel if mode doesn't need connection
        await stopChannel(channelId, id);
      }
    }
  };

  const getChannelMode = (
    channelId: ChannelId,
    accountId?: string,
  ): import("../channels/channel-mode.js").ChannelMode | undefined => {
    const plugin = getChannelPlugin(channelId);
    if (!plugin) {
      return undefined;
    }
    const cfg = loadConfig();
    const store = getStore(channelId);
    const resolvedId =
      accountId ??
      plugin.config.defaultAccountId?.(cfg) ??
      plugin.config.listAccountIds(cfg)[0] ??
      DEFAULT_ACCOUNT_ID;

    const modeState = store.modeOverrides.get(resolvedId);
    return modeState?.mode;
  };

  const getChannelModeState = (
    channelId: ChannelId,
    accountId?: string,
  ):
    | { mode: import("../channels/channel-mode.js").ChannelMode; dndMessage?: string }
    | undefined => {
    const plugin = getChannelPlugin(channelId);
    if (!plugin) {
      return undefined;
    }
    const cfg = loadConfig();
    const store = getStore(channelId);
    const resolvedId =
      accountId ??
      plugin.config.defaultAccountId?.(cfg) ??
      plugin.config.listAccountIds(cfg)[0] ??
      DEFAULT_ACCOUNT_ID;

    return store.modeOverrides.get(resolvedId);
  };

  const clearChannelModeOverride = (channelId: ChannelId, accountId?: string): void => {
    const plugin = getChannelPlugin(channelId);
    if (!plugin) {
      return;
    }
    const cfg = loadConfig();
    const store = getStore(channelId);
    const accountIds = accountId ? [accountId] : plugin.config.listAccountIds(cfg);

    for (const id of accountIds) {
      store.modeOverrides.delete(id);
    }
  };

  // Legacy methods for backward compatibility
  const setChannelEnabled = async (
    channelId: ChannelId,
    enabled: boolean,
    accountId?: string,
  ): Promise<void> => {
    const mode = enabled ? "enabled" : "disabled";
    await setChannelMode(channelId, mode, { accountId });
  };

  const getChannelEnabled = (channelId: ChannelId, accountId?: string): boolean | undefined => {
    const mode = getChannelMode(channelId, accountId);
    if (mode === undefined) {
      return undefined;
    }
    return mode !== "disabled";
  };

  const clearChannelEnabledOverride = (channelId: ChannelId, accountId?: string): void => {
    clearChannelModeOverride(channelId, accountId);
  };

  const setChannelDnd = async (
    channelId: ChannelId,
    enabled: boolean,
    message?: string,
    accountId?: string,
  ): Promise<void> => {
    if (enabled) {
      await setChannelMode(channelId, "dnd", { dndMessage: message, accountId });
    } else {
      // If disabling DND, revert to enabled mode
      await setChannelMode(channelId, "enabled", { accountId });
    }
  };

  const getChannelDnd = (
    channelId: ChannelId,
    accountId?: string,
  ): { enabled: boolean; message?: string } | undefined => {
    const modeState = getChannelModeState(channelId, accountId);
    if (!modeState) {
      return undefined;
    }
    return {
      enabled: modeState.mode === "dnd",
      message: modeState.dndMessage,
    };
  };

  manager = {
    getRuntimeSnapshot,
    startChannels,
    startChannel,
    stopChannel,
    markChannelLoggedOut,
    // New unified mode system
    setChannelMode,
    getChannelMode,
    getChannelModeState,
    clearChannelModeOverride,
    // Legacy methods (use mode system internally)
    setChannelEnabled,
    getChannelEnabled,
    clearChannelEnabledOverride,
    setChannelDnd,
    getChannelDnd,
  };

  return manager;
}
