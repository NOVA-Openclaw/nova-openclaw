/**
 * Strips stale thinking/redacted_thinking blocks from a session manager's
 * active branch, and rewrites transcript entries through a live
 * SessionManager. Split out from transcript-rewrite.ts so that
 * `session-manager.ts` can call this path-independent cleanup (#111) without
 * creating a runtime import cycle: transcript-rewrite.ts imports
 * transcript-file-state.ts, which imports session-manager.ts (for
 * buildSessionContext/migrateSessionEntries/parseSessionEntries) — so
 * session-manager.ts cannot import anything from transcript-rewrite.ts at
 * runtime without closing a cycle. This module has no dependency on
 * transcript-file-state.ts, so it is safe for session-manager.ts to import.
 */
import type {
  TranscriptRewriteReplacement,
  TranscriptRewriteResult,
} from "../../context-engine/types.js";
import type { AgentMessage } from "../runtime/index.js";
import type { SessionManager } from "../sessions/session-manager.js";
import { stripThinkingBlocksFromMessage } from "./thinking.js";

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

function appendBranchEntry(params: {
  sessionManager: SessionManagerLike;
  entry: SessionBranchEntry;
  rewrittenEntryIds: ReadonlyMap<string, string>;
  appendMessage: SessionManagerLike["appendMessage"];
}): string {
  const { sessionManager, entry, rewrittenEntryIds, appendMessage } = params;
  if (entry.type === "message") {
    return appendMessage(entry.message as Parameters<typeof sessionManager.appendMessage>[0]);
  }
  if (entry.type === "compaction") {
    return sessionManager.appendCompaction(
      entry.summary,
      remapEntryId(entry.firstKeptEntryId, rewrittenEntryIds) ?? entry.firstKeptEntryId,
      entry.tokensBefore,
      entry.details,
      entry.fromHook,
    );
  }
  if (entry.type === "thinking_level_change") {
    return sessionManager.appendThinkingLevelChange(entry.thinkingLevel);
  }
  if (entry.type === "model_change") {
    return sessionManager.appendModelChange(entry.provider, entry.modelId);
  }
  if (entry.type === "custom") {
    return sessionManager.appendCustomEntry(entry.customType, entry.data);
  }
  if (entry.type === "custom_message") {
    return sessionManager.appendCustomMessageEntry(
      entry.customType,
      entry.content,
      entry.display,
      entry.details,
    );
  }
  if (entry.type === "session_info") {
    if (entry.name) {
      return sessionManager.appendSessionInfo(entry.name);
    }
    return sessionManager.appendSessionInfo("");
  }
  if (entry.type === "branch_summary") {
    return sessionManager.branchWithSummary(
      remapEntryId(entry.parentId, rewrittenEntryIds),
      entry.summary,
      entry.details,
      entry.fromHook,
    );
  }
  return sessionManager.appendLabelChange(
    remapEntryId(entry.targetId, rewrittenEntryIds) ?? entry.targetId,
    entry.label,
  );
}

/**
 * Safely rewrites transcript message entries on the active branch by branching
 * from the first rewritten message's parent and re-appending the suffix.
 */
export function rewriteTranscriptEntriesInSessionManager(params: {
  sessionManager: SessionManagerLike;
  replacements: TranscriptRewriteReplacement[];
}): TranscriptRewriteResult {
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
    };
  }

  const branch = params.sessionManager.getBranch();
  if (branch.length === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "empty session",
    };
  }

  const { matchedIndices, bytesFreed } = findTranscriptRewriteMatches(branch, replacementsById);

  if (matchedIndices.length === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no matching message entries",
    };
  }

  const firstMatchedEntry = branch[matchedIndices[0]] as
    | Extract<SessionBranchEntry, { type: "message" }>
    | undefined;
  // matchedIndices only contains indices of branch "message" entries.
  if (!firstMatchedEntry) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "invalid first rewrite target",
    };
  }

  if (!firstMatchedEntry.parentId) {
    params.sessionManager.resetLeaf();
  } else {
    params.sessionManager.branch(firstMatchedEntry.parentId);
  }

  // Maintenance rewrites should preserve the exact requested history without
  // re-running persistence hooks or size truncation on replayed messages.
  // Use the strip-bypassing append so that replayed assistant messages do not
  // recursively re-trigger stale-thinking-block cleanup (#111).
  const appendMessage = params.sessionManager.appendMessageWithoutStrip.bind(params.sessionManager);
  const rewrittenEntryIds = new Map<string, string>();
  for (let index = matchedIndices[0]; index < branch.length; index++) {
    const entry = branch[index];
    const replacement = entry.type === "message" ? replacementsById.get(entry.id) : undefined;
    const newEntryId =
      replacement === undefined
        ? appendBranchEntry({
            sessionManager: params.sessionManager,
            entry,
            rewrittenEntryIds,
            appendMessage,
          })
        : appendMessage(replacement as Parameters<typeof params.sessionManager.appendMessage>[0]);
    rewrittenEntryIds.set(entry.id, newEntryId);
  }

  return {
    changed: true,
    bytesFreed,
    rewrittenEntries: matchedIndices.length,
  };
}

/**
 * Strip thinking/redacted_thinking blocks from every existing assistant turn
 * on the active branch before a new assistant message is appended. The
 * incoming message is intentionally NOT part of the branch yet, so it remains
 * untouched. After this strip and the subsequent append, at most the newest
 * assistant thinking block survives on the active branch.
 *
 * Used by SessionManager.appendMessage for path-independent cleanup (#111).
 */
export function stripStaleThinkingBlocksFromSessionManagerBranch(params: {
  sessionManager: SessionManagerLike;
}): TranscriptRewriteResult {
  const branch = params.sessionManager.getBranch();
  const replacements: TranscriptRewriteReplacement[] = [];

  for (const entry of branch) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }
    const stripped = stripThinkingBlocksFromMessage(entry.message);
    if (stripped !== entry.message) {
      replacements.push({ entryId: entry.id, message: stripped });
    }
  }

  if (replacements.length === 0) {
    return {
      changed: false,
      bytesFreed: 0,
      rewrittenEntries: 0,
      reason: "no stale thinking blocks",
    };
  }

  return rewriteTranscriptEntriesInSessionManager({
    sessionManager: params.sessionManager,
    replacements,
  });
}
