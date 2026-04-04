import type { Hono } from "hono";

import { registerIntegrationsControllers } from "./integrations.controller";
import { registerLinksControllers } from "./links.controller";
import { registerMonitoringControllers } from "./monitoring.controller";
import { registerNewsControllers } from "./news.controller";
import { registerNotificationsControllers } from "./notifications.controller";
import { registerPageConfigControllers } from "./pageConfig.controller";
import { registerWallpapersControllers } from "./wallpapers.controller";
import { registerWidgetsControllers } from "./widgets.controller";

export function registerDataControllers(app: Hono) {
  registerPageConfigControllers(app);
  registerLinksControllers(app);
  registerWidgetsControllers(app);
  registerIntegrationsControllers(app);
  registerNewsControllers(app);
  registerNotificationsControllers(app);
  registerMonitoringControllers(app);
  registerWallpapersControllers(app);
}