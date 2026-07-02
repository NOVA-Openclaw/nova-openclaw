// Covers Anthropic refusal normalization and failover signal shaping.
import { describe, expect, it } from "vitest";
import { applyAnthropicRefusal } from "./anthropic-refusal.js";

describe("applyAnthropicRefusal", () => {
  it("sets stopReason=error, errorCode=provider_refusal, and a readable message", () => {
    const output = { stopReason: "stop" } as {
      stopReason: string;
      errorMessage?: string;
      errorCode?: string;
      diagnostics?: unknown[];
    };

    applyAnthropicRefusal(
      output,
      { category: "bio", explanation: "Contains unsafe biological content" },
      "anthropic",
    );

    expect(output.stopReason).toBe("error");
    expect(output.errorCode).toBe("provider_refusal");
    expect(output.errorMessage).toMatch(
      /Anthropic refusal \(category: bio\): Contains unsafe biological content/,
    );
    expect(output.diagnostics).toEqual([
      {
        type: "provider_refusal",
        timestamp: expect.any(Number),
        details: {
          provider: "anthropic",
          category: "bio",
          explanation: "Contains unsafe biological content",
        },
      },
    ]);
  });

  it("preserves existing diagnostics", () => {
    const output = {
      stopReason: "stop",
      diagnostics: [{ type: "existing" }],
    } as {
      stopReason: string;
      errorMessage?: string;
      errorCode?: string;
      diagnostics?: unknown[];
    };

    applyAnthropicRefusal(output, { category: "legal" }, "anthropic");

    expect(output.diagnostics).toHaveLength(2);
    expect(output.diagnostics?.[0]).toEqual({ type: "existing" });
    expect(output.diagnostics?.[1]).toMatchObject({ type: "provider_refusal" });
  });
});
