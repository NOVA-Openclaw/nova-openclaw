import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * The hardcoded default preamble string, used as a fallback when no file
 * override is present or when the file is empty/unreadable.
 */
export const DEFAULT_SYSTEM_PROMPT_PREAMBLE =
  "You are a personal assistant running inside OpenClaw.";

/**
 * Default filename for the preamble override file, resolved against the state
 * directory.
 */
export const DEFAULT_PREAMBLE_FILENAME = "system-prompt-preamble.md";

/**
 * Process-scoped cache for the resolved preamble string. `undefined` means
 * not yet resolved; `null` is not used (we store the string or DEFAULT).
 */
let preambleCache: string | undefined;

/**
 * Read the preamble file and return its trimmed content, or `undefined` if
 * the file is absent, empty after trimming, or unreadable.
 *
 * CRLF sequences are normalized to LF before trimming.
 */
function readPreambleFile(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const trimmed = normalized.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT / ENOTDIR = file simply doesn't exist; no need to warn.
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      // Permission errors and other I/O problems: warn but fall back.
      console.warn(
        `[system-prompt-preamble] Could not read preamble file "${filePath}": ${String(err)}`,
      );
    }
    return undefined;
  }
}

/**
 * Options for `resolveSystemPromptPreamble`.
 */
export type ResolvePreambleOptions = {
  /**
   * Optional custom filename (from `agents.defaults.systemPromptPreambleFile`).
   * When provided it replaces the default filename; if the named file is
   * absent the function falls back to the hardcoded default string (it does
   * NOT fall through to the default filename).
   */
  preambleFile?: string;
  /**
   * Process environment to use for state-dir resolution. Defaults to
   * `process.env`. Useful in tests to inject `OPENCLAW_STATE_DIR`.
   */
  env?: NodeJS.ProcessEnv;
};

/**
 * Resolve the system prompt preamble string.
 *
 * Resolution order:
 * 1. Return the cached result if available (process-scoped, read once).
 * 2. Determine the target filename:
 *    - If `preambleFile` option is set, use that name.
 *    - Otherwise use `DEFAULT_PREAMBLE_FILENAME`.
 * 3. Build the full path: `<resolveStateDir()>/<filename>`.
 * 4. If the file exists and has non-whitespace content → use the trimmed
 *    content (CRLF → LF normalised).
 * 5. If the file is missing, empty, whitespace-only, or unreadable (WARN
 *    logged) → fall back to `DEFAULT_SYSTEM_PROMPT_PREAMBLE`.
 *
 * When `preambleFile` is provided but the file doesn't exist, the function
 * returns the default string — it does NOT fall through to look for the
 * default filename.
 *
 * @param options - Optional resolution parameters.
 * @returns The resolved preamble string (never throws).
 */
export function resolveSystemPromptPreamble(options: ResolvePreambleOptions = {}): string {
  // Return cached result when available.
  if (preambleCache !== undefined) {
    return preambleCache;
  }

  const env = options.env ?? process.env;
  const filename = options.preambleFile?.trim() || DEFAULT_PREAMBLE_FILENAME;
  const stateDir = resolveStateDir(env);
  const filePath = path.join(stateDir, filename);

  const content = readPreambleFile(filePath);
  const result = content ?? DEFAULT_SYSTEM_PROMPT_PREAMBLE;

  preambleCache = result;
  return result;
}

/**
 * Clear the process-scoped preamble cache.
 *
 * Exposed for testing purposes only. In production the cache is populated
 * once and never cleared (process-scoped read-once behaviour).
 */
export function clearSystemPromptPreambleCache(): void {
  preambleCache = undefined;
}
