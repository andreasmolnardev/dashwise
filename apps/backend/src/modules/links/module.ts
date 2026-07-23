import linksRoute from "./internal/links.route";
import type { DashwiseBackendModule } from "../../platform/modules/types";

export const linksModule = { id: "links", name: "Links", routes: [linksRoute] } satisfies DashwiseBackendModule;
