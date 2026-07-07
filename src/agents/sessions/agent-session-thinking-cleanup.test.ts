// Tests for proactive strip-on-save of stale thinking blocks.
//
// These tests verify the persist-time hook added to AgentSession strips thinking
// and redacted_thinking blocks from every *prior* assistant turn on the active
// branch when a new assistant thinking-bearing message is saved, keeping only the
// single most recent assistant thinking block intact.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../../packages/agent-core/src/types.js";
import type { AssistantMessage, Model } from "../../llm/types.js";
import * as transcriptRewrite from "../embedded-agent-runner/transcript-rewrite.js";
import {
  castAgentMessage,
  makeAgentAssistantMessage,
  makeAgentUserMessage,
} from "../test-helpers/agent-message-fixtures.js";
import { AuthStorage } from "./auth-storage.js";
import { createExtensionRuntime } from "./extensions/loader.js";
import type { LoadExtensionsResult } from "./extensions/types.js";
import { ModelRegistry } from "./model-registry.js";
import { createAgentSession } from "./sdk.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";

const testModel: Model = {
  id: "test-model",
  name: "Test Model",
  api: "openai-responses",
  provider: "test-provider",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 1000,
};

function createEmptyResourceLoader() {
  const extensionsResult: LoadExtensionsResult = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };
  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-thinking-cleanup-"));
  tempDirs.push(dir);
  return dir;
}

async function createSessionWithTempManager() {
  const dir = await makeTempDir();
  const sessionFile = path.join(dir, "session.jsonl");
  const sessionManager = SessionManager.open(sessionFile, dir, dir);
  const { session } = await createAgentSession({
    model: testModel,
    resourceLoader: createEmptyResourceLoader(),
    sessionManager,
    settingsManager: SettingsManager.inMemory(),
    modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory()),
  });
  const unlocked = session as unknown as {
    handleAgentEventUnlocked: (event: AgentEvent) => Promise<void>;
  };
  return { session, sessionManager, unlocked };
}

function messageEndEvent(message: unknown): AgentEvent {
  return { type: "message_end", message: castAgentMessage(message) };
}

function toolResultEndEvent(params: {
  toolCallId: string;
  toolName: string;
  content: unknown;
}): AgentEvent {
  return {
    type: "message_end",
    message: castAgentMessage({
      role: "toolResult",
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      content: params.content,
      isError: false,
      timestamp: Date.now(),
    }),
  };
}

function countThinkingBlocks(message: { role?: unknown; content?: unknown }): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return 0;
  }
  return message.content.filter((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "thinking" || type === "redacted_thinking";
  }).length;
}

type SessionManagerLike = ReturnType<typeof SessionManager.open>;

type MessageEntry = Extract<
  ReturnType<SessionManagerLike["getBranch"]>[number],
  { type: "message" }
>;
type AssistantMessageEntry = MessageEntry & { message: AssistantMessage };

function getAssistantMessageEntries(sessionManager: SessionManagerLike): AssistantMessageEntry[] {
  return sessionManager
    .getBranch()
    .filter(
      (entry): entry is AssistantMessageEntry =>
        entry.type === "message" && entry.message.role === "assistant",
    );
}

function getAssistantMessageAt(sessionManager: SessionManagerLike, index: number) {
  const entry = getAssistantMessageEntries(sessionManager)[index];
  expect(entry).toBeDefined();
  return entry;
}

function asAssistantMessage(msg: { role?: unknown; content?: unknown }) {
  expect(msg.role).toBe("assistant");
  return msg as { role: "assistant"; content: unknown[] };
}

function buildProviderContextMessages(sessionManager: SessionManagerLike) {
  return sessionManager.buildSessionContext().messages;
}

function assertOnlyLatestAssistantHasThinking(sessionManager: SessionManagerLike) {
  const entries = getAssistantMessageEntries(sessionManager);
  for (let i = 0; i < entries.length; i++) {
    const count = countThinkingBlocks(entries[i].message);
    if (i === entries.length - 1) {
      expect(count).toBeGreaterThan(0);
    } else {
      expect(count).toBe(0);
    }
  }
}

// ============================================================================
// Priority-1 gating: mocked/no-op/lock-safety tests
// ============================================================================

describe("strip-on-save hook: no-op and lock-safety behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("TC-EDGE-03: assistant message with no thinking block is a strict no-op", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();
    // Spy only on the test action; createAgentSession may invoke session repair paths.
    const rewriteSpy = vi.spyOn(transcriptRewrite, "rewriteTranscriptEntriesInSessionManager");

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "hello" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [{ type: "text", text: "no thinking here" }],
        }),
      ),
    );

    expect(rewriteSpy).not.toHaveBeenCalled();
    expect(getAssistantMessageEntries(sessionManager)).toHaveLength(1);
  });

  it("TC-ERR-01: strip failure is non-fatal and the new turn is still saved", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    // Seed one prior assistant turn with thinking so the cleanup has something to rewrite.
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "first" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "old", thinkingSignature: "sig-old" },
            { type: "text", text: "first reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    // The non-fatal error path is covered at the transcript-append choke-point
    // (see transcript-append-thinking-cleanup.test.ts). Here we verify normal operation:
    // a new thinking-bearing assistant turn is saved and prior stale blocks are stripped.
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "new", thinkingSignature: "sig-new" },
            { type: "text", text: "second reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    const entries = getAssistantMessageEntries(sessionManager);
    expect(entries).toHaveLength(2);
    expect(countThinkingBlocks(entries[0].message)).toBe(0);
    expect(countThinkingBlocks(entries[1].message)).toBe(1);
  });

  it("TC-ERR-03: cleanup uses only the SessionManager rewrite path", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();
    const runtimeSpy = vi.spyOn(transcriptRewrite, "rewriteTranscriptEntriesInRuntimeTranscript");
    const fileSpy = vi.spyOn(transcriptRewrite, "rewriteTranscriptEntriesInSessionFile");

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "seed" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "first", thinkingSignature: "sig1" },
            { type: "text", text: "first reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "second", thinkingSignature: "sig2" },
            { type: "text", text: "second reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    expect(runtimeSpy).not.toHaveBeenCalled();
    expect(fileSpy).not.toHaveBeenCalled();
    assertOnlyLatestAssistantHasThinking(sessionManager);
    expect(getAssistantMessageEntries(sessionManager)).toHaveLength(2);
  });
});

// ============================================================================
// Priority-1 gating: integration tests
// ============================================================================

describe("strip-on-save hook: integration", () => {
  it("TC-HAPPY-01: single model, thinking collapses to newest after each save", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "hello" })),
    );

    for (let i = 1; i <= 3; i++) {
      await unlocked.handleAgentEventUnlocked(
        messageEndEvent(
          makeAgentAssistantMessage({
            content: [
              { type: "thinking", thinking: `thinking ${i}`, thinkingSignature: `sig-${i}` },
              { type: "text", text: `reply ${i}` },
            ] as AssistantMessage["content"],
          }),
        ),
      );
    }

    assertOnlyLatestAssistantHasThinking(sessionManager);
    const contextMessages = buildProviderContextMessages(sessionManager);
    const assistantContextMessages = contextMessages.filter((m) => m.role === "assistant");
    expect(assistantContextMessages).toHaveLength(3);
    for (let i = 0; i < assistantContextMessages.length; i++) {
      const msg = assistantContextMessages[i];
      expect(msg).toBeDefined();
      expect(countThinkingBlocks(msg)).toBe(i === 2 ? 1 : 0);
    }
  });

  it("TC-EDGE-09: every prior assistant thinking block is stripped, including the previous latest", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "hello" })),
    );

    // First assistant turn: at this moment it is the only/latest assistant entry.
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "first", thinkingSignature: "sig-first" },
            { type: "text", text: "first reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    let entry = getAssistantMessageAt(sessionManager, 0);
    expect(countThinkingBlocks(entry.message)).toBe(1);

    // Second assistant turn: the first turn is no longer latest, so it must be stripped.
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "second", thinkingSignature: "sig-second" },
            { type: "text", text: "second reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    expect(getAssistantMessageEntries(sessionManager)).toHaveLength(2);
    expect(countThinkingBlocks(getAssistantMessageAt(sessionManager, 0).message)).toBe(0);
    expect(countThinkingBlocks(getAssistantMessageAt(sessionManager, 1).message)).toBe(1);

    // The text content of the first turn survived the strip.
    entry = getAssistantMessageAt(sessionManager, 0);
    expect(entry.message.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "first reply" })]),
    );
  });

  it("TC-DOM-01: model-switch mid-session strips all stale thinking blocks", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "start on fable" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          provider: "anthropic",
          model: "claude-fable-5",
          content: [
            { type: "thinking", thinking: "fable A", thinkingSignature: "sig-fable-A" },
            { type: "text", text: "fable reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "fallback to opus" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          provider: "anthropic",
          model: "claude-opus-4-8",
          content: [
            { type: "thinking", thinking: "opus B", thinkingSignature: "sig-opus-B" },
            { type: "text", text: "opus reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "back to fable" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          provider: "anthropic",
          model: "claude-fable-5",
          content: [
            { type: "thinking", thinking: "fable C", thinkingSignature: "sig-fable-C" },
            { type: "text", text: "final fable reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    assertOnlyLatestAssistantHasThinking(sessionManager);

    const contextMessages = buildProviderContextMessages(sessionManager);
    const assistantMessages = contextMessages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(3);
    for (let i = 0; i < assistantMessages.length; i++) {
      const msg = asAssistantMessage(assistantMessages[i]);
      expect(countThinkingBlocks(msg)).toBe(i === 2 ? 1 : 0);
    }
  });

  it("TC-DOM-02: active tool-use loop preserves latest thinking+tool_use pairing", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "use tools" })),
    );

    // Assistant A: thinking + tool_use
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "call X", thinkingSignature: "sig-A" },
            { type: "toolCall", id: "call-x", name: "read", arguments: { path: "x.txt" } },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    await unlocked.handleAgentEventUnlocked(
      toolResultEndEvent({
        toolCallId: "call-x",
        toolName: "read",
        content: [{ type: "text", text: "contents of x" }],
      }),
    );

    // Assistant B: thinking + tool_use
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "call Y", thinkingSignature: "sig-B" },
            { type: "toolCall", id: "call-y", name: "read", arguments: { path: "y.txt" } },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    await unlocked.handleAgentEventUnlocked(
      toolResultEndEvent({
        toolCallId: "call-y",
        toolName: "read",
        content: [{ type: "text", text: "contents of y" }],
      }),
    );

    // Assistant C: thinking + text final answer
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "final", thinkingSignature: "sig-C" },
            { type: "text", text: "done" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    assertOnlyLatestAssistantHasThinking(sessionManager);

    const contextMessages = buildProviderContextMessages(sessionManager);
    const assistantMessages = contextMessages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(3);

    // C is the final answer; A and B had their thinking stripped but their
    // tool_use/text blocks remain.
    for (let i = 0; i < assistantMessages.length; i++) {
      const msg = asAssistantMessage(assistantMessages[i]);
      const thinkingCount = countThinkingBlocks(msg);
      expect(thinkingCount).toBe(i === 2 ? 1 : 0);
      if (i < 2) {
        expect(msg.content).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: "toolCall" })]),
        );
      }
    }
  });

  it("TC-DOM-03: retroactively heals a pre-poisoned transcript on the next save", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    const staleCount = 34;
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "start" })),
    );

    for (let i = 0; i < staleCount; i++) {
      await unlocked.handleAgentEventUnlocked(
        messageEndEvent(
          makeAgentAssistantMessage({
            content: [
              { type: "thinking", thinking: `stale ${i}`, thinkingSignature: `sig-stale-${i}` },
              { type: "text", text: `reply ${i}` },
            ] as AssistantMessage["content"],
          }),
        ),
      );
      await unlocked.handleAgentEventUnlocked(
        messageEndEvent(makeAgentUserMessage({ content: `turn ${i}` })),
      );
    }

    // Poison the transcript shape to match the incident coordinates:
    // ensure at least one older assistant entry has a thinking block at content index 7.
    // We append one extra block-heavy old assistant turn before the healing save.
    const blockHeavyOldAssistant = makeAgentAssistantMessage({
      content: [
        { type: "text", text: "prefix 0" },
        { type: "text", text: "prefix 1" },
        { type: "text", text: "prefix 2" },
        { type: "text", text: "prefix 3" },
        { type: "text", text: "prefix 4" },
        { type: "text", text: "prefix 5" },
        { type: "text", text: "prefix 6" },
        { type: "thinking", thinking: "incident at index 7", thinkingSignature: "sig-incident" },
        { type: "text", text: "suffix" },
      ] as AssistantMessage["content"],
    });
    await unlocked.handleAgentEventUnlocked(messageEndEvent(blockHeavyOldAssistant));

    // Healing save: new assistant turn with its own fresh thinking block.
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "heal" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "fresh", thinkingSignature: "sig-fresh" },
            { type: "text", text: "healed reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    assertOnlyLatestAssistantHasThinking(sessionManager);

    const contextMessages = buildProviderContextMessages(sessionManager);
    const assistantMessages = contextMessages.filter((m) => m.role === "assistant");
    expect(assistantMessages.length).toBe(staleCount + 2);
    for (let i = 0; i < assistantMessages.length; i++) {
      const msg = asAssistantMessage(assistantMessages[i]);
      expect(countThinkingBlocks(msg)).toBe(i === assistantMessages.length - 1 ? 1 : 0);
    }
  });
});

// ============================================================================
// Additional edge/boundary coverage
// ============================================================================

describe("strip-on-save hook: additional edges", () => {
  it("TC-EDGE-01: multiple thinking blocks in one older assistant message are all stripped", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "hello" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "first block", thinkingSignature: "sig1" },
            { type: "toolCall", id: "call-1", name: "read", arguments: {} },
            { type: "thinking", thinking: "second block", thinkingSignature: "sig2" },
            { type: "text", text: "reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "new", thinkingSignature: "sig-new" },
            { type: "text", text: "new reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    expect(getAssistantMessageEntries(sessionManager)).toHaveLength(2);
    expect(countThinkingBlocks(getAssistantMessageAt(sessionManager, 0).message)).toBe(0);
    expect(getAssistantMessageAt(sessionManager, 0).message.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "toolCall" }),
        expect.objectContaining({ type: "text", text: "reply" }),
      ]),
    );
    expect(countThinkingBlocks(getAssistantMessageAt(sessionManager, 1).message)).toBe(1);
  });

  it("TC-EDGE-02: thinking-only older assistant message is replaced with placeholder text", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "hello" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "only thinking", thinkingSignature: "sig1" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "new", thinkingSignature: "sig2" },
            { type: "text", text: "new reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    expect(getAssistantMessageEntries(sessionManager)).toHaveLength(2);
    expect(getAssistantMessageAt(sessionManager, 0).message.content).toEqual([
      { type: "text", text: "[assistant reasoning omitted]" },
    ]);
  });

  it("TC-EDGE-04: redacted_thinking blocks are treated as signed thinking", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "hello" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "redacted_thinking", data: "opaque-blob" },
            { type: "text", text: "old reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "new", thinkingSignature: "sig-new" },
            { type: "text", text: "new reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    expect(getAssistantMessageEntries(sessionManager)).toHaveLength(2);
    expect(countThinkingBlocks(getAssistantMessageAt(sessionManager, 0).message)).toBe(0);
    expect(countThinkingBlocks(getAssistantMessageAt(sessionManager, 1).message)).toBe(1);
  });

  it("TC-EDGE-05: first assistant turn in a fresh session is saved without error", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();
    const rewriteSpy = vi.spyOn(transcriptRewrite, "rewriteTranscriptEntriesInSessionManager");
    // createAgentSession may trigger session repair/rewrite paths; clear them.
    rewriteSpy.mockClear();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "hello" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "first", thinkingSignature: "sig1" },
            { type: "text", text: "first reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    expect(rewriteSpy).not.toHaveBeenCalled();
    const entries = getAssistantMessageEntries(sessionManager);
    expect(entries).toHaveLength(1);
    expect(countThinkingBlocks(entries[0].message)).toBe(1);
  });

  it("TC-BOUND-01: exactly one prior assistant turn is sanitized", async () => {
    const { sessionManager, unlocked } = await createSessionWithTempManager();

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(makeAgentUserMessage({ content: "hello" })),
    );
    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "first", thinkingSignature: "sig1" },
            { type: "text", text: "first reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    await unlocked.handleAgentEventUnlocked(
      messageEndEvent(
        makeAgentAssistantMessage({
          content: [
            { type: "thinking", thinking: "second", thinkingSignature: "sig2" },
            { type: "text", text: "second reply" },
          ] as AssistantMessage["content"],
        }),
      ),
    );

    expect(getAssistantMessageEntries(sessionManager)).toHaveLength(2);
    expect(countThinkingBlocks(getAssistantMessageAt(sessionManager, 0).message)).toBe(0);
    expect(countThinkingBlocks(getAssistantMessageAt(sessionManager, 1).message)).toBe(1);
  });
});
