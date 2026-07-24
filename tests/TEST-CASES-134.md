# Test Cases: nova-openclaw#134 — Duplicate-Declaration Build Break on main (merge 980a96f, v2026.7.1)
<!-- Issue: #134 | Workflow run: SE #488 | Designed by: Gem (QA Lead) | Step 3 -->

Test-case design complete for SE Run #488 (issue #134). Full write-up below — includes a critical forensic finding on `readResponseWithLimit` that changes the risk profile of the fix.

---

# Test Case Design — SE Run #488 / Issue #134 (duplicate-identifier build breakage, merge 980a96f)

## Forensic notes informing this design (read before executing)

1. **`model-pricing-cache.ts` is NOT a simple duplicate-import case.** The two `readResponseWithLimit` imports come from *different modules*:
   - Line 1: `@openclaw/media-core/read-response-with-limit` — this path **does not resolve to a real file**. `packages/media-core/src/` contains no `read-response-with-limit.ts` (only `read-byte-stream-with-limit.ts`), and it is not in `tsconfig.json`'s explicit path aliases (only a generic `@openclaw/media-core/*` wildcard). This import predates the merge (present on main-side `9e874778` too) and is dead/broken.
   - Line 21 (added by the merge): `../infra/http-body.js` — this **is real**; `src/infra/http-body.ts` exports a working `readResponseWithLimit`.
   - **Implication: the correct fix keeps line 21 (`../infra/http-body.js`) and removes line 1, which is the opposite of naive "keep the first/upstream-looking one" instinct.** Test case 3 below is written specifically to catch a regression where the wrong import is kept.

2. **`session-store-runtime.ts` and `embedded-gateway-stub.ts` merge hunks contain substantial legitimate new content**, not just the duplicate lines — new exports (`readAmbientTranscriptWatermark`, `resolveAmbientTranscriptWatermarkKey`, `updateAmbientTranscriptWatermark`), new params (`readConsistency`), and new stub methods (`readNumberParam`, `dropPreSessionStartAnnouncePairs`, `projectChatDisplayMessages`, `readRecentSessionMessagesWithStatsAsync`, `readSessionMessagesPageWithStatsAsync`). A naive dedup pass must not accidentally strip these.

3. Relevant real CI check/job names (for cascade verification, confirmed against `.github/workflows/ci.yml`): `checks-fast-plugin-contracts-shard`, `checks-fast-channel-contracts-shard`, `check-prod-types`, `check-test-types`, `check-lint`, `check-session-accessor-boundary`, `check-session-transcript-reader-boundary`, `check-additional-extension-channels`, `check-additional-extension-package-boundary`, `check-docs`, plus `install-smoke.yml`, `plugin-npm-release.yml`, `openclaw-scheduled-live-checks.yml`.

---

## Test Cases

### Happy Path — Build Success

1. **TC-01: `pnpm build` succeeds on Node v22.** Run `pnpm build` (invokes `scripts/build-all.mjs`) on the fix branch with `node --version` pinned to v22.23.1 (production). **Pass:** exit code 0, no `PARSE_ERROR` output, `dist/` artifacts produced.
2. **TC-02: `pnpm build:docker` succeeds on Node v22.** Run the full docker build chain (`tsdown-build.mjs` → `check-cli-bootstrap-imports.mjs` → `runtime-postbuild.mjs` → `build-stamp.mjs` → `runtime-postbuild-stamp.mjs` → plugin asset build/copy → hook metadata/export templates/build-info/CLI startup/compat scripts). **Pass:** exit code 0 for every chained script; no `[PARSE_ERROR]` in tsdown/rolldown output; final Docker image builds and starts.
3. **TC-03: `pnpm build:plugin-sdk:strict-smoke` succeeds.** This exercises the plugin-sdk-specific tsdown path plus `check-plugin-sdk-exports.mjs`, which is a separate build surface from `build:docker` and could regress independently if the fix touches export shapes. **Pass:** exit code 0, `check-plugin-sdk-exports.mjs` reports no missing/extra exports.

### Regression Detection — Duplicates Removed, No New Ones, Correct Declaration Kept

4. **TC-04: Static duplicate-identifier scan — zero occurrences of the 4 named duplicates.** Grep each file for its previously-duplicated identifier and assert exactly one declaration remains:
   - `grep -c 'resolveStorePath as resolveSessionStorePath' src/plugin-sdk/session-store-runtime.ts` → 1
   - `grep -c 'readResponseWithLimit' src/gateway/model-pricing-cache.ts` (import lines only, i.e. lines matching `^import`) → 1
   - `grep -c 'normalizeFastMode, type FastMode' src/agents/tools/embedded-gateway-stub.ts` → 1
   **Pass:** each count is exactly 1 (not 0 — the identifier must still be imported and used, just once).

5. **TC-05: `model-pricing-cache.ts` retains the correct (working) import source.** Assert the surviving import is `import { readResponseWithLimit } from "../infra/http-body.js"` and that `@openclaw/media-core/read-response-with-limit` does **not** appear anywhere in the file. **Pass:** `grep -q 'from "../infra/http-body.js"'` matches on the `readResponseWithLimit` import line; `grep -q 'media-core/read-response-with-limit'` returns no match. **Fail condition to explicitly watch for:** if the fix instead kept the `@openclaw/media-core` import (the naive "upstream/first line" choice) and dropped the `../infra/http-body.js` one, TC-01/TC-02 will still catch it at build time (rolldown will fail to resolve the module) — but this test case exists to give a fast, targeted signal *why*, rather than relying solely on the build log.

6. **TC-06: Repo-wide duplicate-declaration scan for regressions elsewhere.** Run the same class of check the build uses (rolldown/tsdown parse) across the *entire* `src/` and `packages/` tree, not just the 3 known files, to confirm the merge didn't introduce the same class of bug elsewhere unnoticed. Practically: full `pnpm build` (TC-01) already covers this since tsdown will PARSE_ERROR on any duplicate top-level identifier repo-wide — but explicitly confirm the build log contains zero `PARSE_ERROR` lines (not just that the 4 known ones are gone). **Pass:** `grep -c 'PARSE_ERROR' <build-log>` → 0.

7. **TC-07: Behavioral equivalence — `readResponseWithLimit` call site unchanged.** Confirm the call at `model-pricing-cache.ts:294` (`await readResponseWithLimit(response, MAX_PRICING_CATALOG_BYTES, {...})`) still type-checks against the `../infra/http-body.js` signature (`(response: Response, maxBytes: number, options?: {onOverflow, chunkTimeoutMs, onIdleTimeout}) => Promise<Buffer>`) and that no call-site changes were needed. **Pass:** `check-prod-types`/`check-test-types` pass with zero new errors in this file; no diff to the call site itself beyond the import line.

8. **TC-08: `session-store-runtime.ts` — new exports from the merge are preserved.** Assert `readAmbientTranscriptWatermark`, `resolveAmbientTranscriptWatermarkKey`, `updateAmbientTranscriptWatermark`, and type `AmbientTranscriptWatermarkScope` are still exported, and `readConsistency?: "latest"` is still present on `SessionStoreReadParams`. **Pass:** grep/AST check confirms all 4 identifiers present in file exports; `check-session-accessor-boundary` passes (this check specifically guards this module's contract surface).

9. **TC-09: `embedded-gateway-stub.ts` — new stub methods from the merge are preserved.** Assert `dropPreSessionStartAnnouncePairs`, `projectChatDisplayMessages`, `readRecentSessionMessagesWithStatsAsync`, `readSessionMessagesPageWithStatsAsync`, and `readNumberParam` (added to the `./common.js` import) are all still present. **Pass:** grep confirms presence; `check-session-transcript-reader-boundary` passes.

10. **TC-10: `session-store-runtime.ts` export surface migration is intact.** The merge changed `export { clearSessionStoreCacheForTest, recordSessionMetaFromInbound, updateLastRoute } from "../config/sessions/store.js"` into a split: `clearSessionStoreCacheForTest` still from `store.js`, but `recordSessionMetaFromInbound`/`updateLastRoute` now re-exported (renamed) from `session-accessor.js` (`recordInboundSessionMeta as recordSessionMetaFromInbound`, `updateSessionLastRoute as updateLastRoute`). Confirm this split survives the dedup fix untouched. **Pass:** `grep -A2 'export {' session-store-runtime.ts` (near EOF) shows the two-block split unchanged; plugin-sdk consumers relying on these SDK-facing names still resolve (`check-additional-extension-package-boundary`).

### Cascade Verification — Named-Failing CI Jobs Go Green

11. **TC-11: `checks-fast-plugin-contracts-shard` passes** (runs `pnpm test:contracts:plugins`, config `test/vitest/vitest.contracts-plugin.config.ts`). **Pass:** exit 0, no PARSE_ERROR, no failed contract assertions.
12. **TC-12: `checks-fast-channel-contracts-shard` passes** (runs `pnpm test:contracts:channels` across the 4 channel-surface/config/registry/session vitest configs). **Pass:** exit 0 for all 4 sub-configs.
13. **TC-13: `check-prod-types` and `check-test-types` pass.** **Pass:** zero new TypeScript errors attributable to the 3 files or their consumers.
14. **TC-14: `check-lint` passes** (`pnpm lint` → `scripts/run-oxlint-shards.mjs`). **Pass:** exit 0, no new lint violations (e.g. unused-import warnings on whichever duplicate import is removed, or on any now-orphaned identifier).
15. **TC-15: `check-session-accessor-boundary` and `check-session-transcript-reader-boundary` pass.** These are the boundary checks named in the issue's affected-file set; they gate the two SDK-facing files directly. **Pass:** exit 0 for both.
16. **TC-16: `check-additional-extension-channels` and `check-additional-extension-package-boundary` pass.** **Pass:** exit 0 for both — confirms extension-facing plugin/channel contracts aren't broken by the export-surface changes in `session-store-runtime.ts`.
17. **TC-17: `check-docs` (Docs job) passes.** **Pass:** exit 0 — confirms no doc-generation step chokes on the build output or type surface changes.
18. **TC-18: `install-smoke.yml` (Install Smoke workflow) passes**, specifically the `pnpm build:docker`/tsdown step named in the 2026-07-19 issue comment. **Pass:** full workflow green, no PARSE_ERROR in Docker build step.
19. **TC-19: `plugin-npm-release.yml` (Plugin NPM Release) passes** (named as failing in the issue). **Pass:** exit 0; plugin package build/publish dry-run succeeds without the parse errors.
20. **TC-20: `openclaw-scheduled-live-checks.yml` (Scheduled Live & E2E) — targeted re-run or equivalent local repro passes the `vite:oxc` transform stage** that previously hit the `readResponseWithLimit` duplicate before live tests could execute. **Pass:** transform stage completes, live/E2E tests reach execution (do not need full E2E pass, just confirm the build-stage blocker is gone).

### Edge Case — Whole-File Cross-Check vs Upstream v2026.7.1

21. **TC-21: Full-file diff of all 3 files against `origin/v2026.7.1` tag, beyond the 4 named identifiers.** Run `git diff v2026.7.1 -- <file>` for each of the 3 files post-fix and manually review every remaining hunk. **Pass criteria:** every remaining delta from upstream is either (a) an intentional fork divergence that predates the merge (verifiable against `9e874778`, the last-known-good fork commit) and is confirmed intentional, or (b) has no functional difference (e.g. comment reordering). **Fail:** any hunk that is itself an unresolved "kept-both-sides" merge artifact (duplicate logic, duplicate exports, duplicate type declarations) not caught by TC-04–TC-10.
22. **TC-22: Three-way comparison per file — `9e874778` (fork pre-merge) vs `v2026.7.1` (upstream) vs fix-branch post-fix.** For each file, confirm the fix-branch version equals "fork pre-merge content, plus upstream's *net-new* additions, minus upstream's duplicate re-declarations of content the fork already had." This is the qualitative check underlying TC-08/TC-09 but generalized to catch any other file-specific kept-both-sides hunk not already enumerated (e.g., in `model-pricing-cache.ts`, are there other lines beyond the `readResponseWithLimit` import that came from both sides redundantly?). **Pass:** no unexplained residual duplication anywhere in the 3-way diff for any of the 3 files.
23. **TC-23: Confirm comment/ordering artifacts don't mask duplicates.** Note that in the pre-fix state, duplicate imports are separated by unrelated lines (e.g. `embedded-gateway-stub.ts` line 1 import, then a block comment, then line 7's duplicate import) — a naive single-line dedup pass or a fix that only checks adjacent lines could miss this pattern. **Pass:** the fix diff explicitly addresses non-adjacent duplicate declarations, not just consecutive ones; confirmed via TC-04's grep counts which are line-position-agnostic.

### Boundary — Node Version

24. **TC-24: Build passes on Node v22.23.1 (production version).** This is the primary boundary condition — production runs Node v22, and this is the version that must be validated as the gating requirement. **Pass:** TC-01/TC-02 executed specifically under `node@22.23.1`, exit 0.
25. **TC-25: Build passes on Node v25.5.0 (secondary/repro environment).** Confirms the fix isn't Node-version-sensitive in either direction (issue comment already reproduced the *bug* on both v22.23.1 and v25.5.0, ruling out a node-version quirk as root cause — this test confirms the *fix* also holds on both). **Pass:** TC-01/TC-02 executed under `node@25.5.0`, exit 0. **Priority:** secondary to TC-24; do not block merge solely on v25 if v22 is fully green and v25 has an unrelated, pre-existing failure — but any v25-specific NEW failure introduced by this fix is in scope and must be triaged.

---

## Suggested execution order for Flint (QA Executor)
1. TC-04 → TC-10 (static/grep-based, fast, no build required) — catch obvious regressions first, cheaply.
2. TC-01, TC-02, TC-24 (Node v22 build) — the critical gate.
3. TC-05, TC-06, TC-07 (targeted post-build verification of the tricky `readResponseWithLimit` case).
4. TC-11 → TC-20 (cascade CI jobs) — run in CI on the PR branch.
5. TC-21 → TC-23 (manual/scripted whole-file upstream diff review) — do this before merge, not after; it's the one category a green CI run cannot fully substitute for.
6. TC-03, TC-25 (secondary build surfaces / Node v25) — lower priority, can run in parallel with step 4.

## Exit criteria for Step 3 sign-off
All of TC-01–TC-20 pass, and TC-21/TC-22 manual review is completed with zero unexplained residual duplication. TC-25 (Node v25) may proceed to merge with a documented pre-existing-and-unrelated failure if one exists, but must not show a NEW failure vs the pre-fix baseline.
