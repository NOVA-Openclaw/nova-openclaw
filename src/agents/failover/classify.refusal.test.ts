import { describe, expect, it } from "vitest";
import { classifyFailoverSignal } from "./classify.js";

describe("TC-A3/A7: provider refusal classification", () => {
  it.each([
    { code: "provider_refusal", status: 401, expected: "refusal" },
    { code: "provider_refusal", status: 403, expected: "refusal" },
    { code: "provider_refusal", status: 429, expected: "refusal" },
    { code: "provider_refusal", status: 500, expected: "refusal" },
    { code: "provider_refusal", status: undefined, expected: "refusal" },
  ])(
    "classifies errorCode=$code ahead of HTTP status $status as '$expected'",
    ({ code, status, expected }) => {
      expect(
        classifyFailoverSignal(
          {
            provider: "openai",
            status,
            code,
            message: "Provider refused the request",
          },
          { providerPlugin: null },
        ),
      ).toEqual({ kind: "reason", reason: expected });
    },
  );

  it("does not classify a non-refusal code as refusal even when the message says refusal", () => {
    expect(
      classifyFailoverSignal(
        {
          provider: "openai",
          status: 403,
          code: "invalid_auth",
          message: "Provider refused the request",
        },
        { providerPlugin: null },
      ),
    ).toEqual({ kind: "reason", reason: "auth" });
  });
});
