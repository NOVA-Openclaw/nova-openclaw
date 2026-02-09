# DND Mode - Quick Reference

## What is DND Mode?

**DND (Do Not Disturb) Mode** = Static auto-reply with **zero token cost**

## Three Channel States

| State | Connected? | Responds? | Uses Agent? | Token Cost |
|-------|-----------|-----------|-------------|------------|
| **Normal** | ✅ Yes | ✅ Yes | ✅ Yes | 💰 High |
| **DND** | ✅ Yes | ✅ Yes (static) | ❌ No | 🆓 Zero |
| **Disabled** | ❌ No | ❌ No | ❌ No | 🆓 Zero |

## Message Flow

### Normal Mode (costs tokens)
```
User sends message
    ↓
Channel receives
    ↓
Monitor dispatches to agent   ← AI processes here ($$$)
    ↓
Agent generates response
    ↓
Response sent
```

### DND Mode (zero tokens)
```
User sends message
    ↓
Channel receives
    ↓
DND check: enabled = true
    ↓
Send static auto-reply        ← NO AI, NO TOKENS ($0)
    ↓
Done (agent never invoked)
```

### Disabled Mode (no response)
```
User sends message
    ↓
Channel offline
    ↓
[No response at all]
```

## RPC Commands

### Enable DND
```javascript
{
  method: "channels.dnd.set",
  params: {
    channel: "telegram",
    enabled: true,
    message: "I'm on vacation. Back March 15."
  }
}
```

### Disable DND
```javascript
{
  method: "channels.dnd.set",
  params: {
    channel: "telegram",
    enabled: false
  }
}
```

### Check DND Status
```javascript
{
  method: "channels.dnd.get",
  params: { channel: "telegram" }
}
```

## Common Use Cases

### 1. Vacation Mode
**Scenario**: Gone for 2 weeks, want to stay responsive but not waste tokens

**Solution**:
```javascript
channels.dnd.set({
  channel: "signal",
  enabled: true,
  message: "I'm on vacation until March 15. Email me@example.com for urgent matters."
});
```

**Savings**: ~100K tokens (~$1.00) over 2 weeks

### 2. After-Hours Auto-Response
**Scenario**: Don't want to be disturbed after 6pm but want to acknowledge messages

**Solution**:
```javascript
// At 6pm
channels.dnd.set({
  channel: "telegram",
  enabled: true,
  message: "Work hours are 9am-5pm PST. I'll respond tomorrow."
});

// At 9am
channels.dnd.set({ channel: "telegram", enabled: false });
```

**Savings**: ~20K tokens/night (~$0.20/night)

### 3. High-Traffic Group
**Scenario**: Busy Discord group where you don't need to respond to everything

**Solution**:
```javascript
channels.dnd.set({
  channel: "discord",
  enabled: true,
  message: "I'm in focus mode. DM me directly if urgent."
});
```

**Savings**: ~50K tokens/day (~$0.50/day)

### 4. Token Budget Management
**Scenario**: Running low on tokens, need to preserve for important channels

**Solution**:
```javascript
// Disable AI on non-critical channels
const nonCritical = ["telegram", "discord", "slack"];
for (const channel of nonCritical) {
  await channels.dnd.set({
    channel,
    enabled: true,
    message: "Reduced availability. Signal only for urgent matters."
  });
}
```

**Savings**: Depends on traffic, but can save hundreds of thousands of tokens

## Implementation Status

✅ **Complete (100%)**:
- DND state storage
- RPC methods (`channels.dnd.set`, `channels.dnd.get`)
- DND check function (`checkChannelDnd()`)

🚧 **Remaining (10%)**:
- Integrate DND check into channel monitors
- Add check BEFORE `dispatchInboundMessage()` call

**Estimated time**: 2-4 hours for all channels

## Integration Code Snippet

```typescript
// In channel monitor (e.g., Signal, Discord, Telegram):
import { checkChannelDnd } from "../../auto-reply/dnd-handler.js";

async function handleInboundMessage(message) {
  // Check DND BEFORE agent dispatch
  const dndCheck = checkChannelDnd({
    channelId: "signal", // or "discord", "telegram", etc.
    accountId: accountId,
    channelManager: context.channelManager,
  });

  if (dndCheck.enabled) {
    // Send static response - NO AGENT, NO TOKENS
    await sendReply(message.sender, dndCheck.message);
    return; // Stop here - agent never invoked
  }

  // Only if NOT in DND: invoke agent (costs tokens)
  await dispatchInboundMessage({ ... });
}
```

## Key Benefits

1. 💰 **Zero Token Cost** - Agent never invoked during DND
2. ⚡ **Instant Response** - No wait for AI processing
3. 🔌 **Stay Connected** - Channel remains active and responsive
4. 🎛️ **Flexible Control** - Enable/disable per channel
5. ✏️ **Custom Messages** - Different away messages per channel
6. 🛡️ **Token Budget Protection** - Preserve tokens for important interactions

## Token Cost Comparison

### Typical Message Processing
- Average tokens per message: 500-1000 tokens
- Typical cost: $0.005-$0.01 per message (depending on model)

### DND Mode
- Tokens per message: **0**
- Cost per message: **$0.00**

### Annual Savings Examples

| Scenario | Messages/Year | Normal Cost | DND Cost | Savings |
|----------|---------------|-------------|----------|---------|
| High-traffic group (100/day) | 36,500 | $182-$365 | $0 | $182-$365 |
| Vacation (2 weeks/year) | 200 | $1-$2 | $0 | $1-$2 |
| After-hours (weeknights) | 5,000 | $25-$50 | $0 | $25-$50 |
| Multiple channels | Varies | $500+ | $0 | $500+ |

## FAQ

**Q: Does DND disconnect the channel?**
A: No. Channel stays connected and receives messages.

**Q: Can users still reach me in DND mode?**
A: Yes. They receive your auto-reply message immediately.

**Q: Is the auto-reply customizable?**
A: Yes. Set a different message per channel.

**Q: Does DND persist across gateway restarts?**
A: Currently no (runtime state only). Config persistence is a future enhancement.

**Q: Can I set DND via the agent?**
A: Yes! The agent can call the RPC methods to manage DND for you.

**Q: What's the difference between DND and disabling the channel?**
A: DND = connected + auto-reply. Disabled = offline + no response.

## Summary

DND mode is a **token-saving feature** that maintains channel responsiveness without AI processing:

- ✅ Channel stays online
- ✅ Instant static replies
- ✅ Zero token cost
- ✅ User-configurable messages
- ✅ Perfect for vacation, after-hours, or high-traffic management

**Status**: 90% complete. Core infrastructure done. Needs monitor integration (2-4 hours).
