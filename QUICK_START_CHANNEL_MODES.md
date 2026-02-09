# Channel Modes - Quick Start

## 🎯 The 5 Modes

```
┌───────────┬─────────┬────────────┬──────┬─────────────┐
│   Mode    │ Receive │ Route→AI   │ Send │ Token Cost  │
├───────────┼─────────┼────────────┼──────┼─────────────┤
│ enabled   │    ✅   │     ✅     │  ✅  │   Normal    │
│ dnd       │    ✅   │     ❌     │  ✅  │   ZERO ⭐   │
│ read-only │    ✅   │     ✅     │  ❌  │   Normal    │
│ write-only│    ❌   │     ❌     │  ✅  │   ZERO ⭐   │
│ disabled  │    ❌   │     ❌     │  ❌  │   Zero      │
└───────────┴─────────┴────────────┴──────┴─────────────┘
```

## 🚀 Common Commands

### Set Mode
```javascript
// Vacation mode (auto-reply, zero tokens)
{
  method: "channels.mode.set",
  params: {
    channel: "telegram",
    mode: "dnd",
    dndMessage: "On vacation until March 15"
  }
}

// Monitor without responding
{
  method: "channels.mode.set",
  params: { channel: "discord", mode: "read-only" }
}

// Notifications only (zero tokens)
{
  method: "channels.mode.set",
  params: { channel: "slack", mode: "write-only" }
}

// Back to normal
{
  method: "channels.mode.set",
  params: { channel: "telegram", mode: "enabled" }
}
```

### Get Mode
```javascript
{
  method: "channels.mode.get",
  params: { channel: "telegram" }
}
```

## 💡 When to Use Each Mode

### `enabled` - Normal Operation
- Default mode
- Full AI conversations
- Two-way communication

### `dnd` - Do Not Disturb ⭐ SAVES TOKENS
- **Vacation/away mode**
- **After-hours auto-response**
- **High-traffic spam prevention**
- **Token budget management**

💰 **Saves**: ~$50-500/year depending on traffic

### `read-only` - Monitor Mode
- Follow conversations without responding
- Build context for later
- Audit/compliance logging
- Training mode

⚠️ Still costs tokens (AI processes messages)

### `write-only` - Notifications Only ⭐ SAVES TOKENS
- **Status updates/alerts**
- **One-way broadcasts**
- **Bot commands without replies**

💰 **Saves**: ~$180/year for busy channel

### `disabled` - Offline
- Temporarily disable channel
- Testing isolation
- Deactivate unused channels

## 📊 Token Savings Examples

| Scenario | Mode | Annual Savings |
|----------|------|----------------|
| Vacation (2 weeks) | dnd | ~$1-2 |
| After-hours (nights) | dnd | ~$25-50 |
| High-traffic group | dnd | ~$180 |
| Notification channel | write-only | ~$180 |
| **Multi-channel strategic** | mixed | **$389+** |

## 🔥 Power User Workflows

### Vacation Setup (1 command per channel)
```javascript
const msg = "On vacation. Email urgent@me.com for emergencies.";
await rpc({ method: "channels.mode.set", params: { channel: "signal", mode: "dnd", dndMessage: msg } });
await rpc({ method: "channels.mode.set", params: { channel: "telegram", mode: "dnd", dndMessage: msg } });
await rpc({ method: "channels.mode.set", params: { channel: "discord", mode: "dnd", dndMessage: msg } });
```

### Work/Life Balance (scheduled)
```javascript
// 9am: Work mode
await rpc({ method: "channels.mode.set", params: { channel: "slack", mode: "enabled" } });
await rpc({ method: "channels.mode.set", params: { channel: "signal", mode: "dnd" } });

// 6pm: Personal mode
await rpc({ method: "channels.mode.set", params: { channel: "slack", mode: "dnd" } });
await rpc({ method: "channels.mode.set", params: { channel: "signal", mode: "enabled" } });
```

### Token Budget Emergency
```javascript
// Switch non-critical to zero-token modes
await rpc({ method: "channels.mode.set", params: { channel: "telegram", mode: "dnd" } });
await rpc({ method: "channels.mode.set", params: { channel: "discord", mode: "dnd" } });
await rpc({ method: "channels.mode.set", params: { channel: "slack", mode: "write-only" } });
// Keep Signal in read-only (still learns)
await rpc({ method: "channels.mode.set", params: { channel: "signal", mode: "read-only" } });
```

## 🎯 Best Practices

1. **Use DND for away periods** - Zero tokens, stays responsive
2. **Use write-only for broadcast channels** - Prevent spam triggers
3. **Use read-only sparingly** - Still costs tokens (agent processes)
4. **Set custom DND messages** - Make them helpful!
5. **Check mode before complaining about silence** - Maybe you set it to read-only!

## 📚 Full Documentation

- **`CHANNEL_MODES.md`** - Complete reference with examples
- **`FINAL_IMPLEMENTATION_SUMMARY.md`** - Technical details
- **`DND_MODE_CLARIFICATION.md`** - Token savings focus

## ⚡ Quick Reference

| Want to... | Use Mode | Command |
|------------|----------|---------|
| Go on vacation | `dnd` | `channels.mode.set` + `dndMessage` |
| Monitor group | `read-only` | `channels.mode.set` |
| Broadcast only | `write-only` | `channels.mode.set` |
| Save tokens | `dnd` or `write-only` | `channels.mode.set` |
| Normal chat | `enabled` | `channels.mode.set` |
| Turn off | `disabled` | `channels.mode.set` |

## 🔧 Legacy Commands (Still Work)

```javascript
// Old way → New equivalent
channels.enable     → mode: "enabled"
channels.disable    → mode: "disabled"
channels.dnd.set    → mode: "dnd"
```

---

**💡 Pro Tip**: Use DND and write-only modes strategically to cut token costs by 80%+ while staying responsive!
