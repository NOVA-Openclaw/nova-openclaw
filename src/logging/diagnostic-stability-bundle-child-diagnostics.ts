import type { DiagnosticStabilityBundleError } from "./diagnostic-stability-bundle-error.js";

const SAFE_REASON_CODE = /^[A-Za-z0-9_.:-]{1,120}$/u;

export function readErrorDiagnostics(
  error: unknown,
): NonNullable<DiagnosticStabilityBundleError>["diagnostics"] | undefined {
  if (!error || typeof error !== "object" || !("diagnostics" in error)) {
    return undefined;
  }
  const value = (error as { diagnostics?: unknown }).diagnostics;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const pluginId =
    typeof source.pluginId === "string" && SAFE_REASON_CODE.test(source.pluginId)
      ? source.pluginId
      : undefined;
  const pid =
    typeof source.pid === "number" && Number.isFinite(source.pid) ? source.pid : undefined;
  const argv0 =
    typeof source.argv0 === "string" && SAFE_REASON_CODE.test(source.argv0)
      ? source.argv0
      : undefined;
  const command =
    typeof source.command === "string" && SAFE_REASON_CODE.test(source.command)
      ? source.command
      : undefined;
  let pending:
    | NonNullable<NonNullable<DiagnosticStabilityBundleError>["diagnostics"]>["pending"]
    | undefined;
  if (source.pending && typeof source.pending === "object" && !Array.isArray(source.pending)) {
    const pendingSource = source.pending as Record<string, unknown>;
    const pendingFlags: Record<string, boolean> = {};
    for (const key of [
      "closingReceipt",
      "controlClose",
      "relayExit",
      "stdoutEnd",
      "stderrEnd",
      "lineageEof",
      "extinctionUnconfirmed",
    ]) {
      if (typeof pendingSource[key] === "boolean") {
        pendingFlags[key] = pendingSource[key];
      }
    }
    if (Object.keys(pendingFlags).length > 0) {
      pending = pendingFlags as NonNullable<
        NonNullable<DiagnosticStabilityBundleError>["diagnostics"]
      >["pending"];
    }
  }
  if (!pluginId && pid === undefined && !argv0 && !command && !pending) {
    return undefined;
  }
  return {
    ...(pluginId ? { pluginId } : {}),
    ...(pid !== undefined ? { pid } : {}),
    ...(argv0 ? { argv0 } : {}),
    ...(command ? { command } : {}),
    ...(pending ? { pending } : {}),
  };
}
