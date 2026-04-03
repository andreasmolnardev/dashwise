import config from "./config";
import { DashwiseSDKConnector } from "@dashwise/sdk/index";
import { registerDashwiseSDKConnector } from "@dashwise/sdk/lib/pocketbase";

export const dashwiseSDK = new DashwiseSDKConnector({
  pbUrl: config.pb_url,
  superuserEmail: Bun.env.PB_ADMIN_EMAIL ?? "",
  superuserPassword: Bun.env.PB_ADMIN_PASSWORD ?? "",
  enableSSO: config.enableSSO,
});

registerDashwiseSDKConnector(dashwiseSDK);
