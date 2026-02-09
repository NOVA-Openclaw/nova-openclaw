import type { RuntimeEnv } from "../../runtime.js";
import { callGatewayFromCli } from "../../cli/gateway-rpc.js";
import { theme } from "../../terminal/theme.js";

export type ChannelsDndOptions = {
  channel?: string;
  account?: string;
  enable?: boolean;
  disable?: boolean;
  message?: string;
  url?: string;
  token?: string;
  timeout?: string;
  json?: boolean;
};

export async function channelsDndCommand(opts: ChannelsDndOptions, runtime: RuntimeEnv) {
  if (!opts.channel) {
    runtime.error("--channel is required");
    runtime.exit(1);
    return;
  }

  // Determine if we're enabling or disabling
  const enabled = opts.enable === true || opts.disable !== true;

  const params = {
    channel: opts.channel,
    enabled,
    message: opts.message,
    accountId: opts.account,
  };

  try {
    await callGatewayFromCli("channels.setDnd", opts, params, { progress: !opts.json });

    if (!opts.json) {
      const status = enabled ? "enabled" : "disabled";
      runtime.log(
        theme.success(
          `✓ DND ${status} for ${opts.channel}${opts.account ? ` (${opts.account})` : ""}`,
        ),
      );
      if (enabled && opts.message) {
        runtime.log(theme.muted(`  Message: ${opts.message}`));
      }
    }
  } catch (err) {
    if (!opts.json) {
      runtime.error(`Failed to set DND: ${String(err)}`);
    }
    runtime.exit(1);
  }
}
