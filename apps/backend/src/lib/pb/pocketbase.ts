import { DashwiseSDKConnector, DashwiseSDKConnectorOptions } from "./client";

let connector: DashwiseSDKConnector | null = null;

function createDefaultOptions(): DashwiseSDKConnectorOptions {
  const pbUrl = process.env.NEXT_PUBLIC_PB_URL || process.env.PB_URL || "http://127.0.0.1:8090";
  const superuserEmail = process.env.PB_ADMIN_EMAIL;
  const superuserPassword = process.env.PB_ADMIN_PASSWORD;

  return {
    pbUrl,
    ...(superuserEmail ? { superuserEmail } : {}),
    ...(superuserPassword ? { superuserPassword } : {}),
  };
}

export function registerDashwiseSDKConnector(instance: DashwiseSDKConnector) {
  connector = instance;
}

export function getDashwiseSDKConnector() {
  if (!connector) {
    connector = new DashwiseSDKConnector(createDefaultOptions());
  }
  return connector;
}

export function getServerPB(cookieHeader?: string) {
  return getDashwiseSDKConnector().createServerClient(cookieHeader);
}

export async function getSuperuserPB() {
  return getDashwiseSDKConnector().getSuperuserClient();
}

export { ClientResponseError } from "pocketbase";
