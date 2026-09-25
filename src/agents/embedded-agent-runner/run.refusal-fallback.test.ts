// Runner-level proof that provider refusals fall back through a configured model chain.
// This test drives the real production entrypoint (runEmbeddedAgentEntry) so the wiring
// between the embedded run result and the model-fallback classifier is exercised exactly
// as production callers use it: run-entry.ts, compact.ts, and
// auto-reply/reply/agent-runner-fallback-candidate.ts.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawTestState } from "../../test-utils/openclaw-test-state.js";
import { makeAssistantMessageFixture } from "../test-helpers/assistant-message-fixtures.js";
import { createModelFallbackConfig } from "../test-helpers/model-fallback-config-fixture.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  mockedBuildEmbeddedRunPayloads,
  mockedGlobalHookRunner,
  mockedMarkAuthProfileFailure,
  mockedRunEmbeddedAttempt,
  createOverflowRunParams,
  resetSharedRunIntegrationHarnessMocks,
} from "./run.overflow-compaction.harness.js";
import { loadSharedRunIntegrationHarness } from "./run.shared-integration-harness.test-support.js";

let state: OpenClawTestState;
let runEmbeddedAgent: Awaited<ReturnType<typeof loadSharedRunIntegrationHarness>>;
let runEmbeddedAgentEntry: typeof import("./run-entry.js").runEmbeddedAgentEntry;

function refusalAttempt(provider: string, model: string, category: string) {
  const assistant = makeAssistantMessageFixture({
    api: "anthropic-messages",
    provider,
    model,
    stopReason: "error",
    errorCode: "provider_refusal",
    content: [],
    errorMessage: `The provider refused this request (category: ${category}).`,
    diagnostics: [{ type: "provider_refusal", timestamp: 1, details: { category } }],
  });
  return makeAttemptResult({
    assistantTexts: [],
    lastAssistant: assistant,
    currentAttemptAssistant: assistant,
    currentAttemptCompletedAssistant: assistant,
  });
}

function successAttempt(provider: string, model: string, text: string) {
  const assistant = makeAssistantMessageFixture({
    api: provider === "openai" ? "openai-responses" : "anthropic-messages",
    provider,
    model,
    stopReason: "stop",
    content: [{ type: "text", text }],
  });
  return makeAttemptResult({
    assistantTexts: [text],
    lastAssistant: assistant,
    currentAttemptAssistant: assistant,
    currentAttemptCompletedAssistant: assistant,
  });
}

async function runRefusalFallback(
  primary: string,
  fallbacks: string[],
  runId: string,
): Promise<{
  outcome: string;
  result: Awaited<ReturnType<typeof runEmbeddedAgent>>;
}> {
  const params = createOverflowRunParams(state);
  const [primaryProvider, primaryModel] = primary.split("/");
  const cfg = createModelFallbackConfig(primary, fallbacks);
  const entryResult = await runEmbeddedAgentEntry({
    selection: {
      cfg,
      provider: primaryProvider ?? "anthropic",
      model: primaryModel ?? "claude-opus-5",
    },
    identity: {
      runId,
      agentId: params.agentId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
    },
    harness: {
      workspaceDir: params.workspaceDir,
      preparation: { kind: "direct" },
      resolveRuntimeOverride: () => undefined,
    },
    behavior: { kind: "command-rpc", hasCommittedSideEffect: () => false },
    sessionOverride: { kind: "preserve" },
    runCandidate: async (provider, model, options) =>
      runEmbeddedAgent({
        ...params,
        provider,
        model,
        config: cfg,
        runId,
        assistantErrorTranscript: options.assistantErrorTranscript,
        allowTransientCooldownProbe: options.allowTransientCooldownProbe,
      }),
  });
  return { outcome: entryResult.outcome, result: entryResult.result };
}

describe("runEmbeddedAgent provider-refusal model fallback", () => {
  beforeAll(async () => {
    runEmbeddedAgent = await loadSharedRunIntegrationHarness();
    ({ runEmbeddedAgentEntry } = await import("./run-entry.js"));
  });

  beforeEach(async () => {
    resetSharedRunIntegrationHarnessMocks();
    const { createOpenClawTestState } = await import("../../test-utils/openclaw-test-state.js");
    state = await createOpenClawTestState({ label: "run.refusal-fallback" });
    mockedGlobalHookRunner.hasHooks.mockImplementation(() => false);
    // Use the real payload builder so refusal diagnostics surface as error payloads
    // and successful attempts surface as visible text payloads.
    const actualPayloads =
      await vi.importActual<typeof import("./run/payloads.js")>("./run/payloads.js");
    mockedBuildEmbeddedRunPayloads.mockImplementation(actualPayloads.buildEmbeddedRunPayloads);
  });

  afterEach(async () => {
    await state?.cleanup();
  });

  it("TC-212-2-INT-02: falls back to the next model on a non-cyber Anthropic refusal", async () => {
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(refusalAttempt("anthropic", "claude-opus-5", "violence"))
      .mockResolvedValueOnce(successAttempt("anthropic", "claude-sonnet-5", "Fallback succeeded."));

    const { outcome, result } = await runRefusalFallback(
      "anthropic/claude-opus-5",
      ["anthropic/claude-sonnet-5"],
      "run-refusal-fallback-int-02",
    );

    // Requirement: rung 1 refused, rung 2 attempted -> exactly 2 inner attempt calls.
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    // Requirement: final outcome is a successful completion from rung 2.
    expect(outcome).toBe("completed");
    // Derivation: successAttempt content is "Fallback succeeded."; real payload builder
    // projects visible assistant text into a payload with the same text.
    expect(result.payloads?.some((payload) => payload.text === "Fallback succeeded.")).toBe(true);
    // Derivation: a successful completion must not carry a terminal error.
    expect(result.meta.error).toBeUndefined();
    // Requirement: refusal must not rotate or cooldown rung 1's auth profile.
    expect(mockedMarkAuthProfileFailure).not.toHaveBeenCalled();
  });

  it("TC-212-2-INT-03: exhausts the chain and surfaces the last rung's refusal", async () => {
    mockedRunEmbeddedAttempt
      .mockResolvedValueOnce(refusalAttempt("anthropic", "claude-opus-5", "violence"))
      .mockResolvedValueOnce(refusalAttempt("anthropic", "claude-sonnet-5", "hate"));

    const { outcome, result } = await runRefusalFallback(
      "anthropic/claude-opus-5",
      ["anthropic/claude-sonnet-5"],
      "run-refusal-fallback-int-03",
    );

    // Requirement: exactly one attempt per configured rung, no repeats, no infinite loop.
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
    // Requirement: exhaustion surfaces the LAST rung's refusal text (category: hate).
    expect(outcome).toBe("exhausted");
    // Derivation: refusalAttempt diagnostics carry category "hate"; real payload builder
    // formats provider refusal diagnostics into an error payload containing the category.
    expect(result.payloads?.[0]).toMatchObject({
      isError: true,
      text: expect.stringContaining("hate"),
    });
  });
});
