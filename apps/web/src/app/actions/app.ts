import { rpcGetAppConfig, rpcGetAppInfo } from "@/lib/rpcClient";

export async function getAppConfigAction() {
  return rpcGetAppConfig();
}

export async function getAppInfoAction(_auth?: { token?: string | null }) {
  return rpcGetAppInfo();
}
