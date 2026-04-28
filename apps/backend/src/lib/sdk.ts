import { DashwiseSDKConnector } from "@dashwise/sdk";
import { registerDashwiseSDKConnector } from "@dashwise/sdk/lib/pocketbase";
import { config } from "./config";
import { createLogger } from "./logger";

const logger = createLogger("SDK");

logger.info(`Using PocketBase at ${config.PB_URL}`);
logger.debug("Dashwise SDK connector config", {
  pbUrl: config.PB_URL,
  superuserEmail: config.PB_ADMIN_EMAIL ? "configured" : "not configured",
  superuserPassword: config.PB_ADMIN_PASSWORD ? "configured" : "not configured",
});

export const _d = new DashwiseSDKConnector({
  pbUrl: config.PB_URL || "http://127.0.0.1:8090",
  superuserEmail: config.PB_ADMIN_EMAIL,
  superuserPassword: config.PB_ADMIN_PASSWORD || "",
});

registerDashwiseSDKConnector(_d);

export default _d;
