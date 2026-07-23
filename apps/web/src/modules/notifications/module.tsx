import { lazy } from "react";
import type { DashwiseModule } from "@/platform/modules/types";

const NotificationsPage = lazy(() => import("./internal/page"));
const MonitoringLayout = lazy(() => import("@/modules/monitoring").then(({ MonitoringLayout }) => ({ default: MonitoringLayout })));

export const notificationsModule = {
  id: "notifications",
  name: "Notifications",
  navigation: [{ id: "notifications", moduleId: "notifications", label: "Notifications", path: "/apps/monitoring/notifications", order: 30 }],
  routes: [{
    id: "notifications", moduleId: "notifications", path: "apps/monitoring/notifications", component: MonitoringLayout,
    meta: { title: "Notifications", pageKind: "application", surface: "application", pageConfig: { mode: "none" }, showSidebar: true, showHeader: true },
    children: [{ id: "notifications-index", moduleId: "notifications", index: true, component: NotificationsPage, meta: { title: "Notifications", pageKind: "application", pageConfig: { mode: "none" } } }],
  }],
} satisfies DashwiseModule;
