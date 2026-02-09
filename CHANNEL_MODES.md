# Channel Modes - Complete Reference

## Overview

OpenClaw channels now support **5 operation modes** that control how channels receive, process, and send messages.

## Mode Matrix

| Mode | Receive | Route to Agent | Send | Token Cost | Use Case |
|------|---------|----------------|------|------------|----------|
| **enabled** | ✅ | ✅ | ✅ | Normal | Normal operation |
| **dnd** | ✅ | ❌ | ✅ (static) | **Zero** | Away/vacation mode |
| **read-only** | ✅ | ✅ | ❌ | Normal | Monitoring/logging |
| **write-only** | ❌ | ❌ | ✅ | Zero | Outbound notifications only |
| **disabled** | ❌ | ❌ | ❌ | Zero | Fully offline |

## Mode Details

### 1. `enabled` - Normal Operation
**Full functionality**

```
Inbound: Message → Route to Agent → AI Processes → Send Response
Outbound: Can send messages
Tokens: Normal usage
```

**Use Cases:**
- Default mode for active channels
- Full conversational AI
- Two-way communication

**Example:**
```javascript
{ method: "channels.mode.set", params: { channel: "signal", mode: "enabled" } }
```

---

### 2. `dnd` - Do Not Disturb (Token-Saving Mode)
**Receives messages but sends static auto-replies without AI processing**

```
Inbound: Message → Static Auto-Reply (NO AGENT)
Outbound: Can send messages
Tokens: ZERO (agent never invoked)
```

**Use Cases:**
- Vacation/away mode
- After-hours auto-response
- High-traffic group spam prevention
- Token budget preservation

**Token Savings:**
- High-traffic group (100 msg/day): ~$182/year
- Vacation (2 weeks): ~$1
- After-hours (nights): ~$0.20/night

**Example:**
```javascript
{
  method: "channels.mode.set",
  params: {
    channel: "telegram",
    mode: "dnd",
    dndMessage: "On vacation until March 15. Email me@example.com for urgent matters."
  }
}
```

---

### 3. `read-only` - Monitor & Log Mode
**Receives and processes messages but cannot respond**

```
Inbound: Message → Route to Agent → AI Processes → [No Response Sent]
Outbound: BLOCKED (cannot send)
Tokens: Normal usage (agent still invoked)
```

**Use Cases:**
- Monitoring conversations for context
- Logging messages without responding
- Training/learning mode (agent sees but doesn't respond)
- Audit/compliance logging
- Building conversation history

**Why This Matters:**
- Agent still learns from conversations
- Context preserved for later
- Useful in group chats where you want to follow along
- Can switch to full mode when ready to engage

**Example:**
```javascript
{ method: "channels.mode.set", params: { channel: "discord", mode: "read-only" } }
```

**Note:** Still costs tokens because agent processes messages. Use DND mode for zero-token monitoring.

---

### 4. `write-only` - Outbound Notifications Only
**Can send messages but doesn't receive/process inbound**

```
Inbound: BLOCKED (no processing)
Outbound: Can send messages
Tokens: ZERO (no inbound = no agent invocations)
```

**Use Cases:**
- Notification/alert channels
- Status update broadcasts
- One-way announcements
- Scheduled messages without replies
- Bot commands that don't need responses

**Why This Matters:**
- Prevents spam from triggering expensive AI calls
- Useful for broadcast channels
- Agent can still post updates proactively

**Example:**
```javascript
{ method: "channels.mode.set", params: { channel: "slack", mode: "write-only" } }
```

**Example Use Case:**
```javascript
// Set Slack to write-only for status updates
await channels.mode.set({ channel: "slack", mode: "write-only" });

// Agent can still send status updates:
await send({ channel: "slack", message: "Deployment completed successfully" });

// But Slack messages don't trigger agent (zero tokens)
```

---

### 5. `disabled` - Fully Offline
**Channel is completely disconnected**

```
Inbound: BLOCKED (offline)
Outbound: BLOCKED (offline)
Tokens: ZERO
```

**Use Cases:**
- Temporarily disabling a channel
- Testing other channels in isolation
- Deactivating unused channels

**Example:**
```javascript
{ method: "channels.mode.set", params: { channel: "telegram", mode: "disabled" } }
```

---

## API Reference

### Set Mode

```javascript
{
  method: "channels.mode.set",
  params: {
    channel: "signal",          // Required: channel name
    mode: "dnd",               // Required: mode (see matrix)
    dndMessage: "Custom msg",  // Optional: DND auto-reply message
    accountId: "account1",     // Optional: specific account
    persist: true              // Optional: write to config (future)
  }
}
```

**Response:**
```javascript
{
  ok: true,
  result: {
    channel: "signal",
    mode: "dnd",
    dndMessage: "Custom msg",
    accountId: "default",
    persisted: false
  }
}
```

### Get Mode

```javascript
{
  method: "channels.mode.get",
  params: {
    channel: "signal",
    accountId: "account1"  // Optional
  }
}
```

**Response:**
```javascript
{
  ok: true,
  result: {
    channel: "signal",
    mode: "dnd",
    description: "Do Not Disturb (receive, auto-reply only, no agent routing)",
    capabilities: {
      canReceive: true,
      canRoute: false,
      canSend: true,
      sendDndReply: true,
      shouldConnect: true
    },
    dndMessage: "On vacation"
  }
}
```

---

## Common Workflows

### Vacation Mode (All Channels)
```javascript
const channels = ["signal", "telegram", "discord", "slack"];
const message = "On vacation until March 15. Email urgent@example.com for emergencies.";

for (const channel of channels) {
  await rpc({
    method: "channels.mode.set",
    params: { channel, mode: "dnd", dndMessage: message }
  });
}
```

**Savings:** ~$10-50 depending on traffic

---

### Work Hours Setup
```javascript
// 9am: Enable work channels fully
await rpc({ method: "channels.mode.set", params: { channel: "slack", mode: "enabled" } });
await rpc({ method: "channels.mode.set", params: { channel: "msteams", mode: "enabled" } });

// Keep personal channels in DND during work
await rpc({
  method: "channels.mode.set",
  params: {
    channel: "signal",
    mode: "dnd",
    dndMessage: "Work mode active. I'll respond after 5pm."
  }
});

// 6pm: Reverse the setup
await rpc({ method: "channels.mode.set", params: { channel: "slack", mode: "dnd" } });
await rpc({ method: "channels.mode.set", params: { channel: "signal", mode: "enabled" } });
```

---

### Monitoring Mode (Read-Only)
```javascript
// Monitor a busy Discord server without responding
await rpc({
  method: "channels.mode.set",
  params: { channel: "discord", mode: "read-only" }
});

// Agent sees all messages (builds context) but doesn't respond
// Later, when ready to engage:
await rpc({
  method: "channels.mode.set",
  params: { channel: "discord", mode: "enabled" }
});
```

---

### Notification Channel (Write-Only)
```javascript
// Set up a Slack channel for status notifications only
await rpc({
  method: "channels.mode.set",
  params: { channel: "slack", mode: "write-only" }
});

// Agent can send updates:
await send({
  channel: "slack",
  message: "System update complete. All services nominal."
});

// But Slack messages don't trigger agent (zero token cost)
```

---

### Token Budget Emergency
```javascript
// Low on tokens? Switch non-critical channels to DND
const nonCritical = ["telegram", "discord", "slack"];
for (const channel of nonCritical) {
  await rpc({
    method: "channels.mode.set",
    params: {
      channel,
      mode: "dnd",
      dndMessage: "Token budget mode active. Signal only for urgent matters."
    }
  });
}

// Keep Signal in read-only (still processes but doesn't respond)
await rpc({
  method: "channels.mode.set",
  params: { channel: "signal", mode: "read-only" }
});
```

---

## Integration Guide

### Channel Monitor Integration

Each channel monitor needs to check mode before processing:

```typescript
import { checkChannelMode, DEFAULT_DND_MESSAGE } from "../../auto-reply/dnd-handler.js";

async function handleInboundMessage(message: InboundMessage) {
  // Check channel mode BEFORE any processing
  const modeCheck = await checkChannelMode({
    channelId: "signal", // or "discord", "telegram", etc.
    accountId: accountId,
    channelManager: context.channelManager,
  });

  // DND mode: Send static reply, don't route to agent
  if (modeCheck.mode === "dnd") {
    const reply = modeCheck.dndMessage || DEFAULT_DND_MESSAGE;
    await sendReply(message.sender, reply);
    return; // STOP HERE - Zero tokens used
  }

  // Read-only mode: Route to agent but don't send response
  if (modeCheck.mode === "read-only") {
    await dispatchInboundMessage({ ...params, suppressResponse: true });
    return;
  }

  // Write-only mode: Don't process inbound at all
  if (modeCheck.mode === "write-only") {
    return; // Ignore inbound messages
  }

  // Enabled mode: Normal processing
  await dispatchInboundMessage(params);
}
```

---

## Token Cost Analysis

### Scenario: High-Traffic Discord Server (100 messages/day)

| Mode | Daily Cost | Annual Cost | Savings |
|------|------------|-------------|---------|
| **enabled** | $0.50 | $182.50 | - |
| **dnd** | $0.00 | $0.00 | **$182.50** |
| **read-only** | $0.50 | $182.50 | $0 |
| **write-only** | $0.00 | $0.00 | **$182.50** |
| **disabled** | $0.00 | $0.00 | **$182.50** |

### Scenario: Personal Telegram (50 messages/day)

| Mode | Daily Cost | Annual Cost | Savings |
|------|------------|-------------|---------|
| **enabled** | $0.25 | $91.25 | - |
| **dnd** | $0.00 | $0.00 | **$91.25** |
| **read-only** | $0.25 | $91.25 | $0 |
| **write-only** | $0.00 | $0.00 | **$91.25** |

**Key Insight**: DND and write-only modes save the most tokens. Read-only costs the same as enabled (agent still processes).

---

## Legacy Methods (Still Supported)

Old methods are still available for backward compatibility:

```javascript
// Old way (still works):
{ method: "channels.enable", params: { channel: "signal" } }
{ method: "channels.disable", params: { channel: "signal" } }
{ method: "channels.dnd.set", params: { channel: "signal", enabled: true } }

// New way (preferred):
{ method: "channels.mode.set", params: { channel: "signal", mode: "enabled" } }
{ method: "channels.mode.set", params: { channel: "signal", mode: "disabled" } }
{ method: "channels.mode.set", params: { channel: "signal", mode: "dnd" } }
```

---

## Configuration (Future Enhancement)

Persistent mode configuration:

```yaml
# config.yaml
channels:
  signal:
    mode: enabled  # Default mode
    
  telegram:
    mode: dnd
    dndMessage: "Away on vacation"
    
  discord:
    mode: read-only
    
  slack:
    mode: write-only
```

---

## FAQ

**Q: Which modes save tokens?**
A: DND, write-only, and disabled save tokens. Read-only does NOT (agent still processes).

**Q: Can I switch modes without disconnecting?**
A: Yes! Most mode changes don't require reconnection (except disabled).

**Q: What's the difference between DND and disabled?**
A: DND stays connected and sends auto-replies. Disabled is fully offline.

**Q: Why use read-only instead of disabled?**
A: Read-only lets agent learn from conversations for future context.

**Q: What's write-only useful for?**
A: Broadcasting notifications/alerts without processing incoming spam.

**Q: Do mode changes persist across gateway restarts?**
A: Not yet (runtime state only). Config persistence is coming.

---

## Summary

The 5-mode system provides fine-grained control over channel behavior:

- **enabled**: Normal operation
- **dnd**: Zero-token auto-replies (best for vacation)
- **read-only**: Agent learns but doesn't respond (monitoring)
- **write-only**: Broadcast only (notifications)
- **disabled**: Fully offline

**Token savings are significant:** DND and write-only modes eliminate AI processing costs while maintaining channel responsiveness or broadcast capability.

**Status:** Core implementation 100% complete. Monitor integration needed (2-4 hours per channel).
