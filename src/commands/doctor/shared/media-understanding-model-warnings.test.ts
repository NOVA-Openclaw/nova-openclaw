// Tests for doctor warnings on media-understanding manifest model refs that cannot
// resolve against their own plugin's static model catalog. See nova-openclaw#183.
import { describe, expect, it, vi } from "vitest";
import type { PluginManifestRecord } from "../../../plugins/manifest-registry.js";

const { loadManifestMetadataSnapshotMock } = vi.hoisted(() => ({
  loadManifestMetadataSnapshotMock: vi.fn(),
}));

vi.mock("../../../plugins/manifest-contract-eligibility.js", () => ({
  loadManifestMetadataSnapshot: loadManifestMetadataSnapshotMock,
}));

const { collectMediaUnderstandingModelWarnings } =
  await import("./media-understanding-model-warnings.js");

function buildPlugin(overrides: Partial<PluginManifestRecord>): PluginManifestRecord {
  return {
    id: "virtual-plugin",
    channels: [],
    cliBackends: [],
    hooks: [],
    manifestPath: "/virtual/virtual-plugin/openclaw.plugin.json",
    origin: "bundled",
    providers: [],
    rootDir: "/virtual/virtual-plugin",
    skills: [],
    source: "/virtual/virtual-plugin/index.ts",
    ...overrides,
  };
}

describe("collectMediaUnderstandingModelWarnings", () => {
  it("warns when defaultModels.image does not match the plugin's own model catalog", () => {
    loadManifestMetadataSnapshotMock.mockReturnValue({
      plugins: [
        buildPlugin({
          id: "opencode",
          mediaUnderstandingProviderMetadata: {
            opencode: {
              capabilities: ["image"],
              defaultModels: { image: "gpt-5-nano" },
            },
          },
          modelCatalog: {
            providers: {
              opencode: {
                models: [{ id: "claude-opus-4-8", name: "Claude Opus 4.8" }],
              },
            },
          },
        }),
      ],
    });

    const warnings = collectMediaUnderstandingModelWarnings({});

    expect(warnings).toEqual([
      '- plugin "opencode" mediaUnderstandingProviderMetadata.opencode.defaultModels.image: "gpt-5-nano" does not match any model id in this plugin\'s own modelCatalog.providers.opencode.models. This will fail at runtime with "Unknown model: opencode/gpt-5-nano". Update the manifest default to a current model id.',
    ]);
  });

  it("does not warn when defaultModels.image matches the plugin's own model catalog", () => {
    loadManifestMetadataSnapshotMock.mockReturnValue({
      plugins: [
        buildPlugin({
          id: "moonshot",
          mediaUnderstandingProviderMetadata: {
            moonshot: {
              capabilities: ["image"],
              defaultModels: { image: "kimi-k2.6" },
            },
          },
          modelCatalog: {
            providers: {
              moonshot: {
                models: [{ id: "kimi-k2.6", name: "Kimi K2.6" }],
              },
            },
          },
        }),
      ],
    });

    expect(collectMediaUnderstandingModelWarnings({})).toEqual([]);
  });

  it("flags a malformed double-provider-prefix ref regardless of catalog availability", () => {
    loadManifestMetadataSnapshotMock.mockReturnValue({
      plugins: [
        buildPlugin({
          id: "openrouter",
          mediaUnderstandingProviderMetadata: {
            openrouter: {
              capabilities: ["image"],
              defaultModels: { image: "openrouter/openrouter/anthropic" },
            },
          },
        }),
      ],
    });

    const warnings = collectMediaUnderstandingModelWarnings({});

    expect(warnings).toEqual([
      '- plugin "openrouter" mediaUnderstandingProviderMetadata.openrouter.defaultModels.image: "openrouter/openrouter/anthropic" starts with a duplicated provider prefix ("openrouter/openrouter"). Fix the malformed model reference in the plugin manifest.',
    ]);
  });

  it("skips audio and video defaultModels — never present in the static chat/vision catalog", () => {
    loadManifestMetadataSnapshotMock.mockReturnValue({
      plugins: [
        buildPlugin({
          id: "openai",
          mediaUnderstandingProviderMetadata: {
            openai: {
              capabilities: ["image", "audio"],
              defaultModels: { image: "gpt-5.5", audio: "gpt-4o-transcribe" },
            },
          },
          modelCatalog: {
            providers: {
              openai: {
                // Catalog intentionally omits audio-only transcription models — this is
                // the real-world shape (Whisper/gpt-4o-transcribe never appear here).
                models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
              },
            },
          },
        }),
      ],
    });

    expect(collectMediaUnderstandingModelWarnings({})).toEqual([]);
  });

  it("skips validation entirely when the provider has no static modelCatalog", () => {
    loadManifestMetadataSnapshotMock.mockReturnValue({
      plugins: [
        buildPlugin({
          id: "minimax",
          mediaUnderstandingProviderMetadata: {
            minimax: {
              capabilities: ["image"],
              defaultModels: { image: "MiniMax-VL-01" },
              documentModels: { pdf: { textExtraction: "MiniMax-M2.7", image: false } },
            },
          },
          // No modelCatalog declared — minimax relies on live provider discovery.
        }),
      ],
    });

    expect(collectMediaUnderstandingModelWarnings({})).toEqual([]);
  });

  it("returns no warnings when there is no mediaUnderstandingProviderMetadata", () => {
    loadManifestMetadataSnapshotMock.mockReturnValue({
      plugins: [buildPlugin({ id: "lobster" })],
    });

    expect(collectMediaUnderstandingModelWarnings({})).toEqual([]);
  });
});
