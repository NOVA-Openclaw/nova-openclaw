# Test Cases: nova-openclaw#61 — Configurable System Prompt Preamble

<!-- Issue: #61 | Designed by: Gem (QA Lead) | Step 3 -->

## Feature Summary

Adds a file-based override for the system prompt preamble. If
`~/.openclaw/system-prompt-preamble.md` exists, its contents replace the
hardcoded string `"You are a personal assistant running inside OpenClaw."` in
three places:

1. `src/agents/system-prompt.ts` — `promptMode === "none"` early return (line ~911)
2. `src/agents/system-prompt.ts` — `stablePrefix` builder (primary session path, line ~969)
3. `src/cli/capability-cli.ts` — `LOCAL_MODEL_RUN_SYSTEM_PROMPT` constant (line ~96)

A `resolveSystemPromptPreamble()` helper reads the file via `resolveStateDir()`
from `src/config/paths.ts`, caches the result, and falls back to the default
string when the file is absent. The `stablePromptPrefixCache` hash input must
include preamble content so stale cache entries are invalidated when the file
changes.

---

## Test Framework

**Vitest** — consistent with all existing agent tests.

**Suggested test files:**

- Unit tests for `resolveSystemPromptPreamble()`: `src/agents/system-prompt-preamble.test.ts` (new)
- Integration tests for `buildAgentSystemPrompt()` with preamble:
  added to existing `src/agents/system-prompt.test.ts`
- Integration test for `LOCAL_MODEL_RUN_SYSTEM_PROMPT` change:
  added to existing `src/cli/capability-cli.test.ts`

**Setup pattern for all file-system tests:**
Use `OPENCLAW_STATE_DIR` env override (or `resolveStateDir` injection) to
point at a temp directory; write/delete the preamble file in `beforeEach` /
`afterEach` to avoid test pollution.

---

## Test Cases

### Group 1 — Happy Path (file exists with custom content)

#### TC-61-01: Custom preamble replaces hardcoded string in stablePrefix

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains: `"You are Aria, a test agent."`
- `promptMode` is `"full"` (default)
- All other `buildAgentSystemPrompt()` params: minimal valid set (`workspaceDir`)

**Action:** Call `buildAgentSystemPrompt(params)`

**Expected:**

- Returned prompt starts with `"You are Aria, a test agent."`
- Returned prompt does NOT contain `"You are a personal assistant running inside OpenClaw."`

**Pass criteria:** Both string-presence assertions pass.

---

#### TC-61-02: Custom preamble replaces hardcoded string in promptMode="none" path

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains: `"You are Aria, a test agent."`
- `promptMode` is `"none"`

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp", promptMode: "none" })`

**Expected:**

- Returned prompt starts with `"You are Aria, a test agent."`
- Returned prompt does NOT contain `"You are a personal assistant running inside OpenClaw."`
- `modelIdentityLine` (if non-empty) still appears in output (unchanged behavior)

**Pass criteria:** All three assertions pass.

---

#### TC-61-03: Custom preamble used in LOCAL_MODEL_RUN_SYSTEM_PROMPT (capability-cli)

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains: `"You are Aria, a test agent."`

**Action:** Invoke the `capability-cli` local model run path that returns
`LOCAL_MODEL_RUN_SYSTEM_PROMPT` (or call `resolveSystemPromptPreamble()` directly
and verify the constant is sourced from it)

**Expected:**

- The resolved value is `"You are Aria, a test agent."`
- The hardcoded string is not returned

**Pass criteria:** Assertion on resolved value passes.

---

#### TC-61-04: Preamble with trailing newline is used verbatim (no double-newline injection)

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains: `"You are Aria.\n"` (trailing newline)

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- The preamble is trimmed or the integration produces exactly one blank line after
  it before the next section (no double-blank-line gap)
- No `"You are a personal assistant"` string appears

**Note for implementer:** Specify trimming policy (trim vs rtrim vs none) in the
implementation. Test must match whichever policy is chosen. If the helper trims
the file content, assert the trailing newline is stripped before placement.

**Pass criteria:** Prompt structure is well-formed; no double blank line at position 0.

---

#### TC-61-05: Preamble with embedded newlines renders as multi-line opening block

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains:
  ```
  You are Aria, a specialized research agent.
  Your purpose is to assist with information retrieval.
  ```

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- Both lines appear at the start of the prompt, in order
- Hardcoded default string absent
- `"## Tooling"` section still follows (prompt structure intact)

**Pass criteria:** `prompt.startsWith("You are Aria")` and `prompt.includes("## Tooling")`.

---

### Group 2 — Default Fallback (no file)

#### TC-61-06: No preamble file → default string used in stablePrefix

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` does NOT exist (deleted or temp dir is clean)

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- Returned prompt starts with `"You are a personal assistant running inside OpenClaw."`

**Pass criteria:** `prompt.startsWith("You are a personal assistant running inside OpenClaw.")` is true.

---

#### TC-61-07: No preamble file → default string used in promptMode="none"

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` does NOT exist

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp", promptMode: "none" })`

**Expected:**

- First line is `"You are a personal assistant running inside OpenClaw."`

**Pass criteria:** Assertion passes; backward compatibility is preserved.

---

#### TC-61-08: No preamble file → LOCAL_MODEL_RUN_SYSTEM_PROMPT returns default

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` does NOT exist

**Action:** Call `resolveSystemPromptPreamble()` (or equivalent)

**Expected:**

- Returned value is exactly `"You are a personal assistant running inside OpenClaw."`

**Pass criteria:** Strict equality assertion passes.

---

### Group 3 — Edge Cases

#### TC-61-09: Empty preamble file → falls back to default

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` exists but is empty (0 bytes)

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- Behavior is identical to TC-61-06 (file absent):
  prompt starts with the hardcoded default string
- An empty file must NOT produce a prompt that starts with a blank line or
  empty first element

**Rationale:** Empty file = effectively no override. Silently falling back is
safer than injecting a blank preamble that breaks the prompt structure.

**Pass criteria:** `prompt.startsWith("You are a personal assistant running inside OpenClaw.")` is true.

---

#### TC-61-10: Whitespace-only preamble file → falls back to default

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains only spaces, tabs, and newlines
  (e.g., `"   \n\t\n  "`)

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- Behavior identical to TC-61-06 (default fallback)
- Prompt does NOT start with whitespace characters

**Pass criteria:** `prompt.startsWith("You are a personal assistant")` is true;
`/^\s/.test(prompt)` is false.

---

#### TC-61-11: Very large preamble file (>100 KB) — does not crash, content used

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains 150 KB of valid text
  (e.g., a long paragraph repeated to fill the size)
- First line begins with `"You are a custom agent."`

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- Function returns without throwing
- Prompt starts with `"You are a custom agent."`
- No truncation of the preamble (the helper must not silently truncate)

**Note for implementer:** If a size cap is desired, it must be documented and
a separate test (TC-61-11b) should assert the cap behavior with a clear error
or truncation marker. This test assumes no cap.

**Pass criteria:** No exception thrown; first line matches custom content.

---

#### TC-61-12: Preamble with special characters (quotes, backticks, angle brackets)

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains:
  `You are "Aria" — the agent. Use <tools> and \`code blocks\` freely.`

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- Special characters are preserved exactly as-is in the prompt
- No HTML-entity encoding, no escaping, no character stripping
- Hardcoded default string absent

**Pass criteria:** `prompt.includes('You are "Aria"')` and `prompt.includes('<tools>')`.

---

#### TC-61-13: Preamble with Unicode content

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains:
  `You are 芳子, an assistant. 日本語で答えます。`

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- Unicode content preserved correctly in returned string
- Hardcoded default string absent

**Pass criteria:** `prompt.includes('芳子')` and `prompt.includes('日本語')`.

---

#### TC-61-14: Preamble file with CRLF line endings

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` is written with `\r\n` line endings
  (Windows-style): `"You are Aria.\r\nSecond line.\r\n"`

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp" })`

**Expected:**

- CRLF sequences do not appear raw in the prompt as `\r\n` visible characters
- Line content is preserved; normalization to `\n` (or trimming of `\r`) is applied

**Pass criteria:** `prompt.includes('\r')` is false; `prompt.includes('You are Aria.')` is true.

---

#### TC-61-15: Preamble file with no read permission (permissions error)

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` exists with content `"You are Aria."`
- File permissions set to `000` (unreadable) using `fs.chmodSync`

**Action:** Call `resolveSystemPromptPreamble()` (or equivalent)

**Expected:**

- Function does NOT throw to the caller
- Returns the hardcoded default string gracefully
- An appropriate warning is logged at WARN or ERROR level (not silently swallowed)

**Pass criteria:** No exception propagated to caller; returned value equals
`"You are a personal assistant running inside OpenClaw."`.

**Cleanup:** Restore file permissions in `afterEach` to avoid leaving unreadable
fixtures in the temp dir.

---

#### TC-61-16: State directory itself does not exist

**Preconditions:**

- `OPENCLAW_STATE_DIR` points to a directory that does not exist on disk

**Action:** Call `resolveSystemPromptPreamble()` (or equivalent)

**Expected:**

- Function does NOT throw
- Returns the hardcoded default string

**Pass criteria:** No exception thrown; fallback default returned.

---

### Group 4 — Cache Behavior

#### TC-61-17: Result is cached after first read (file not re-read on second call)

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains `"You are Aria."`
- File I/O is spy-wrapped (e.g., `vi.spyOn(fs, 'readFileSync')` or equivalent
  depending on implementation using sync vs async)

**Action:**

1. Call `resolveSystemPromptPreamble()` — first call
2. Modify file content on disk to `"You are Bob."`
3. Call `resolveSystemPromptPreamble()` — second call (without cache bust)

**Expected:**

- `readFileSync` (or equivalent) called exactly once
- Both calls return `"You are Aria."` (cached result, not re-read from disk)

**Pass criteria:** Spy call count is 1; both return values equal `"You are Aria."`.

---

#### TC-61-18: Cache is process-scoped and survives multiple prompt builds

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains `"You are Aria."`
- File I/O is spy-wrapped

**Action:**

1. Call `buildAgentSystemPrompt(params)` — first build
2. Call `buildAgentSystemPrompt(params)` — second build

**Expected:**

- File is read at most once across both builds
- Both prompts start with `"You are Aria."`

**Pass criteria:** Spy call count ≤ 1 across both builds.

---

#### TC-61-19: Preamble change invalidates stablePromptPrefixCache

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains `"You are Aria."`
- Internal `stablePromptPrefixCache` is accessible (or observable via output)

**Action:**

1. Call `buildAgentSystemPrompt(params)` — produces a cached stablePrefix
2. Clear the preamble cache (simulate a restart by calling the cache-clear path,
   or reset module state in Vitest using `vi.resetModules()`)
3. Update `$STATE_DIR/system-prompt-preamble.md` to `"You are Bob."`
4. Call `buildAgentSystemPrompt(params)` again

**Expected:**

- The second call produces a prompt starting with `"You are Bob."`
- The `stablePromptPrefixCache` entry from step 1 is NOT reused for step 4
  (hash changed because preamble content is part of the hash input)

**Pass criteria:** Second prompt starts with `"You are Bob."`, not `"You are Aria."`.

---

#### TC-61-20: Same preamble content, same other inputs → stablePromptPrefixCache hit

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains `"You are Aria."`
- All other `buildAgentSystemPrompt()` inputs are identical between two calls

**Action:**

1. Call `buildAgentSystemPrompt(params)` — first call; spy on `cacheStablePromptPrefix`
   inner builder callback
2. Call `buildAgentSystemPrompt(params)` — second call with identical inputs

**Expected:**

- Inner builder callback is invoked exactly once (cache hit on second call)
- Both returned prompts are identical strings

**Pass criteria:** Builder callback spy count is 1; strict equality of both prompts.

---

#### TC-61-21: Different preamble content → different stablePromptPrefixCache keys

**Preconditions:**

- Call 1: preamble file contains `"You are Aria."`
- Call 2: preamble content changes (simulate by clearing preamble cache and
  changing file content) to `"You are Bob."`
- All other inputs identical

**Action:** Two separate calls to `buildAgentSystemPrompt()` with each preamble

**Expected:**

- The two calls produce prompts with different leading lines
- The `stablePromptPrefixCache` does NOT serve call-1's cached entry for call-2
  (different hash keys)

**Pass criteria:** Prompts differ at the preamble position; no stale cache cross-contamination.

---

### Group 5 — promptMode Interaction

#### TC-61-22: promptMode="minimal" uses custom preamble

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains `"You are Aria."`
- `promptMode` is `"minimal"`

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp", promptMode: "minimal" })`

**Expected:**

- Preamble at start of output is `"You are Aria."`
- Sections that are suppressed in minimal mode remain suppressed (no regression)

**Pass criteria:** Prompt starts with custom preamble; minimal-mode suppressions verified.

---

#### TC-61-23: promptMode="none" with preamble file: only preamble and modelIdentityLine

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains `"You are Aria, compact mode."`
- `promptMode` is `"none"`
- `modelIdentityLine` is provided (non-empty)

**Action:** Call `buildAgentSystemPrompt({ workspaceDir: "/tmp", promptMode: "none", ... })`

**Expected:**

- Returned string contains `"You are Aria, compact mode."` and `modelIdentityLine`
- No other sections (Tooling, Safety, etc.) are present
- Preamble precedes `modelIdentityLine`

**Pass criteria:** Split on `"\n"` yields exactly 2 non-empty lines in expected order.

---

### Group 6 — Regression / No-Change Verification

#### TC-61-24: No preamble file → full prompt output is structurally identical to pre-feature behavior

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` does NOT exist
- Inputs: same representative params as existing `system-prompt.test.ts` baseline cases

**Action:** Call `buildAgentSystemPrompt(params)` and compare with a baseline
snapshot from before this feature was introduced

**Expected:**

- Output is byte-for-byte identical to the pre-feature baseline (no structural change)

**Pass criteria:** Snapshot comparison passes (Vitest `toMatchSnapshot()`).

---

#### TC-61-25: Preamble does not affect sections that follow it

**Preconditions:**

- `$STATE_DIR/system-prompt-preamble.md` contains `"You are Aria."`

**Action:** Call `buildAgentSystemPrompt` with `ownerNumbers`, `skillsPrompt`,
and `docsPath` all populated

**Expected:**

- `## Authorized Senders` section present and correct
- `## Skills` section present and correct
- `## Tooling` section present and correct
- Preamble change has not altered any downstream section content

**Pass criteria:** All section content assertions from existing tests still pass.

---

## Coverage Summary

| Area                                         | Test IDs             | Count  |
| -------------------------------------------- | -------------------- | ------ |
| Happy path — file exists with custom content | TC-61-01 to TC-61-05 | 5      |
| Default fallback — no file                   | TC-61-06 to TC-61-08 | 3      |
| Edge: empty file                             | TC-61-09             | 1      |
| Edge: whitespace-only file                   | TC-61-10             | 1      |
| Edge: very large file                        | TC-61-11             | 1      |
| Edge: special characters                     | TC-61-12             | 1      |
| Edge: Unicode                                | TC-61-13             | 1      |
| Edge: CRLF line endings                      | TC-61-14             | 1      |
| Edge: file permissions error                 | TC-61-15             | 1      |
| Edge: state dir missing                      | TC-61-16             | 1      |
| Cache: single-read behavior                  | TC-61-17 to TC-61-18 | 2      |
| Cache: invalidation on content change        | TC-61-19 to TC-61-21 | 3      |
| promptMode interaction                       | TC-61-22 to TC-61-23 | 2      |
| Regression / no-change                       | TC-61-24 to TC-61-25 | 2      |
| **Total**                                    |                      | **25** |

---

### Group 7 — OPENCLAW_STATE_DIR Override

#### TC-61-26: Preamble file read from OPENCLAW_STATE_DIR location

**Preconditions:**

- `OPENCLAW_STATE_DIR` set to a custom temp directory (e.g., `/tmp/test-state-xyz`)
- `$OPENCLAW_STATE_DIR/system-prompt-preamble.md` contains `"You are StateDir Agent."`
- Default `~/.openclaw/system-prompt-preamble.md` does NOT exist (or contains different content)

**Action:** Call `resolveSystemPromptPreamble()`

**Expected:**

- Returned value is `"You are StateDir Agent."`
- The file was read from the `OPENCLAW_STATE_DIR` path, not `~/.openclaw/`

**Pass criteria:** Return value matches the custom state dir file content.

---

### Group 8 — Filename Override via Config

#### TC-61-27: Custom filename via config overrides default filename

**Preconditions:**

- Config `agents.defaults.systemPromptPreambleFile` set to `"my-custom-preamble.md"`
- `$STATE_DIR/my-custom-preamble.md` contains `"You are CustomFile Agent."`
- `$STATE_DIR/system-prompt-preamble.md` also exists with different content

**Action:** Call `resolveSystemPromptPreamble()` with config available

**Expected:**

- Returned value is `"You are CustomFile Agent."`
- The default filename `system-prompt-preamble.md` is NOT read

**Pass criteria:** Return value matches the custom-named file content.

---

#### TC-61-28: Custom filename set but file doesn't exist → falls back to default string

**Preconditions:**

- Config `agents.defaults.systemPromptPreambleFile` set to `"nonexistent-preamble.md"`
- `$STATE_DIR/nonexistent-preamble.md` does NOT exist
- `$STATE_DIR/system-prompt-preamble.md` also does NOT exist

**Action:** Call `resolveSystemPromptPreamble()`

**Expected:**

- Returns the hardcoded default string
- Does NOT fall through to `system-prompt-preamble.md` (config filename takes precedence, even when missing)

**Pass criteria:** Return value equals `"You are a personal assistant running inside OpenClaw."`

---

#### TC-61-29: No filename config set → reads default filename

**Preconditions:**

- Config `agents.defaults.systemPromptPreambleFile` is NOT set (undefined)
- `$STATE_DIR/system-prompt-preamble.md` contains `"You are Default Filename Agent."`

**Action:** Call `resolveSystemPromptPreamble()`

**Expected:**

- Returned value is `"You are Default Filename Agent."`
- Default filename `system-prompt-preamble.md` is used

**Pass criteria:** Return value matches the default-named file content.

---

## Updated Coverage Summary

| Area                                         | Test IDs             | Count  |
| -------------------------------------------- | -------------------- | ------ |
| Happy path — file exists with custom content | TC-61-01 to TC-61-05 | 5      |
| Default fallback — no file                   | TC-61-06 to TC-61-08 | 3      |
| Edge cases                                   | TC-61-09 to TC-61-16 | 8      |
| Cache behavior                               | TC-61-17 to TC-61-21 | 5      |
| promptMode interaction                       | TC-61-22 to TC-61-23 | 2      |
| Regression / no-change                       | TC-61-24 to TC-61-25 | 2      |
| OPENCLAW_STATE_DIR override                  | TC-61-26             | 1      |
| Filename override via config                 | TC-61-27 to TC-61-29 | 3      |
| **Total**                                    |                      | **29** |

---

## Entry Criteria

- Feature branch with `resolveSystemPromptPreamble()` implemented
- All three change sites patched
- `stablePromptPrefixCache` hash input updated to include preamble content

## Exit Criteria

- All 25 test cases pass
- No existing `system-prompt.test.ts` or `capability-cli.test.ts` tests regress
- Coverage on `resolveSystemPromptPreamble()` helper: 100% statement, 100% branch
  (it is a small, critical helper — full coverage is achievable)
