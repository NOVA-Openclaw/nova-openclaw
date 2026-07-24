# Test Cases: nova-openclaw#152 — TS2304 `assistantForFailover` in embedded-agent-runner/run.ts (sibling of #134, merge 980a96f)
<!-- Issue: #152 | Sibling of: #134 (SE #488) | Workflow run: SE #489 | Designed by: Gem (QA Lead) | Step 3 -->

Test-case design complete for SE Run #489 (issue #152). Structure follows the precedent set by `tests/TEST-CASES-134.md` (branch `fix/134-merge-dup-declarations`).

---

# Test Case Design — SE Run #489 / Issue #152 (stale-identifier build breakage, merge 980a96f, sibling of #134)

## Forensic notes informing this design (read before executing)

1. **Root cause, verified directly against source (not just the issue text).** Three-way check against the live repo confirms the PL's fix-design comment on #152 exactly:
   - Pre-merge fork (`9e874778eac8b42ac5ddf7b44ebe7323a7c31590`, old line 3257) declared `const assistantForFailover = currentAttemptAssistant ?? sessionAssistantForCandidate;`.
   - Current `main` (`0dc6e66b75`) line **2479** reads `const attemptAssistant = currentAttemptAssistant ?? sessionAssistantForCandidate;` — same initializer expression, upstream's binding name.
   - Current `main` line **3543** still reads `const assistantVisibleText = resolveFinalAssistantVisibleText(assistantForFailover);` — the one usage the merge conflict resolution missed.
   - `git blame -L 3543,3543` attributes the line to the merge-adjacent commit `9bffa031e7e1` (2026-07-02, pre-dating the `980a96f653` merge landing on main 2026-07-14), consistent with "one usage site not converted during conflict resolution."
2. **Same root cause class as #134, different failure mode.** #134 was a *duplicate-identifier* class defect (kept-both-sides merge artifact); #152 is a *missing/stale-identifier* class defect (converted-all-but-one merge artifact). Both trace to the same `980a96f653` "Merge tag v2026.7.1" commit, but in a 4th file (`run.ts`) that #134's scope never enumerated.
3. **Scope and type-fit confirmed by direct inspection, not inference:**
   - `attemptAssistant` (declared line 2479) is used at **26 other call sites** in the same enclosing block (lines 2483, 3061, 3094, 3210, 3251, 3423, 3434–3438, 3452, 3457, 3463–3464, 3483, 3490–3491, 3501, 3506–3507, 3517, 3588, 3672, 3679, 3695, 3741, 4218, 4261) — both before and after line 3543, at identical indentation (10 spaces / same block depth as the declaration).
   - `resolveFinalAssistantVisibleText` (defined in `src/agents/embedded-agent-runner/run/helpers.ts:269`) has signature `(lastAssistant: AssistantMessage | undefined) => string | undefined`. `attemptAssistant`'s type (from `currentAttemptAssistant ?? sessionAssistantForCandidate`, both `AssistantMessage`-typed per surrounding destructure) matches exactly.
   - Line 3696, immediately adjacent to the buggy line 3543's twin call, already calls the sibling function identically: `resolveFinalAssistantRawText(attemptAssistant)` — i.e., the exact same call pattern this fix produces already exists one "usage family" over, giving a live in-file precedent that the substitution is idiomatically correct, not just type-correct.
4. **Repo-wide sweep already performed (results below in TC-04) via `git grep` (tracked files only — avoids node_modules/.git false-slowness).** Exactly one occurrence of `assistantForFailover` exists in the entire tracked tree: the line 3543 usage itself. No other stale references, no test fixtures, no docs, no comments reference the old name.
5. **This is a 1-line, 1-file fix** — smaller blast radius than #134 (which touched 3 files). Regression-guard emphasis is correspondingly narrower: confirm the diff is exactly this and nothing else, and confirm none of the 26 legitimate `attemptAssistant` usages (all merge-added, per #134's precedent of "don't strip legitimate merge content") are touched.
6. **Relevant real CI job names** (confirmed against `.github/workflows/ci.yml`, matrix `check_name:` entries): `check-shrinkwrap`, `check-prod-types`, `check-lint`, `check-test-types`, `check-additional-extension-channels`, `check-additional-extension-bundled`, `check-additional-extension-package-boundary` are explicit named matrix jobs. `checks-node-agentic-agents-embedded`, `checks-node-agentic-agents-support`, `checks-node-agentic-plugin-sdk`, `checks-node-core-fast`, `checks-node-core-runtime-tui-pty`, `checks-node-core-tooling` are the sharded Vitest/typecheck jobs named in se488-step10's forensic list. All 13 fail at the **typecheck stage**, before any test logic executes — meaning cascade verification for this fix is a typecheck-clearing question, not a behavioral one (see Cascade section).

---

## Test Cases

### Happy Path — Typecheck / Build Success

1. **TC-01: `check-prod-types` passes (production `tsc --noEmit` equivalent).** This is the exact job whose log surfaced the TS2304 in se488-step10's forensics (job `89336616513`). **Pass:** exit code 0, zero TS2304 errors, zero new errors of any kind attributable to `run.ts` or its consumers.
2. **TC-02: `check-test-types` passes.** Separate tsc project/config from prod-types (test-scoped types); confirmed as one of the 13 originally-blocked jobs. **Pass:** exit code 0, zero TS2304, zero new errors.
3. **TC-03: `pnpm build` succeeds end-to-end on Node v22.23.1 (production version).** Full build chain must not choke on the type error at the tsdown/rolldown transform stage. **Pass:** exit code 0, `dist/` artifacts produced, no `PARSE_ERROR` / `TS2304` in output.
4. **TC-04: `check-lint` passes.** Named as one of the 13 blocked jobs; oxlint runs a type-aware pass in this repo's config and was failing on the same root cause. **Pass:** exit 0, no new lint violations (including no new unused-import or unresolved-reference violations introduced by the rename).

### Defect-Specific — TS2304 Disappearance

5. **TC-05: The exact reported error is gone.** Run the same `tsc`/build invocation that produced the original error and grep the output for the literal string from the issue:
   ```
   grep -c "Cannot find name 'assistantForFailover'" <typecheck-output>
   ```
   **Pass:** count is 0. **Fail condition:** any occurrence, at any line number — the fix must eliminate the error entirely, not just relocate it.
6. **TC-06: Line 3543 now reads the fixed identifier.** `sed -n '3543p' src/agents/embedded-agent-runner/run.ts` contains `resolveFinalAssistantVisibleText(attemptAssistant)` (not `assistantForFailover`). **Pass:** exact string match. This is the single line the fix is scoped to touch.
7. **TC-07: No new TS2304 (or any TS23xx-class "cannot find name/module") errors elsewhere in the file post-fix.** Full `check-prod-types`/`check-test-types` output for `run.ts` shows zero errors of any kind, not just zero of this specific one. **Pass:** grep for `run.ts(` in typecheck output returns no lines.

### Scope-Correctness of the Substitute Identifier

8. **TC-08: Declaration precedes usage in file order and block scope.** `attemptAssistant` is declared at line 2479; the fixed usage is at line 3543 (2479 < 3543 — declaration precedes usage). Both are within the same enclosing function body at identical indentation (10 spaces, confirmed via `cat -A` byte-for-byte comparison of leading whitespace on both lines). **Pass:** no TDZ (temporal-dead-zone) or out-of-scope error at typecheck or runtime; indentation/brace-depth match confirmed by direct inspection (already verified during test design — see forensic note 3).
9. **TC-09: Initializer semantics match pre-merge intent exactly.** Pre-merge fork declared `const assistantForFailover = currentAttemptAssistant ?? sessionAssistantForCandidate;` (old line 3257, ref `9e874778eac8b42ac5ddf7b44ebe7323a7c31590`). Current `attemptAssistant` at line 2479 has the **identical** initializer expression: `currentAttemptAssistant ?? sessionAssistantForCandidate`. **Pass:** byte-for-byte match of the initializer RHS across the pre-merge ref and current main (already confirmed during design — `git show 9e874778eac8b42ac5ddf7b44ebe7323a7c31590:src/agents/embedded-agent-runner/run.ts` at old line 3257 vs. current line 2479). This proves the fix is a pure rename with zero semantic drift, not an accidental introduction of a differently-scoped or differently-initialized variable that merely shares a similar name.
10. **TC-10: Type fit confirmed against the consuming function's signature.** `resolveFinalAssistantVisibleText` (defined `src/agents/embedded-agent-runner/run/helpers.ts:269`) accepts `lastAssistant: AssistantMessage | undefined`. `attemptAssistant`'s inferred type from its `??` initializer (`currentAttemptAssistant` and `sessionAssistantForCandidate`, both destructured/declared as `AssistantMessage`-typed per surrounding code) satisfies this exactly — no widening, narrowing, or `as`-cast needed. **Pass:** `check-prod-types` reports zero type-mismatch errors on this call site specifically (cross-checked against TC-01's general pass).
11. **TC-11: In-file idiomatic precedent already exists for this exact call pattern.** Line 3695 (`resolveFinalAssistantVisibleText(attemptAssistant)`) and line 3696 (`resolveFinalAssistantRawText(attemptAssistant)`) already call these two sibling functions with `attemptAssistant` as the argument, elsewhere in the same file. The fix at line 3543 makes that call site consistent with this established in-file pattern rather than introducing a novel usage. **Pass:** manual review confirms the fixed line 3543 is stylistically and semantically consistent with the codebase's established pattern for this call family (not merely type-correct in isolation).

### No-Other-Stale-Identifier Sweep

12. **TC-12: Repo-wide `assistantForFailover` sweep — pre-fix baseline (already executed during test design).** `git grep -n "assistantForFailover"` across the full tracked tree returned **exactly one hit**: `src/agents/embedded-agent-runner/run.ts:3543`. No occurrences in tests, fixtures, docs, comments, or any other source file. **Pass (pre-fix, informational):** confirms the fix's scope of "rename this one line" is complete and sufficient — there is no second stale reference lurking elsewhere that the PL's one-line fix design would miss.
13. **TC-13: Repo-wide `assistantForFailover` sweep — post-fix verification (must re-run after fix lands).** `git grep -c "assistantForFailover"` (or equivalent `grep -r --include='*.ts' --include='*.tsx'`) across the full tracked tree. **Pass:** zero hits anywhere in the repository. This is the authoritative "no stale identifier remains" gate — must be re-run against the actual fix commit, not assumed from the pre-fix sweep.
14. **TC-14: Sweep also covers non-`.ts` surfaces (defense in depth).** Extend TC-13's grep to `.md`, `.json`, `.yml` in case the identifier leaked into docs, changelogs, or config comments during the same bad merge. **Pass:** zero hits outside `.ts`/`.tsx` source (none expected or found in pre-fix baseline, but re-confirm post-fix since this is a cheap check).

### Regression Guards

15. **TC-15: Diff is exactly 1 line, 1 file.** `git diff main..<fix-branch> --stat` shows exactly one file (`src/agents/embedded-agent-runner/run.ts`) with exactly 1 line changed (1 insertion, 1 deletion — a same-line modification, not an added/removed line). **Pass:** `git diff --stat` output matches `1 file changed, 1 insertion(+), 1 deletion(-)` and `git diff -U0` shows only the single `-`/`+` pair at line 3543.
16. **TC-16: All 26 legitimate `attemptAssistant` usages elsewhere in the file are untouched.** Enumerate call sites at lines 2483, 3061, 3094, 3210, 3251, 3423, 3434–3438, 3452, 3457, 3463–3464, 3483, 3490–3491, 3501, 3506–3507, 3517, 3588, 3672, 3679, 3695, 3741, 4218, 4261 (26 sites, captured pre-fix as the baseline). **Pass:** identical grep output for `attemptAssistant` pre-fix and post-fix, plus the new line 3543 occurrence (27 total post-fix). No merge-added identifier is accidentally stripped or altered — mirrors #134's TC-08/TC-09 "preserve merge-added content" pattern, scoped here to a single identifier's usage count rather than whole export lists (since this fix is 1 line vs. #134's 3-file scope).
17. **TC-17: `currentAttemptAssistant` and `sessionAssistantForCandidate` (the two identifiers `attemptAssistant`'s initializer depends on) are unmodified.** Both remain present and unchanged at their pre-fix line numbers/content (confirmed baseline: `currentAttemptAssistant` at lines 2367, 2392, 2472, 2479, 3440; `sessionAssistantForCandidate` at lines 2471, 2479, 2498–2499, 2510). **Pass:** no diff to any line outside 3543.
18. **TC-18: No new identifier collisions introduced.** Confirm `attemptAssistant` is not redeclared or shadowed between lines 2479 and 3543 (i.e., no nested block between the declaration and the fixed usage introduces a different `attemptAssistant` binding that would silently change which variable line 3543 now refers to). **Pass:** `grep -n "attemptAssistant\s*=" src/agents/embedded-agent-runner/run.ts` shows exactly one assignment/declaration (line 2479) for the entire function scope spanning both lines.

### Cascade Verification — Named Blocked CI Jobs Go Green

All 13 jobs identified in se488-step10-merge-report.md failed at the **typecheck stage** on the same root cause (`run.ts(3543,73): error TS2304`). Since this is a pure type-error fix with zero behavioral change, cascade verification is primarily "does typecheck now pass," not "does new test logic pass." Per #488 precedent (full CI matrix deferred to PR gate), this section defines pass/fail criteria; full-matrix execution happens at the PR CI run, not in local test design.

19. **TC-19: `check-prod-types` flips green.** (Duplicate emphasis of TC-01 in cascade-specific framing — this was one of the two jobs whose failure log was directly captured in se488-step10, job `89336616513`.)
20. **TC-20: `check-test-types` flips green.**
21. **TC-21: `check-lint` flips green.** (Directly captured failure log in se488-step10, job `89336616470`.)
22. **TC-22: `check-shrinkwrap` flips green.** Typecheck-gated per the merge-report's 13-job list; should clear once the type error is gone (this job does not itself touch `run.ts` logic, only gates on a clean prior stage).
23. **TC-23: `check-additional-extension-bundled`, `check-additional-extension-channels`, `check-additional-extension-package-boundary` all flip green.** These 3 extension-boundary jobs were blocked purely by the shared typecheck-stage failure, not by any extension-specific logic touching `run.ts`.
24. **TC-24: `checks-node-agentic-agents-embedded` flips green.** Highest-relevance sharded job — `embedded-agent-runner` is literally the directory containing the fixed file; this shard's own test/type-check surface directly covers the changed code.
25. **TC-25: `checks-node-agentic-agents-support` flips green.**
26. **TC-26: `checks-node-agentic-plugin-sdk` flips green.**
27. **TC-27: `checks-node-core-fast`, `checks-node-core-runtime-tui-pty`, `checks-node-core-tooling` all flip green.**
28. **TC-28: No previously-passing job regresses.** Compare the full pass/fail job list on the fix branch's CI run against current `main`'s baseline (the same 92-pass/15-fail split documented in se488-step10, adjusted for the 2 known-pre-existing-unrelated failures — `security-fast` dependency advisories and `check-docs` staleness — which are **out of scope** for this fix and should remain in whatever state they're already in). **Pass:** zero new failures among jobs that were passing before this fix; the only state changes should be the 13 listed jobs flipping fail→pass.
29. **TC-29 (deferred per #488 precedent): Full 109-check CI matrix run on the PR branch is the authoritative gate, not local test execution.** Per SE run #488's established precedent ("defer full matrix to PR gate"), TC-19–TC-28 define *expected* outcomes; actual execution and confirmation happens when Gidget opens the PR and CI runs. Flint should confirm TC-01–TC-18 locally/pre-PR (fast, deterministic, no CI infra needed) and treat TC-19–TC-28 as the PR-gate checklist to verify against the actual run, not something to simulate locally.

### Boundary / Out-of-Scope Reminders (carried from #134 precedent, scoped down)

30. **TC-30: The 2 known pre-existing-unrelated CI failures are explicitly out of scope.** `security-fast` (dependency advisories) and `check-docs` (docs_map staleness) are unrelated to both #134 and #152 and must not be conflated with this fix's success criteria. **Pass condition for sign-off:** these 2 jobs' pass/fail state is irrelevant to this issue's exit criteria — do not block on them.
31. **TC-31: The perpetually-stuck `Scan changed paths (precise)` (OpenGrep) infra job is explicitly out of scope.** Same rationale as #488 — 100% historical non-completion rate, unrelated to any code change, and `main` has no branch protection requiring it. **Pass condition:** irrelevant to sign-off.

---

## Suggested execution order for Flint (QA Executor)

1. TC-06, TC-13, TC-14 (grep-based, near-instant, no build required) — confirm the literal fix landed and no stale identifier remains anywhere.
2. TC-15, TC-16, TC-17, TC-18 (diff-scope and regression-guard checks, grep/diff-based, fast) — confirm blast radius is exactly 1 line.
3. TC-01, TC-02, TC-03, TC-04 (the critical typecheck/build/lint gate on Node v22.23.1) — this is the primary pass/fail signal.
4. TC-05, TC-07 (targeted post-typecheck grep for the specific error string and any residual TS23xx-class errors in the file).
5. TC-08, TC-09, TC-10, TC-11 (scope/semantic verification — mostly already confirmed during design via direct source inspection; Flint should re-confirm against the actual fix commit rather than trust the pre-fix design notes).
6. TC-19 → TC-28 (cascade CI jobs) — run in CI on the PR branch per TC-29; do not attempt to fully replicate the 109-job matrix locally.
7. TC-30, TC-31 — informational only, not gating.

## Exit criteria for Step 3 sign-off

All of TC-01–TC-18 pass locally/pre-PR. TC-19–TC-28 are expected-outcome definitions to be confirmed at the PR CI gate (per #488 precedent — defer full matrix to PR gate); Step 3 sign-off does not require the PR to exist yet, but the PR must show all 13 previously-blocked jobs green (or newly-identified-and-triaged-separately) before this issue is closed. TC-30/TC-31 are explicitly non-gating. Given the fix is a 1-line, 1-file, zero-behavior-change rename with a pre-merge-verified-identical initializer, this is a low-risk change — QA sign-off should not require anything beyond TC-01–TC-18 passing plus PR-gate confirmation of TC-19–TC-28; do not add speculative additional test scope beyond what's enumerated here.
