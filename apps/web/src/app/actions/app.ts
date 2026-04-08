import { callApiAction } from "@/lib/apiClient";

export async function getAppConfigAction() {
  return callApiAction("app", "getAppConfigAction");
}

export async function getAppInfoAction(_auth?: { token?: string | null }) {
  return callApiAction("app", "getAppInfoAction");
}
