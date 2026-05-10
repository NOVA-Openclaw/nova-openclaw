# Test Cases: Issue #41 — Canonical message:received Hook Context

**Branch:** `fix/issue-41-canonical-message-received-context`
**Related:** nova-mind #179 (parallel fix for sender fields)

---

## Context Shape Consistency

### TC-001: message:received uses deriveInboundMessageHookContext

**Verification:** `triggerMessageReceived` in `src/hooks/message-hooks.ts` calls `deriveInboundMessageHookContext(ctx)` instead of building a custom context object.
**Expected:** The `createInternalHookEvent` call passes the canonical context, not the hand-rolled one.

### TC-002: Sender fields at top level

**Input:** Discord message from I)ruid
**Expected:** Hook context has `senderId`, `senderName`, `senderUsername` at the top level (not only inside `metadata`).

```typescript
event.context.senderId === "330189773371080716";
event.context.senderName === "I)ruid";
event.context.senderUsername === "druidian";
```

### TC-003: Content field present

**Input:** Any message with body text
**Expected:** `event.context.content` contains the message body (derived from BodyForCommands → RawBody → Body fallback chain).

### TC-004: Provider and channel fields

**Input:** Discord channel message
**Expected:**

- `event.context.provider === "discord"`
- `event.context.channelId === "discord"` (normalized)
- `event.context.conversationId` set to channel identifier
- `event.context.guildId` set to Discord guild ID
- `event.context.channelName` set to channel name
- `event.context.isGroup` correctly determined

### TC-005: Signal message context

**Input:** Signal group message
**Expected:** Same canonical shape — `provider`, `senderId`, `senderName`, `senderE164`, `isGroup`, `conversationId` all populated at top level.

### TC-006: Telegram message context

**Input:** Telegram message
**Expected:** Same canonical shape with appropriate provider-specific fields.

### TC-007: messageId populated

**Input:** Any channel message
**Expected:** `event.context.messageId` contains the platform message ID (from MessageSidFull → MessageSid → MessageSidFirst fallback).

### TC-008: threadId populated for Discord threads

**Input:** Discord message in a thread
**Expected:** `event.context.threadId` contains the thread ID.

---

## Backward Compatibility

### TC-009: Old context fields still accessible

**Verification:** The canonical context includes `body` (from `ctx.Body`) and `content` (derived). Hooks that previously read `ctx.message` or `ctx.rawBody` should be updated, but the canonical context provides equivalent data via `content`.
**Expected:** No hook that reads `event.context.content` breaks.

### TC-010: message field deprecated but present

**Verification:** If any downstream hooks depend on `event.context.message` (the old field), consider whether to include it as an alias.
**Expected:** Document breaking change if `message` field is removed. Prefer `content` going forward.

---

## No Regression

### TC-011: reply_dispatch hooks unaffected

**Verification:** Changes are only to `triggerMessageReceived`. Plugin hooks on `reply_dispatch` continue to receive the same context.
**Expected:** No change to reply_dispatch behavior.

### TC-012: message:sent hooks unaffected

**Verification:** `triggerMessageSent` is not modified.
**Expected:** No change to sent message hook behavior.
