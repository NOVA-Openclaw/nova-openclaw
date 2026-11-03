import type { ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import type { PluginRuntimeCloseChildDiagnostics } from "../../plugins/runtime-close-error.js";

type ServiceChildRelayHostCleanupRelay = { ended: boolean };
type ServiceChildRelayHostCleanupControl = { closed: boolean; destroy: () => void };

export function createServiceChildRelayHostCleanupHost(
  getCompletionSettled: () => boolean,
  getClosingReceipt: () => boolean,
  getControl: () => ServiceChildRelayHostCleanupControl | undefined,
  getChildExited: () => boolean,
  getStdoutRelay: () => ServiceChildRelayHostCleanupRelay,
  getStderrRelay: () => ServiceChildRelayHostCleanupRelay,
  getLineage: () => Readable | undefined,
  getClosed: () => boolean,
  getAnchorPid: () => number | undefined,
  getCommandPid: () => number | undefined,
  params: {
    pluginId?: string;
    argv0?: string;
    command: string;
    ownedWorker?: boolean;
  },
  startup: { reject: (error: Error) => void },
  resultCompletion: { reject: (error: Error) => void },
  cleanup: { completion: { reject: (error: Error) => void } },
  setResultError: (error: Error) => void,
  loseIdentity: (message: string) => void,
  child: ChildProcess,
  getRetirement: () => {
    diagnostics: () => { durationMs: number; escalationAfterMs?: number; signalError?: Error };
  },
): { diagnostics: () => PluginRuntimeCloseChildDiagnostics; expire: () => void } {
  function buildPending(): NonNullable<PluginRuntimeCloseChildDiagnostics["pending"]> {
    const control = getControl();
    const stdoutRelay = getStdoutRelay();
    const stderrRelay = getStderrRelay();
    const lineage = getLineage();
    return {
      closingReceipt: !getClosingReceipt(),
      controlClose: !control?.closed,
      relayExit: !getChildExited(),
      lineageEof: !lineage?.readableEnded,
      extinctionUnconfirmed: !getClosed(),
      stdoutEnd: !stdoutRelay.ended,
      stderrEnd: !stderrRelay.ended,
    };
  }

  function diagnostics(): PluginRuntimeCloseChildDiagnostics {
    const anchorPid = getAnchorPid();
    const commandPid = getCommandPid();
    return {
      pluginId: params.pluginId,
      pid: params.ownedWorker ? anchorPid : commandPid,
      argv0: params.argv0,
      command: params.command,
      pending: buildPending(),
    };
  }

  function expire(): void {
    if (getCompletionSettled()) {
      return;
    }
    const pending = buildPending();
    const message =
      "service child cleanup did not complete before its hard deadline; pending: " +
      JSON.stringify(pending);
    const error = new Error(message, {
      cause: getRetirement().diagnostics(),
    });
    setResultError(error);
    startup.reject(error);
    resultCompletion.reject(error);
    cleanup.completion.reject(error);
    try {
      loseIdentity(message);
    } finally {
      getControl()?.destroy();
      if (!params.ownedWorker) {
        getLineage()?.destroy();
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
    }
  }

  return { diagnostics, expire };
}
