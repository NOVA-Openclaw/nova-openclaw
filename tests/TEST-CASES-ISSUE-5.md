# Test Cases for Issue #5: Auto-respond in Slack threads

## 1. Config Option Parsing and Validation

**ID:** TC-5.1
**Description:** Verify that the `thread.autoRespondWhenParticipating` config option is parsed correctly.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true`.
  **Steps:**

1. Update the channel configuration to include `thread.autoRespondWhenParticipating: true`.
2. Restart the agent.
3. Check the agent's internal configuration to confirm the option is set correctly.
   **Expected Results:**

- The agent's configuration reflects the `thread.autoRespondWhenParticipating: true` setting.

**ID:** TC-5.2
**Description:** Verify that the `thread.autoRespondWhenParticipating` config option is parsed correctly when set to false.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true`.
  **Steps:**

1. Update the channel configuration to include `thread.autoRespondWhenParticipating: false`.
2. Restart the agent.
3. Check the agent's internal configuration to confirm the option is set correctly.
   **Expected Results:**

- The agent's configuration reflects the `thread.autoRespondWhenParticipating: false` setting.

**ID:** TC-5.3
**Description:** Verify that the agent handles an invalid value for `thread.autoRespondWhenParticipating` gracefully.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true`.
  **Steps:**

1. Update the channel configuration to include `thread.autoRespondWhenParticipating: "invalid"`.
2. Restart the agent.
3. Check the agent's logs for error messages.
   **Expected Results:**

- The agent logs an error message indicating an invalid configuration value.
- The agent either defaults to a safe value (e.g., `false`) or refuses to start.

## 2. Thread Participation Tracking

**ID:** TC-5.4
**Description:** Verify that the agent tracks threads where it has sent at least one message.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: true`.
  **Steps:**

1. User @mentions agent in the channel.
2. Agent replies to the message, creating a thread.
3. Check the agent's internal state to confirm the thread is being tracked as a "participated thread."
   **Expected Results:**

- The agent's internal state indicates that the thread is being tracked.

**ID:** TC-5.5
**Description:** Verify that the agent stops tracking a thread when it expires (if thread expiry is implemented).
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: true`.
- Thread expiry is enabled (if implemented).
  **Steps:**

1. User @mentions agent in the channel.
2. Agent replies to the message, creating a thread.
3. Wait for the thread to expire.
4. Check the agent's internal state to confirm the thread is no longer being tracked.
   **Expected Results:**

- The agent's internal state indicates that the thread is no longer being tracked after expiry.

## 3. Auto-Respond Behavior (Enabled)

**ID:** TC-5.6
**Description:** Verify that the agent auto-responds to new messages in a participated thread without requiring @mention.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: true`.
  **Steps:**

1. User @mentions agent in the channel.
2. Agent replies to the message, creating a thread.
3. User replies in the thread _without_ @mentioning the agent.
   **Expected Results:**

- The agent responds to the user's message in the thread.

**ID:** TC-5.7
**Description:** Verify that the agent _does_ require @mention for new top-level channel messages when `thread.autoRespondWhenParticipating` is enabled.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: true`.
  **Steps:**

1. User sends a new message in the channel _without_ @mentioning the agent.
   **Expected Results:**

- The agent does _not_ respond to the user's message.

## 4. No Change in Behavior (Disabled)

**ID:** TC-5.8
**Description:** Verify that the agent _does not_ auto-respond to new messages in a thread without requiring @mention when `thread.autoRespondWhenParticipating` is disabled.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: false`.
  **Steps:**

1. User @mentions agent in the channel.
2. Agent replies to the message, creating a thread.
3. User replies in the thread _without_ @mentioning the agent.
   **Expected Results:**

- The agent does _not_ respond to the user's message in the thread.

**ID:** TC-5.9
**Description:** Verify that the agent _does_ require @mention for new top-level channel messages when `thread.autoRespondWhenParticipating` is disabled (same as existing behavior).
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: false`.
  **Steps:**

1. User sends a new message in the channel _without_ @mentioning the agent.
   **Expected Results:**

- The agent does _not_ respond to the user's message.

## 5. Edge Cases

**ID:** TC-5.10
**Description:** Verify that the agent correctly handles multiple threads simultaneously.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: true`.
  **Steps:**

1. User @mentions agent in the channel, creating thread A.
2. Agent replies to the message in thread A.
3. User @mentions agent in the channel again, creating thread B.
4. Agent replies to the message in thread B.
5. User replies in thread A _without_ @mentioning the agent.
6. User replies in thread B _without_ @mentioning the agent.
   **Expected Results:**

- The agent responds to the user's message in both thread A and thread B.

**ID:** TC-5.11
**Description:** Verify that the agent only auto-responds in threads where _it_ has participated, and not threads started by others.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: true`.
  **Steps:**

1. User A @mentions another bot in the channel, creating thread A.
2. User B replies to the message in thread A.
3. User C replies to thread A _without_ @mentioning the agent.
   **Expected Results:**

- The agent does _not_ respond to User C's message.

**ID:** TC-5.12
**Description:** Verify that if the agent is mentioned in a thread where it is already participating, it continues to auto-respond even if it hasn't seen a message in that thread for a while.
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true` and `thread.autoRespondWhenParticipating: true`.
  **Steps:**

1. User @mentions agent in the channel.
2. Agent replies to the message, creating a thread.
3. Wait for a period of time (e.g., several hours).
4. User replies in the thread _without_ @mentioning the agent.
   **Expected Results:**

- The agent responds to the user's message in the thread.

**ID:** TC-5.13
**Description:** Verify the interaction between `autoRespondWhenParticipating` and other thread-related settings (e.g. `replyToMode`).
**Preconditions:**

- The agent is running.
- A Slack channel is configured with `requireMention: true`, `thread.autoRespondWhenParticipating: true`, and a specific `replyToMode` (e.g., `thread`).
  **Steps:**

1. User @mentions agent in the channel.
2. Agent replies to the message, creating a thread.
3. User replies in the thread _without_ @mentioning the agent.
   **Expected Results:**

- The agent responds to the user's message in the thread, _and_ the reply adheres to the configured `replyToMode` (e.g., the reply is only visible in the thread).

## 6. Domain-Specific Scenarios (NOVA Review)

**ID:** TC-5.14
**Description:** Verify agent joins tracking when @mentioned mid-thread (thread it didn't start).
**Preconditions:**

- Agent running with `requireMention: true` and `thread.autoRespondWhenParticipating: true`.
  **Steps:**

1. User A starts a thread by replying to User B's message (agent not involved).
2. User C @mentions agent in that existing thread.
3. Agent responds in the thread.
4. User A replies in the thread _without_ @mentioning agent.
   **Expected Results:**

- Agent responds to User A's follow-up (now a participated thread).

**ID:** TC-5.15
**Description:** Verify thread tracking survives gateway restart.
**Preconditions:**

- Agent running with `thread.autoRespondWhenParticipating: true`.
- Agent has participated in thread A.
  **Steps:**

1. Restart the gateway.
2. User replies in thread A _without_ @mention.
   **Expected Results:**

- **Option A:** Agent responds (participation persisted).
- **Option B:** Agent doesn't respond (tracking is memory-only, user must re-mention after restart).
- Document which behavior is implemented.

**ID:** TC-5.16
**Description:** Verify default behavior when config option is omitted entirely.
**Preconditions:**

- Agent running with `requireMention: true`.
- `thread.autoRespondWhenParticipating` is NOT in config (omitted, not set to false).
  **Steps:**

1. User @mentions agent, agent responds creating thread.
2. User replies in thread without @mention.
   **Expected Results:**

- Agent does NOT respond (default should be false/off for backward compatibility).

**ID:** TC-5.17
**Description:** Verify behavior with bot messages in participated threads.
**Preconditions:**

- Agent running with `thread.autoRespondWhenParticipating: true` and `allowBots: true`.
  **Steps:**

1. User @mentions agent, agent responds creating thread.
2. Another bot posts in the thread.
   **Expected Results:**

- Agent responds to bot message (consistent with allowBots setting).
- If `allowBots: false`, agent should NOT respond to bot messages even in participated threads.

**ID:** TC-5.18
**Description:** Verify thread_broadcast messages ("also send to channel") handling.
**Preconditions:**

- Agent running with `thread.autoRespondWhenParticipating: true`.
- Agent has participated in a thread.
  **Steps:**

1. User replies in thread with "Also send to channel" checked.
   **Expected Results:**

- Agent responds in thread (not in main channel).
- Response should stay in thread context regardless of broadcast.

**ID:** TC-5.19
**Description:** Verify tracking is per-channel (isolation).
**Preconditions:**

- Agent running in both #channel-a and #channel-b with `thread.autoRespondWhenParticipating: true`.
  **Steps:**

1. User @mentions agent in #channel-a, agent responds creating thread.
2. In #channel-b, user starts a thread without @mentioning agent.
3. User replies in #channel-b thread without @mention.
   **Expected Results:**

- Agent does NOT respond in #channel-b thread (participation in #channel-a doesn't affect #channel-b).

**ID:** TC-5.20
**Description:** Verify DM thread behavior (if applicable).
**Preconditions:**

- Agent running with DMs enabled.
- User sends a message that creates a threaded reply context in DM.
  **Steps:**

1. Test whether `autoRespondWhenParticipating` applies to DM threads or only channel threads.
   **Expected Results:**

- Document expected behavior: DMs typically don't require mention anyway, so this may be N/A.
