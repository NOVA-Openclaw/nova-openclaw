// Tests for path-independent stale thinking-block cleanup at the transcript
// append choke-point (appendSessionTranscriptMessageLocked).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../../agents/embedded-agent-runner/logger.js";
import * as transcriptRewrite from "../../agents/embedded-agent-runner/transcript-rewrite.js";
import type { SessionMessageEntry } from "../../agents/sessions/session-manager.js";
import { SessionManager } from "../../agents/sessions/session-manager.js";
import type { AssistantMessage } from "../../llm/types.js";
import { appendSessionTranscriptMessage } from "./transcript-append.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-transcript-strip-"));
  tempDirs.push(dir);
  return dir;
}

async function createTranscriptFile(dir: string, fileName: string): Promise<string> {
  const sessionFile = path.join(dir, fileName);
  const header = {
    type: "session",
    version: 2,
    id: "test-session",
    timestamp: new Date().toISOString(),
    cwd: dir,
  };
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(sessionFile, `${JSON.stringify(header)}\n`, { mode: 0o600 });
  return sessionFile;
}

async function seedAssistantTurn(
  sessionFile: string,
  parentId: string | null,
  id: string,
  content: AssistantMessage["content"],
): Promise<string> {
  const entry = {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "assistant", content },
  };
  await fs.appendFile(sessionFile, `${JSON.stringify(entry)}\n`);
  return id;
}

async function seedUserTurn(
  sessionFile: string,
  parentId: string | null,
  id: string,
  text: string,
): Promise<string> {
  const entry = {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text }] },
  };
  await fs.appendFile(sessionFile, `${JSON.stringify(entry)}\n`);
  return id;
}

function toAssistantMessage(message: { role?: unknown; content?: unknown }): AssistantMessage {
  if (message.role !== "assistant") {
    throw new Error("Expected assistant message");
  }
  return message as AssistantMessage;
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

function getAssistantMessageEntries(
  sessionManager: ReturnType<typeof SessionManager.open>,
): SessionMessageEntry[] {
  return sessionManager.getBranch().filter((entry): entry is SessionMessageEntry => {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      return false;
    }
    return true;
  });
}

describe("transcript-append thinking-block strip", () => {
  it("TC-111-U01: appendSessionTranscriptMessage strips prior assistant thinking blocks", async () => {
    const dir = await makeTempDir();
    const sessionFile = await createTranscriptFile(dir, "session-topic-test.jsonl");

    let parentId = await seedUserTurn(sessionFile, null, "u1", "hello");
    parentId = await seedAssistantTurn(sessionFile, parentId, "a1", [
      { type: "thinking", thinking: "old1", thinkingSignature: "sig1" },
      { type: "text", text: "first reply" },
    ]);
    await seedAssistantTurn(sessionFile, parentId, "a2", [
      { type: "thinking", thinking: "old2", thinkingSignature: "sig2" },
      { type: "text", text: "second reply" },
    ]);

    const result = await appendSessionTranscriptMessage({
      transcriptPath: sessionFile,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "new", thinkingSignature: "sig-new" },
          { type: "text", text: "third reply" },
        ],
      },
    });

    expect(result).toBeDefined();
    expect(result?.appended).toBe(true);

    const sessionManager = SessionManager.open(sessionFile, dir, dir);
    const entries = getAssistantMessageEntries(sessionManager);
    expect(entries).toHaveLength(3);
    expect(countThinkingBlocks(entries[0].message)).toBe(0);
    expect(countThinkingBlocks(entries[1].message)).toBe(0);
    expect(countThinkingBlocks(entries[2].message)).toBe(1);
    expect(toAssistantMessage(entries[0].message).content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "first reply" })]),
    );
  });

  it("TC-111-U07: non-thinking assistant append strips prior thinking blocks", async () => {
    const dir = await makeTempDir();
    const sessionFile = await createTranscriptFile(dir, "session.jsonl");

    let parentId = await seedUserTurn(sessionFile, null, "u1", "hello");
    parentId = await seedAssistantTurn(sessionFile, parentId, "a1", [
      { type: "thinking", thinking: "old1", thinkingSignature: "sig1" },
      { type: "text", text: "first reply" },
    ]);
    parentId = await seedAssistantTurn(sessionFile, parentId, "a2", [
      { type: "thinking", thinking: "old2", thinkingSignature: "sig2" },
      { type: "text", text: "second reply" },
    ]);
    await seedAssistantTurn(sessionFile, parentId, "a3", [
      { type: "thinking", thinking: "old3", thinkingSignature: "sig3" },
      { type: "text", text: "third reply" },
    ]);

    await appendSessionTranscriptMessage({
      transcriptPath: sessionFile,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "plain reply" }],
      },
    });

    const sessionManager = SessionManager.open(sessionFile, dir, dir);
    const entries = getAssistantMessageEntries(sessionManager);
    expect(entries).toHaveLength(4);
    for (const entry of entries) {
      expect(countThinkingBlocks(entry.message)).toBe(0);
    }
  });

  it("TC-111-U20: no rewrite when branch is already clean", async () => {
    const dir = await makeTempDir();
    const sessionFile = await createTranscriptFile(dir, "session.jsonl");

    let parentId = await seedUserTurn(sessionFile, null, "u1", "hello");
    for (let i = 0; i < 49; i += 1) {
      parentId = await seedAssistantTurn(sessionFile, parentId, `a${i}`, [
        { type: "text", text: `reply ${i}` },
      ]);
    }
    await seedAssistantTurn(sessionFile, parentId, `a49`, [{ type: "text", text: "reply 49" }]);

    const rewriteSpy = vi.spyOn(transcriptRewrite, "rewriteTranscriptEntriesInState");

    await appendSessionTranscriptMessage({
      transcriptPath: sessionFile,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "new", thinkingSignature: "sig-new" },
          { type: "text", text: "new reply" },
        ],
      },
    });

    expect(rewriteSpy).not.toHaveBeenCalled();
  });

  it("TC-111-U21: large branch bound at transcript-append choke-point", async () => {
    const dir = await makeTempDir();
    const sessionFile = await createTranscriptFile(dir, "large-session.jsonl");

    let parentId = await seedUserTurn(sessionFile, null, "u1", "hello");
    for (let i = 0; i < 200; i += 1) {
      const content: AssistantMessage["content"] =
        i === 0
          ? [
              { type: "thinking", thinking: "stale", thinkingSignature: "sig-stale" },
              { type: "text", text: `reply ${i}` },
            ]
          : [{ type: "text", text: `reply ${i}` }];
      parentId = await seedAssistantTurn(sessionFile, parentId, `a${i}`, content);
    }

    const rewriteSpy = vi.spyOn(transcriptRewrite, "rewriteTranscriptEntriesInState");

    const start = performance.now();
    await appendSessionTranscriptMessage({
      transcriptPath: sessionFile,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "new", thinkingSignature: "sig-new" },
          { type: "text", text: "new reply" },
        ],
      },
    });
    const elapsed = performance.now() - start;

    expect(rewriteSpy).toHaveBeenCalledTimes(1);
    const result = rewriteSpy.mock.results[0]?.value as { rewrittenEntries?: number } | undefined;
    expect(result?.rewrittenEntries).toBe(1);
    expect(elapsed).toBeLessThan(500);

    const sessionManager = SessionManager.open(sessionFile, dir, dir);
    const entries = getAssistantMessageEntries(sessionManager);
    expect(entries).toHaveLength(201);
    expect(countThinkingBlocks(entries[0].message)).toBe(0);
    for (let i = 1; i < entries.length - 1; i += 1) {
      expect(countThinkingBlocks(entries[i].message)).toBe(0);
    }
    expect(countThinkingBlocks(entries[entries.length - 1].message)).toBe(1);
  });

  it("TC-111-ERR-01: rewrite failure is non-fatal and the new turn is still saved", async () => {
    const dir = await makeTempDir();
    const sessionFile = await createTranscriptFile(dir, "session.jsonl");

    const parentId = await seedUserTurn(sessionFile, null, "u1", "hello");
    await seedAssistantTurn(sessionFile, parentId, "a1", [
      { type: "thinking", thinking: "old", thinkingSignature: "sig-old" },
      { type: "text", text: "first reply" },
    ]);

    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const rewriteSpy = vi
      .spyOn(transcriptRewrite, "rewriteTranscriptEntriesInState")
      .mockImplementation(() => {
        throw new Error("simulated disk failure");
      });

    await expect(
      appendSessionTranscriptMessage({
        transcriptPath: sessionFile,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "new", thinkingSignature: "sig-new" },
            { type: "text", text: "second reply" },
          ],
        },
      }),
    ).resolves.not.toThrow();

    const sessionManager = SessionManager.open(sessionFile, dir, dir);
    const entries = getAssistantMessageEntries(sessionManager);
    expect(entries).toHaveLength(2);
    expect(countThinkingBlocks(entries[entries.length - 1].message)).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((call) =>
        call.some((arg) => typeof arg === "string" && arg.includes("[transcript-rewrite] failed:")),
      ),
    ).toBe(true);

    rewriteSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("TC-111-I02: pre-poisoned 109-block topic transcript heals on next save", async () => {
    const dir = await makeTempDir();
    const sessionFile = await createTranscriptFile(dir, "session-topic-123.jsonl");

    let parentId = await seedUserTurn(sessionFile, null, "u0", "start");
    for (let i = 0; i < 108; i += 1) {
      parentId = await seedAssistantTurn(sessionFile, parentId, `stale-${i}`, [
        { type: "thinking", thinking: `stale ${i}`, thinkingSignature: `sig-stale-${i}` },
        { type: "text", text: `reply ${i}` },
      ]);
    }
    await seedAssistantTurn(sessionFile, parentId, `stale-108`, [
      { type: "thinking", thinking: "stale 108", thinkingSignature: "sig-stale-108" },
      { type: "text", text: "reply 108" },
    ]);

    await appendSessionTranscriptMessage({
      transcriptPath: sessionFile,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "fresh", thinkingSignature: "sig-fresh" },
          { type: "text", text: "healed reply" },
        ],
      },
    });

    const sessionManager = SessionManager.open(sessionFile, dir, dir);
    const entries = getAssistantMessageEntries(sessionManager);
    expect(entries).toHaveLength(110);
    for (let i = 0; i < entries.length; i += 1) {
      expect(countThinkingBlocks(entries[i].message)).toBe(i === entries.length - 1 ? 1 : 0);
    }
  });

  it("TC-111-R03: SessionManager.forkFrom sanitizes stale thinking blocks", async () => {
    const sourceDir = await makeTempDir();
    const sourceFile = await createTranscriptFile(sourceDir, "source.jsonl");

    let parentId = await seedUserTurn(sourceFile, null, "u1", "hello");
    parentId = await seedAssistantTurn(sourceFile, parentId, "a1", [
      { type: "thinking", thinking: "old1", thinkingSignature: "sig1" },
      { type: "text", text: "first" },
    ]);
    await seedAssistantTurn(sourceFile, parentId, "a2", [
      { type: "thinking", thinking: "old2", thinkingSignature: "sig2" },
      { type: "text", text: "second" },
    ]);

    const targetDir = await makeTempDir();
    const forkedManager = SessionManager.forkFrom(sourceFile, targetDir);
    const forkedFile = forkedManager.getSessionFile();
    expect(forkedFile).toBeDefined();

    const reopened = SessionManager.open(forkedFile!, targetDir, targetDir);
    const entries = getAssistantMessageEntries(reopened);
    expect(entries).toHaveLength(2);
    expect(countThinkingBlocks(entries[0].message)).toBe(0);
    expect(countThinkingBlocks(entries[1].message)).toBe(1);
  });

  it("TC-111-R04: createBranchedSession sanitizes stale thinking blocks", async () => {
    const dir = await makeTempDir();
    const sessionFile = await createTranscriptFile(dir, "source.jsonl");

    let parentId = await seedUserTurn(sessionFile, null, "u1", "hello");
    parentId = await seedAssistantTurn(sessionFile, parentId, "a1", [
      { type: "thinking", thinking: "old1", thinkingSignature: "sig1" },
      { type: "text", text: "first" },
    ]);
    const leafId = await seedAssistantTurn(sessionFile, parentId, "a2", [
      { type: "thinking", thinking: "old2", thinkingSignature: "sig2" },
      { type: "text", text: "second" },
    ]);

    const sourceManager = SessionManager.open(sessionFile, dir, dir);
    const branchedFile = sourceManager.createBranchedSession(leafId)!;
    expect(branchedFile).toBeDefined();

    const reopened = SessionManager.open(branchedFile, dir, dir);
    const entries = getAssistantMessageEntries(reopened);
    expect(entries).toHaveLength(2);
    expect(countThinkingBlocks(entries[0].message)).toBe(0);
    expect(countThinkingBlocks(entries[1].message)).toBe(1);
  });
});
