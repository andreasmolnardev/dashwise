import { trpc } from "@/lib/apiClient";
const api = trpc as any;

export async function getAppConfigAction() {
  return api.app.getAppConfigAction.query();
}

export async function getAppInfoAction(_auth?: { token?: string | null }) {
  return api.app.getAppInfoAction.query();
}
