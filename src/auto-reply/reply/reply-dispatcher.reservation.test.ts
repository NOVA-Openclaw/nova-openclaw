import { afterEach, expect, it, vi } from "vitest";
import {
  dispatchInboundMessageWithDispatcher,
  dispatchInboundMessageWithBufferedDispatcher,
} from "../dispatch.js";
import {
  getPendingReplyDetails,
  getTotalPendingReplies,
} from "./dispatcher-registry.js";
import { createReplyDispatcher } from "./reply-dispatcher.js";

const minimalCfg = {
  _brand: "OpenClawConfig" as const,
} as unknown as import("../../config/types.openclaw.js").OpenClawConfig;

afterEach(() => {
  vi.restoreAllMocks();
});

function minimalCtx(sessionKey = "test-session") {
  return {
    Body: "hello",
    SessionKey: sessionKey,
    Surface: "test",
    ChatType: "direct",
  };
}

it("releases the dispatcher reservation when the dispatch lifecycle throws before any reply is enqueued", async () => {
  const before = getTotalPendingReplies();
  const diagnosticEvents = await import("../../infra/diagnostic-events.js");
  vi.spyOn(diagnosticEvents, "isDiagnosticsEnabled").mockReturnValue(true);
  const diagnosticLogging = await import("../../logging/diagnostic.js");
  vi.spyOn(diagnosticLogging, "logMessageReceived").mockImplementation(() => {
    throw new Error("log message failure");
  });
  await expect(
    dispatchInboundMessageWithDispatcher({
      ctx: minimalCtx(),
      cfg: minimalCfg,
      dispatcherOptions: { deliver: async () => undefined },
    }),
  ).rejects.toThrow("log message failure");
  expect(getTotalPendingReplies()).toBe(before);
});

it("releases the dispatcher reservation when a reply is enqueued and delivery errors", async () => {
  const before = getTotalPendingReplies();
  const deliveryError = new Error("delivery failed after enqueue");
  const result = await dispatchInboundMessageWithDispatcher({
    ctx: minimalCtx(),
    cfg: minimalCfg,
    dispatcherOptions: {
      deliver: async () => {
        throw deliveryError;
      },
    },
    replyResolver: async () => ({ text: "reply" }),
  });
  expect(result.settledReceipt?.counts.final.failedAfterSend).toBe(1);
  expect(getTotalPendingReplies()).toBe(before);
});

it("releases the dispatcher reservation when a final reply is suppressed before delivery", async () => {
  const before = getTotalPendingReplies();
  await dispatchInboundMessageWithDispatcher({
    ctx: minimalCtx(),
    cfg: minimalCfg,
    dispatcherOptions: {
      beforeDeliver: async () => null,
      deliver: async () => undefined,
    },
    replyResolver: async () => ({ text: "reply" }),
  });
  expect(getTotalPendingReplies()).toBe(before);
});

it("keeps markComplete idempotent so double completion never drives pending negative", async () => {
  const before = getTotalPendingReplies();
  const dispatcher = createReplyDispatcher({
    deliver: async () => undefined,
  });
  dispatcher.sendFinalReply({ text: "reply" });
  dispatcher.markComplete();
  dispatcher.markComplete();
  await dispatcher.waitForIdle();
  expect(getTotalPendingReplies()).toBe(before);
  expect(getPendingReplyDetails()).toHaveLength(0);
});

it("registers dispatchers with sessionKey and runId so a leak can name itself", async () => {
  const before = getTotalPendingReplies();
  let releaseDelivery!: () => void;
  const dispatcher = createReplyDispatcher({
    deliver: async () => {
      await new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
    },
    metadata: { sessionKey: "leak-session", runId: "leak-run" },
  });
  dispatcher.sendFinalReply({ text: "reply" });
  // Flush microtasks so the reservation is visible.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  const details = getPendingReplyDetails();
  expect(details).toContainEqual({
    sessionKey: "leak-session",
    runId: "leak-run",
    pending: 2, // reservation + one enqueued reply
  });
  dispatcher.markComplete();
  releaseDelivery();
  await dispatcher.waitForIdle();
  expect(getTotalPendingReplies()).toBe(before);
});

it("releases the buffered dispatcher reservation when the lifecycle throws before any reply is enqueued", async () => {
  const before = getTotalPendingReplies();
  const diagnosticEvents = await import("../../infra/diagnostic-events.js");
  vi.spyOn(diagnosticEvents, "isDiagnosticsEnabled").mockReturnValue(true);
  const diagnosticLogging = await import("../../logging/diagnostic.js");
  vi.spyOn(diagnosticLogging, "logMessageReceived").mockImplementation(() => {
    throw new Error("buffered log message failure");
  });
  await expect(
    dispatchInboundMessageWithBufferedDispatcher({
      ctx: minimalCtx(),
      cfg: minimalCfg,
      dispatcherOptions: { deliver: async () => undefined },
    }),
  ).rejects.toThrow("buffered log message failure");
  expect(getTotalPendingReplies()).toBe(before);
});
