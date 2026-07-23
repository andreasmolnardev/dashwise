import { dashboardModule } from "../../modules/dashboard/module";
import { linksModule } from "../../modules/links/module";
import { monitoringModule } from "../../modules/monitoring/module";
import { newsModule } from "../../modules/news/module";
import { notificationsModule } from "../../modules/notifications/module";
import { validateBackendProduct } from "../../platform/modules/compose";
import type { DashwiseBackendProduct } from "../../platform/modules/types";
import { config } from "../../lib/config";

export const homelabProduct = validateBackendProduct({
  id: "homelab",
  modules: [dashboardModule, monitoringModule, notificationsModule, linksModule, newsModule]
    .filter((module) => !config.DISABLED_MODULES.includes(module.id)),
} satisfies DashwiseBackendProduct);
