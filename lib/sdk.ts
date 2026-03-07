import config from "./config";
import { DashwiseSDKConnector } from "@dashwise/sdk";
import { registerDashwiseSDKConnector } from "@dashwise/sdk/lib/pocketbase";

export const dashwiseSDK = new DashwiseSDKConnector({
  pbUrl: config.pb_url,
  superuserEmail: config.pbAdminEmail,
  superuserPassword: config.pbAdminPassword,
  enableSSO: config.enableSSO,
});

registerDashwiseSDKConnector(dashwiseSDK);
