import { describe, expect, test } from "bun:test";
import definition from "../index";

type EndpointResource = {
  id: string;
  name: string;
  state: "online" | "offline";
  available: boolean;
  attributes: Record<string, unknown>;
};

function createRuntime(fetch: typeof globalThis.fetch) {
  const resources = new Map<string, EndpointResource>();
  const snapshots: EndpointResource[][] = [];
  let scheduledTask: ((signal: AbortSignal) => void | Promise<void>) | undefined;
  let intervalMs: number | undefined;

  const integrations = {
    instanceId: "rest-example-instance",
    config: {
      endpoint: "https://status.example.test/health",
      serviceName: "Example API",
      pollIntervalSeconds: 45,
    },
    secrets: { get: async (key: string) => key === "apiKey" ? "secret-api-key" : undefined },
    resources: {
      endpoint: {
        get: (id: string) => resources.get(id),
        upsert: async (resource: EndpointResource) => {
          resources.set(resource.id, resource);
          return resource;
        },
        update: async () => undefined,
        remove: async (id: string) => resources.delete(id),
        sync: async (next: EndpointResource[], options: { completeness: "complete" | "partial" }) => {
          snapshots.push(next);
          for (const resource of next) resources.set(resource.id, resource);
          if (options.completeness === "complete") {
            for (const id of resources.keys()) {
              if (!next.some((resource) => resource.id === id)) resources.delete(id);
            }
          }
        },
      },
    },
    http: { fetch },
    scheduler: {
      every: (_name: string, delay: number, task: (signal: AbortSignal) => void | Promise<void>) => {
        intervalMs = delay;
        scheduledTask = task;
      },
    },
  };

  return {
    integrations,
    resources,
    snapshots,
    get scheduledTask() { return scheduledTask; },
    get intervalMs() { return intervalMs; },
  };
}

describe("REST status integration", () => {
  test("performs an authenticated initial check and schedules the configured interval", async () => {
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const runtime = createRuntime(async (input, init) => {
      requests.push({ input, init });
      return new Response("ok", { status: 200 });
    });

    await definition.start?.(runtime.integrations as never);

    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.input)).toBe("https://status.example.test/health");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe("Bearer secret-api-key");
    expect(runtime.resources.get("endpoint")?.state).toBe("online");
    expect(runtime.snapshots).toHaveLength(1);
    expect(runtime.intervalMs).toBe(45_000);
    expect(runtime.scheduledTask).toBeFunction();
  });

  test("preserves the discovered resource when a later network check fails", async () => {
    let shouldFail = false;
    const runtime = createRuntime(async () => {
      if (shouldFail) throw new Error("network failure");
      return new Response("ok", { status: 200 });
    });

    await definition.start?.(runtime.integrations as never);
    shouldFail = true;
    await runtime.scheduledTask?.(new AbortController().signal);

    expect(runtime.snapshots).toHaveLength(1);
    expect(runtime.resources.get("endpoint")).toMatchObject({
      id: "endpoint",
      name: "Example API",
      state: "offline",
      available: false,
      attributes: { error: "Endpoint request failed" },
    });
  });
});
