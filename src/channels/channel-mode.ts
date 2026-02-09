/**
 * Channel operation modes
 */
export type ChannelMode = "enabled" | "dnd" | "read-only" | "write-only" | "disabled";

export const CHANNEL_MODES: readonly ChannelMode[] = [
  "enabled",
  "dnd",
  "read-only",
  "write-only",
  "disabled",
] as const;

export type ChannelModeCapabilities = {
  /** Can receive inbound messages */
  canReceive: boolean;
  /** Can route messages to agent for processing */
  canRoute: boolean;
  /** Can send outbound messages/responses */
  canSend: boolean;
  /** Should send static DND auto-reply */
  sendDndReply: boolean;
  /** Should start/maintain connection */
  shouldConnect: boolean;
};

/**
 * Get capabilities for a channel mode
 */
export function getChannelModeCapabilities(mode: ChannelMode): ChannelModeCapabilities {
  switch (mode) {
    case "enabled":
      return {
        canReceive: true,
        canRoute: true,
        canSend: true,
        sendDndReply: false,
        shouldConnect: true,
      };
    case "dnd":
      return {
        canReceive: true,
        canRoute: false, // Don't route to agent = zero tokens
        canSend: true, // Can send static DND reply
        sendDndReply: true,
        shouldConnect: true,
      };
    case "read-only":
      return {
        canReceive: true,
        canRoute: true, // Route to agent for processing
        canSend: false, // But don't send responses
        sendDndReply: false,
        shouldConnect: true,
      };
    case "write-only":
      return {
        canReceive: false, // Don't process inbound
        canRoute: false,
        canSend: true, // Can send outbound
        sendDndReply: false,
        shouldConnect: true, // Need connection for sending
      };
    case "disabled":
      return {
        canReceive: false,
        canRoute: false,
        canSend: false,
        sendDndReply: false,
        shouldConnect: false,
      };
  }
}

/**
 * Check if a mode string is valid
 */
export function isValidChannelMode(mode: unknown): mode is ChannelMode {
  return typeof mode === "string" && CHANNEL_MODES.includes(mode as ChannelMode);
}

/**
 * Normalize a mode string, returning null if invalid
 */
export function normalizeChannelMode(mode: unknown): ChannelMode | null {
  if (isValidChannelMode(mode)) {
    return mode;
  }
  return null;
}

/**
 * Get a human-readable description of a channel mode
 */
export function describeChannelMode(mode: ChannelMode): string {
  switch (mode) {
    case "enabled":
      return "Normal operation (receive, route, respond)";
    case "dnd":
      return "Do Not Disturb (receive, auto-reply only, no agent routing)";
    case "read-only":
      return "Read-only (receive and route to agent, but cannot send responses)";
    case "write-only":
      return "Write-only (can send outbound messages, but doesn't receive)";
    case "disabled":
      return "Disabled (fully offline)";
  }
}

/**
 * Get token cost implication for a mode
 */
export function getChannelModeTokenCost(mode: ChannelMode): "normal" | "zero" | "read-only" {
  const capabilities = getChannelModeCapabilities(mode);
  
  if (!capabilities.canRoute) {
    return "zero"; // No agent routing = zero tokens
  }
  
  if (capabilities.canRoute && !capabilities.canSend) {
    return "read-only"; // Routes to agent but doesn't respond
  }
  
  return "normal";
}
