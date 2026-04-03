import type { Hono } from "hono";

import { registerAuthControllers } from "./controllers/auth.controller";
import { registerDataControllers } from "./controllers/data.controller";
import { registerSystemControllers } from "./controllers/system.controller";

export function registerRestRoutes(app: Hono) {
  registerSystemControllers(app);
  registerAuthControllers(app);
  registerDataControllers(app);
}
