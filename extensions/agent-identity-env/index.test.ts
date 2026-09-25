// Agent Identity Environment plugin tests — Issue #212, section 1.
// TC-212-1-* ids are carried into it() titles per the test design.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHookHandlersForTest } from "openclaw/plugin-sdk/channel-test-helpers";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExecRequestPreparation,
  resolvePreparedExecEnvironment,
} from "../../src/agents/bash-tools.exec-request-preparation.js";
import { loadGatewayStartupPluginPlan } from "../../src/plugins/gateway-startup-plugin-ids.js";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "../../src/plugins/hook-runner-global.js";
import { createMockPluginRegistry } from "../../src/plugins/hooks.test-fixtures.js";
import plugin, { CLAWDBOT_AGENT_ID, OPENCLAW_AGENT_ID, OPENCLAW_SESSION_KEY } from "./index.js";
import manifest from "./openclaw.plugin.json" with { type: "json" };

const WORKTREE_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

function getPluginHandler() {
  const handlers = registerHookHandlersForTest<OpenClawPluginApi>({
    config: {},
    register: plugin.register,
  });
  const handler = handlers.get("resolve_exec_env");
  if (!handler) {
    throw new Error("agent-identity-env did not register a resolve_exec_env handler");
  }
  return handler as (
    event: unknown,
    ctx: unknown,
  ) => Record<string, string> | Promise<Record<string, string>>;
}

function installPluginHookInGlobalRegistry(params?: {
  handler?: (event: unknown, ctx: unknown) => unknown;
}) {
  const registry = createMockPluginRegistry([
    {
      pluginId: "agent-identity-env",
      hookName: "resolve_exec_env",
      handler: params?.handler ?? getPluginHandler(),
    },
  ]);
  initializeGlobalHookRunner(registry);
}

describe("agent-identity-env plugin", () => {
  afterEach(() => {
    resetGlobalHookRunner();
    vi.useRealTimers();
  });

  describe("TC-212-1-U-01..U-11, U-14: resolve_exec_env handler unit behavior", () => {
    const handler = getPluginHandler();

    it("TC-212-1-U-01: returns exactly the three identity vars for a main agent", async () => {
      const result = await handler(
        { sessionKey: "agent:gem:main", toolName: "exec", host: "gateway" },
        { agentId: "gem", sessionKey: "agent:gem:main" },
      );
      expect(result).toEqual({
        OPENCLAW_AGENT_ID: "gem",
        CLAWDBOT_AGENT_ID: "gem",
        OPENCLAW_SESSION_KEY: "agent:gem:main",
      });
    });

    it("TC-212-1-U-02: passes a subagent session key through verbatim", async () => {
      const sessionKey = "agent:gem:subagent:330cff92-1111-2222-3333-444444444444";
      const result = await handler(
        { sessionKey, toolName: "exec", host: "gateway" },
        { agentId: "gem", sessionKey },
      );
      expect(result.OPENCLAW_SESSION_KEY).toBe(sessionKey);
    });

    it("TC-212-1-U-03: returns identical vars for gateway, sandbox, and node hosts", async () => {
      const ctx = { agentId: "gem", sessionKey: "agent:gem:main" };
      const expected = {
        OPENCLAW_AGENT_ID: "gem",
        CLAWDBOT_AGENT_ID: "gem",
        OPENCLAW_SESSION_KEY: "agent:gem:main",
      };
      for (const host of ["gateway", "sandbox", "node"] as const) {
        const result = await handler({ sessionKey: ctx.sessionKey, toolName: "exec", host }, ctx);
        expect(result).toEqual(expected);
      }
    });

    it("TC-212-1-U-04: omits agent vars when ctx.agentId is undefined", async () => {
      const result = await handler(
        { sessionKey: "agent:gem:main", toolName: "exec", host: "gateway" },
        { sessionKey: "agent:gem:main" },
      );
      expect(result).toEqual({ OPENCLAW_SESSION_KEY: "agent:gem:main" });
      expect(result).not.toHaveProperty(OPENCLAW_AGENT_ID);
      expect(result).not.toHaveProperty(CLAWDBOT_AGENT_ID);
    });

    it("TC-212-1-U-05: omits session key when ctx.sessionKey is undefined", async () => {
      const result = await handler({ toolName: "exec", host: "gateway" }, { agentId: "gem" });
      expect(result).toEqual({ OPENCLAW_AGENT_ID: "gem", CLAWDBOT_AGENT_ID: "gem" });
      expect(result).not.toHaveProperty(OPENCLAW_SESSION_KEY);
    });

    it("TC-212-1-U-06: returns empty object when both ctx.agentId and ctx.sessionKey are undefined", async () => {
      const result = await handler({ toolName: "exec", host: "gateway" }, {});
      expect(result).toEqual({});
    });

    it("TC-212-1-U-07: treats empty-string agentId as absent", async () => {
      const result = await handler(
        { toolName: "exec", host: "gateway" },
        { agentId: "", sessionKey: "agent:gem:main" },
      );
      expect(result).toEqual({ OPENCLAW_SESSION_KEY: "agent:gem:main" });
      expect(result).not.toHaveProperty(OPENCLAW_AGENT_ID);
    });

    it("TC-212-1-U-08: treats whitespace-only agentId as absent", async () => {
      const result = await handler(
        { toolName: "exec", host: "gateway" },
        { agentId: "   ", sessionKey: "agent:gem:main" },
      );
      expect(result).toEqual({ OPENCLAW_SESSION_KEY: "agent:gem:main" });
      expect(result).not.toHaveProperty(OPENCLAW_AGENT_ID);
    });

    it("TC-212-1-U-09: passes a newline-containing sessionKey through raw", async () => {
      const sessionKey = "agent:gem:main\ninjected";
      const result = await handler(
        { sessionKey, toolName: "exec", host: "gateway" },
        { agentId: "gem", sessionKey },
      );
      expect(result.OPENCLAW_SESSION_KEY).toBe(sessionKey);
    });

    it("TC-212-1-U-10: does not throw on non-string/null/undefined agentId", async () => {
      await expect(
        Promise.resolve(
          handler({ toolName: "exec", host: "gateway" }, {
            agentId: 12345,
            sessionKey: "agent:gem:main",
          } as never),
        ),
      ).resolves.toEqual({ OPENCLAW_SESSION_KEY: "agent:gem:main" });
      await expect(
        Promise.resolve(
          handler({ toolName: "exec", host: "gateway" }, {
            agentId: null,
            sessionKey: "agent:gem:main",
          } as never),
        ),
      ).resolves.toEqual({ OPENCLAW_SESSION_KEY: "agent:gem:main" });
    });

    it("TC-212-1-U-11: filterPluginExecEnv/merge layer does not drop the three identity vars", async () => {
      // Indirect test: if the core filter dropped these keys, resolvePreparedExecEnvironment
      // would not surface them. The dangerous-prefix blocklist is not exported, so we exercise
      // the real merge path.
      const { env } = resolvePreparedExecEnvironment({
        execParams: { command: "env" },
        host: "gateway",
        pluginEnv: {
          [OPENCLAW_AGENT_ID]: "gem",
          [CLAWDBOT_AGENT_ID]: "gem",
          [OPENCLAW_SESSION_KEY]: "agent:gem:main",
        },
        defaultPathPrepend: [],
        warnings: [],
      });
      expect(env[OPENCLAW_AGENT_ID]).toBe("gem");
      expect(env[CLAWDBOT_AGENT_ID]).toBe("gem");
      expect(env[OPENCLAW_SESSION_KEY]).toBe("agent:gem:main");
    });

    it("TC-212-1-U-14: CLAWDBOT_AGENT_ID is a straight duplicate of OPENCLAW_AGENT_ID", async () => {
      const result = await handler(
        { toolName: "exec", host: "gateway" },
        { agentId: "gem", sessionKey: "agent:gem:main" },
      );
      expect(result[CLAWDBOT_AGENT_ID]).toBe(result[OPENCLAW_AGENT_ID]);
      expect(result[CLAWDBOT_AGENT_ID]).toBe("gem");
    });
  });

  describe("TC-212-1-INT-01, INT-02, U-12, U-13, U-15: exec-request-preparation integration", () => {
    it("TC-212-1-INT-01: identity vars land in final resolved env via real exec request preparation", async () => {
      installPluginHookInGlobalRegistry();
      const prep = createExecRequestPreparation({
        agentId: "gem",
        resolveHostForParams: () => "gateway",
      });
      const prepared = await prep.prepareParamsWithResolvedExecEnv(
        { command: "env" },
        { hookContext: { agentId: "gem", sessionKey: "agent:gem:main" } },
      );
      const state = prep.getResolvedExecEnvPreparedState(prepared);
      const { env } = resolvePreparedExecEnvironment({
        execParams: prepared,
        host: "gateway",
        pluginEnv: state?.pluginEnv,
        defaultPathPrepend: [],
        warnings: [],
      });
      expect(env[OPENCLAW_AGENT_ID]).toBe("gem");
      expect(env[CLAWDBOT_AGENT_ID]).toBe("gem");
      expect(env[OPENCLAW_SESSION_KEY]).toBe("agent:gem:main");
    });

    it("TC-212-1-INT-02: plugin env wins over explicit per-call exec env (decided precedence)", async () => {
      const { env } = resolvePreparedExecEnvironment({
        execParams: { command: "env", env: { [OPENCLAW_AGENT_ID]: "spoofed-agent" } },
        host: "gateway",
        pluginEnv: { [OPENCLAW_AGENT_ID]: "gem" },
        defaultPathPrepend: [],
        warnings: [],
      });
      expect(env[OPENCLAW_AGENT_ID]).toBe("gem");
    });

    it("TC-212-1-U-12 companion: a throwing handler does not break exec preparation", async () => {
      installPluginHookInGlobalRegistry({
        handler: () => {
          throw new Error("plugin failed");
        },
      });
      const prep = createExecRequestPreparation({
        agentId: "gem",
        resolveHostForParams: () => "gateway",
      });
      await expect(
        prep.prepareParamsWithResolvedExecEnv(
          { command: "env" },
          { hookContext: { agentId: "gem", sessionKey: "agent:gem:main" } },
        ),
      ).resolves.toBeDefined();
    });

    it("TC-212-1-U-13: a hanging handler is skipped after the 15s hook timeout", async () => {
      vi.useFakeTimers();
      installPluginHookInGlobalRegistry({
        handler: () => new Promise<never>(() => {}),
      });
      const prep = createExecRequestPreparation({
        agentId: "gem",
        resolveHostForParams: () => "gateway",
      });
      const preparedPromise = prep.prepareParamsWithResolvedExecEnv(
        { command: "env" },
        { hookContext: { agentId: "gem", sessionKey: "agent:gem:main" } },
      );
      await vi.advanceTimersByTimeAsync(16_000);
      const prepared = await preparedPromise;
      const state = prep.getResolvedExecEnvPreparedState(prepared);
      expect(state?.pluginEnv).toBeUndefined();
    });

    it("TC-212-1-U-15: plugin env survives node-host exec-env payload construction", async () => {
      installPluginHookInGlobalRegistry();
      const prep = createExecRequestPreparation({
        agentId: "gem",
        resolveHostForParams: () => "node",
      });
      const prepared = await prep.prepareParamsWithResolvedExecEnv(
        { command: "env" },
        { hookContext: { agentId: "gem", sessionKey: "agent:gem:main" } },
      );
      const state = prep.getResolvedExecEnvPreparedState(prepared);
      const { env } = resolvePreparedExecEnvironment({
        execParams: prepared,
        host: "node",
        pluginEnv: state?.pluginEnv,
        defaultPathPrepend: [],
        warnings: [],
      });
      expect(env[OPENCLAW_AGENT_ID]).toBe("gem");
      expect(env[CLAWDBOT_AGENT_ID]).toBe("gem");
      expect(env[OPENCLAW_SESSION_KEY]).toBe("agent:gem:main");
    });
  });

  describe("TC-212-1-INT-04: intent parity with old patch 861e4e63823", () => {
    const handler = getPluginHandler();

    it("produces identical var names and values for a main agent and a subagent", async () => {
      const main = await handler(
        { sessionKey: "agent:gidget:main", toolName: "exec", host: "gateway" },
        { agentId: "gidget", sessionKey: "agent:gidget:main" },
      );
      expect(main).toEqual({
        OPENCLAW_AGENT_ID: "gidget",
        CLAWDBOT_AGENT_ID: "gidget",
        OPENCLAW_SESSION_KEY: "agent:gidget:main",
      });

      const sub = await handler(
        {
          sessionKey: "agent:gem:subagent:330cff92-1111-2222-3333-444444444444",
          toolName: "exec",
          host: "gateway",
        },
        { agentId: "gem", sessionKey: "agent:gem:subagent:330cff92-1111-2222-3333-444444444444" },
      );
      expect(sub).toEqual({
        OPENCLAW_AGENT_ID: "gem",
        CLAWDBOT_AGENT_ID: "gem",
        OPENCLAW_SESSION_KEY: "agent:gem:subagent:330cff92-1111-2222-3333-444444444444",
      });
    });

    it("U-09 companion: newline in value is not rejected by the merge/filter layer", async () => {
      const sessionKey = "agent:gem:main\ninjected";
      const { env } = resolvePreparedExecEnvironment({
        execParams: { command: "env" },
        host: "gateway",
        pluginEnv: {
          [OPENCLAW_AGENT_ID]: "gem",
          [CLAWDBOT_AGENT_ID]: "gem",
          [OPENCLAW_SESSION_KEY]: sessionKey,
        },
        defaultPathPrepend: [],
        warnings: [],
      });
      expect(env[OPENCLAW_SESSION_KEY]).toBe(sessionKey);
    });
  });

  describe("TC-212-1-U-16, INT-05: manifest and fresh-install activation", () => {
    it("TC-212-1-U-16: manifest declares activation.onStartup: true and is enabled by default", () => {
      expect(manifest.id).toBe("agent-identity-env");
      expect(manifest.activation).toEqual({ onStartup: true });
      // enabledByDefault is required for a hook-only plugin with no other activation
      // trigger (channels/providers/tools) to start on a fresh install.
      expect(manifest.enabledByDefault).toBe(true);
      expect(manifest.configSchema).toBeDefined();
    });

    it("TC-212-1-INT-05: plugin is in the fresh-install startup plan with no user config", () => {
      const plan = loadGatewayStartupPluginPlan({
        config: {},
        workspaceDir: WORKTREE_ROOT,
        env: process.env,
      });
      expect(plan.pluginIds).toContain("agent-identity-env");
    });
  });
});
