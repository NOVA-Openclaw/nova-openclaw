// Agent Identity Environment plugin entrypoint.
// Re-implements the agent-identity exec-env injection from old patch 861e4e63823
// as a self-contained bundled plugin on the resolve_exec_env hook.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

const OPENCLAW_AGENT_ID = "OPENCLAW_AGENT_ID";
const CLAWDBOT_AGENT_ID = "CLAWDBOT_AGENT_ID";
const OPENCLAW_SESSION_KEY = "OPENCLAW_SESSION_KEY";

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveAgentIdentityExecEnv(
  _event: { host: "gateway" | "sandbox" | "node"; sessionKey?: string; toolName: "exec" },
  ctx: { agentId?: string; sessionKey?: string },
): Record<string, string> {
  const env: Record<string, string> = {};
  if (isNonBlankString(ctx.agentId)) {
    env[OPENCLAW_AGENT_ID] = ctx.agentId;
    // Legacy alias, same value — still read by shell-aliases.sh and other consumers.
    env[CLAWDBOT_AGENT_ID] = ctx.agentId;
  }
  if (isNonBlankString(ctx.sessionKey)) {
    env[OPENCLAW_SESSION_KEY] = ctx.sessionKey;
  }
  return env;
}

export default definePluginEntry({
  id: "agent-identity-env",
  name: "Agent Identity Environment",
  description:
    "Injects OPENCLAW_AGENT_ID, CLAWDBOT_AGENT_ID, and OPENCLAW_SESSION_KEY into exec child processes so scripts, hooks, and CLI tools can identify which agent initiated the execution.",
  register(api: OpenClawPluginApi) {
    api.on("resolve_exec_env", resolveAgentIdentityExecEnv);
  },
});

// Exported for tests so the implementation can be exercised directly without
// instantiating the plugin API.
export { resolveAgentIdentityExecEnv, OPENCLAW_AGENT_ID, CLAWDBOT_AGENT_ID, OPENCLAW_SESSION_KEY };
