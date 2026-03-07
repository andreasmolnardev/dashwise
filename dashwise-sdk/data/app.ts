import config from "@/lib/config";
import { getDashwiseSDKConnector, getServerPB } from "@dashwise/sdk/lib/pocketbase";

export async function getAppConfig() {
  return getDashwiseSDKConnector().getAppConfig();
}

export async function getAppInfo() {
  const pb = getServerPB();
  const instanceName = "dashwise";

  const record = await pb
    .collection("appInfo")
    .getFirstListItem(`instanceName = "${instanceName.toLowerCase()}"`);

  return {
    updateAvailable: record.updateAvailable,
    currentAppVersion: config.version,
    userSignupDisabled: config.disableUserSignup,
  };
}
