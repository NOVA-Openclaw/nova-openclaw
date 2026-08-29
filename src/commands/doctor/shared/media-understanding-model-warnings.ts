// Doctor warnings for media-understanding provider manifest model references that
// cannot resolve against that same plugin's own static model catalog.
//
// Media-understanding defaults (`defaultModels`, `documentModels`) are plain strings
// declared in each plugin's `openclaw.plugin.json`. Nothing validates them against the
// provider's own catalog at manifest-author time, so a renamed/retired model id (version
// drift) or a malformed ref (e.g. an accidental double `openrouter/` prefix) silently
// breaks the `pdf`/`image` tools at runtime with "Unknown model" instead of failing fast
// at doctor/CI time. See nova-openclaw#183.
import type { OpenClawConfig } from "../../../config/types.openclaw.js";
import { loadManifestMetadataSnapshot } from "../../../plugins/manifest-contract-eligibility.js";
import type {
  PluginManifestMediaUnderstandingProviderMetadata,
  PluginManifestModelCatalog,
} from "../../../plugins/manifest.js";

type DocumentModelsPdf = PluginManifestMediaUnderstandingProviderMetadata["documentModels"] extends
  | Partial<Record<"pdf", infer V>>
  | undefined
  ? V
  : never;

// The static `modelCatalog.providers[id].models[]` list only ever declares chat/completion
// models (input includes "text"/"image"). Audio-transcription and video-description models
// (Whisper, gpt-4o-transcribe, Voxtral, etc.) are never present there — verified against every
// bundled plugin manifest — so validating `audio`/`video` defaults against this catalog would
// be a systematic false positive, not a real defect. Only `image` capability is checkable here.
const CATALOG_CHECKABLE_CAPABILITIES = new Set(["image"]);

function collectCandidateRefs(params: {
  pluginId: string;
  providerId: string;
  metadata: PluginManifestMediaUnderstandingProviderMetadata;
}): Array<{ field: string; value: string; catalogCheckable: boolean }> {
  const refs: Array<{ field: string; value: string; catalogCheckable: boolean }> = [];
  for (const [capability, modelId] of Object.entries(params.metadata.defaultModels ?? {})) {
    if (typeof modelId === "string" && modelId.trim()) {
      refs.push({
        field: `defaultModels.${capability}`,
        value: modelId.trim(),
        catalogCheckable: CATALOG_CHECKABLE_CAPABILITIES.has(capability),
      });
    }
  }
  const pdfDocumentModels: DocumentModelsPdf | undefined = params.metadata.documentModels?.pdf;
  if (pdfDocumentModels) {
    for (const [mode, modelId] of Object.entries(pdfDocumentModels)) {
      // `false` is a valid, explicit "unsupported" marker — not a model reference.
      if (typeof modelId === "string" && modelId.trim()) {
        refs.push({
          field: `documentModels.pdf.${mode}`,
          value: modelId.trim(),
          // "image" mode is a chat/vision model and catalog-checkable; "textExtraction" models
          // (e.g. MiniMax-M2.7) are plain completion models that may also be absent from a
          // vision-scoped catalog view, so only check the image mode here.
          catalogCheckable: mode === "image",
        });
      }
    }
  }
  return refs;
}

/** Detects structurally malformed model refs regardless of catalog availability. */
function detectMalformedRef(value: string): string | undefined {
  if (value.includes("//")) {
    return "contains an empty path segment (double slash)";
  }
  const segments = value.split("/");
  if (segments.length >= 2 && segments[0] === segments[1]) {
    return `starts with a duplicated provider prefix ("${segments[0]}/${segments[1]}")`;
  }
  if (segments.at(-1)?.trim() === "") {
    return "ends with a trailing slash (truncated model id)";
  }
  return undefined;
}

function resolveLocalModelId(providerId: string, modelId: string): string {
  const slash = modelId.indexOf("/");
  if (slash > 0 && modelId.slice(0, slash).trim() === providerId) {
    return modelId.slice(slash + 1).trim();
  }
  return modelId.trim();
}

function findCatalogModelIds(
  catalog: PluginManifestModelCatalog | undefined,
  providerId: string,
): Set<string> | undefined {
  const provider = catalog?.providers?.[providerId];
  if (!provider) {
    return undefined;
  }
  return new Set(
    (provider.models ?? [])
      .map((model) => model.id?.trim())
      .filter((id): id is string => Boolean(id)),
  );
}

/** Collects doctor warnings for media-understanding default/document model refs that
 * either look structurally malformed, or fail to resolve against the owning plugin's
 * own statically-declared model catalog (when one is present). */
export function collectMediaUnderstandingModelWarnings(params: {
  cfg?: OpenClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const warnings: string[] = [];
  const snapshot = loadManifestMetadataSnapshot({
    config: params.cfg,
    env: params.env,
    ...(params.workspaceDir ? { workspaceDir: params.workspaceDir } : {}),
  });

  for (const plugin of snapshot.plugins) {
    const providerMetadata = plugin.mediaUnderstandingProviderMetadata;
    if (!providerMetadata) {
      continue;
    }
    for (const [providerId, metadata] of Object.entries(providerMetadata)) {
      const refs = collectCandidateRefs({ pluginId: plugin.id, providerId, metadata });
      if (refs.length === 0) {
        continue;
      }
      const catalogModelIds = findCatalogModelIds(plugin.modelCatalog, providerId);
      for (const ref of refs) {
        const malformedReason = detectMalformedRef(ref.value);
        if (malformedReason) {
          warnings.push(
            `- plugin "${plugin.id}" mediaUnderstandingProviderMetadata.${providerId}.${ref.field}: ` +
              `"${ref.value}" ${malformedReason}. Fix the malformed model reference in the plugin manifest.`,
          );
          continue;
        }
        if (!ref.catalogCheckable || !catalogModelIds) {
          // Either this capability/mode is never represented in the static catalog (audio,
          // video, textExtraction), or the provider has no static modelCatalog at all (relies
          // on live discovery) — cannot validate the id without a network call, so skip rather
          // than false-positive.
          continue;
        }
        const localModelId = resolveLocalModelId(providerId, ref.value);
        if (!catalogModelIds.has(localModelId)) {
          warnings.push(
            `- plugin "${plugin.id}" mediaUnderstandingProviderMetadata.${providerId}.${ref.field}: ` +
              `"${ref.value}" does not match any model id in this plugin's own modelCatalog.providers.${providerId}.models. ` +
              `This will fail at runtime with "Unknown model: ${providerId}/${localModelId}". ` +
              `Update the manifest default to a current model id.`,
          );
        }
      }
    }
  }

  return warnings;
}
