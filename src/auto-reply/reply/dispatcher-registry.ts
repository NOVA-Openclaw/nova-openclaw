/**
 * Global registry for tracking active reply dispatchers.
 * Used to ensure gateway restart waits for all replies to complete.
 */
import { resolveGlobalSet } from "../../shared/global-singleton.js";

export type ReplyDispatcherRegistration = {
  /** Owning session key, when known, so a leaked dispatcher names itself. */
  sessionKey?: string;
  /** Owning run id, when known, so a leaked dispatcher names itself. */
  runId?: string;
};

type TrackedDispatcher = {
  readonly pending: () => number;
  readonly sessionKey?: string;
  readonly runId?: string;
};

const activeDispatchers = resolveGlobalSet<TrackedDispatcher>(
  Symbol.for("openclaw.activeReplyDispatchers"),
  "close-only",
);

/**
 * Register a reply dispatcher for global tracking.
 * Returns an unregister function to call when the dispatcher is no longer needed.
 */
export function registerDispatcher(
  pending: () => number,
  registration?: ReplyDispatcherRegistration,
): () => void {
  // Separate registrations must remain distinct even when they share a callback.
  const tracked: TrackedDispatcher = { pending, ...registration };
  activeDispatchers.add(tracked);

  return () => {
    activeDispatchers.delete(tracked);
  };
}

/**
 * Get the total number of pending replies across all dispatchers.
 */
export function getTotalPendingReplies(): number {
  let total = 0;
  for (const dispatcher of activeDispatchers) {
    total += dispatcher.pending();
  }
  return total;
}

export type PendingReplyDetail = {
  sessionKey?: string;
  runId?: string;
  pending: number;
};

/**
 * Get per-dispatcher pending details so a future leak can name itself.
 */
export function getPendingReplyDetails(): PendingReplyDetail[] {
  const details: PendingReplyDetail[] = [];
  for (const dispatcher of activeDispatchers) {
    const pending = dispatcher.pending();
    if (pending > 0) {
      details.push({
        sessionKey: dispatcher.sessionKey,
        runId: dispatcher.runId,
        pending,
      });
    }
  }
  return details;
}
