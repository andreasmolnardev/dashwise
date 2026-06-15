import { DashwiseSDKConnector, DashwiseSDKConnectorOptions } from "./client";
import { config } from "../config";

let connector: DashwiseSDKConnector | null = null;

function createDefaultOptions(): DashwiseSDKConnectorOptions {
  return {
    pbUrl: config.PB_URL,
    ...(config.PB_ADMIN_EMAIL ? { superuserEmail: config.PB_ADMIN_EMAIL } : {}),
    ...(config.PB_ADMIN_PASSWORD ? { superuserPassword: config.PB_ADMIN_PASSWORD } : {}),
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
