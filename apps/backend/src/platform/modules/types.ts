import type { Hono } from "hono";

export interface JobDefinition {
  id: string;
  schedule: string;
  run: (source: string, ...args: unknown[]) => Promise<unknown>;
  runOnStartup?: boolean;
}

export interface DashwiseBackendModule {
  id: string;
  name: string;
  routes?: readonly Hono[];
  jobs?: readonly JobDefinition[];
}

export interface DashwiseBackendProduct {
  id: string;
  modules: readonly DashwiseBackendModule[];
}
