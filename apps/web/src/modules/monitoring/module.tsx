import { lazy } from "react";
import type { DashwiseModule } from "@/platform/modules/types";

const MonitoringLayout = lazy(() => import("./internal/layout"));
const MonitoringPage = lazy(() => import("./internal/page"));
const MonitoringDetailPage = lazy(() => import("./internal/[monitorId]/page"));
const MonitoringSshPage = lazy(() => import("./internal/ssh/page"));
const MonitoringHostPage = lazy(() => import("./internal/hosts/page"));

export const monitoringModule = {
  id: "monitoring",
  name: "Monitoring",
  navigation: [{ id: "monitoring", moduleId: "monitoring", label: "Monitoring", path: "/apps/monitoring", order: 20 }],
  routes: [{
    id: "monitoring", moduleId: "monitoring", path: "apps/monitoring", component: MonitoringLayout,
    meta: { title: "Monitoring", pageKind: "application", surface: "application", pageConfig: { mode: "none" }, showSidebar: true, showHeader: true },
    children: [
      { id: "monitoring-index", moduleId: "monitoring", index: true, component: MonitoringPage, meta: { title: "Monitoring", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "monitoring-ssh", moduleId: "monitoring", path: "ssh", component: MonitoringSshPage, meta: { title: "Monitoring", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "monitoring-ssh-host", moduleId: "monitoring", path: "ssh/:hostId", component: MonitoringSshPage, meta: { title: "Monitoring", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "monitoring-host", moduleId: "monitoring", path: "hosts/:hostId", component: MonitoringHostPage, meta: { title: "Monitoring", pageKind: "application", pageConfig: { mode: "none" } } },
      { id: "monitoring-detail", moduleId: "monitoring", path: ":monitorId", component: MonitoringDetailPage, meta: { title: "Monitoring", pageKind: "application", pageConfig: { mode: "none" } } },
    ],
  }],
} satisfies DashwiseModule;
