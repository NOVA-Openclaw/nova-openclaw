/** Unit tests for drain log detail formatting. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayActiveWorkSnapshot } from "../../infra/gateway-active-work.js";
import { formatDrainCountsWithDetails } from "./run-loop-drain.js";

type GetPendingReplyDetailsFn =
  typeof import("../../auto-reply/reply/dispatcher-registry.js").getPendingReplyDetails;

const hoisted = vi.hoisted(() => ({
  getPendingReplyDetailsMock: vi.fn<() => ReturnType<GetPendingReplyDetailsFn>>(() => []),
}));

vi.mock("../../auto-reply/reply/dispatcher-registry.js", () => ({
  getPendingReplyDetails: () => hoisted.getPendingReplyDetailsMock(),
}));

function makeSnapshot(pendingReplies: number): GatewayActiveWorkSnapshot {
  return {
    idle: pendingReplies === 0,
    counts: {
      queueSize: 0,
      pendingReplies,
      embeddedRuns: 0,
      backgroundExecSessions: 0,
      cronRuns: 0,
      activeTasks: 0,
      rootRequests: 0,
      sessionAdmissions: 0,
      sessionMutations: 0,
      chatRuns: 0,
      queuedTurns: 0,
      terminalPersistence: 0,
      terminalSessions: 0,
      lifecycleWrites: 0,
      totalActive: pendingReplies,
    },
    blockers:
      pendingReplies > 0
        ? [{ kind: "reply", count: pendingReplies, message: "pending replies" }]
        : [],
    writeCustody: { owner: null, heldBy: null },
  };
}

describe("formatDrainCountsWithDetails", () => {
  beforeEach(() => {
    hoisted.getPendingReplyDetailsMock.mockReturnValue([]);
  });

  it("returns the base count when no pending replies are reported", () => {
    hoisted.getPendingReplyDetailsMock.mockReturnValue([
      { sessionKey: "s1", runId: "r1", pending: 3 },
    ]);
    expect(formatDrainCountsWithDetails(makeSnapshot(0))).toBe("");
  });

  it("returns the base count when the detail list is empty", () => {
    expect(formatDrainCountsWithDetails(makeSnapshot(3))).toBe("pendingReplies=3");
  });

  it("formats up to five pending reply details", () => {
    hoisted.getPendingReplyDetailsMock.mockReturnValue([
      { sessionKey: "s1", runId: "r1", pending: 1 },
      { sessionKey: "s2", runId: "r2", pending: 1 },
      { sessionKey: "s3", runId: "r3", pending: 1 },
      { sessionKey: "s4", runId: "r4", pending: 1 },
      { sessionKey: "s5", runId: "r5", pending: 1 },
    ]);
    const result = formatDrainCountsWithDetails(makeSnapshot(5));
    expect(result).toBe(
      "pendingReplies=5 [pendingReplies: sessionKey=s1 runId=r1 pending=1; sessionKey=s2 runId=r2 pending=1; sessionKey=s3 runId=r3 pending=1; sessionKey=s4 runId=r4 pending=1; sessionKey=s5 runId=r5 pending=1]",
    );
  });

  it("caps details at five and reports the remainder count", () => {
    hoisted.getPendingReplyDetailsMock.mockReturnValue([
      { sessionKey: "s1", runId: "r1", pending: 1 },
      { sessionKey: "s2", runId: "r2", pending: 1 },
      { sessionKey: "s3", runId: "r3", pending: 1 },
      { sessionKey: "s4", runId: "r4", pending: 1 },
      { sessionKey: "s5", runId: "r5", pending: 1 },
      { sessionKey: "s6", runId: "r6", pending: 1 },
      { sessionKey: "s7", runId: "r7", pending: 1 },
      { sessionKey: "s8", runId: "r8", pending: 1 },
    ]);
    const result = formatDrainCountsWithDetails(makeSnapshot(8));
    expect(result).toContain("sessionKey=s5 runId=r5 pending=1");
    expect(result).not.toContain("sessionKey=s6");
    expect(result).not.toContain("sessionKey=s7");
    expect(result).not.toContain("sessionKey=s8");
    expect(result).toContain("and 3 more");
  });
});
