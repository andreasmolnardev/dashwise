import type { DashwiseModule, NavigationEntry } from "../modules/types";

export function navigationEntries(modules: readonly DashwiseModule[]): NavigationEntry[] {
  return modules.flatMap((module) => module.navigation ?? []).sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
}
