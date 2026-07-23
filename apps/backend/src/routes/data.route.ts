import { Hono } from "hono";

import integrationsRoute from "../platform/integrations/route";
import pageConfigRoute from "../platform/page-config/route";
import wallpapersRoute from "./wallpapers.route";
import widgetsRoute from "../platform/widget-consumers/route";
import searchItemsRoute from "../platform/search/route";

const dataRoute = new Hono();

dataRoute.route("/", pageConfigRoute);
dataRoute.route("/", widgetsRoute);
dataRoute.route("/", integrationsRoute);
dataRoute.route("/", wallpapersRoute);
dataRoute.route("/", searchItemsRoute);

export default dataRoute;
