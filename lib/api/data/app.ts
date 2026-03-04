import config from "@/lib/config";
import { getServerPB } from "@/lib/pb";

export async function getAppConfig() {
  return {
    enableSSO:
      process.env.NEXT_PUBLIC_ENABLE_SSO === "1" ||
      process.env.NEXT_PUBLIC_ENABLE_SSO === "true",
  };
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
