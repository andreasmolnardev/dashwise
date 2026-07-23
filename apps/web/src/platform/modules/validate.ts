import type { DashwiseProduct, ModuleRoute } from "./types";

function collectRoutes(routes: readonly ModuleRoute[]): ModuleRoute[] {
  return routes.flatMap((route) => [route, ...(route.children ? collectRoutes(route.children) : [])]);
}

function assertUnique(values: readonly string[], label: string) {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length) throw new Error(`Duplicate ${label}: ${[...new Set(duplicates)].join(", ")}`);
}

export function validateProduct(product: DashwiseProduct): DashwiseProduct {
  assertUnique(product.modules.map((module) => module.id), "module identifier");
  const routes = collectRoutes(product.modules.flatMap((module) => module.routes ?? []));
  assertUnique(routes.map((route) => route.id), "route identifier");
  assertUnique(product.modules.flatMap((module) => module.navigation ?? []).map((entry) => entry.id), "navigation identifier");

  for (const route of routes) {
    if (route.moduleId !== product.modules.find((module) => module.id === route.moduleId)?.id) {
      throw new Error(`Route ${route.id} references unavailable module ${route.moduleId}`);
    }
    if (route.meta.pageConfig?.mode === "named" && !route.meta.pageConfig.pageName) {
      throw new Error(`Route ${route.id} requires pageConfig.pageName`);
    }
  }

  return product;
}
