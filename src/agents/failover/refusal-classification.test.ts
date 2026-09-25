import type { AssistantMessage } from "@openclaw/llm-core/types";
import { describe, expect, it } from "vitest";
import { isTerminalAssistantError } from "../../llm/utils/retry.js";
import { classifyAssistantFailoverReason } from "../embedded-agent-helpers/assistant-message-failures.js";
import { classifyFailoverReasonFromCode } from "./classification-rules.js";

function makeRefusalFixture(extra: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "messages",
    provider: "anthropic",
    model: "claude-opus-5",
    usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
    timestamp: 1,
    stopReason: "error",
    errorCode: "provider_refusal",
    errorMessage: "Anthropic refusal (category: violence): harmful content",
    diagnostics: [
      {
        type: "provider_refusal",
        timestamp: 1,
        details: { provider: "anthropic", category: "violence" },
      },
    ],
    ...extra,
  };
}

describe("refusal classification", () => {
  describe("TC-212-2-U-08: classifyFailoverReasonFromCode", () => {
    it('maps "PROVIDER_REFUSAL" to "refusal"', () => {
      expect(classifyFailoverReasonFromCode("PROVIDER_REFUSAL")).toBe("refusal");
    });

    it("normalizes lowercase input to uppercase before matching", () => {
      expect(classifyFailoverReasonFromCode("provider_refusal")).toBe("refusal");
    });
  });

  describe("TC-212-2-U-09: classifyFailoverReasonFromCode falsy input guard", () => {
    it.each([
      { label: "undefined", input: undefined },
      { label: "empty string", input: "" },
      { label: "whitespace", input: "   " },
    ])("returns null for $label", ({ input }) => {
      expect(classifyFailoverReasonFromCode(input)).toBeNull();
    });
  });

  describe("TC-212-2-INT-01: classifyAssistantFailoverReason seam", () => {
    it("classifies a provider_refusal AssistantMessage as 'refusal' through the real production path", () => {
      const reason = classifyAssistantFailoverReason(makeRefusalFixture());
      expect(reason).toBe("refusal");
    });
  });

  describe("TC-212-2-U-11: refusal is terminal for retry but not for failover", () => {
    it("classifies a refusal despite isTerminalAssistantError being true for the same message", () => {
      const fixture = makeRefusalFixture();
      expect(isTerminalAssistantError(fixture)).toBe(true);
      expect(classifyAssistantFailoverReason(fixture)).toBe("refusal");
    });
  });
});
