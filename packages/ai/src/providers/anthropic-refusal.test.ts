import { describe, expect, it } from "vitest";
import { applyAnthropicRefusal } from "./anthropic-refusal.js";

describe("applyAnthropicRefusal", () => {
  it("TC-212-2-U-02: sets errorCode=provider_refusal so the failover classifier can see the refusal", () => {
    const output = {
      stopReason: "stop" as const,
      diagnostics: [] as { type: string; timestamp: number; details: Record<string, unknown> }[],
    };

    applyAnthropicRefusal(
      output,
      { category: "violence", explanation: "harmful content" },
      "anthropic",
    );

    expect(output.stopReason).toBe("error");
    expect(output.errorCode).toBe("provider_refusal");
    expect(output.errorMessage).toBe("Anthropic refusal (category: violence): harmful content");
    expect(output.diagnostics).toHaveLength(1);
    expect(output.diagnostics[0]).toMatchObject({
      type: "provider_refusal",
      details: {
        provider: "anthropic",
        category: "violence",
        explanation: "harmful content",
      },
    });
    expect(typeof output.diagnostics[0].timestamp).toBe("number");
  });

  it("TC-212-2-U-03: normalizes adversarial stopDetails without throwing and still produces a classifiable refusal", () => {
    const cases = [
      {
        label: "cyber refusal",
        stopDetails: { category: "cyber", explanation: "unsafe code" },
        expectedMessage: "Anthropic refusal (category: cyber): unsafe code",
      },
      {
        label: "null category/explanation",
        stopDetails: { category: null, explanation: null },
        expectedMessage: "Anthropic refusal.",
      },
      {
        label: "undefined stopDetails",
        stopDetails: undefined,
        expectedMessage: "Anthropic refusal.",
      },
      {
        label: "non-object stopDetails",
        stopDetails: "not an object",
        expectedMessage: "Anthropic refusal.",
      },
    ] as const;

    for (const { label, stopDetails, expectedMessage } of cases) {
      const output = {
        stopReason: "stop" as const,
        diagnostics: [] as { type: string; timestamp: number; details: Record<string, unknown> }[],
      };

      applyAnthropicRefusal(output, stopDetails as unknown, "anthropic");

      expect(output.stopReason, label).toBe("error");
      expect(output.errorCode, label).toBe("provider_refusal");
      expect(output.errorMessage, label).toBe(expectedMessage);
      expect(output.diagnostics, label).toHaveLength(1);
      expect(output.diagnostics[0].type, label).toBe("provider_refusal");
    }
  });
});
