import { logWarn } from "../logger.js";
import { resolveFailoverReasonFromError, describeFailoverError } from "./failover-error.js";
import { type FailoverReason } from "./pi-embedded-helpers.js";

export type RetryableError = {
  error: unknown;
  reason: FailoverReason;
  retryable: boolean;
  attempt: number;
};

/**
 * Determines if an error should trigger a retry based on error type.
 *
 * Retry on: rate limits (429), timeouts, transient errors
 * Immediate fail on: auth errors (401/403), invalid input (400)
 */
export function isRetryableError(err: unknown): boolean {
  const reason = resolveFailoverReasonFromError(err);

  if (!reason) {
    return false;
  }

  // Retry on rate limits and timeouts
  if (reason === "rate_limit" || reason === "timeout") {
    return true;
  }

  // Don't retry on auth, billing, or format errors
  if (reason === "auth" || reason === "billing" || reason === "format") {
    return false;
  }

  // For other errors, check if they look transient
  return isTransientError(err);
}

/**
 * Checks if an error appears to be transient (network issues, etc.)
 */
function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") {
    const transientCodes = [
      "ECONNRESET",
      "ECONNABORTED",
      "EPIPE",
      "ENOTFOUND",
      "ENETUNREACH",
      "EAI_AGAIN",
    ];
    if (transientCodes.includes(code.toUpperCase())) {
      return true;
    }
  }

  const message = err instanceof Error ? err.message : String(err);
  const transientPatterns = [
    /connection reset/i,
    /socket hang up/i,
    /network error/i,
    /temporary failure/i,
    /service unavailable/i,
    /bad gateway/i,
  ];

  return transientPatterns.some((pattern) => pattern.test(message));
}

/**
 * Calculates exponential backoff delay.
 * Default: 1000ms, doubles each retry.
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs: number = 1000): number {
  // Exponential backoff: baseDelay * 2^attempt
  const delay = baseDelayMs * Math.pow(2, attempt);
  // Cap at 30 seconds to avoid excessive waits
  return Math.min(delay, 30000);
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryConfig = {
  /** Number of retries (default: 3) */
  retryCount?: number;
  /** Base retry delay in milliseconds (default: 1000, doubles each retry) */
  retryDelayMs?: number;
};

export type RetryAttempt = {
  attempt: number;
  error: string;
  reason?: FailoverReason;
  delayMs?: number;
};

/**
 * Retries a function with exponential backoff on retryable errors.
 *
 * @param fn - Function to retry
 * @param config - Retry configuration
 * @param onRetry - Optional callback for each retry attempt
 * @returns Result of successful execution
 * @throws Last error if all retries fail
 */
export async function runWithRetry<T>(params: {
  fn: () => Promise<T>;
  config?: RetryConfig;
  provider?: string;
  model?: string;
  onRetry?: (attempt: RetryAttempt) => void | Promise<void>;
}): Promise<{ result: T; attempts: RetryAttempt[] }> {
  const retryCount = params.config?.retryCount ?? 3;
  const baseDelayMs = params.config?.retryDelayMs ?? 1000;
  const attempts: RetryAttempt[] = [];
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const result = await params.fn();
      return { result, attempts };
    } catch (err) {
      lastError = err;

      // Check if we should retry
      const shouldRetry = isRetryableError(err);
      const isLastAttempt = attempt >= retryCount;

      if (!shouldRetry || isLastAttempt) {
        // Don't retry, throw the error
        throw err;
      }

      // Calculate backoff delay
      const delayMs = calculateBackoffDelay(attempt, baseDelayMs);

      // Record the attempt
      const described = describeFailoverError(err);
      const attemptRecord: RetryAttempt = {
        attempt: attempt + 1,
        error: described.message,
        reason: described.reason,
        delayMs,
      };
      attempts.push(attemptRecord);

      // Log retry attempt
      const modelLabel =
        params.provider && params.model ? `${params.provider}/${params.model}` : "model";
      logWarn(
        `Retry attempt ${attempt + 1}/${retryCount} for ${modelLabel}: ${described.message} ` +
          `(reason: ${described.reason ?? "unknown"}, delay: ${delayMs}ms)`,
      );

      // Notify caller of retry
      await params.onRetry?.(attemptRecord);

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError;
}
