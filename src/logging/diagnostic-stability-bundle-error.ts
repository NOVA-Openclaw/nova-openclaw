export type DiagnosticStabilityBundleChildDiagnostics = {
  pluginId?: string;
  pid?: number;
  argv0?: string;
  command?: string;
  pending?: {
    closingReceipt?: boolean;
    controlClose?: boolean;
    relayExit?: boolean;
    stdoutEnd?: boolean;
    stderrEnd?: boolean;
    lineageEof?: boolean;
    extinctionUnconfirmed?: boolean;
  };
};

export type DiagnosticStabilityBundleError = {
  name?: string;
  code?: string;
  message?: string;
  stack?: string;
  diagnostics?: DiagnosticStabilityBundleChildDiagnostics;
};
