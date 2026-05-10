/**
 * Message hook events for message:received and message:sent
 *
 * These hooks enable automation around the message lifecycle:
 * - message:received — fires when an inbound message is about to be processed
 * - message:sent — fires after an outbound message is successfully delivered
 */
import type { FinalizedMsgContext } from "../auto-reply/templating.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { createInternalHookEvent, triggerInternalHook } from "./internal-hooks.js";
import {
  deriveInboundMessageHookContext,
  toInternalMessageReceivedContext,
} from "./message-hook-mappers.js";

/**
 * @deprecated Use CanonicalInboundMessageHookContext from message-hook-mappers.ts
 * Kept as a type alias for backward compatibility. Downstream hooks should migrate
 * to reading `content` (not `message`) and canonical field names. See issue #41.
 */
export type MessageReceivedContext = {
  /** @deprecated Use `content` instead */
  message: string;
  /** @deprecated Use `content` instead */
  rawBody?: string;
  senderId?: string;
  senderName?: string;
  /** @deprecated Use `provider` or `channelId` instead */
  channel?: string;
  messageId?: string;
  isGroup?: boolean;
  groupId?: string;
  timestamp?: number;
  commandAuthorized?: boolean;
};

export type MessageSentContext = {
  /** The reply text that was sent */
  text?: string;
  /** Media URL if any */
  mediaUrl?: string;
  /** Target recipient */
  target?: string;
  /** Channel the message was sent to */
  channel?: string;
  /** Delivery kind (tool, block, final) */
  kind?: string;
};

/**
 * Trigger message:received hook
 * Call this when an inbound message is about to be processed by the agent.
 *
 * Uses the canonical CanonicalInboundMessageHookContext shape (deriveInboundMessageHookContext)
 * so that hook authors see a consistent context with sender fields at the top level.
 * Fixes #41: previously used a hand-rolled context with different field names
 * (e.g. `message` instead of `content`, `channel` instead of `provider`/`channelId`).
 */
export async function triggerMessageReceived(
  sessionKey: string,
  ctx: FinalizedMsgContext,
): Promise<void> {
  const canonical = deriveInboundMessageHookContext(ctx);
  const internalContext = toInternalMessageReceivedContext(canonical);
  const hookEvent = createInternalHookEvent("message", "received", sessionKey, internalContext);
  await triggerInternalHook(hookEvent);
}

/**
 * Trigger message:sent hook
 * Call this after an outbound message is successfully delivered
 */
export async function triggerMessageSent(
  sessionKey: string,
  payload: ReplyPayload,
  context: {
    target?: string;
    channel?: string;
    kind?: string;
  },
): Promise<void> {
  await triggerInternalHook(
    createInternalHookEvent("message", "sent", sessionKey, {
      text: payload.text,
      mediaUrl: payload.mediaUrl,
      target: context.target,
      channel: context.channel,
      kind: context.kind,
    }),
  );
}
