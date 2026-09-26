# Test Cases — Issue #212 (upstream v2026.9.6 rebuild)

**[PROMOTION STATUS — SE #1009 Step 8, 2026-09-26]** All executable test cases
designed below (77 of 78 IDs; `TC-212-5-U-08` was explicitly dropped per Step 4
review) were already promoted into the project's permanent co-located test
suite during steps 5-6, carrying their TC IDs into `it()`/`describe()` titles
per this file's own convention (see `test/TEST-CASES-ISSUE-212.md`'s
"Conventions" note below). Permanent homes: `extensions/agent-identity-env/index.test.ts`,
`packages/ai/src/providers/{anthropic-refusal,openai-chatgpt-responses-streaming,openai-responses-provider-refusal,openai-responses-shared}.test.ts`,
`src/agents/bootstrap-files.test.ts`, `src/agents/failover/{refusal-classification,signal}.test.ts`,
`src/agents/embedded-agent-runner/{result-fallback-classifier,run.refusal-fallback}.test.ts`,
`src/agents/embedded-agent-runner/run/{auth-profile-failure-policy,failover-policy}.test.ts`,
`src/agents/cli-session.test.ts`, `test/scripts/package-changelog.test.ts`.
Full PASS/FAIL/UNTESTED mapping and staging validation:
`se-runs/1009/step8-qa-validation.md`. This design document is retained
in-place (not deleted/relocated) for historical decision traceability
(ambiguities, Step 4 review resolutions, I)ruid rulings) — it is a planning
artifact, not an active test-execution surface; no CI process reads it.

---

Test design owner: Gem (QA Lead). SE run #1009, Step 3.

Scope: the five re-applied fork items and the staging gate defined in issue
#212. Source of truth for requirements: the issue body + all Step 1/2 decision
comments, and `~/.openclaw/workspace/reports/nova-openclaw-patch-audit-v2026.9.6.md`.

Conventions: this repo uses `test/` (not `tests/`) for cross-cutting suites and
co-located `*.test.ts` next to the source file for unit tests, per
`test/AGENTS.md` and the existing `src/agents/bootstrap-files.test.ts` /
`src/agents/failover/*.test.ts` pattern. Test IDs below are stable references
for implementation and review; they are not enforced file/describe names, but
implementers should carry the ID into the `it()` title (see existing
`TC-243-*` precedent in `src/agents/bootstrap-files.test.ts` from the old fork).

Legend: **[U]** unit, **[INT]** integration (real production code path, not a
hand-built context), **[STAGE]** staging-only (desk review / manual gate, not
CI unit tests), **[KILL]** kill-check (must fail when the mechanism is
disabled/reverted — proves the test isn't vacuously green).

---

## 1. Agent-identity exec-env plugin (`resolve_exec_env` hook)

Target: a new self-contained `extensions/agent-identity-env/` plugin
(decided name, Step 4 review 2026-09-24) registering `resolve_exec_env`.
Reference behavior: old patch `861e4e63823`. Contract:
`src/agents/bash-tools.exec-request-preparation.ts` (`prepareParamsWithResolvedExecEnv`
~L262-285, `filterPluginExecEnv` ~L104, merge at
`resolvePreparedExecEnvironment` ~L389), hook types in `src/plugins/hook-types.ts`
(`PluginHookResolveExecEnvEvent`/`Context` ~L1042-1049, handler signature
~L1227-1230), docs `docs/plugins/hooks/tool-policy.md` "Exec environment hook"
(~L252-276).

### 1.1 Happy path

- **TC-212-1-U-01**: `resolve_exec_env` handler given `ctx.agentId = "gem"`,
  `ctx.sessionKey = "agent:gem:main"` returns exactly
  `{ OPENCLAW_AGENT_ID: "gem", CLAWDBOT_AGENT_ID: "gem", OPENCLAW_SESSION_KEY: "agent:gem:main" }`.
  No extra keys.
- **TC-212-1-U-02**: subagent session key form (e.g.
  `agent:gem:subagent:330cff92-...`) is passed through unchanged as the
  `OPENCLAW_SESSION_KEY` value — the plugin must not attempt to parse/rewrite
  session keys, only pass through `ctx.sessionKey` verbatim.
- **TC-212-1-U-03**: `event.host` is each of `"gateway"`, `"sandbox"`, `"node"`
  in turn — same three vars returned identically regardless of host (the old
  patch covered host/gateway/sandbox/node explicitly; the plugin must not
  special-case `host`).

### 1.2 Missing/partial context → omission, never empty-string

- **TC-212-1-U-04**: `ctx.agentId` is `undefined` → `OPENCLAW_AGENT_ID` and
  `CLAWDBOT_AGENT_ID` are both **absent from the returned object**, not set to
  `""`. `OPENCLAW_SESSION_KEY` still set if `ctx.sessionKey` present.
- **TC-212-1-U-05**: `ctx.sessionKey` is `undefined` → `OPENCLAW_SESSION_KEY`
  absent; agent vars still set if `ctx.agentId` present.
- **TC-212-1-U-06**: both `ctx.agentId` and `ctx.sessionKey` undefined → handler
  returns `{}` (or `undefined`/void — assert whichever the implementation
  chooses is handled correctly by the hook runner per
  `hook-resolve-exec-env.test.ts`'s "empty env when no handlers" case), not an
  object containing empty-string values.
- **TC-212-1-U-07 [adversarial]**: `ctx.agentId = ""` (empty string) →
  treated as absent (omit the var), not injected as `OPENCLAW_AGENT_ID=""`.
  Rationale: an empty string is falsy-but-truthy-as-a-key-presence bug magnet;
  the AC says "missing agentId/sessionKey → that var is omitted", and an empty
  string is a degenerate form of missing.
- **TC-212-1-U-08 [adversarial]**: `ctx.agentId = "   "` (whitespace only) →
  same as TC-212-1-U-07, treated as absent. Do not inject a whitespace-only
  env value.
- **TC-212-1-U-09 [adversarial]**: `ctx.sessionKey` containing a newline
  (`"agent:gem:main\ninjected"`) → the plugin passes the raw string through (it
  is not the plugin's job to sanitize — that's `filterPluginExecEnv`'s /
  `normalizeHostOverrideEnvVarKey`'s job, which validates **keys**, not
  **values**). Document/assert this is a non-goal for the plugin itself, and
  add a companion test at the `filterPluginExecEnv`/merge layer (TC-212-1-INT-04
  below) confirming a newline in the _value_ is not rejected by the exec-env
  filter (only key format is validated) — this is expected/known behavior, not
  a defect, but must be asserted so a future "fix" doesn't silently change
  exec's env-passing semantics without a test noticing.
- **TC-212-1-U-10 [adversarial]**: `ctx.agentId` is not a string at the type
  level cannot be constructed in TS, but a hand-built JS-caller (simulating a
  misbehaving 3rd-party plugin dependency or hook-runner bug) passes
  `ctx.agentId = 12345` (number) or `ctx.agentId = null` → the plugin must not
  throw; either coerce defensively to absent, or the hook runner's existing
  error isolation (`hook-resolve-exec-env.test.ts` "isolates handler errors")
  catches it and the exec still runs. Assert exec is not blocked either way.

### 1.3 Hook contract / merge precedence (config→runtime seam)

- **TC-212-1-INT-01 [seam]**: drive `createExecRequestPreparation(...).prepareBeforeToolCallParams`
  and `resolvePreparedExecEnvironment` through the **real** exec-request-prep
  module (not a hand-built context) with a registered test hook via
  `getGlobalHookRunner()`/`createHookRunner` + `registerHookHandlersForTest`
  (see `extensions/discord/src/subagent-hooks.test.ts` for the pattern), a real
  `HookContext` carrying `agentId`/`sessionKey`, and assert the three env vars
  land in the final resolved `env` object returned to the exec tool. This is
  the "hook context populated by real production code" requirement — do not
  hand-construct `PluginHookResolveExecEnvContext` directly for this one test.
- **TC-212-1-INT-02 [precedence, DECIDED 2026-09-24]**: call `resolvePreparedExecEnvironment`
  with `execParams.env = { OPENCLAW_AGENT_ID: "spoofed-agent" }` (explicit
  per-call override) and `pluginEnv = { OPENCLAW_AGENT_ID: "gem" }` → resulting
  merged env has `OPENCLAW_AGENT_ID: "gem"` (plugin wins). This is the
  I)ruid-decided precedence (2026-09-24): plugin env overrides explicit
  per-call `env`, intentionally breaking agent-spoofing. Assert the _opposite_
  outcome would fail this test (do not write it permissively).
- **TC-212-1-INT-03**: inline shell assignment still wins — this is a
  behavior of the shell itself, not the plugin, so no unit test can assert it
  directly; instead assert (documentation-level, or via a fixture that greps
  the merged env map) that the plugin does not attempt to intercept or block
  shell-level env reassignment; i.e., the plugin only contributes to the
  `env` map passed to the child process spawn call, never to shell source
  parsing. Mark this test **[STAGE]**-adjacent: a true end-to-end exec run
  (`CLAWDBOT_AGENT_ID=other-agent gh ...`) showing the shell-assigned value
  wins is a desk-review/manual check, not a unit test, because the shell's
  variable-assignment precedence is out of this plugin's control surface.
- **TC-212-1-U-11**: `filterPluginExecEnv` (existing core function, not
  plugin-owned) does **not** drop `OPENCLAW_AGENT_ID`, `CLAWDBOT_AGENT_ID`, or
  `OPENCLAW_SESSION_KEY` — confirm none of these three names collide with
  `isDangerousHostEnvVarName`/`isDangerousHostEnvOverrideVarName`/`PATH`/
  `OPENCLAW_CLI`. This is a **[KILL]** candidate: if a future change adds
  `OPENCLAW_*` to the dangerous-prefix blocklist, this test must fail loudly
  rather than silently dropping the vars.

### 1.4 Hook failure mode (log-and-skip, exec must still run)

- **TC-212-1-U-12**: registered `resolve_exec_env` handler throws
  synchronously → exec preparation still completes and returns an env object
  (possibly without the plugin's vars, per `hook-resolve-exec-env.test.ts`'s
  existing "isolates handler errors" behavior at the hook-runner layer); assert
  at the exec-request-preparation integration level that `prepareBeforeToolCallParams`
  does not reject/throw.
- **TC-212-1-U-13**: registered handler hangs past the 15s hook timeout (use
  fake timers per `test/AGENTS.md` — this belongs in `vitest.unit-fast-fake-timers`,
  not `unit-fast`) → hook runner's existing 15s-timeout-then-skip behavior
  (already covered generically by `hook-resolve-exec-env.test.ts`) results in
  exec proceeding without the plugin's env vars, not exec hanging for 15s
  visibly to the caller in a way that surfaces as a tool failure.
- **TC-212-1-KILL-01**: comment out / stub the plugin's hook registration
  entirely (simulate "plugin not installed") → `OPENCLAW_AGENT_ID` etc. do not
  appear anywhere in the exec environment for any host. This proves the deploy-
  ordering constraint from the Step 1 decision comment ("a v2026.9.6 gateway
  without the plugin loses these vars, and consumers silently fall back") is
  real and observable, not assumed. Named test must fail with the plugin
  disabled and pass with it enabled.

### 1.5 Intent-level check against OLD behavior (861e4e63823)

- **TC-212-1-INT-04 [intent parity]**: for a fixed `agentId="gidget"`,
  `sessionKey="agent:gidget:main"` (main agent) AND a fixed
  `agentId="gem"`, `sessionKey="agent:gem:subagent:<uuid>"` (subagent), assert
  the **var names and values** produced by the new plugin are identical to
  what `861e4e63823`'s `bash-tools.exec.ts` diff produced for the same inputs:
  `OPENCLAW_AGENT_ID = agentId`, `CLAWDBOT_AGENT_ID = agentId` (legacy alias,
  same value, not a different derived form), `OPENCLAW_SESSION_KEY = defaults.sessionKey`.
  This guards against a subtle rewrite regression (e.g. accidentally using
  `ctx.sessionId` instead of `ctx.sessionKey`, which are different fields per
  `PluginHookAgentContext`). Reference: old patch diff, `git -C ~/nova-openclaw show 861e4e63823`.
- **TC-212-1-U-14**: `CLAWDBOT_AGENT_ID` is a straight duplicate of
  `OPENCLAW_AGENT_ID`'s value (not a transformed/prefixed variant) — this
  matches old-patch intent ("legacy alias, still read by shell-aliases.sh") and
  guards against someone "helpfully" changing the alias format during the
  rewrite.

### 1.6 Node-host forwarding

- **TC-212-1-U-15**: `event.host === "node"` → plugin env is present in the
  payload documented as "forwarded to node-host execution requests" (per
  `docs/plugins/hooks/tool-policy.md`). If forwarding is implemented at a layer
  outside the plugin itself (i.e., already-existing core behavior per the
  patch audit's "Plugin env is forwarded to node-host execution" observation),
  this test should assert at the integration level that the plugin's returned
  vars survive being routed through the node-host exec-env payload
  construction, not just that the plugin function returns the right object in
  isolation.

### 1.7 Plugin activation on a fresh install — added per Step 4 review (gap B)

Confirmed via `src/plugins/gateway-startup-plugin-config.ts:246`
(`shouldConsiderForGatewayStartup`) and `docs/plugins/manifest/capabilities.md:177`:
"Omitting `onStartup` no longer startup-loads the plugin implicitly." A
hook-only plugin with no channel/provider/command/route/config-path surface to
hang narrower activation off of (per the `onProviders`/`onCommands`/
`onChannels`/`onRoutes`/`onConfigPaths`/`onCapabilities` fields at
`docs/plugins/manifest/capabilities.md:193-202`) has no other trigger path — it
must set `activation.onStartup: true` explicitly in
`extensions/agent-identity-env/openclaw.plugin.json`, or it silently never
loads on a real gateway even though its code, hook registration, and every
unit test above are otherwise correct. This is exactly the silent-fallback
failure mode item 1 exists to prevent, one layer up the stack from where the
unit tests above look.

- **TC-212-1-U-16 [manifest]**: `extensions/agent-identity-env/openclaw.plugin.json`
  is present, parses, matches the manifest shape used by other bundled
  hook-only plugins (e.g. `active-memory`'s manifest as a reference example),
  and declares `activation.onStartup === true` literally — not merely absent,
  per the confirmed doc language that absence means startup-lazy, not
  startup-by-default.
- **TC-212-1-INT-05 [real loader, not JSON-only]**: drive the actual plugin
  discovery/activation-planning path (the function(s) that call
  `shouldConsiderForGatewayStartup`, or the public loader entry point used by
  `test/cli-json-stdout.plugins.e2e.test.ts`'s `plugins list --json`
  invocation) against a fixture installation containing this plugin with **no
  user config at all** (fresh install, no `plugins.*` block, no explicit
  enable), and assert the plugin appears in the resulting startup/load plan.
  This must exercise the real planner function, not just read the JSON file
  and assert a boolean field — the planner has its own precedence rules
  (context-engine slot, dreaming-plugin startup set, etc.) that a hand-read of
  the manifest cannot verify.
- **TC-212-1-KILL-02**: `activation.onStartup` flipped to `false` (or omitted)
  in the manifest → TC-212-1-INT-05 must fail (plugin absent from the
  fresh-install startup plan). Confirms the test actually exercises
  activation, not just manifest-file presence.
- **TC-212-1-STAGE-01**: on the staged gateway (STAGE-02 below), run
  `openclaw plugins list --json` (or the gateway's equivalent loaded-plugins
  surface) and confirm the new plugin id appears in the loaded/active list —
  the true end-to-end version of TC-212-1-INT-05, against the real staged
  install rather than a test harness.

---

## 2. Provider refusal → configured fallback chain

Targets: `packages/gateway-protocol/src/failover-reasons.ts` (add `"refusal"`),
`src/agents/failover/message-patterns.ts` (new `isRefusalErrorMessage()`),
`src/agents/failover/classify.ts` / `classification-rules.ts`
(`classifyFailoverReasonFromCode` gains a case), `packages/ai/src/providers/anthropic-refusal.ts`
(`applyAnthropicRefusal` needs to surface something the classifier can key on —
currently sets `diagnostics[].type: "provider_refusal"` with **no `errorCode`**),
and the assistant/auth-controller wiring so `"refusal"` behaves as
content-scoped (no auth-profile rotation, straight to next model) per the
Step 2 I)ruid decision.

**Step 4 review resolution (2026-09-24) for the seam conflict (former
Ambiguity #1, now CONFIRMED):** `src/agents/embedded-agent-helpers/assistant-message-failures.ts:33`
returns `null` when `isTerminalAssistantError(msg)`, and `src/llm/utils/retry.ts:37`
makes every provider refusal terminal via `isProviderRefusalAssistantError`.
DECISION: option (a) — carve refusals out of the early return inside
`classifyAssistantFailoverReason` only. `isTerminalAssistantError` itself
stays unchanged everywhere else (it has a legitimate, different job for the
_retry_ classifier — deciding whether the same turn can be retried in place,
which a refusal correctly answers "no" to). TC-212-2-U-11 (below) remains the
first/sharpest test to implement.

**Additionally confirmed (Step 4 review):** refusal is also consumed as
terminal by `src/agents/embedded-agent-runner/run/terminal-outcome.ts:33`,
`run/incomplete-turn-resolution.ts:142,341`,
`run/overflow-context-recovery.ts:99`, and `run/provider-refusal.ts`. The
classifier-level fix (2.5 below) is necessary but not sufficient on its own —
these downstream consumers format/short-circuit a refusal for user-facing
display and incomplete-turn detection _before_ a model-fallback decision would
normally be reached in the run loop. Section 2.5b below adds the true
end-to-end runner-level acceptance test this requires.

- **TC-212-2-U-01**: `FAILOVER_REASONS` (packages/gateway-protocol) includes
  `"refusal"` exactly once, and the array order/existing 16 entries are
  otherwise unchanged (guards against an accidental reorder breaking any code
  that indexes by position — unlikely but worth one assertion given this is a
  frozen, wire-visible list per the comment in `src/agents/failover/signal.ts`).

### 2.2 Anthropic refusal → classifiable signal

- **TC-212-2-U-02**: `applyAnthropicRefusal(output, stopDetails, "anthropic")`
  sets `output.diagnostics[].type === "provider_refusal"` (existing, unchanged)
  AND now also sets whatever new field the classifier keys on (e.g.
  `output.errorCode` or an extended diagnostic field — implementer's choice,
  but it must be a field `classifyFailoverReasonFromCode` or an analogous new
  function actually reads). This test must assert the **specific field the
  classifier consumes**, not just diagnostics presence, because diagnostics
  presence alone was already true pre-fix and did NOT trigger fallback (that's
  the whole bug per patch-audit N2).
- **TC-212-2-U-03 [equivalence]**: `readAnthropicRefusalDetails` / the refusal
  path with `stopDetails = { category: "cyber", explanation: "..." }` vs.
  `stopDetails = { category: null, explanation: null }` vs. `stopDetails = undefined`
  vs. `stopDetails = "not an object"` (adversarial — non-object stopDetails) —
  all four must not throw, and the first three must still produce a
  classifiable refusal; only the shape of `errorMessage` text differs.
- **TC-212-2-U-04 [non-cyber path]**: an Anthropic refusal with
  `category: "violence"` or `category: null` (a **non-cyber** refusal, the
  case the audit found upstream's narrow escalation does NOT cover) must still
  classify as `"refusal"` and trigger the **configured fallback chain** (not
  the Daybreak cyber-escalation path, which is OpenAI + cyber-category only).
  This is the core acceptance criterion of item 2 — a generic Anthropic safety
  refusal must no longer die with "generic LLM request failed."

### 2.3 `isRefusalErrorMessage()` message-pattern matcher

- **TC-212-2-U-05 [equivalence partitioning]**: representative refusal-text
  samples (Anthropic-style `"Anthropic refusal (category: violence): ..."`,
  a bare `"I cannot help with that request."`-style safety refusal string if
  the old patch matched raw text too) → `true`. Representative non-refusal
  samples (a rate-limit message, a generic 500, an auth error, empty string)
  → `false`. Follow the `TEST_DESIGN_PATTERNS` equivalence-partition
  convention already used throughout `message-patterns.ts`'s existing
  `isRateLimitErrorMessage`/`isBillingErrorMessage` tests.
- **TC-212-2-U-06 [boundary/adversarial]**: message containing the refusal
  keyword as a substring inside unrelated prose (e.g. a long tool-output blob
  that happens to mention "the model refused to comply" as _quoted user
  content_, not a provider error) — decide and assert whether this is a false
  positive risk; if the implementer scopes the regex tightly (anchored,
  provider-message-shaped), assert the tight form does NOT match arbitrary
  prose containing the word "refus-".
- **TC-212-2-U-07 [CJK/i18n parity]**: per the existing pattern-file
  convention (`CJK_AUTH_ERROR_PATTERNS` etc. throughout `message-patterns.ts`),
  confirm whether a Chinese-language provider refusal pattern is in scope for
  this fix. If not explicitly required by the issue, flag as an ambiguity (see
  Ambiguities section) rather than silently skipping — the file's established
  convention is to cover CJK provider variants for every other reason category.

### 2.4 `classifyFailoverReasonFromCode` wiring

- **TC-212-2-U-08**: `classifyFailoverReasonFromCode("PROVIDER_REFUSAL")` (or
  whatever normalized code string the implementer chooses to key on) returns
  `"refusal"`. Follow the existing switch-case style in
  `classification-rules.ts` (see `"DEACTIVATED_WORKSPACE"` → `"auth_permanent"`
  as the pattern to match).
  Adversarial: `classifyFailoverReasonFromCode("provider_refusal")` (lowercase)
  also returns `"refusal"` — the function already uppercases input
  (`raw?.trim().toUpperCase()`), confirm this isn't broken by the new case.
- **TC-212-2-U-09 [adversarial]**: `classifyFailoverReasonFromCode(undefined)`,
  `classifyFailoverReasonFromCode("")`, `classifyFailoverReasonFromCode("   ")`
  all continue to return `null` (unchanged pre-existing guard) — regression
  guard that the new case doesn't accidentally widen the falsy-input handling.

### 2.5 Fallback-chain wiring (content-scoped, no profile rotation)

- **TC-212-2-INT-01 [seam]**: drive `classifyAssistantFailoverReason` (real
  function in `assistant-message-failures.ts`) with a real `AssistantMessage`
  fixture carrying `stopReason: "error"`, `diagnostics: [{ type: "provider_refusal", ... }]`,
  and the new classifier-consumed field from TC-212-2-U-02 → returns
  `"refusal"`. This is the "real production code path" integration test for
  item 2, using `buildAssistantFailoverSignal` + `classifyFailoverSignal`
  exactly as production does, not a hand-rolled classification call.
- **TC-212-2-U-10**: `resolveRunFailoverDecision({ stage: "assistant", failoverReason: "refusal", failoverFailure: true, fallbackConfigured: true, ... })`
  → `action: "fallback_model"`, NOT `action: "rotate_profile"`. This is the
  "content-scoped, no auth-profile rotation" requirement — assert explicitly
  that `shouldRotateAssistant`'s logic path is NOT taken for `"refusal"`
  (parallel to how `"tls_certificate"` is special-cased to skip profile
  rotation and go straight to fallback in the existing `resolveRunFailoverDecision`
  — item 2 needs an equivalent explicit branch or reason-based check; write
  the test against whatever mechanism the implementer chooses, but the
  observable behavior must match).
- **TC-212-2-KILL-01**: revert the `classification-rules.ts` case addition
  (or the `FAILOVER_REASONS` array entry) → the same fixture from
  TC-212-2-INT-01 no longer classifies as `"refusal"` and instead falls
  through to `null`/`"unclassified"`, which — per the original bug report —
  surfaces as generic "LLM request failed" instead of triggering fallback.
  Named test must fail with the mechanism reverted.
- **TC-212-2-U-11 [does not double-count with `isTerminalAssistantError`, DECISION CONFIRMED]**:
  `isTerminalAssistantError` already returns `true` for any message where
  `isProviderRefusalAssistantError` is true (existing code,
  `src/llm/utils/retry.ts:37`) — this makes a refusal message a "terminal
  assistant error" for the _retry_ classifier, which is a **different**
  question from the _failover_ classifier (`classifyAssistantFailoverReason`,
  gated on `msg.stopReason !== "error" || isTerminalAssistantError(msg)` at
  `assistant-message-failures.ts:32` — this early-return means a refusal
  message currently returns `null` from `classifyAssistantFailoverReason`
  before ever reaching `classifyFailoverSignal`). Per the Step 4 review
  decision, the fix carves refusals out of this early return **inside
  `classifyAssistantFailoverReason` only** — `isTerminalAssistantError` itself
  is unchanged for every other caller (the retry classifier's "can this exact
  turn be retried in place" question legitimately still says "no" for a
  refusal). Write this as a failing-until-fixed test: assert
  `classifyAssistantFailoverReason(refusalFixture)` returns `"refusal"`, not
  `null`, despite `isTerminalAssistantError` also being `true` for the same
  message. **[KILL]**: without the fix, this test fails today against
  upstream code as-is (confirmed by reading `assistant-message-failures.ts:32`
  and `retry.ts:27-39` together) — this is the sharpest edge case in the whole
  item and should be the first test implemented, since it may change the
  re-apply strategy (patch audit N2 did not call this seam out explicitly).
- **TC-212-2-U-12 [auth-profile cooldown exemption, added per Step 4 review
  gap E]**: `resolveAuthProfileFailureReason` (`src/agents/embedded-agent-runner/run/auth-profile-failure-policy.ts:14`)
  already returns `null` (no cooldown/health-penalty bookkeeping) for a fixed
  set of content/transport-scoped reasons — `overloaded`, `server_error`,
  `tls_certificate`, `empty_response`, `context_overflow`, `format` — with the
  file's own comment explaining why: "one bad transcript or connection should
  not cool down an otherwise healthy provider profile." `"refusal"` must be
  added to this same list. Assert
  `resolveAuthProfileFailureReason({ failoverReason: "refusal", providerStarted: true })`
  returns `null` — a content refusal is not a credential failure and must not
  mark the auth profile, consistent with how `tls_certificate` is already
  exempted. **[KILL]**: omit `"refusal"` from this list → the test fails
  (returns `"refusal"` instead of `null`), proving a refusal would otherwise
  incorrectly cool down a healthy credential shared across sessions (the exact
  failure mode #77228 describes for `format`).

### 2.5b Runner-level end-to-end acceptance test — added per Step 4 review (gap A, the true acceptance test)

NOVA's review point stands: the classifier-level tests above (2.1–2.5) prove
`classifyAssistantFailoverReason` returns `"refusal"` in isolation. They do
**not** prove a real run with a configured multi-model chain actually produces
an attempt on rung 2 after a non-cyber refusal on rung 1 — several downstream
consumers (`terminal-outcome.ts:33`, `incomplete-turn-resolution.ts:142,341`,
`overflow-context-recovery.ts:99`, `provider-refusal.ts`) also branch on
`isProviderRefusalAssistantError` and could short-circuit before a fallback
decision is reached, independent of whatever the classifier now returns. This
is the true acceptance test for item 2; the classifier tests are supporting
evidence, not the proof.

- **TC-212-2-INT-02 [runner-level, real fallback chain]**: build on the
  pattern already established in `run.empty-error-retry.test-support.ts`
  (which already constructs `provider_refusal` diagnostics fixtures via
  `emptyErrorAttempt`/`makeAssistantMessageFixture` and drives the real
  `runEmbeddedAgent`/`loadSharedRunIntegrationHarness` harness — see its
  `"ignores a historical refusal after compaction"` and
  `"preserves a completed current refusal..."` cases for the exact fixture
  shape to reuse). Configure a run with a **2-model fallback chain** (e.g.
  `anthropic/claude-opus-5` primary, `anthropic/claude-sonnet-5` fallback, or
  reuse whatever fixture provider pair the harness already supports), mock
  rung 1 to return a **non-cyber** Anthropic refusal
  (`diagnostics: [{ type: "provider_refusal", details: { category: "violence" } }]`,
  or `category: undefined`) via `mockedRunEmbeddedAttempt.mockResolvedValueOnce(...)`,
  and mock rung 2 to return a normal success. Assert:
  1. `mockedRunEmbeddedAttempt` is called **twice** (rung 1 refused, rung 2
     attempted) — the harness actually advanced to the next model, not just
     that a classifier function returned a string.
  2. The final `result.payloads` reflect rung 2's successful content, not the
     refusal text.
  3. No auth-profile rotation/cooldown call fired for rung 1's profile (ties
     to TC-212-2-U-12).
- **TC-212-2-KILL-02**: with the classifier-level fix from TC-212-2-U-11
  reverted (early return not carved out) but every other item-2 change in
  place, TC-212-2-INT-02 must fail — `mockedRunEmbeddedAttempt` called only
  **once**, because the refusal never reaches the point where a fallback
  decision gets made. This is the test that would have caught the seam
  conflict before it shipped; it must exist precisely because the
  classifier-only tests above cannot catch it.
- **TC-212-2-INT-03 [chain exhausted by refusals, added per Step 4 review gap C]**:
  every rung in the configured chain returns a refusal (mock 2+ rungs, all
  non-cyber Anthropic refusals, no success anywhere). Assert:
  1. The run does **not** loop indefinitely or re-attempt the same rung twice
     — exactly one attempt per configured rung, matching how
     `model-fallback-runner.ts`'s `exhaustionResult`/`outcome: "exhausted"`
     path already caps attempts for other reasons.
  2. The final surfaced error/payload is the **last rung's refusal text**
     (with its category/explanation, via `formatUserFacingAssistantErrorText`
     per `terminal-outcome.ts:33`), not a generic "LLM request failed" or an
     `unclassified`/`unknown` fallback message — the whole point of item 2 is
     that a refusal-caused exhaustion still reads as a refusal to the caller.

### 2.5c Provider-emission coverage matrix — added per Step 4 review (gap D)

Confirmed via source read (2026-09-24): the `provider_refusal` diagnostic is
currently emitted from exactly three call sites:
`packages/ai/src/transports/anthropic-stream-reducer.ts` (calls
`applyAnthropicRefusal`, i.e. **direct Anthropic only**),
`packages/ai/src/providers/openai-chatgpt-responses.ts:617`, and
`packages/ai/src/providers/openai-responses-shared.ts:326` (both **OpenAI
Responses-family transports only**). **Confirmed gap, not hypothetical**: the
OpenRouter plugin (`extensions/openrouter/index.ts`) hardcodes
`api: "openai-completions"` for every model it proxies, regardless of the
underlying upstream model — and grep across
`packages/ai/src/providers/openai-completions*.ts` and
`packages/ai/src/internal/openai-completions-compat.ts` shows **zero**
`provider_refusal`/`applyAnthropicRefusal`/`stop_details` handling anywhere in
that transport family. This means **an OpenRouter-proxied Anthropic refusal
(NOVA's current primary route, `openrouter/anthropic/claude-opus-5.5`) does
NOT currently emit a classifiable `provider_refusal` diagnostic at all** —
item 2's fix, as scoped by the issue and patch audit, does not reach this
path. This is now a **confirmed, documented gap** (see updated Ambiguities
section), not an open question — flagging it as out of scope for this run's
implementation, but it must not be silently assumed to already be covered.

- **TC-212-2-U-13 [direct Anthropic emits]**: a fixture streamed through
  `anthropic-stream-reducer.ts`'s real reduction path (or as close to it as
  the existing `anthropic.test.ts`/`anthropic-transport-stream.test.ts`
  harnesses allow) with a `stop_details` payload produces a `provider_refusal`
  diagnostic — confirms this path (already covered indirectly by 2.2's unit
  tests) is the one genuinely fixed path.
- **TC-212-2-U-14 [OpenAI Responses-family emits]**: a fixture through
  `openai-chatgpt-responses.ts` and, separately, `openai-responses-shared.ts`
  (both call sites) produces a `provider_refusal` diagnostic — confirms the
  OpenAI Responses path (used by the existing cyber-escalation feature) is
  unaffected by/compatible with the new generic classifier.
- **TC-212-2-U-15 [OpenRouter-proxied Anthropic does NOT emit — documented
  negative result, not a defect in this fix]**: a fixture through the
  `openai-completions` transport (the family OpenRouter always uses per
  `extensions/openrouter/index.ts`'s `api: "openai-completions"`) carrying
  whatever raw refusal-shaped content an OpenRouter-proxied Anthropic response
  actually returns (research the real wire shape before writing this fixture
  — it will NOT be a `stop_details` field, since that's Anthropic-native) does
  **not** produce a `provider_refusal` diagnostic and therefore does not
  classify as `"refusal"`. This test exists to make the gap executable and
  visible in the suite (so it surfaces the first time someone tries to close
  it) rather than leaving it as prose alone. If the implementer decides this
  gap is in-scope after all, this test flips from a documented-negative to a
  real coverage requirement — do not silently delete it either way without
  updating the Ambiguities section.

### 2.6 Non-regression: OpenAI cyber-policy escalation untouched

- **TC-212-2-INT-04**: a **cyber-category OpenAI refusal** (provider="openai",
  category="cyber") still takes the existing Daybreak-retry path
  (`isReplaySafeEmbeddedOpenAiCyberRefusal` returns `true`, per
  `embedded-cyber-failover.ts`) and does **not** additionally get routed
  through the new generic `"refusal"` → configured-fallback-chain path in the
  same turn. Assert the two mechanisms are mutually exclusive for this one
  fixture shape (OpenAI+cyber), per `docs/concepts/model-failover.md`'s "does
  not send ordinary provider failures to Daybreak" / "general model fallback
  ordering is unchanged" language.
- **TC-212-2-U-16**: an **OpenAI refusal with category != "cyber"** (e.g.
  `"violence"` or no category) is NOT eligible for Daybreak
  (`isReplaySafeEmbeddedOpenAiCyberRefusal` returns `false` since
  `refusal.category !== "cyber"`) and instead goes through the new generic
  `"refusal"` fallback path — confirms the two paths partition correctly by
  category, not just by provider.
- **TC-212-2-U-17 [strict selection non-regression]**: a locked/strict model
  selection (`fallbacksOverride: []` per `isEmbeddedModelSelectionStrict`)
  receiving a non-cyber refusal → refusal remains terminal (surfaces the
  error), does NOT force a fallback the operator explicitly disabled. Mirrors
  the "explicit configured default"/"user session override" strict-selection
  contract in `docs/concepts/model-failover.md`.

---

## 3. Synthetic bootstrap path identifiers

Target: `sanitizeBootstrapFiles()` in `src/agents/bootstrap-files.ts` (~L126).
Old patch: `08b30984100`, with an existing, directly reusable old test suite in
`~/nova-openclaw` at that commit (`src/agents/bootstrap-files.test.ts`,
`describe("sanitizeBootstrapFiles — synthetic path preservation (PR #243)")`,
TC-243-U-01 through at least U-05+). Re-verify the new test IDs below port the
same fixture shapes into the current `resolveBootstrapFilesForRun` /
`registerInternalHook("agent:bootstrap", ...)` harness — confirmed still
present and unchanged in v2026.9.6 (`src/hooks/internal-hooks.js`,
`AgentBootstrapHookContext`).

### 3.1 Happy path (ported from old TC-243-U-01/02/03/04)

- **TC-212-3-U-01**: `db:AGENT/HEARTBEAT.md` passes through
  `sanitizeBootstrapFiles` unchanged — not absolute, not containing
  `workspaceDir`.
- **TC-212-3-U-02** (`it.each`): `db:UNIVERSAL/USER.md`,
  `db:GLOBAL/COMMUNICATION.md`, `db:DOMAIN:Quality Assurance/AB_TESTING_METHODOLOGY.md`,
  `db:WORKFLOW:SE-openclaw-test/WORKFLOW.md` (this very run's own workflow
  namespace — dogfood the real value), `db:agent/SOUL.md` (lowercase prefix
  still qualifies per the regex being case-insensitive-agnostic — it doesn't
  check case at all) — all preserved verbatim.
- **TC-212-3-U-03**: `fallback:UNIVERSAL_SEED.md` preserved verbatim.
- **TC-212-3-U-04**: `emergency:RECOVERY.md` preserved verbatim.
- **TC-212-3-U-05** (no-regression): a normal workspace-relative path like
  `AGENTS.md` still resolves through the ordinary `path.resolve(workspaceRoot, ...)`
  branch unchanged.

### 3.2 Boundary / adversarial — regex edge cases

- **TC-212-3-U-06 [boundary]**: `foo/db:bar.md` (slash **before** colon) is
  **not** treated as synthetic — must resolve as a normal (workspace-relative,
  containing a literal colon in the filename on POSIX) path. This is the
  documented negative case in the old patch's own comment.
- **TC-212-3-U-07 [boundary]**: `:leading.md` (colon as the very first
  character, no leading alpha) is **not** synthetic.
- **TC-212-3-U-08 [boundary]**: `1db:thing.md` (leading digit before the
  colon-prefix word) is **not** synthetic.
- **TC-212-3-U-09 [Windows drive-letter false-positive — NEW, not in old
  patch, explicitly required by this run's brief]**: `C:\Users\druid\file.md`
  and `C:/Users/druid/file.md` (Windows absolute paths) must **NOT** match
  `SYNTHETIC_PATH_PREFIX` and be preserved as opaque synthetic strings — they
  must continue through normal `path.isAbsolute()`/`path.resolve()` handling
  (or whatever Windows-path branch exists). A naive single-uppercase-letter
  regex (`/^[A-Za-z][A-Za-z0-9_-]*:/`) **will match** `C:` as its own prefix
  unless the implementation adds an explicit drive-letter exclusion (e.g.
  requiring the identifier segment before `:` to be 2+ chars, or requiring
  what follows `:` to not start with `\` or `/`). **This is a real regression
  risk the original 2026-05-20 patch never had to consider** (it predates this
  fork running on Windows-hosted nodes) — write this test to **fail against a
  naive port of the old regex unchanged**, forcing the implementer to add the
  drive-letter guard explicitly. Cover both `C:\...` and `C:/...` forms, plus
  a lowercase drive letter `c:\...` (Windows drive letters are
  case-insensitive) and a two-letter "drive" edge case like `db:\...` (a
  synthetic-shaped prefix that ALSO happens to look path-like after the colon
  — decide and assert the correct disambiguation: is `db:\foo` treated as
  synthetic `db:` namespace or as a malformed path? Recommend: still synthetic,
  since real Windows drive letters are exactly one character, and `db` is two
  — assert the implementation's regex encodes this distinction, e.g. via a
  `{2,}` minimum length on the prefix, or an explicit single-letter-plus-colon
  exclusion).
- **TC-212-3-U-10 [adversarial, non-string path]**: a bootstrap file record
  with `path: undefined`, `path: null`, `path: 123` (non-string) — existing
  code already has a guard (`normalizeOptionalString(file.path) ?? ""` then an
  empty check that calls `warn?.()` and `continue`s) — confirm this pre-existing
  guard still fires correctly and is not bypassed by the new synthetic check
  (i.e., the synthetic bypass branch must run **after** the missing-path
  guard, not before — verify branch order in the implementation).
- **TC-212-3-U-11 [adversarial, empty-after-trim]**: `path: ""` and
  `path: "   "` (whitespace-only) — both must hit the existing "missing or
  invalid path" warning branch, not be misclassified as synthetic (a
  whitespace string does not match `SYNTHETIC_PATH_PREFIX` since it requires
  a leading alpha character, but assert this explicitly since it's cheap
  insurance).

### 3.3 Dedupe behavior

- **TC-212-3-U-12 [dedupe]**: two bootstrap file entries both with
  `path: "db:AGENT/SOUL.md"` (e.g. injected by two different hooks, or the
  same hook run twice) → only one survives in the sanitized output (existing
  `seenPaths` dedupe logic, now keyed on the **literal synthetic string**
  rather than a resolved-path relative key). Assert dedupe uses the raw
  synthetic string as the key (per the old patch's stated design: "Dedupe key
  is the literal synthetic path string").
- **TC-212-3-U-13 [dedupe collision non-issue, but assert it explicitly]**:
  a synthetic path `db:AGENT/SOUL.md` and a resolved-filesystem path that
  happens to normalize to the literal string `"db:AGENT/SOUL.md"` as its
  relative-path dedupe key (contrived, but the old patch's comment explicitly
  claims "synthetic keys and FS relative keys never collide because synthetic
  keys always contain `:` early, while FS relative keys never do" — POSIX
  relative paths cannot contain a bare `:` in a dedupe-key-producing position
  because `path.relative`/`path.normalize` do not introduce colons). Write one
  test that constructs a workspace-relative file whose **name** literally
  contains a colon early (e.g. `"db:AGENT" + path.sep + "SOUL.md"` is not
  constructible as a single relative path segment without going through
  `path.resolve` first, which never emits a bare `word:` prefix on POSIX) to
  confirm no accidental collision — mark this test **low priority /
  documentation-only** if it proves unconstructable on the test-runner's OS;
  do not force a contrived cross-platform fixture that can't exist in
  practice.

### 3.4 Kill-check

- **TC-212-3-KILL-01**: revert the `SYNTHETIC_PATH_PREFIX` bypass branch
  entirely (i.e., test against the pre-fix `sanitizeBootstrapFiles` that
  unconditionally calls `path.resolve`) → TC-212-3-U-01 must fail (the path
  becomes an absolute filesystem path like
  `<workspaceRoot>/db:AGENT/HEARTBEAT.md`, exactly the corruption the fix
  prevents). Confirms the test actually exercises the mechanism.

### 3.5 Integration (real bootstrap-hook path)

- **TC-212-3-INT-01**: using `registerInternalHook("agent:bootstrap", ...)` +
  `resolveBootstrapFilesForRun({ workspaceDir })` (the exact pattern in the
  existing `bootstrap-files.test.ts` suite, real production entry point, not
  calling `sanitizeBootstrapFiles` directly) with a synthetic path injected via
  the hook, confirming the full pipeline (hook injection → session filtering →
  memory-origin filtering → sanitize) preserves the synthetic path end-to-end,
  not just at the `sanitizeBootstrapFiles` unit boundary. This satisfies the
  "config→runtime seam, real production code" requirement for item 3.

---

## 4. xurl SKILL.md media-upload warning

Target: `skills/xurl/SKILL.md`. Old patch: `d950e917e4c`. Doc-only — a
presence check is sufficient per the task brief.

**Step 4 review (2026-09-24): AGREED, desk-review checklist item, no new CI
test category.**

- **TC-212-4-STAGE-01 [presence check, desk review checklist line]**:
  `skills/xurl/SKILL.md` "## Media" section contains the warning line about
  `--category amplify_video` auto-detection defaulting incorrectly for
  images, includes explicit `--category tweet_image --media-type image/...`
  examples for at least jpeg/png, **and** the Troubleshooting section's final
  bullet still mentions `--category tweet_image` (per the old diff's last
  hunk — folded into this single checklist line rather than a separate test,
  per Step 4 review). No CI content-assertion test introduced for this
  doc-only item.

---

## 5. `-nova` version suffix + validator acceptance

Targets: `package.json` version = `"2026.9.6-nova"`; `scripts/package-changelog.mjs`
`RELEASE_VERSION_PATTERN` (~L18); three regex literals in
`scripts/e2e/lib/upgrade-survivor/diagnostics.mjs` (confirmed present at
~L393 `doctorObservation`, ~L936 process-identity version read, ~L1628
`baselineCompanion.version` check — all three currently share the identical
literal `/^\d{4}\.\d{1,2}\.\d{1,3}(?:-(?:\d+|(?:alpha|beta)\.\d+))?$/`, which
does **not** accept `-nova`).

### 5.1 Baseline (must still work — regression guards)

- **TC-212-5-U-01 (`it.each`)**: existing accepted upstream forms continue to
  pass both the changelog pattern and the diagnostics pattern:
  `"2026.9.6"`, `"2026.9.6-1"` (correction release), `"2026.9.6-alpha.2"`,
  `"2026.9.6-beta.1"`. Use `resolvePackageChangelogVersions` for the
  changelog-side assertions (existing test file
  `test/scripts/package-changelog.test.ts` already covers most of these —
  confirm no regression by re-running, don't just re-derive from scratch).
- **TC-212-5-U-02 [RESOLVED per Step 4 review gap A — concrete answer, not a
  branch pick]**: `"2026.9.6-nova"` is now **accepted** by
  `RELEASE_VERSION_PATTERN` (`scripts/package-changelog.mjs`) and by all three
  diagnostics.mjs regex sites. Tracing `resolvePackageChangelogVersions` through
  to its actual consumers (`extractCurrentPackageChangelog`/
  `readCurrentPackageChangelog`, `scripts/package-changelog.mjs:56-131`) shows
  neither existing branch is correct: v2026.9.6 ships `CHANGELOG/2026.9.6.md`
  with **no** `2026.9.6-nova` section, so the plain `-N`-style branch
  (`[version]` only, matching e.g. `-1` correction releases) would pass the
  regex and then fail packing with "does not contain a release section"; the
  prerelease branch would also wrongly append `Unreleased` as a fallback
  candidate, which is semantically wrong for a stable-release fork suffix.
  **Requirement**: `resolvePackageChangelogVersions("2026.9.6-nova")` must
  return `["2026.9.6-nova", "2026.9.6"]` (i.e. `[version, match[1]]`, the base
  version as a fallback heading candidate, no `Unreleased`), plus `Unreleased`
  appended only when `options.allowUnreleased` is set — mirroring the existing
  `-N` correction-release branch's shape but explicitly returning 2 elements
  (`[version, match[1]]`) rather than reusing that branch's exact code path,
  since `-nova` is not a correction release either; write the implementation's
  own dedicated branch.
  1. Unit test: `resolvePackageChangelogVersions("2026.9.6-nova")` equals
     exactly `["2026.9.6-nova", "2026.9.6"]` (no `allowUnreleased`), and
     `["2026.9.6-nova", "2026.9.6", "Unreleased"]` with `allowUnreleased: true`.
  2. **TC-212-5-INT-01 [real-data seam, the test that actually proves #167 is
     fixed]**: `readCurrentPackageChangelog(<worktree root>, "2026.9.6-nova")`
     succeeds against the **real** `CHANGELOG/2026.9.6.md` /
     `CHANGELOG/records/2026.9.6.md` in this checkout (confirmed present) —
     not a synthetic fixture like the rest of `package-changelog.test.ts`. This
     is the concrete proof that a `2026.9.6-nova` packaged build actually
     resolves to the real `2026.9.6` release section instead of throwing.
  3. **TC-212-5-KILL-02**: patch the two acceptance regexes but leave
     `resolvePackageChangelogVersions`'s heading-fallback branch unadded (i.e.
     `-nova` still resolves to `[version]` only, no base-version fallback) →
     TC-212-5-INT-01 must fail with "does not contain a release section for
     2026.9.6-nova." This is exactly the failure mode a partial, regex-only
     patch would produce and ship silently green on every other test above.
  4. **TC-212-5-U-16 [tag-link flag — checked, currently dormant but must stay
     tested]**: `extractCurrentPackageChangelog`'s >500KB compaction path
     (`scripts/package-changelog.mjs:83`) builds a source link to tag
     `` `v${packageVersion}` `` verbatim — for a `-nova` build this produces
     `v2026.9.6-nova`, a tag that will not exist upstream. **Checked**:
     `CHANGELOG/2026.9.6.md` is ~116KB and `CHANGELOG/records/2026.9.6.md` is
     ~73KB — well under the 500KB `MAX_PACKAGED_CHANGELOG_BYTES` limit, so this
     path is **not reachable for the current 2026.9.6 release** and TC-212-5-INT-01
     will not exercise it. Add a regression test asserting the packaged output
     for `2026.9.6-nova` does NOT contain a `v2026.9.6-nova` tag link (proves
     the dormant path stayed dormant), and separately, a synthetic-content unit
     test (oversized fixture, same pattern as `package-changelog.test.ts`'s
     `oversizedContributionRecord`) that forces the compaction path with a
     `-nova` version and asserts whatever link format ships there is
     intentional — if it's the broken `v2026.9.6-nova` form, flag that as a
     known follow-up defect rather than letting a future oversized release
     silently ship a dead link.

### 5.2 Adversarial — malformed/garbage versions must still be REJECTED

- **TC-212-5-U-03 (`it.each`)**: garbage versions continue to be **rejected**
  by both patterns after the `-nova` addition: `"2026.9"` (missing patch),
  `"2026.9.6.1"` (four segments), `"v2026.9.6"` (leading v), `"2026.9.6-"`
  (trailing dash, no suffix), `"2026.9.6-nova-evil"` (suffix-after-suffix —
  **explicitly called out in the brief as an adversarial case**; must reject
  unless the implementer deliberately widens the grammar to allow chained
  suffixes, which the brief's Item 5 wording does not ask for), `"2026.9.6-NOVA"`
  (uppercase — **explicitly called out**; decide and assert case-sensitivity:
  recommend rejecting uppercase since the convention commit history shows
  lowercase `-nova` used consistently across all 8 historical suffix-bump
  commits in the patch audit, and case-insensitive acceptance widens the
  grammar beyond what's needed), `"2026.9.6nova"` (no separating dash —
  **explicitly called out**; must reject), `"2026.9.6-2-nova"` (chained
  numeric-then-nova suffix — **explicitly flagged in the brief as needing a
  reasoned decision**, see Ambiguities), `"2026.9.6-beta.1-nova"` (chained
  prerelease-then-nova — **also explicitly flagged**, see Ambiguities).
- **TC-212-5-U-04**: empty string, `null`, `undefined`, a number
  (`20269.6` no dots) passed to `resolvePackageChangelogVersions` /
  the diagnostics regexes — all continue to throw/reject cleanly, no crash,
  no silent pass-through as "valid."
- **TC-212-5-U-05 [boundary]**: version-component boundary values continue to
  work with the widened pattern: `"2026.1.1-nova"` (single-digit month/day,
  minimum), `"2026.12.999-nova"` (large day-of-month component — the pattern
  allows up to 3 digits per the diagnostics regex `\d{1,3}`; changelog pattern
  allows unbounded `[0-9]*`, confirm this discrepancy between the two patterns
  is pre-existing and not something the `-nova` patch should silently
  "harmonize" without a separate decision).

### 5.3 Cross-file consistency

- **TC-212-5-U-06**: the same version string (`"2026.9.6-nova"`) is tested
  against **all four** patched regex sites (1 in package-changelog.mjs, 3 in
  diagnostics.mjs) in one parameterized test, asserting all four agree
  (accept). This catches the exact bug class the patch audit flagged: three
  near-identical-but-independently-maintained copies of the same pattern in
  diagnostics.mjs could drift (e.g. someone fixes line 393 but misses 936/1628).
- **TC-212-5-U-07**: `package.json`'s `"version"` field is exactly
  `"2026.9.6-nova"` (simple presence/format assertion — confirms the base
  version wasn't left as bare `2026.9.6` after the rebase, and wasn't
  mistakenly written as `2026.9.6-Nova` or `2026.9.6_nova`).
- **TC-212-5-U-08: DROPPED per Step 4 review.** `npm-shrinkwrap.json` is
  confirmed absent in v2026.9.6 (this repo uses `pnpm-lock.yaml` /
  `pnpm-workspace.yaml`; the old companion fix `3281e88ba18` targeted a file
  that no longer exists on this base). No replacement test needed — there is
  no lockfile-version-sync requirement to re-apply.

### 5.4 Kill-check

- **TC-212-5-KILL-01**: revert `RELEASE_VERSION_PATTERN` to the pre-patch
  form (drop `-nova` acceptance) → TC-212-5-U-02 must fail. Same for one of
  the three diagnostics.mjs sites reverted independently — each of the three
  is its own kill-check target, since they're independently maintained copies
  (see TC-212-5-U-06 rationale); a partial patch (2 of 3 sites fixed) must
  still show as a failing suite, not a false-green.

---

## Staging gate (SE-openclaw-test / desk review, NOT CI unit tests)

Per Step 1 decision: Graybeard resets staging only; NOVA runs the fresh
install and these tests herself. These are **[STAGE]** items, verified via
desk review + manual execution at steps 5-6/11, not part of the unit test
suite delivered by this step.

- **TC-212-STAGE-01**: fresh install from this branch builds cleanly (no
  build errors, no missing-dependency failures).
- **TC-212-STAGE-02**: gateway starts healthy — plugins and hooks load
  (including the new item-1 exec-env plugin), no crash-loop, `/status` or
  equivalent reports version `2026.9.6-nova` (confirms item 5's version string
  actually reaches the running gateway, not just package.json on disk).
- **TC-212-STAGE-03 [REVISED 2026-09-26, I)ruid ruling]**: original wording
  ("a direct request with an explicit `--thinking adaptive` directive
  completes with no schema rejection") is **not the correct expectation**.
  Upstream v2026.9.6 (`05a084b25de`) deliberately **rejects** an explicit
  `--thinking adaptive` CLI/API directive for `anthropic/claude-opus-5-5` —
  confirmed on staging (`stage03-04-run.json`): exit 1, `errorCode=UNAVAILABLE`,
  `Thinking level "adaptive" is not supported for anthropic/claude-opus-5-5.
  Use one of: low, medium, high, xhigh, max.` This explicit-directive rejection
  is expected upstream behavior, not a bug — it is out of scope for this test
  case.

  The production-relevant shape is a **stored** `thinking=adaptive` default
  (`agents.defaults.thinkingDefault` / per-agent `thinkingDefault`, e.g.
  production NOVA's actual config), not an explicit per-call directive. Per
  `docs/tools/thinking.md`, a stored unsupported level is silently remapped by
  provider-profile rank rather than rejected. **Revised test**: with
  `agents.defaults.thinkingDefault: "adaptive"` stored in config (no
  `--thinking` flag passed on the call), a real agent turn against
  `anthropic/claude-opus-5-5` must complete with **stored adaptive accepted:
  no rejection, no fallback, opus-5-5 served** — i.e.
  `executionTrace.fallbackUsed === false` and
  `executionTrace.winnerModel === "claude-opus-5-5"` in the run JSON, with zero
  `not supported`/`reject`/`UNAVAILABLE` hits in the gateway journal for the
  run window. Do **not** assert a specific `requestShaping.thinking` value (the
  remap target varies with the prompt/adaptive routing — one observed run
  showed `requestShaping.thinking: "medium"`, but asserting "adaptive ==
  medium" as a fixed equivalence would be wrong); assert only that the stored
  value was accepted and the turn completed on the requested model without a
  hard rejection or a fallback to a different model. Confirmed on staging
  2026-09-25 (`stage03b-run.json`, `stage03b-journal-grep.txt`): PASS.

  The OpenRouter `openrouter/anthropic/claude-opus-5.5` route (production's
  actual primary) is out of scope for this test case — confirmed working by
  I)ruid; do not mark it as a gap. This build's catalog also has no OpenRouter
  entry to test against regardless (direct-Anthropic only).
- **TC-212-STAGE-04**: item-1 exec-env plugin observably sets the three vars
  in a real exec call on the staged gateway (e.g. `exec env | grep OPENCLAW_AGENT_ID`
  from within an agent session) — the true end-to-end version of
  TC-212-1-INT-01, run against the actual staged install rather than a test
  harness.
- **TC-212-STAGE-05**: item 2 (refusal fallback), item 3 (`db:` paths), item 4
  (xurl doc) — desk-reviewed per the issue's explicit statement that these are
  "verified through desk review and unit tests at steps 5-6, then in
  production at step 11," not part of the staging gate's pass/fail criteria
  list (which only names build/health/opus-5). Do not block the staging gate
  on these three; they are covered by the unit tests above instead.

---

## Requirement ambiguities and contradictions found

Revised after Step 4 review (NOVA ↔ Gem, round 1, 2026-09-24). Resolved items
kept for traceability; new/still-open items appended at the end.

### Resolved in round 1

1. **Item 2 / refusal-terminal seam conflict — RESOLVED, CONFIRMED real.**
   `classifyAssistantFailoverReason` early-returns `null` whenever
   `isTerminalAssistantError(msg)` is true, and `isTerminalAssistantError`
   already treats **any** provider-refusal message as terminal
   (`isProviderRefusalAssistantError` at `retry.ts:37`, unconditional,
   pre-dating this fix). NOVA independently verified this against
   `assistant-message-failures.ts:33` and `retry.ts:37` and confirmed the
   conflict is real, not a hypothetical. **DECISION: option (a)** — carve
   refusals out of the early return inside `classifyAssistantFailoverReason`
   only; `isTerminalAssistantError` stays unchanged for the retry classifier
   everywhere else. TC-212-2-U-11 is the first test to implement.
   **Additionally surfaced by the same review**: refusal is _also_ consumed as
   terminal by `terminal-outcome.ts:33`, `incomplete-turn-resolution.ts:142,341`,
   `overflow-context-recovery.ts:99`, and `provider-refusal.ts` — meaning the
   classifier fix alone is necessary but not sufficient. Section 2.5b
   (TC-212-2-INT-02/KILL-02/INT-03) now carries the true runner-level
   acceptance test that proves a refusal on rung 1 actually reaches rung 2 of
   a real configured chain, not just that a classifier function returns a
   string in isolation.

2. **Item 5 / `-nova` chained-suffix acceptance — RESOLVED: AGREED reject.**
   `2026.9.6-2-nova` and `2026.9.6-beta.1-nova` are rejected. Grammar is
   exactly `YYYY.M.P-nova` as one more terminal alternative, not composable
   with the existing `-N`/`-alpha.N`/`-beta.N` suffixes. TC-212-5-U-03's
   chained-suffix cases are hard rejects, confirmed.

3. **Item 5 / case-sensitivity — RESOLVED: AGREED lowercase only.**
   `-NOVA`/`-Nova` rejected; only lowercase `-nova` accepted.

4. **Item 5 / `npm-shrinkwrap.json` — RESOLVED: confirmed ABSENT in
   v2026.9.6.** TC-212-5-U-08 dropped; no replacement test (see 5.3).

5. **Item 4 / SKILL.md CI-assertion precedent — RESOLVED: AGREED, desk-review
   checklist item, no new CI test category.** TC-212-4-STAGE-01 kept as a
   single checklist line covering both the Media-section warning and the
   Troubleshooting bullet; the separate regression-guard test dropped/folded
   in, per Step 4 review.

6. **Item 1 / plugin name — RESOLVED: `extensions/agent-identity-env/`
   adopted as the decided name**, not just a placeholder.

7. **Item 1 / non-ASCII agentId — RESOLVED: AGREED, fine as documented
   (deliberate omission, not a gap).**

### New gaps identified in round 1 (now designed above, see cross-references)

A. **Item 5 / changelog heading resolution for `-nova` — answered concretely,
not left as an open branch-pick.** `resolvePackageChangelogVersions("2026.9.6-nova")`
must return `["2026.9.6-nova", "2026.9.6"]` (plus `Unreleased` only when
`allowUnreleased`), verified against the **real** `CHANGELOG/2026.9.6.md`
in this checkout (TC-212-5-INT-01), not a synthetic fixture — this is the
test that actually proves #167 is fixed. See revised 5.1 (TC-212-5-U-02,
TC-212-5-INT-01, TC-212-5-KILL-02, TC-212-5-U-16). The >500KB
compaction-path tag-link risk (`v${packageVersion}` → `v2026.9.6-nova`,
a nonexistent tag) is checked: the real 2026.9.6 changelog/record files
are ~116KB/~73KB, well under the 500KB limit, so this path is **not
reachable today** — confirmed dormant, not just assumed, and covered by a
regression test plus a synthetic-oversized unit test so it stays visible
if a future release grows past the limit.

B. **Item 1 / plugin activation on a fresh install — now covered, section
1.7.** A bundled plugin that is present but not activated by default
reproduces exactly the silent-fallback failure item 1 exists to prevent.
`activation.onStartup: true` is required in the manifest (confirmed via
`gateway-startup-plugin-config.ts:246` and
`docs/plugins/manifest/capabilities.md:177`, since this plugin has no
channel/provider/command surface to hang narrower activation off of).
TC-212-1-U-16/INT-05/KILL-02/STAGE-01 added; STAGE-02 now explicitly
checks the plugin appears in the loaded-plugin list via `plugins list --json`.

C. **Item 2 / refusal on every rung, chain exhausted — now covered,
TC-212-2-INT-03.** Every rung refusing must surface the _last rung's_
refusal text (not a generic "LLM request failed") and must not loop or
re-attempt a rung twice.

D. **Item 2 / which providers actually emit a classifiable refusal — now
covered and CONFIRMED AS A REAL GAP, section 2.5c
(TC-212-2-U-13/U-14/U-15).** Verified by direct source read: the
`provider_refusal` diagnostic is emitted from exactly three call sites —
`anthropic-stream-reducer.ts` (direct Anthropic only, via
`applyAnthropicRefusal`) and two OpenAI Responses-family sites
(`openai-chatgpt-responses.ts:617`, `openai-responses-shared.ts:326`).
**Confirmed**: `extensions/openrouter/index.ts` hardcodes
`api: "openai-completions"` for every proxied model regardless of the
underlying upstream model, and a repo-wide grep of
`packages/ai/src/providers/openai-completions*.ts` /
`packages/ai/src/internal/openai-completions-compat.ts` shows **zero**
refusal handling anywhere in that transport family. **This means an
OpenRouter-proxied Anthropic refusal — NOVA's current primary route,
`openrouter/anthropic/claude-opus-5.5` — does NOT currently emit a
classifiable `provider_refusal` diagnostic, and item 2's fix as scoped by
the issue/patch-audit does not reach this path.** This is now a
**documented, executable gap** (TC-212-2-U-15 makes it visible as a
negative-result test rather than leaving it as prose) and is explicitly
**out of scope for this run's implementation** per the issue's stated
targets (which name `anthropic-refusal.ts` and the OpenAI stop-reason
mapper only, not any OpenRouter/openai-completions file). Flagging for
I)ruid/NOVA awareness: NOVA's own primary model route is not covered by
this fix.

E. **Item 2 / refusal must not rotate auth profiles or record a cooldown —
now covered, TC-212-2-U-12.** Mirrors the existing `tls_certificate`
exemption in `resolveAuthProfileFailureReason`
(`auth-profile-failure-policy.ts:14`), which already documents "one bad
transcript or connection should not cool down an otherwise healthy
provider profile" for a fixed list of content/transport-scoped reasons.
`"refusal"` must join that list; a kill-check proves its omission would
incorrectly cool down a shared credential (the same failure class as
#77228).
