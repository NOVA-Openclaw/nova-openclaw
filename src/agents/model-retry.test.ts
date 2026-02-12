import { describe, it, expect, vi } from "vitest";
import { FailoverError } from "./failover-error.js";
import { runWithRetry, isRetryableError, calculateBackoffDelay } from "./model-retry.js";

describe("model-retry", () => {
  describe("isRetryableError", () => {
    it("should retry on rate limit errors", () => {
      const err = new FailoverError("Rate limited", {
        reason: "rate_limit",
        status: 429,
      });
      expect(isRetryableError(err)).toBe(true);
    });

    it("should retry on timeout errors", () => {
      const err = new FailoverError("Request timed out", {
        reason: "timeout",
        status: 408,
      });
      expect(isRetryableError(err)).toBe(true);
    });

    it("should not retry on auth errors", () => {
      const err = new FailoverError("Unauthorized", {
        reason: "auth",
        status: 401,
      });
      expect(isRetryableError(err)).toBe(false);
    });

    it("should not retry on billing errors", () => {
      const err = new FailoverError("Payment required", {
        reason: "billing",
        status: 402,
      });
      expect(isRetryableError(err)).toBe(false);
    });

    it("should not retry on format errors", () => {
      const err = new FailoverError("Invalid request format", {
        reason: "format",
        status: 400,
      });
      expect(isRetryableError(err)).toBe(false);
    });

    it("should retry on transient network errors", () => {
      const err = new Error("connection reset");
      (err as { code?: string }).code = "ECONNRESET";
      expect(isRetryableError(err)).toBe(true);
    });
  });

  describe("calculateBackoffDelay", () => {
    it("should calculate exponential backoff correctly", () => {
      expect(calculateBackoffDelay(0, 1000)).toBe(1000);
      expect(calculateBackoffDelay(1, 1000)).toBe(2000);
      expect(calculateBackoffDelay(2, 1000)).toBe(4000);
      expect(calculateBackoffDelay(3, 1000)).toBe(8000);
    });

    it("should cap at 30 seconds", () => {
      expect(calculateBackoffDelay(10, 1000)).toBe(30000);
    });
  });

  describe("runWithRetry", () => {
    it("should succeed on first attempt without retrying", async () => {
      const mockFn = vi.fn().mockResolvedValue("success");
      const result = await runWithRetry({ fn: mockFn });

      expect(result.result).toBe("success");
      expect(result.attempts).toHaveLength(0);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should retry on retryable error and succeed", async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(
          new FailoverError("Rate limited", {
            reason: "rate_limit",
            status: 429,
          }),
        )
        .mockResolvedValueOnce("success");

      const onRetry = vi.fn();
      const result = await runWithRetry({
        fn: mockFn,
        config: { retryCount: 3, retryDelayMs: 10 },
        onRetry,
      });

      expect(result.result).toBe("success");
      expect(result.attempts).toHaveLength(1);
      expect(mockFn).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("should not retry on non-retryable error", async () => {
      const authError = new FailoverError("Unauthorized", {
        reason: "auth",
        status: 401,
      });
      const mockFn = vi.fn().mockRejectedValue(authError);

      await expect(runWithRetry({ fn: mockFn })).rejects.toThrow("Unauthorized");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should exhaust retries and throw last error", async () => {
      const rateLimitError = new FailoverError("Rate limited", {
        reason: "rate_limit",
        status: 429,
      });
      const mockFn = vi.fn().mockRejectedValue(rateLimitError);

      await expect(
        runWithRetry({
          fn: mockFn,
          config: { retryCount: 2, retryDelayMs: 10 },
        }),
      ).rejects.toThrow("Rate limited");

      // 1 initial + 2 retries = 3 total attempts
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it("should call onRetry callback for each retry", async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new FailoverError("Timeout", { reason: "timeout" }))
        .mockRejectedValueOnce(new FailoverError("Timeout", { reason: "timeout" }))
        .mockResolvedValueOnce("success");

      const onRetry = vi.fn();
      await runWithRetry({
        fn: mockFn,
        config: { retryCount: 3, retryDelayMs: 10 },
        provider: "test-provider",
        model: "test-model",
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          reason: "timeout",
        }),
      );
    });
  });
});
