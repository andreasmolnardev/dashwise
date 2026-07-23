import { matchRoutes } from "react-router-dom";
import type { DashwiseModule, ModuleRoute, PageConfigMode } from "../modules/types";
import { moduleRoutes } from "./routes";

export function routeMetadata(pathname: string, modules: readonly DashwiseModule[]): ModuleRoute["meta"] | undefined {
  const match = matchRoutes(moduleRoutes(modules), pathname)?.at(-1);
  const route = modules.flatMap((module) => module.routes ?? []).flatMap(flattenRoutes).find((entry) => entry.id === match?.route.id);
  return route?.meta;
}

function flattenRoutes(route: ModuleRoute): ModuleRoute[] {
  return [route, ...(route.children?.flatMap(flattenRoutes) ?? [])];
}

export function resolvePageConfigName(pathname: string, mode: PageConfigMode, pageName?: string): string {
  if (mode === "named") return pageName!;
  if (mode === "none") return "home";
  return pathname.split("/").filter(Boolean)[0] ?? "home";
}
