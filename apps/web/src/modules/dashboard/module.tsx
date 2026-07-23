import { lazy } from "react";
import type { DashwiseModule } from "@/platform/modules/types";

const DynamicPage = lazy(() => import("./internal/DashboardPage"));

export const dashboardModule = {
  id: "dashboard",
  name: "Dashboard",
  navigation: [{ id: "dashboard", moduleId: "dashboard", label: "Dashboard", path: "/home", order: 0 }],
  routes: [
    { id: "dashboard-home", moduleId: "dashboard", path: "home", component: DynamicPage, meta: { title: "Home", pageKind: "dashboard", surface: "dashboard", pageConfig: { mode: "pathname-first-segment" }, showSidebar: true, showHeader: true } },
    { id: "dashboard-page", moduleId: "dashboard", path: ":page", component: DynamicPage, meta: { pageKind: "dashboard", surface: "dashboard", pageConfig: { mode: "pathname-first-segment" }, showSidebar: true, showHeader: true } },
  ],
} satisfies DashwiseModule;
