import type { ComponentType, LazyExoticComponent } from "react";

export type PageConfigMode = "none" | "named" | "pathname-first-segment";

export interface ModuleRoute {
  id: string;
  moduleId: string;
  path?: string;
  index?: boolean;
  component: LazyExoticComponent<ComponentType> | ComponentType;
  children?: readonly ModuleRoute[];
  meta: {
    title?: string;
    pageKind: "dashboard" | "application" | "settings" | "system";
    surface?: "dashboard" | "application" | "frame" | "sidebar";
    pageConfig?: { mode: PageConfigMode; pageName?: string };
    showSidebar?: boolean;
    showHeader?: boolean;
    requiredPermissions?: readonly string[];
  };
}

export interface NavigationEntry {
  id: string;
  moduleId: string;
  label: string;
  path: string;
  group?: string;
  order?: number;
  requiredPermissions?: readonly string[];
}

export interface DashwiseModule {
  id: string;
  name: string;
  routes?: readonly ModuleRoute[];
  navigation?: readonly NavigationEntry[];
}

export interface DashwiseProduct {
  id: string;
  modules: readonly DashwiseModule[];
}
