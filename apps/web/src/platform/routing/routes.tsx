import { createElement } from "react";
import type { RouteObject } from "react-router-dom";
import type { DashwiseModule, ModuleRoute } from "../modules/types";

export function moduleRoutes(modules: readonly DashwiseModule[]): RouteObject[] {
  return modules.flatMap((module) => (module.routes ?? []).map(toRouteObject));
}

function toRouteObject(route: ModuleRoute): RouteObject {
  if (route.index) {
    return { id: route.id, index: true, element: createElement(route.component) };
  }

  return {
    id: route.id,
    path: route.path,
    element: createElement(route.component),
    children: route.children?.map(toRouteObject),
  };
}
