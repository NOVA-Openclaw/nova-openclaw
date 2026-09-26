# Agent Identity Environment plugin

Fork-owned bundled plugin. Injects agent-identity environment variables into
`exec` tool child processes, using the upstream `resolve_exec_env` plugin hook
(added upstream 2026-06-02) instead of patching core exec-tool internals.

## Why this exists

Scripts, hooks, and CLI tools invoked through the `exec` tool sometimes need
to know which agent and session initiated the command — for attribution,
logging, or callback routing. Upstream's `resolve_exec_env` hook makes the
`agentId` and `sessionKey` available to plugins, but exporting them as
environment variables still requires a plugin that chooses to do so (per
`docs/releases/2026.9.2.md`). No first-party plugin ships that export by
default. This plugin is that export, re-implementing the behavior of the
fork's older core-file patch (`861e4e63823`,
`feat(exec): inject OPENCLAW_AGENT_ID and session env vars for subagents`) as
a self-contained plugin so it survives future upstream restructuring of the
exec-tool internals (the original patch's target file,
`src/agents/bash-tools.exec.ts`, no longer exists as of upstream v2026.9.6 —
it was split into 235 files under `src/agents/bash-tools.exec-*.ts`).

## What it does

On every `exec` tool invocation (any host: `gateway`, `sandbox`, or `node`),
the plugin's `resolve_exec_env` handler reads `ctx.agentId` and
`ctx.sessionKey` from the hook context and returns:

| Variable               | Value            | Notes                                                                           |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------- |
| `OPENCLAW_AGENT_ID`    | `ctx.agentId`    | Omitted (not empty-string) if `agentId` is absent                               |
| `CLAWDBOT_AGENT_ID`    | `ctx.agentId`    | Legacy alias, same value — still read by `shell-aliases.sh` and other consumers |
| `OPENCLAW_SESSION_KEY` | `ctx.sessionKey` | Passed through verbatim, unparsed — omitted if `sessionKey` is absent           |

The plugin does not special-case `host`, does not parse or rewrite session
keys, and never emits an empty-string value for a missing field — a variable
is either present with a real value or absent from the returned object.

## Hook used

Registers on the `resolve_exec_env` hook (`src/plugins/hook-types.ts`,
`PluginHookResolveExecEnvContext`). See
[Exec environment hook](../../docs/plugins/hooks/tool-policy.md#exec-environment-hook)
for the full hook contract, including the host exec-environment key policy
that filters plugin-contributed variables (`PATH` is always dropped; `LD_*`,
`DYLD_*`, `NODE_OPTIONS`, proxy, and TLS-override variables are dropped). None
of those filtered names collide with the three variables this plugin sets.

## Config

No configuration. `openclaw.plugin.json` declares an empty `configSchema` and
`activation.onStartup: true` — the plugin must load on startup or the
variables silently never appear in any `exec` call. `enabledByDefault: true`
ships it active in every install without opt-in.

## Testing

See `index.test.ts` for the full unit/integration suite (21 test cases,
`TC-212-1-*` IDs) and
`test/TEST-CASES-ISSUE-212.md` section 1 for the test design and decision
history (e.g. why `onStartup: true` is mandatory, and the plugin-precedence
rule when a hook handler and an explicit caller-supplied env both set the
same key).
