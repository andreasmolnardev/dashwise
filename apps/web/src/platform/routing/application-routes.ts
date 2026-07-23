import { matchRoutes } from "react-router-dom";
import type { ModuleRoute } from "../modules/types";

const applicationRoutes: Pick<ModuleRoute, "path" | "meta">[] = [
  { path: "auth/*", meta: { pageKind: "system", pageConfig: { mode: "none" } } },
  { path: "settings/*", meta: { pageKind: "settings", pageConfig: { mode: "none" } } },
  { path: "notifications/*", meta: { pageKind: "application", pageConfig: { mode: "none" } } },
  { path: "onboarding", meta: { pageKind: "system", pageConfig: { mode: "none" } } },
  { path: "frame", meta: { pageKind: "system", pageConfig: { mode: "none" } } },
  { path: "screensaver", meta: { pageKind: "system", pageConfig: { mode: "none" } } },
];

export function applicationRouteMetadata(pathname: string): ModuleRoute["meta"] | undefined {
  return matchRoutes(applicationRoutes, pathname)?.at(-1)?.route.meta;
}
