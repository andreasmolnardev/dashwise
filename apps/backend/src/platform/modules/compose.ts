import type { Hono } from "hono";
import type { DashwiseBackendModule, DashwiseBackendProduct } from "./types";

export function validateBackendProduct(product: DashwiseBackendProduct): DashwiseBackendProduct {
  const moduleIds = product.modules.map((module) => module.id);
  const jobIds = product.modules.flatMap((module) => module.jobs ?? []).map((job) => job.id);
  for (const [label, values] of [["module", moduleIds], ["job", jobIds]] as const) {
    const duplicate = values.find((value, index) => values.indexOf(value) !== index);
    if (duplicate) throw new Error(`Duplicate ${label} identifier: ${duplicate}`);
  }
  return product;
}

export function mountModuleRoutes(app: Hono, modules: readonly DashwiseBackendModule[]) {
  for (const module of modules) {
    for (const route of module.routes ?? []) app.route("/", route);
  }
}
