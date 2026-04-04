import { api } from "@/lib/apiClient";

export async function getAppConfigAction() {
  return api.app.getAppConfigAction();
}

export async function getAppInfoAction(_auth?: { token?: string | null }) {
  return api.app.getAppInfoAction();
}
