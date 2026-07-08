// Transcript rewrite tests cover in-memory and persisted JSONL rewrites for
// tool-result externalization, labels, compaction markers, and write locks.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "openclaw/plugin-sdk/agent-core";
import { SessionManager } from "openclaw/plugin-sdk/agent-sessions";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const acquireSessionWriteLockReleaseMock = vi.hoisted(() => vi.fn(async () => {}));
const acquireSessionWriteLockMock = vi.hoisted(() =>
  vi.fn(async (_params?: unknown) => ({ release: acquireSessionWriteLockReleaseMock })),
);

vi.mock("../session-write-lock.js", async () => {
  const original = await vi.importActual<typeof import("../session-write-lock.js")>(
    "../session-write-lock.js",
  );
  return {
    ...original,
    acquireSessionWriteLock: (params?: unknown) => acquireSessionWriteLockMock(params),
  };
});

let rewriteTranscriptEntriesInSessionManager: typeof import("./strip-stale-thinking-blocks.js").rewriteTranscriptEntriesInSessionManager;
let rewriteTranscriptEntriesInRuntimeTranscript: typeof import("./transcript-rewrite.js").rewriteTranscriptEntriesInRuntimeTranscript;
let onSessionTranscriptUpdate: typeof import("../../sessions/transcript-events.js").onSessionTranscriptUpdate;
let installSessionToolResultGuard: typeof import("../session-tool-result-guard.js").installSessionToolResultGuard;

type AppendMessage = Parameters<SessionManager["appendMessage"]>[0];

function asAppendMessage(message: unknown): AppendMessage {
  return message as AppendMessage;
}

function getBranchMessages(sessionManager: SessionManager): AgentMessage[] {
  return sessionManager
    .getBranch()
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message);
}

function appendSessionMessages(
  sessionManager: SessionManager,
  messages: AppendMessage[],
): string[] {
  return messages.map((message) => sessionManager.appendMessage(message));
}

function createTextContent(text: string) {
  return [{ type: "text", text }];
}

function createReadRewriteSession(options?: { tailAssistantText?: string }) {
  // Read rewrite fixtures include a suffix assistant turn so branch rewrites
  // must re-append downstream entries after replacing the tool result.
  const sessionManager = SessionManager.inMemory();
  const entryIds = appendSessionMessages(sessionManager, [
    asAppendMessage({
      role: "user",
      content: "read file",
      timestamp: 1,
    }),
    asAppendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }],
      timestamp: 2,
    }),
    asAppendMessage({
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      content: createTextContent("x".repeat(8_000)),
      isError: false,
      timestamp: 3,
    }),
    asAppendMessage({
      role: "assistant",
      content: createTextContent(options?.tailAssistantText ?? "summarized"),
      timestamp: 4,
    }),
  ]);
  return {
    sessionManager,
    toolResultEntryId: entryIds[2],
    tailAssistantEntryId: entryIds[3],
  };
}

function createExecRewriteSession() {
  const sessionManager = SessionManager.inMemory();
  const entryIds = appendSessionMessages(sessionManager, [
    asAppendMessage({
      role: "user",
      content: "run tool",
      timestamp: 1,
    }),
    asAppendMessage({
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "exec",
      content: createTextContent("before rewrite"),
      isError: false,
      timestamp: 2,
    }),
    asAppendMessage({
      role: "assistant",
      content: createTextContent("summarized"),
      timestamp: 3,
    }),
  ]);
  return {
    sessionManager,
    toolResultEntryId: entryIds[1],
  };
}

function createToolResultReplacement(toolName: string, text: string, timestamp: number) {
  return {
    role: "toolResult",
    toolCallId: "call_1",
    toolName,
    content: createTextContent(text),
    isError: false,
    timestamp,
  } as AgentMessage;
}

function findAssistantEntryByText(sessionManager: SessionManager, text: string) {
  return sessionManager
    .getBranch()
    .find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        Array.isArray(entry.message.content) &&
        entry.message.content.some((part) => part.type === "text" && part.text === text),
    );
}

function requireValue<T>(value: T | undefined, label: string): T {
  // Fail with a labeled invariant instead of letting optional entries produce
  // weak assertions later in transcript-branch tests.
  if (value === undefined) {
    throw new Error(`expected ${label}`);
  }
  return value;
}

function requireString(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`expected ${label}`);
  }
  return value;
}

beforeAll(async () => {
  ({ onSessionTranscriptUpdate } = await import("../../sessions/transcript-events.js"));
  ({ installSessionToolResultGuard } = await import("../session-tool-result-guard.js"));
  ({ rewriteTranscriptEntriesInRuntimeTranscript } = await import("./transcript-rewrite.js"));
  ({ rewriteTranscriptEntriesInSessionManager } = await import("./strip-stale-thinking-blocks.js"));
});

beforeEach(() => {
  acquireSessionWriteLockMock.mockClear();
  acquireSessionWriteLockReleaseMock.mockClear();
});

describe("rewriteTranscriptEntriesInSessionManager", () => {
  it("branches from the first replaced message and re-appends the remaining suffix", () => {
    const { sessionManager, toolResultEntryId } = createReadRewriteSession();

    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: toolResultEntryId,
          message: createToolResultReplacement("read", "[externalized file_123]", 3),
        },
      ],
    });

    expect(result.changed).toBe(true);
    expect(result.rewrittenEntries).toBe(1);
    expect(result.bytesFreed).toBeGreaterThan(0);

    const branchMessages = getBranchMessages(sessionManager);
    expect(branchMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    const rewrittenToolResult = branchMessages[2] as Extract<AgentMessage, { role: "toolResult" }>;
    expect(rewrittenToolResult.content).toEqual([
      { type: "text", text: "[externalized file_123]" },
    ]);
  });

  it("preserves active-branch labels after rewritten entries are re-appended", () => {
    const { sessionManager, toolResultEntryId } = createReadRewriteSession();
    const summaryEntry = requireValue(
      findAssistantEntryByText(sessionManager, "summarized"),
      "summary entry",
    );
    sessionManager.appendLabelChange(summaryEntry.id, "bookmark");

    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: toolResultEntryId,
          message: createToolResultReplacement("read", "[externalized file_123]", 3),
        },
      ],
    });

    expect(result.changed).toBe(true);
    const rewrittenSummaryEntry = requireValue(
      findAssistantEntryByText(sessionManager, "summarized"),
      "rewritten summary entry",
    );
    expect(sessionManager.getLabel(rewrittenSummaryEntry.id)).toBe("bookmark");
    expect(sessionManager.getBranch().map((entry) => entry.type)).toContain("label");
  });

  it("preserves compaction keep markers when replayed entries are not themselves rewritten", () => {
    // Only entries actually being replaced (present in replacementsById) may
    // change id; every other replayed entry must keep its original id so a
    // captured firstKeptEntryId (or any other external reference) survives an
    // unrelated sibling entry's rewrite (#111 C5 fix). Previously this replay
    // reassigned a fresh id to every replayed entry -- including entries with
    // no content change -- silently invalidating markers like
    // compaction.firstKeptEntryId across intervening rewrites.
    const {
      sessionManager,
      toolResultEntryId,
      tailAssistantEntryId: keptAssistantEntryId,
    } = createReadRewriteSession({ tailAssistantText: "keep me" });
    sessionManager.appendCompaction("summary", keptAssistantEntryId, 123);

    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: toolResultEntryId,
          message: createToolResultReplacement("read", "[externalized file_123]", 3),
        },
      ],
    });

    expect(result.changed).toBe(true);
    const branch = sessionManager.getBranch();
    const keptAssistantEntry = branch.find(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        Array.isArray(entry.message.content) &&
        entry.message.content.some((part) => part.type === "text" && part.text === "keep me"),
    );
    const compactionEntry = branch.find((entry) => entry.type === "compaction");

    const keptAssistant = requireValue(keptAssistantEntry, "kept assistant entry");
    const compaction = requireValue(compactionEntry, "compaction entry");
    if (compaction.type !== "compaction") {
      throw new Error("expected compaction entry");
    }
    expect(keptAssistant.id).toBe(keptAssistantEntryId);
    expect(compaction.firstKeptEntryId).toBe(keptAssistant.id);
    expect(compaction.firstKeptEntryId).toBe(keptAssistantEntryId);
  });

  it("bypasses persistence hooks when replaying rewritten messages", () => {
    const { sessionManager, toolResultEntryId } = createExecRewriteSession();
    installSessionToolResultGuard(sessionManager, {
      transformToolResultForPersistence: (message) => ({
        ...(message as Extract<AgentMessage, { role: "toolResult" }>),
        content: [{ type: "text", text: "[hook transformed]" }],
      }),
      beforeMessageWriteHook: ({ message }) =>
        message.role === "assistant" ? { block: true } : undefined,
    });

    const result = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: toolResultEntryId,
          message: createToolResultReplacement("exec", "[exact replacement]", 2),
        },
      ],
    });

    expect(result.changed).toBe(true);
    const branchMessages = getBranchMessages(sessionManager);
    expect(branchMessages.map((message) => message.role)).toEqual([
      "user",
      "toolResult",
      "assistant",
    ]);
    expect((branchMessages[1] as Extract<AgentMessage, { role: "toolResult" }>).content).toEqual([
      { type: "text", text: "[exact replacement]" },
    ]);
    const replayedAssistant = branchMessages[2];
    if (!replayedAssistant || replayedAssistant.role !== "assistant") {
      throw new Error("expected rewritten suffix to replay the assistant summary");
    }
    expect(replayedAssistant.content).toEqual([{ type: "text", text: "summarized" }]);
  });

  it("TC-111-U22: keeps replayed entry ids stable across a second strip-triggered rewrite", () => {
    // #111 C5 fix: appendEntry() must supersede (not duplicate) a prior
    // fileEntries row when an id is reused via options.entryId, and a second
    // strip-triggered rewrite of the same session must not corrupt or
    // duplicate ids assigned by an earlier rewrite. Without the supersede
    // fix, this reproduces the exact orphaned-duplicate-row bug traced in
    // the r8/r9 handoff: a stale row for a reused id lingers in fileEntries
    // (and the persisted JSONL) after the second rewrite.
    const sessionManager = SessionManager.inMemory();
    const entryIds = appendSessionMessages(sessionManager, [
      asAppendMessage({ role: "user", content: "first", timestamp: 1 }),
      asAppendMessage({
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "exec",
        content: createTextContent("stale result one"),
        isError: false,
        timestamp: 2,
      }),
      asAppendMessage({ role: "assistant", content: createTextContent("middle"), timestamp: 3 }),
      asAppendMessage({
        role: "toolResult",
        toolCallId: "call_2",
        toolName: "exec",
        content: createTextContent("stale result two"),
        isError: false,
        timestamp: 4,
      }),
      asAppendMessage({ role: "assistant", content: createTextContent("tail"), timestamp: 5 }),
    ]);
    const [, firstToolResultId, middleAssistantId, secondToolResultId, tailAssistantId] = entryIds;

    const firstRewrite = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: firstToolResultId,
          message: createToolResultReplacement("exec", "[replaced result one]", 2),
        },
      ],
    });
    expect(firstRewrite.changed).toBe(true);

    // The middle assistant/second-tool-result/tail entries were replayed
    // (not replaced) by the first rewrite; per the fix they must keep their
    // original ids.
    const afterFirstRewrite = sessionManager.getBranch();
    const middleAfterFirst = requireValue(
      afterFirstRewrite.find((entry) => entry.id === middleAssistantId),
      "middle assistant entry (unchanged id after first rewrite)",
    );
    expect(middleAfterFirst.id).toBe(middleAssistantId);

    const secondRewrite = rewriteTranscriptEntriesInSessionManager({
      sessionManager,
      replacements: [
        {
          entryId: secondToolResultId,
          message: createToolResultReplacement("exec", "[replaced result two]", 4),
        },
      ],
    });
    expect(secondRewrite.changed).toBe(true);

    const branch = sessionManager.getBranch();
    const allEntries = sessionManager.getEntries();

    // No id should appear more than once anywhere in the persisted entry set
    // -- a duplicate means a prior row was left behind instead of superseded.
    const idCounts = new Map<string, number>();
    for (const entry of allEntries) {
      idCounts.set(entry.id, (idCounts.get(entry.id) ?? 0) + 1);
    }
    for (const [id, count] of idCounts) {
      expect(count, `entry id ${id} must appear exactly once in fileEntries`).toBe(1);
    }

    // The middle assistant (never replaced, replayed across both rewrites)
    // must still carry its original id, and must be reachable on the live
    // branch (not an orphaned duplicate).
    expect(branch.some((entry) => entry.id === middleAssistantId)).toBe(true);
    expect(sessionManager.getBranch().map((entry) => entry.id)).not.toContain("__orphan__");

    // The tail assistant (also never replaced, replayed only by the second
    // rewrite since it comes after secondToolResultId) must also keep its id.
    expect(branch.some((entry) => entry.id === tailAssistantId)).toBe(true);

    const branchMessages = getBranchMessages(sessionManager);
    expect(branchMessages.map((message) => message.role)).toEqual([
      "user",
      "toolResult",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect((branchMessages[1] as Extract<AgentMessage, { role: "toolResult" }>).content).toEqual([
      { type: "text", text: "[replaced result one]" },
    ]);
    expect((branchMessages[3] as Extract<AgentMessage, { role: "toolResult" }>).content).toEqual([
      { type: "text", text: "[replaced result two]" },
    ]);
  });
});

describe("rewriteTranscriptEntriesInRuntimeTranscript", () => {
  it("does not create session metadata for missing runtime transcripts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-transcript-rewrite-runtime-"));
    const storePath = path.join(dir, "sessions.json");
    await fs.writeFile(storePath, "{}\n", "utf8");

    const result = await rewriteTranscriptEntriesInRuntimeTranscript({
      scope: {
        agentId: "main",
        sessionId: "missing-session",
        sessionKey: "agent:main:missing",
        storePath,
      },
      request: { replacements: [] },
    });

    expect(result.changed).toBe(false);
    expect(await fs.readFile(storePath, "utf8")).toBe("{}\n");
  });

  it("rewrites runtime transcripts through scoped session identity", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-transcript-rewrite-runtime-"));
    const storePath = path.join(dir, "sessions.json");
    const sessionManager = SessionManager.create(dir, dir);
    const entryIds = appendSessionMessages(sessionManager, [
      asAppendMessage({
        role: "user",
        content: "run tool",
        timestamp: 1,
      }),
      asAppendMessage({
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "exec",
        content: createTextContent("before rewrite"),
        isError: false,
        timestamp: 2,
      }),
      asAppendMessage({
        role: "assistant",
        content: createTextContent("summarized"),
        timestamp: 3,
      }),
    ]);
    const sessionFile = requireString(sessionManager.getSessionFile(), "persisted session file");
    const resolvedSessionFile = await fs.realpath(sessionFile);
    const sessionId = path.basename(sessionFile, ".jsonl");
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "agent:main:test": {
          sessionFile,
          sessionId,
          updatedAt: 10,
        },
      }),
      "utf8",
    );
    const toolResultEntryId = entryIds[1];
    const listener = vi.fn();
    const cleanup = onSessionTranscriptUpdate(listener);

    try {
      const result = await rewriteTranscriptEntriesInRuntimeTranscript({
        scope: {
          agentId: "main",
          sessionId,
          sessionKey: "agent:main:test",
          storePath,
        },
        request: {
          replacements: [
            {
              entryId: toolResultEntryId,
              message: createToolResultReplacement("exec", "[runtime rewrite]", 2),
            },
          ],
        },
      });

      expect(result.changed).toBe(true);
      expect(acquireSessionWriteLockMock).toHaveBeenCalledWith({
        sessionFile: resolvedSessionFile,
        staleMs: 1_800_000,
        timeoutMs: 60_000,
        maxHoldMs: 300_000,
      });
      expect(acquireSessionWriteLockReleaseMock).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({
        agentId: "main",
        sessionFile: resolvedSessionFile,
        sessionId,
        sessionKey: "agent:main:test",
        target: {
          agentId: "main",
          sessionId,
          sessionKey: "agent:main:test",
        },
      });

      const rewrittenSession = SessionManager.open(sessionFile);
      const branchMessages = getBranchMessages(rewrittenSession);
      expect(branchMessages.map((message) => message.role)).toEqual([
        "user",
        "toolResult",
        "assistant",
      ]);
      expect((branchMessages[1] as Extract<AgentMessage, { role: "toolResult" }>).content).toEqual([
        { type: "text", text: "[runtime rewrite]" },
      ]);
    } finally {
      cleanup();
    }
  });
});
