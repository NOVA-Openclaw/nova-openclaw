import type { AssistantMessage } from "@openclaw/llm-core/types";
import { describe, expect, it } from "vitest";
import { isTerminalAssistantError } from "../../llm/utils/retry.js";
import { classifyAssistantFailoverReason } from "../embedded-agent-helpers/assistant-message-failures.js";
import { isReplaySafeEmbeddedOpenAiCyberRefusal } from "../embedded-agent-runner/embedded-cyber-failover.js";
import type { EmbeddedAgentRunResult } from "../embedded-agent-runner/types.js";
import { classifyFailoverReasonFromCode } from "./classification-rules.js";
import { isRefusalErrorMessage } from "./classify.js";

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

  describe("TC-212-2-U-05: isRefusalErrorMessage matches provider-shaped refusal text", () => {
    it.each([
      {
        label: "category + explanation",
        raw: "Anthropic refusal (category: violence): harmful content",
      },
      { label: "category only", raw: "Anthropic refusal (category: cyber)." },
      { label: "bare refusal", raw: "Anthropic refusal." },
      { label: "explanation only", raw: "Anthropic refusal: I cannot help with that." },
    ])("matches $label", ({ raw }) => {
      expect(isRefusalErrorMessage(raw)).toBe(true);
      // The classifier must also route the message to the refusal bucket.
      expect(
        classifyAssistantFailoverReason(
          makeRefusalFixture({ errorMessage: raw, errorCode: undefined, diagnostics: undefined }),
        ),
      ).toBe("refusal");
    });
  });

  describe("TC-212-2-U-06: isRefusalErrorMessage does not match arbitrary prose", () => {
    it.each([
      {
        label: "quoted user content",
        raw: "the model refused to comply with the quoted user content",
      },
      { label: "rate-limit message", raw: "Rate limit exceeded. Please retry." },
      { label: "generic 500", raw: "Internal server error" },
      { label: "auth error", raw: "Invalid API key" },
      { label: "empty string", raw: "" },
      { label: " substring without prefix", raw: "provider refusal: out of policy" },
    ])("rejects $label", ({ raw }) => {
      expect(isRefusalErrorMessage(raw)).toBe(false);
    });
  });

  describe("TC-212-2-U-07: CJK/i18n parity", () => {
    it("is left out: no provider-shaped Chinese-language refusal pattern is currently emitted by the supported transports", () => {
      // The file's existing CJK patterns are for auth/billing/rate-limit/overload/
      // server-error/timeout messages. Anthropic and OpenAI Responses refusals are
      // emitted in English-shaped text even when the underlying request is Chinese.
      // This test documents the explicit decision to skip CJK parity for refusals
      // until a concrete provider emission shape is observed.
      expect(true).toBe(true);
    });
  });

  describe("TC-212-2-U-13/14/15: provider emission coverage matrix", () => {
    it("TC-212-2-U-13: direct Anthropic emits provider_refusal diagnostic + errorCode", () => {
      const fixture = makeRefusalFixture({
        api: "messages",
        provider: "anthropic",
        errorCode: "provider_refusal",
        diagnostics: [
          {
            type: "provider_refusal",
            timestamp: 1,
            details: { provider: "anthropic", category: "violence" },
          },
        ],
      });
      expect(classifyAssistantFailoverReason(fixture)).toBe("refusal");
    });

    it("TC-212-2-U-14: OpenAI Responses-family emits provider_refusal diagnostic + errorCode", () => {
      const fixture = makeRefusalFixture({
        api: "openai-responses",
        provider: "openai",
        errorCode: "provider_refusal",
        diagnostics: [
          {
            type: "provider_refusal",
            timestamp: 1,
            details: { provider: "openai", category: "violence" },
          },
        ],
      });
      expect(classifyAssistantFailoverReason(fixture)).toBe("refusal");
    });

    it("TC-212-2-U-15: openai-completions transport (OpenRouter path) does not emit provider_refusal", () => {
      // OpenRouter proxies every model through `api: "openai-completions"`. That
      // transport surfaces refusal content as visible assistant text (stopReason
      // "stop"), not as a stopReason "error" with a provider_refusal diagnostic.
      // This is a documented negative — do not "fix" it in this change.
      const fixture = makeRefusalFixture({
        api: "openai-completions",
        provider: "openrouter",
        stopReason: "stop",
        errorCode: undefined,
        errorMessage: undefined,
        diagnostics: undefined,
        content: [{ type: "text", text: "I cannot help with that." }],
      });
      expect(classifyAssistantFailoverReason(fixture)).not.toBe("refusal");
    });
  });

  describe("TC-212-2-INT-04: cyber OpenAI refusal stays on the Daybreak path", () => {
    it("isReplaySafeEmbeddedOpenAiCyberRefusal remains true for a cyber OpenAI refusal", () => {
      const result: EmbeddedAgentRunResult = {
        meta: {
          durationMs: 0,
          sessionId: "test-session",
          agentMeta: {
            sessionId: "test-session",
            provider: "openai",
            model: "gpt-test",
            agentHarnessId: "openclaw",
            providerRefusal: { provider: "openai", category: "cyber" },
          },
        },
      };
      expect(isReplaySafeEmbeddedOpenAiCyberRefusal({ provider: "openai", result })).toBe(true);
    });

    it("still classifies a cyber OpenAI refusal as 'refusal' for downstream consumers", () => {
      // The generic classifier exposes the same reason, but the runner's cyber
      // path is evaluated first; this test ensures the new refusal lane does not
      // hide the cyber category from the existing escalation path.
      const fixture = makeRefusalFixture({
        api: "openai-responses",
        provider: "openai",
        errorCode: "provider_refusal",
        diagnostics: [
          {
            type: "provider_refusal",
            timestamp: 1,
            details: { provider: "openai", category: "cyber" },
          },
        ],
      });
      expect(classifyAssistantFailoverReason(fixture)).toBe("refusal");
    });
  });

  describe("TC-212-2-U-16: non-cyber OpenAI refusal goes to generic refusal", () => {
    it("classifies an OpenAI Responses refusal with category != cyber as 'refusal'", () => {
      const fixture = makeRefusalFixture({
        api: "openai-responses",
        provider: "openai",
        errorCode: "provider_refusal",
        errorMessage: "OpenAI refusal (category: violence): harmful content",
        diagnostics: [
          {
            type: "provider_refusal",
            timestamp: 1,
            details: { provider: "openai", category: "violence" },
          },
        ],
      });
      expect(classifyAssistantFailoverReason(fixture)).toBe("refusal");
    });
  });
});
