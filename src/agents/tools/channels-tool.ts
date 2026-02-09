import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, type GatewayCallOptions } from "./gateway.js";

const CHANNEL_ACTIONS = [
  "mode.set",
  "mode.get",
  "dnd.enable",
  "dnd.disable",
  "dnd.status",
] as const;

const CHANNEL_MODES = ["enabled", "dnd", "read-only", "write-only", "disabled"] as const;

// Flattened schema to avoid top-level anyOf/oneOf (API compatibility)
const ChannelsToolSchema = Type.Object({
  action: stringEnum(CHANNEL_ACTIONS),
  channel: Type.Optional(Type.String()),
  accountId: Type.Optional(Type.String()),
  // mode.set
  mode: Type.Optional(stringEnum(CHANNEL_MODES)),
  message: Type.Optional(Type.String()),
  // Gateway connection (optional overrides)
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

export function createChannelsTool(opts?: {
  agentChannel?: string;
  agentAccountId?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Channels",
    name: "channels",
    description:
      "Control your own channel modes and settings. Set DND (Do Not Disturb), read-only, write-only, or disable channels. When setting DND, you can optionally provide an auto-reply message. Use this to manage your availability across channels.",
    parameters: ChannelsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      // Resolve channel and account (prefer explicit params, fall back to agent context)
      const channel =
        readStringParam(params, "channel") ??
        opts?.agentChannel ??
        (() => {
          throw new Error(
            "channel parameter is required (or must be inferrable from agent context)",
          );
        })();

      const accountId = readStringParam(params, "accountId") ?? opts?.agentAccountId;

      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl:
          typeof params.gatewayUrl === "string" && params.gatewayUrl.trim()
            ? params.gatewayUrl.trim()
            : undefined,
        gatewayToken:
          typeof params.gatewayToken === "string" && params.gatewayToken.trim()
            ? params.gatewayToken.trim()
            : undefined,
        timeoutMs:
          typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
            ? Math.max(1, Math.floor(params.timeoutMs))
            : undefined,
      };

      if (action === "mode.set") {
        const mode = readStringParam(params, "mode", { required: true });
        if (!["enabled", "dnd", "read-only", "write-only", "disabled"].includes(mode)) {
          throw new Error(
            `Invalid mode: ${mode}. Must be one of: enabled, dnd, read-only, write-only, disabled`,
          );
        }
        const message = readStringParam(params, "message");

        const result = await callGatewayTool(
          "channels.mode.set",
          gatewayOpts,
          {
            channel,
            mode,
            accountId,
            dndMessage: mode === "dnd" ? message : undefined,
          },
          { expectFinal: true },
        );

        return jsonResult({
          ok: true,
          channel,
          accountId,
          mode,
          message: mode === "dnd" ? message : undefined,
          result,
        });
      }

      if (action === "mode.get") {
        const result = await callGatewayTool(
          "channels.mode.get",
          gatewayOpts,
          {
            channel,
            accountId,
          },
          { expectFinal: true },
        );

        return jsonResult({
          ok: true,
          channel,
          accountId,
          result,
        });
      }

      if (action === "dnd.enable") {
        const message = readStringParam(params, "message");

        const result = await callGatewayTool(
          "channels.dnd.set",
          gatewayOpts,
          {
            channel,
            enabled: true,
            message,
            accountId,
          },
          { expectFinal: true },
        );

        return jsonResult({
          ok: true,
          channel,
          accountId,
          enabled: true,
          message,
          result,
        });
      }

      if (action === "dnd.disable") {
        const result = await callGatewayTool(
          "channels.dnd.set",
          gatewayOpts,
          {
            channel,
            enabled: false,
            accountId,
          },
          { expectFinal: true },
        );

        return jsonResult({
          ok: true,
          channel,
          accountId,
          enabled: false,
          result,
        });
      }

      if (action === "dnd.status") {
        const result = await callGatewayTool(
          "channels.dnd.get",
          gatewayOpts,
          {
            channel,
            accountId,
          },
          { expectFinal: true },
        );

        return jsonResult({
          ok: true,
          channel,
          accountId,
          result,
        });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
