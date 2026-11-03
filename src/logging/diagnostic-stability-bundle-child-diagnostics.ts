import type {
  DiagnosticStabilityBundleChildDiagnostics,
  DiagnosticStabilityBundleError,
} from "./diagnostic-stability-bundle-error.js";

const SAFE_REASON_CODE = /^[A-Za-z0-9_.:-]{1,120}$/u;

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasProperty<K extends PropertyKey>(
  value: Record<string, unknown>,
  key: K,
): value is Record<K, unknown> {
  return key in value;
}

const PENDING_KEYS = [
  "closingReceipt",
  "controlClose",
  "relayExit",
  "stdoutEnd",
  "stderrEnd",
  "lineageEof",
  "extinctionUnconfirmed",
] as const;

type PendingFlags = DiagnosticStabilityBundleChildDiagnostics["pending"];

export function readErrorDiagnostics(
  error: unknown,
): NonNullable<DiagnosticStabilityBundleError>["diagnostics"] | undefined {
  if (!isNonNullObject(error) || !hasProperty(error, "diagnostics")) {
    return undefined;
  }
  const value = error.diagnostics;
  if (!isNonNullObject(value)) {
    return undefined;
  }
  const pluginId =
    typeof value.pluginId === "string" && SAFE_REASON_CODE.test(value.pluginId)
      ? value.pluginId
      : undefined;
  const pid = typeof value.pid === "number" && Number.isFinite(value.pid) ? value.pid : undefined;
  const argv0 =
    typeof value.argv0 === "string" && SAFE_REASON_CODE.test(value.argv0) ? value.argv0 : undefined;
  const command =
    typeof value.command === "string" && SAFE_REASON_CODE.test(value.command)
      ? value.command
      : undefined;
  let pending: PendingFlags | undefined;
  if (isNonNullObject(value.pending)) {
    const pendingFlags: PendingFlags = {};
    for (const key of PENDING_KEYS) {
      if (typeof value.pending[key] === "boolean") {
        pendingFlags[key] = value.pending[key];
      }
    }
    if (Object.keys(pendingFlags).length > 0) {
      pending = pendingFlags;
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
