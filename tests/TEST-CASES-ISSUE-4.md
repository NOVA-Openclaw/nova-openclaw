## Test Cases for Auto-Retry and Fallback (Issue #4)

**Status:** NOVA Reviewed ✓  
**Review Date:** 2026-02-12  
**Reviewer Notes:**

- Good coverage of retry/fallback scenarios
- TC7 should specify: rate limits (429) = retry, auth errors (401/403) = immediate fail
- Consider adding: max total timeout across all retries
- Implementation location: likely in model request layer or sessions_spawn

**Objective:** Verify the auto-retry and fallback mechanism for model errors.

### 1. Happy Path: Model Succeeds on First Try

- **Description:** The primary model successfully processes the input on the first attempt.
- **Steps:**
  1.  Provide a valid input to the primary model.
  2.  Verify that the model returns a successful response.
  3.  Verify that no retry or fallback attempts are made.
- **Expected Result:** The model returns a successful response without any retries or fallbacks.

### 2. Retry Success: Model Fails Once, Succeeds on Retry

- **Description:** The primary model fails on the first attempt due to a transient error, but succeeds on a subsequent retry.
- **Steps:**
  1.  Configure the primary model to simulate a transient failure on the first attempt (e.g., connection timeout).
  2.  Provide a valid input to the primary model.
  3.  Verify that the model retries the request automatically.
  4.  Verify that the model succeeds on a retry attempt.
- **Expected Result:** The model retries the request after the initial failure and returns a successful response after a retry.

### 3. Fallback Success: Primary Model Fails All Retries, Fallback Succeeds

- **Description:** The primary model fails after all retry attempts, and the fallback model successfully processes the input.
- **Steps:**
  1.  Configure the primary model to simulate persistent failures (e.g., invalid input format).
  2.  Provide a valid input to the primary model.
  3.  Verify that the model retries the request the configured number of times.
  4.  Verify that the model triggers the fallback mechanism after all retries fail.
  5.  Verify that the fallback model successfully processes the input.
- **Expected Result:** The primary model fails after all retries, the fallback mechanism is triggered, and the fallback model returns a successful response.

### 4. Complete Failure: Both Models Fail, Alert Triggered

- **Description:** Both the primary model and the fallback model fail to process the input.
- **Steps:**
  1.  Configure both the primary and fallback models to simulate persistent failures.
  2.  Provide a valid input to the primary model.
  3.  Verify that the primary model retries the request the configured number of times.
  4.  Verify that the model triggers the fallback mechanism after all retries fail.
  5.  Verify that the fallback model also fails.
  6.  Verify that an alert is triggered to notify the user of the complete failure.
- **Expected Result:** Both models fail, and an alert is triggered.

### 5. No Fallback Configured: Primary Fails, No Fallback Available

- **Description:** The primary model fails, but no fallback model is configured.
- **Steps:**
  1.  Configure the system without a fallback model.
  2.  Configure the primary model to simulate persistent failures.
  3.  Provide a valid input to the primary model.
  4.  Verify that the primary model retries the request the configured number of times.
  5.  Verify that an error is returned indicating no fallback is available.
- **Expected Result:** The primary model fails, and an error is returned indicating no fallback is available.

### 6. Exponential Backoff Timing Verification

- **Description:** Verify the exponential backoff timing between retry attempts.
- **Steps:**
  1.  Configure the retry mechanism with exponential backoff.
  2.  Configure the primary model to simulate a transient failure.
  3.  Provide a valid input to the primary model.
  4.  Monitor the time between each retry attempt.
  5.  Verify that the time between retries increases exponentially.
- **Expected Result:** The time between retries increases exponentially according to the configured backoff parameters.

### 7. Error Types that Should Trigger Retry vs Immediate Fail

- **Description:** Verify that specific error types trigger a retry, while others cause immediate failure.
- **Steps:**
  1.  Configure the system to retry on specific error types (e.g., connection timeouts, rate limiting).
  2.  Configure the system to immediately fail on other error types (e.g., invalid input format, unauthorized access).
  3.  Provide input that triggers a retryable error.
  4.  Verify that the model retries the request.
  5.  Provide input that triggers a non-retryable error.
  6.  Verify that the model immediately fails.
- **Expected Result:** The model retries on retryable errors and immediately fails on non-retryable errors.

### 8. Logging of Retry/Fallback Attempts

- **Description:** Verify that all retry and fallback attempts are properly logged.
- **Steps:**
  1.  Configure the logging system to capture retry and fallback events.
  2.  Configure the primary model to simulate failures and trigger retries and/or fallbacks.
  3.  Provide a valid input to the primary model.
  4.  Analyze the logs.
  5.  Verify that each retry attempt, the reason for the retry, the fallback attempt (if any), and the final result are logged.
- **Expected Result:** All retry and fallback attempts are logged with relevant information (timestamp, error message, model used, etc.).
