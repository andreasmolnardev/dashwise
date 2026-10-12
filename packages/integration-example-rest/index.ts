import {
  defineIntegration,
  resourceCollection,
  type IntegrationsRuntime,
  type ResourceRecord,
} from "@dashwise/integrations-sdk";

type EndpointHealth = ResourceRecord & {
  state: "online" | "offline";
  attributes: {
    checkedAt: string;
    statusCode?: number;
    error?: string;
  };
};

const endpointCollection = resourceCollection<EndpointHealth>({
  persistent: true,
  shortcuts: true,
  apps: ["services"],
});

async function checkEndpoint(
  integrations: IntegrationsRuntime<
    { endpoint: string; serviceName: string; pollIntervalSeconds: number },
    "apiKey",
    { endpoint: typeof endpointCollection }
  >,
  signal?: AbortSignal,
) {
  const checkedAt = new Date().toISOString();
  const apiKey = await integrations.secrets.get("apiKey");

  try {
    const response = await integrations.http.fetch(integrations.config.endpoint, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal,
    });
    const online = response.ok;
    await integrations.resources.endpoint.sync([{
      id: "endpoint",
      name: integrations.config.serviceName,
      type: "http-service",
      icon: "mdi:server-network",
      state: online ? "online" : "offline",
      available: online,
      actions: [],
      attributes: {
        checkedAt,
        statusCode: response.status,
        ...(!online ? { error: `Endpoint returned HTTP ${response.status}` } : {}),
      },
    }], { completeness: "complete" });
  } catch {
    if (signal?.aborted) return;

    // A failed request cannot be an authoritative empty snapshot. Preserve the
    // known resource and update only its observed availability.
    await integrations.resources.endpoint.upsert({
      id: "endpoint",
      name: integrations.config.serviceName,
      type: "http-service",
      icon: "mdi:server-network",
      state: "offline",
      available: false,
      actions: [],
      attributes: {
        checkedAt,
        error: "Endpoint request failed",
      },
    });
  }
}

const definition = defineIntegration({
  id: "example-rest-status",
  name: "REST status example",
  version: "1.0.0",
  description: "A small REST integration that checks a configured health endpoint.",
  config: {
    endpoint: { type: "url", title: "Health endpoint", required: true },
    serviceName: {
      type: "string",
      title: "Service name",
      required: true,
      default: "Example service",
    },
    apiKey: { type: "secret", title: "Bearer token", required: false },
    pollIntervalSeconds: {
      type: "number",
      title: "Refresh interval in seconds",
      required: true,
      default: 60,
      min: 10,
      max: 3600,
    },
  },
  resources: { endpoint: endpointCollection },
  apps: [{ id: "services", name: "REST services", icon: "mdi:server-network" }],
  widgets: [{
    id: "health-summary",
    name: "Service health",
    description: "Show whether the configured endpoint is responding.",
    template: "icon-details-card",
    properties: {
      header: { title: "${endpoint.name}", icon: "mdi:server-network" },
      icon: { file: "${endpoint.icon}", size: 32, description: "Service status" },
      primary: "${endpoint.state}",
      secondary: "HTTP ${endpoint.attributes.statusCode}",
    },
    exampleProps: {
      endpoint: {
        name: "Example service",
        state: "online",
        icon: "mdi:server-network",
        attributes: { statusCode: 200 },
      },
    },
    configSchema: {
      endpoint: {
        type: "shortcut-select",
        label: "Service endpoint",
        required: true,
        appIds: ["services"],
        collectionIds: ["endpoint"],
      },
      showStatusCode: { type: "boolean", label: "Show HTTP status code", default: true },
    },
    resourceBindings: {
      endpoint: { type: "shortcut-select", configKey: "endpoint" },
    },
  }],
  glanceables: [{
    id: "health-state",
    name: "Service health state",
    description: "Show the latest health check result.",
    configSchema: {
      endpoint: {
        type: "shortcut-select",
        label: "Service endpoint",
        required: true,
        appIds: ["services"],
        collectionIds: ["endpoint"],
      },
    },
    resourceBindings: {
      endpoint: { type: "shortcut-select", configKey: "endpoint" },
    },
  }],
  async start(integrations) {
    const refresh = (signal: AbortSignal) => checkEndpoint(integrations, signal);
    await refresh(new AbortController().signal);
    integrations.scheduler.every(
      "endpoint-health",
      integrations.config.pollIntervalSeconds * 1000,
      refresh,
    );
  },
});

export default definition;
