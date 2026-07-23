import { dashboardModule } from "@/modules/dashboard/module";
import { linksModule } from "@/modules/links/module";
import { monitoringModule } from "@/modules/monitoring/module";
import { newsModule } from "@/modules/news/module";
import { notificationsModule } from "@/modules/notifications/module";
import { validateProduct } from "@/platform/modules/validate";
import type { DashwiseProduct } from "@/platform/modules/types";
import config from "@/lib/config";

export const homelabProduct = validateProduct({
  id: "homelab",
  modules: [dashboardModule, monitoringModule, notificationsModule, linksModule, newsModule]
    .filter((module) => !config.disabledModules.includes(module.id)),
} satisfies DashwiseProduct);
