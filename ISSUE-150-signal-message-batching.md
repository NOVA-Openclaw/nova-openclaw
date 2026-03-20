# Issue #150: Signal Channel Handler Batches Messages Instead of Delivering Individually

## Problem

When the agent sends multiple messages during a work session (e.g., status updates, responses to queued messages, task completions), the Signal channel handler does not deliver them to the user in real-time as they are generated. Instead, all messages are held and delivered as a single large batch once the agent pauses or completes its current work.

## Expected Behavior

Each message should be delivered to the user's Signal client individually and in real-time as the agent generates and sends it, with only natural processing delays (not artificially batched).

## Actual Behavior

Messages accumulate during agent activity and are dumped to the user all at once when the agent becomes idle. This creates a poor user experience:

- User has no visibility into what the agent is doing in real-time
- Large walls of text arrive simultaneously, making it hard to read or respond to individual items
- Time-sensitive information (like "shall I proceed?") arrives too late to be actionable
- Makes interactive back-and-forth conversation feel broken

## Investigation Steps (before any code changes)

1. **Check Signal channel configuration** — Review `openclaw.json` Signal channel settings for any debounce, batch, queue, or rate-limit parameters that could explain the behavior
2. **Check OpenClaw global delivery settings** — Look for outbound queue/batch config at the gateway level
3. **Compare with other channels** — Does Telegram or other channels exhibit the same batching? If not, what differs in their config?
4. **Only after config options are exhausted** should we investigate the Signal channel handler code

## Possible Causes

- **Configuration:** Signal channel config may have debounce/batch settings enabled
- Signal outbound handler may be using a queue with a flush-on-idle strategy instead of immediate dispatch
- Rate limiting or debounce logic may be too aggressive
- The delivery pipeline may be waiting for the agent's full turn to complete before flushing outbound messages
- Signal's own rate limits may be triggering batching behavior in the send service

## Acceptance Criteria

- [ ] Individual messages are delivered to Signal as they are generated, not batched
- [ ] If rate limiting is necessary (Signal API limits), messages should still be sent as soon as the rate window allows, not held until the agent is idle
- [ ] User receives real-time feedback during long agent work sessions
- [ ] No regression in message ordering or delivery reliability
