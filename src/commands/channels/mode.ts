import type { RuntimeEnv } from "../../runtime.js";
import { formatCliChannelOptions } from "../../cli/channel-options.js";
import { callGatewayFromCli } from "../../cli/gateway-rpc.js";
import { theme } from "../../terminal/theme.js";

export type ChannelsModeOptions = {
  channel?: string;
  account?: string;
  mode: "enabled" | "dnd" | "read-only" | "write-only" | "disabled";
  message?: string;
  url?: string;
  token?: string;
  timeout?: string;
  json?: boolean;
};

export async function channelsModeCommand(opts: ChannelsModeOptions, runtime: RuntimeEnv) {
  if (!opts.channel) {
    runtime.error("--channel is required");
    runtime.exit(1);
    return;
  }

  const params = {
    channel: opts.channel,
    mode: opts.mode,
    accountId: opts.account,
    dndMessage: opts.mode === "dnd" ? opts.message : undefined,
  };

  try {
    await callGatewayFromCli("channels.setMode", opts, params, { progress: !opts.json });

    if (!opts.json) {
      runtime.log(
        theme.success(
          `✓ Channel ${opts.channel}${opts.account ? ` (${opts.account})` : ""} mode set to: ${opts.mode}`,
        ),
      );
    }
  } catch (err) {
    if (!opts.json) {
      runtime.error(`Failed to set channel mode: ${String(err)}`);
    }
    runtime.exit(1);
  }
}
