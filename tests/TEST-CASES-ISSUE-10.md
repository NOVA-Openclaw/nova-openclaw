# Test Cases — Issue #10: Change NOVA release version format to YYYY.MM.DD-nova

## Summary

The `VERSION` constant (exported from `src/version.ts`) must include the `-nova` suffix.
The version in `package.json` should be changed from `2026.2.16` to `2026.2.16-nova`.

---

## TC-1: package.json contains `-nova` suffix

- **Type:** Static / grep
- **Verify:** `package.json` `"version"` field matches pattern `YYYY.M.D-nova`
- **Expected:** `"version": "2026.2.16-nova"`

## TC-2: VERSION constant ends with `-nova`

- **Type:** Unit (vitest)
- **File:** `src/version.test.ts`
- **Action:** Import `VERSION` from `./version.js`; assert `VERSION.endsWith("-nova")`
- **Expected:** `true`

## TC-3: VERSION constant matches package.json exactly

- **Type:** Unit (vitest)
- **File:** `src/version.test.ts`
- **Action:** Read `package.json` version, compare to `VERSION`
- **Expected:** They are identical (both `2026.2.16-nova`)

## TC-4: resolveVersionFromModuleUrl returns `-nova` suffixed version

- **Type:** Unit (vitest) — extends existing temp-dir tests
- **Action:** Create temp `package.json` with `{ "name": "openclaw", "version": "2026.2.16-nova" }`, call `resolveVersionFromModuleUrl`
- **Expected:** Returns `"2026.2.16-nova"`

## TC-5: Existing version resolution tests still pass

- **Type:** Regression
- **Action:** Run `npx vitest run src/version.test.ts`
- **Expected:** All existing tests pass (no breakage from format change)

## TC-6: No semver-strict validation blocks the prerelease tag

- **Type:** Exploratory / build
- **Action:** Run `npm version` or build pipeline to confirm `-nova` suffix doesn't cause errors
- **Expected:** Build succeeds; no semver validation rejects the format

---

## Implementation Notes

- The version string flows through as a plain string — no semver parsing in `version.ts`
- Primary change: update `"version"` in `package.json` from `2026.2.16` to `2026.2.16-nova`
- Add TC-2 as a new test in `src/version.test.ts`
