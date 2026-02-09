import type { ChannelId } from "../channels/plugins/types.js";
import type { ChannelManager } from "../gateway/server-channels.js";
import type { ChannelMode, ChannelModeCapabilities } from "../channels/channel-mode.js";

export const DEFAULT_DND_MESSAGE =
  "I'm currently in Do Not Disturb mode. I'll respond when I'm back online.";

export type ChannelModeCheckResult = {
  mode: ChannelMode;
  capabilities: ChannelModeCapabilities;
  dndMessage?: string;
};

/**
 * Get the current mode and capabilities for a channel
 */
export async function checkChannelMode(params: {
  channelId: ChannelId;
  accountId?: string;
  channelManager: ChannelManager;
}): Promise<ChannelModeCheckResult> {
  const { getChannelModeCapabilities } = await import("../channels/channel-mode.js");
  
  const modeState = params.channelManager.getChannelModeState(
    params.channelId,
    params.accountId,
  );

  const mode = modeState?.mode ?? "enabled";
  const capabilities = getChannelModeCapabilities(mode);

  return {
    mode,
    capabilities,
    dndMessage: modeState?.dndMessage,
  };
}

export type DndCheckResult =
  | { enabled: false }
  | { enabled: true; message: string };

/**
 * Check if a channel is in DND mode and return the DND message if applicable.
 * @deprecated Use checkChannelMode() instead for full mode awareness
 */
export async function checkChannelDnd(params: {
  channelId: ChannelId;
  accountId?: string;
  channelManager: ChannelManager;
}): Promise<DndCheckResult> {
  const modeCheck = await checkChannelMode(params);

  if (modeCheck.mode !== "dnd") {
    return { enabled: false };
  }

  const message = modeCheck.dndMessage || DEFAULT_DND_MESSAGE;
  return { enabled: true, message };
}

/**
 * Determines if an inbound message should be routed to the agent.
 * Returns true if the message should be routed, false if it should be blocked.
 */
export async function shouldRouteToAgent(params: {
  channelId: ChannelId;
  accountId?: string;
  channelManager: ChannelManager;
}): Promise<boolean> {
  const modeCheck = await checkChannelMode(params);
  return modeCheck.capabilities.canRoute;
}

/**
 * Determines if the channel can send responses.
 * Returns true if sending is allowed, false otherwise.
 */
export async function canSendResponse(params: {
  channelId: ChannelId;
  accountId?: string;
  channelManager: ChannelManager;
}): Promise<boolean> {
  const modeCheck = await checkChannelMode(params);
  return modeCheck.capabilities.canSend;
}

/**
 * @deprecated Use shouldRouteToAgent() instead
 */
export async function shouldBlockForDnd(params: {
  channelId: ChannelId;
  accountId?: string;
  channelManager: ChannelManager;
}): Promise<boolean> {
  const shouldRoute = await shouldRouteToAgent(params);
  return !shouldRoute;
}
