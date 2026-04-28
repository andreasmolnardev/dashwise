import { Hono } from "hono";

import integrationsRoute from "./integrations.route";
import linksRoute from "./links.route";
import monitoringRoute from "./monitoring.route";
import newsRoute from "./news.route";
import notificationsRoute from "./notifications.route";
import pageConfigRoute from "./pageConfig.route";
import wallpapersRoute from "./wallpapers.route";
import widgetsRoute from "./widgets.route";

const dataRoute = new Hono();

dataRoute.route("/", pageConfigRoute);
dataRoute.route("/", linksRoute);
dataRoute.route("/", widgetsRoute);
dataRoute.route("/", integrationsRoute);
dataRoute.route("/", newsRoute);
dataRoute.route("/", notificationsRoute);
dataRoute.route("/", monitoringRoute);
dataRoute.route("/", wallpapersRoute);

export default dataRoute;
