import config from "@/lib/config";
import { getDashwiseSDKConnector, getServerPB } from "@dashwise/sdk/lib/pocketbase";

export async function getAppConfig() {
  return getDashwiseSDKConnector().getAppConfig();
}

export async function getAppInfo() {
  const pb = getServerPB();
  const instanceName = "dashwise";

  const result = await pb.collection("appInfo").getList(1, 1, {
    filter: `instanceName = "${instanceName.toLowerCase()}"`,
    skipTotal: true,
  }).catch(() => ({ items: [] }));

  const record = result.items[0];

  return {
    updateAvailable: record?.updateAvailable || false,
    currentAppVersion: config.version || "unknown",
    userSignupDisabled: config.disableUserSignup || false,
  };
}