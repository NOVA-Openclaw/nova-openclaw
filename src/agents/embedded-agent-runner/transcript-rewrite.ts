/**
 * Rewrites transcript entries in session managers, states, and files.
 */
import type {
  TranscriptRewriteReplacement,
  TranscriptRewriteRequest,
  TranscriptRewriteResult,
} from "../../context-engine/types.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { emitSessionTranscriptUpdate } from "../../sessions/transcript-events.js";
import type { AgentMessage } from "../runtime/index.js";
import {
  acquireSessionWriteLock,
  type SessionWriteLockAcquireTimeoutConfig,
  resolveSessionWriteLockOptions,
} from "../session-write-lock.js";
import type { SessionManager } from "../sessions/session-manager.js";
import { log } from "./logger.js";
import {
  readTranscriptFileState,
  type TranscriptFileState,
  type TranscriptPersistedEntry,
} from "./transcript-file-state.js";
import {
  persistRuntimeTranscriptStateMutation,
  resolveRuntimeTranscriptReadTarget,
  type RuntimeTranscriptScope,
} from "./transcript-runtime-state.js";

// SessionBranchEntry / SessionManagerLike / estimateMessageBytes /
// findTranscriptRewriteMatches / remapEntryId are intentionally duplicated
// (not imported) from strip-stale-thinking-blocks.ts here. That module needs
// rewriteTranscriptEntriesInSessionManager (a runtime value) from this file
// for the session-manager append path; importing shared helpers back from
// strip-stale-thinking-blocks.ts would recreate the same runtime import
// cycle this split exists to avoid. See #111.
type SessionManagerLike = ReturnType<typeof SessionManager.open>;
type SessionBranchEntry = ReturnType<SessionManagerLike["getBranch"]>[number];

function estimateMessageBytes(message: AgentMessage): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function findTranscriptRewriteMatches(
  branch: readonly SessionBranchEntry[],
  replacementsById: ReadonlyMap<string, AgentMessage>,
): { matchedIndices: number[]; bytesFreed: number } {
  const matchedIndices: number[] = [];
  let bytesFreed = 0;

  for (let index = 0; index < branch.length; index++) {
    const entry = branch[index];
    if (entry.type !== "message") {
      continue;
    }
    const replacement = replacementsById.get(entry.id);
    if (!replacement) {
      continue;
    }
    const originalBytes = estimateMessageBytes(entry.message);
    const replacementBytes = estimateMessageBytes(replacement);
    matchedIndices.push(index);
    bytesFreed += Math.max(0, originalBytes - replacementBytes);
  }

  return { matchedIndices, bytesFreed };
}

function remapEntryId(
  entryId: string | null | undefined,
  rewrittenEntryIds: ReadonlyMap<string, string>,
): string | null {
  if (!entryId) {
    return null;
  }
  return rewrittenEntryIds.get(entryId) ?? entryId;
}

function appendTranscriptStateBranchEntry(params: {
  state: TranscriptFileState;
  entry: SessionBranchEntry;
  rewrittenEntryIds: ReadonlyMap<string, string>;
}): SessionBranchEntry {
  const { state, entry, rewrittenEntryIds } = params;
  if (entry.type === "message") {
    return state.appendMessage(entry.message);
  }
  if (entry.type === "compaction") {
    return state.appendCompaction(
      entry.summary,
      remapEntryId(entry.firstKeptEntryId, rewrittenEntryIds) ?? entry.firstKeptEntryId,
      entry.tokensBefore,
      entry.details,
      entry.fromHook,
    );
  }
  if (entry.type === "thinking_level_change") {
    return state.appendThinkingLevelChange(entry.thinkingLevel);
  }
  if (entry.type === "model_change") {
    return state.appendModelChange(entry.provider, entry.modelId);
  }
  if (entry.type === "custom") {
    return state.appendCustomEntry(entry.customType, entry.data);
  }
  if (entry.type === "custom_message") {
    return state.appendCustomMessageEntry(
      entry.customType,
      entry.content,
      entry.display,
      entry.details,
    );
  }
  if (entry.type === "session_info") {
    return state.appendSessionInfo(entry.name ?? "");
  }
  if (entry.type === "branch_summary") {
    return state.branchWithSummary(
      remapEntryId(entry.parentId, rewrittenEntryIds),
      entry.summary,
      entry.details,
      entry.fromHook,
    );
  }
  return state.appendLabelChange(
    remapEntryId(entry.targetId, rewrittenEntryIds) ?? entry.targetId,
    entry.label,
  );
}

// Note: rewriteTranscriptEntriesInSessionManager and
// stripStaleThinkingBlocksFromSessionManagerBranch (#111) live in
// strip-stale-thinking-blocks.ts, not here, to avoid a runtime import cycle
// (session-manager.ts -> this module -> transcript-file-state.ts ->
// session-manager.ts). See that module for the session-manager rewrite path.

export function rewriteTranscriptEntriesInState(params: {
  state: TranscriptFileState;
  replacements: TranscriptRewriteReplacement[];
  allowedRewriteSuffixEntryIds?: string[];
}): TranscriptRewriteResult & { appendedEntries: TranscriptPersistedEntry[] } {
  const replacementsById = new Map(
    params.replacements
      .filter((replacement) => replacement.entryId.trim().length > 0)
      .map((replacement) => [replacement.entryId, replacement.message]),
  );
  if (replacementsById.size === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no replacements requested",
      appendedEntries: [],
    };
  }

  const originalLeafId = params.state.getLeafId();
  const originalAppendParentId = params.state.getAppendParentId();
  const originalAppendMode = params.state.getAppendMode();
  const activeBranch = params.state.getBranch();
  const allEntries = params.state.getEntries();
  let branch = activeBranch;
  let restoreOriginalNavigation = false;
  const replacementIdsOnBranch = (candidate: readonly SessionBranchEntry[]): Set<string> =>
    new Set(
      candidate
        .filter((entry) => entry.type === "message" && replacementsById.has(entry.id))
        .map((entry) => entry.id),
    );
  const activeReplacementIds = replacementIdsOnBranch(activeBranch);
  if (activeReplacementIds.size > 0 && activeReplacementIds.size < replacementsById.size) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "rewrite targets span multiple branches",
      appendedEntries: [],
    };
  }
  const activeBranchHasEveryReplacement = activeReplacementIds.size === replacementsById.size;
  if (!activeBranchHasEveryReplacement && params.allowedRewriteSuffixEntryIds) {
    const allowedIds = new Set(params.allowedRewriteSuffixEntryIds);
    const sideBranch = allEntries
      .toReversed()
      .filter((entry) => allowedIds.has(entry.id))
      .map((entry) => params.state.getBranch(entry.id))
      .find((candidate) => replacementIdsOnBranch(candidate).size === replacementsById.size);
    if (sideBranch) {
      branch = sideBranch;
      restoreOriginalNavigation = true;
    }
  }
  if (
    !activeBranchHasEveryReplacement &&
    !restoreOriginalNavigation &&
    activeReplacementIds.size === 0 &&
    params.replacements.some((replacement) =>
      allEntries.some((entry) => entry.id === replacement.entryId),
    )
  ) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "rewrite targets span multiple branches",
      appendedEntries: [],
    };
  }
  if (branch.length === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "empty session",
      appendedEntries: [],
    };
  }

  const { matchedIndices, bytesFreed } = findTranscriptRewriteMatches(branch, replacementsById);

  if (matchedIndices.length === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no matching message entries",
      appendedEntries: [],
    };
  }

  const firstMatchedEntry = branch[matchedIndices[0]] as
    | Extract<SessionBranchEntry, { type: "message" }>
    | undefined;
  if (!firstMatchedEntry) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "invalid first rewrite target",
      appendedEntries: [],
    };
  }

  if (params.allowedRewriteSuffixEntryIds) {
    const allowedIds = new Set(params.allowedRewriteSuffixEntryIds);
    const hasUnexpectedSuffixEntry = branch
      .slice(matchedIndices[0])
      .some((entry) => typeof entry.id === "string" && !allowedIds.has(entry.id));
    if (hasUnexpectedSuffixEntry) {
      return {
        changed: false,
        bytesFreed: 0,
        rewrittenEntries: 0,
        reason: "rewrite suffix guard failed",
        appendedEntries: [],
      };
    }
  }

  if (!firstMatchedEntry.parentId) {
    params.state.resetLeaf();
  } else {
    params.state.branch(firstMatchedEntry.parentId);
  }

  const appendedEntries: TranscriptPersistedEntry[] = [];
  const rewrittenEntryIds = new Map<string, string>();
  for (let index = matchedIndices[0]; index < branch.length; index++) {
    const entry = branch[index];
    const replacement = entry.type === "message" ? replacementsById.get(entry.id) : undefined;
    const newEntry =
      replacement === undefined
        ? appendTranscriptStateBranchEntry({
            state: params.state,
            entry,
            rewrittenEntryIds,
          })
        : params.state.appendMessage(replacement);
    rewrittenEntryIds.set(entry.id, newEntry.id);
    appendedEntries.push(newEntry);
  }
  if (restoreOriginalNavigation) {
    appendedEntries.push(
      params.state.appendLeafControl({
        targetId: originalLeafId,
        appendParentId: originalAppendParentId,
        ...(originalAppendMode ? { appendMode: originalAppendMode } : {}),
      }),
    );
  }

  return {
    changed: true,
    bytesFreed,
    rewrittenEntries: matchedIndices.length,
    appendedEntries,
  };
}

/**
 * Rewrites message entries for a runtime transcript without using the
 * file-backed path as caller identity.
 */
export async function rewriteTranscriptEntriesInRuntimeTranscript(params: {
  scope: RuntimeTranscriptScope;
  request: TranscriptRewriteRequest;
  config?: SessionWriteLockAcquireTimeoutConfig;
}): Promise<TranscriptRewriteResult> {
  let sessionLock: Awaited<ReturnType<typeof acquireSessionWriteLock>> | undefined;
  try {
    const target = await resolveRuntimeTranscriptReadTarget(params.scope);
    sessionLock = await acquireSessionWriteLock({
      sessionFile: target.sessionFile,
      ...resolveSessionWriteLockOptions(params.config),
    });
    const state = await readTranscriptFileState(target.sessionFile);
    const result = rewriteTranscriptEntriesInState({
      state,
      replacements: params.request.replacements,
      ...(params.request.allowedRewriteSuffixEntryIds
        ? { allowedRewriteSuffixEntryIds: params.request.allowedRewriteSuffixEntryIds }
        : {}),
    });
    if (result.changed) {
      await persistRuntimeTranscriptStateMutation({
        target,
        state,
        appendedEntries: result.appendedEntries,
      });
      emitSessionTranscriptUpdate({
        sessionFile: target.sessionFile,
        sessionKey: target.sessionKey,
        agentId: target.agentId,
        target: {
          agentId: target.agentId,
          sessionId: target.sessionId,
          sessionKey: target.sessionKey,
        },
      });
      log.info(
        `[transcript-rewrite] rewrote ${result.rewrittenEntries} entr` +
          `${result.rewrittenEntries === 1 ? "y" : "ies"} ` +
          `bytesFreed=${result.bytesFreed} ` +
          `sessionKey=${target.sessionKey}`,
      );
    }
    return result;
  } catch (err) {
    const reason = formatErrorMessage(err);
    log.warn(`[transcript-rewrite] failed: ${reason}`);
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason,
    };
  } finally {
    await sessionLock?.release();
  }
}
