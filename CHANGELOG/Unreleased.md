## Unreleased

### NOVA Fork

- Reapplied the fork onto upstream `v2026.11.5` (previously rebuilt on `v2026.9.6`; SE run #1485, nova-openclaw#251). Carried forward: the `extensions/agent-identity-env/` plugin (`OPENCLAW_AGENT_ID`/`CLAWDBOT_AGENT_ID`/`OPENCLAW_SESSION_KEY` injection via the `resolve_exec_env` hook, replacing the old core-file patch whose target `src/agents/bash-tools.exec.ts` no longer exists), provider-refusal-triggers-model-fallback classification (`refusal` failover reason added to `FAILOVER_REASONS` across `src/agents/failover/*`, `packages/ai/src/providers/*`, and `packages/gateway-protocol/src/failover-reasons.ts` — carved out of the terminal-error gate and auth-profile rotation, but still advancing model fallback), synthetic `db:`/`fallback:` bootstrap path identifier preservation in `sanitizeBootstrapFiles` (`src/agents/bootstrap-files.ts`), the xurl `SKILL.md` media-upload-defaults warning, the dispatcher `markComplete` defence-in-depth coverage (`src/auto-reply/dispatch.test.ts`), and startup lease TTL scaling plus the agent-progress heartbeat pump (`src/infra/startup-migration-checkpoint.ts`, `src/state/openclaw-database-preflight-agent-scheduler.ts`). The bundled `himalaya` skill is intentionally kept in the repo per #212 scope; NOVA's running install removes it separately as post-deploy cleanup.

  Dropped from this reapply, with cause:
  - `66398bf` (dispatcher-registry/run-loop-drain log-detail-cap enhancement): its only consumer, `src/cli/gateway-cli/run-loop-drain.ts`, was deleted upstream in v2026.11.5. The enhancement itself (the `ReplyDispatcherRegistration` type, per-dispatcher `sessionKey`/`runId` fields, `getPendingReplyDetails()`) is **not** upstream and has no remaining consumer; the unrelated `markComplete` defence-in-depth behavior bundled in the same original commit was independently preserved via `dispatch.test.ts`.
  - `d8af674` (env-var-count-budget.txt reconstruction): absorbed by the earlier `818014bc5` conflict resolution, which already landed the budget at 460 (458 base + 2 for `agent-identity-env`'s two env vars).
  - `16eac5e` (Signal drain): dropped per I)ruid's ruling — Signal is unused.
  - `92346895` + `0d02944` (reply-dispatcher fix): unnecessary — upstream has carried the equivalent fix since v2026.11.3.
  - version-suffix patch: dropped (#212).

  Full patch audit, classification rationale, and staging/QA validation: (#251, #212).

### Fixes

- Control UI: keep automation editor actions flush with the scroll area's bottom, including on narrow screens and when editing job scratch. (#172176) Thanks @brandon-julio-t!
