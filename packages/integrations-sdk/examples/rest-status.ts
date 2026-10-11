import {
  defineAction,
  defineIntegration,
  resourceCollection,
  type ResourceRecord,
} from "@dashwise/integrations-sdk";

type ServiceStatus = ResourceRecord & {
  state: "online" | "offline";
  attributes: { checkedAt: string; statusCode?: number };
};
const serviceStatus = resourceCollection<ServiceStatus>({ persistent: true, shortcuts: true });

export default defineIntegration({
  id: "example-rest-status",
  name: "REST Status Example",
  version: "1.0.0",
  config: {
    endpoint: { type: "url", required: true },
    apiKey: { type: "secret", required: false },
    pollIntervalSeconds: { type: "number", required: true, default: 60, min: 10 },
  },
  resources: { services: serviceStatus },
  actions: {
    refresh: defineAction<{ reason?: string }, ServiceStatus>({
      id: "refresh",
      name: "Refresh status",
      inputSchema: { type: "object", properties: { reason: { type: "string" } } },
      async execute(integrations, resource, input) {
        integrations.logger.info("Refreshing service status", {
          resourceId: resource.id,
          reason: input.reason ?? "manual",
        });
        return { success: true, value: resource };
      },
    }),
  },
  apps: [{ id: "services", name: "Services", icon: "mdi:server" }],
  widgets: [{ id: "status-list", name: "Status list" }],
  glanceables: [{ id: "service-count", name: "Online services" }],
  async start(integrations) {
    const apiKey = await integrations.secrets.get("apiKey");
    const response = await integrations.http.fetch(integrations.config.endpoint, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(integrations.config.pollIntervalSeconds * 1000),
    });
    if (!response.ok) throw new Error(`Status endpoint returned ${response.status}`);
    const body = (await response.json()) as { status: "online" | "offline" };
    await integrations.resources.services.sync([{
      id: "primary",
      name: "Primary service",
      state: body.status,
      attributes: { checkedAt: new Date().toISOString(), statusCode: response.status },
      available: body.status === "online",
      actions: ["refresh"],
    }], { completeness: "complete" });
  },
});
