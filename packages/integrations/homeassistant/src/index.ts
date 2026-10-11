import {
  defineIntegration,
  resourceCollection,
  type GlanceableContribution,
  type IntegrationConfigSchema,
  type JsonValue,
  type ResourceRecord,
  type WidgetContribution,
} from "@dashwise/integrations-sdk";
import { actions, attachClient, detachClient, stopClient } from "./actions";
import { HomeAssistantWebSocketClient } from "./client";
import type { HassState } from "./ha-types";
import { APP_IDS, mapEntities } from "./mapping";
import {
  buildStatusResources,
  countLightsOn,
  STATUS_RESOURCE_IDS,
  type ConnectionStatus,
  type StatusResource,
} from "./status";

type EntityResource = ResourceRecord & {
  type: string;
  state: string;
  attributes: Record<string, JsonValue>;
  actions: string[];
  apps: string[];
};

const entityCollection = resourceCollection<EntityResource>({
  persistent: true,
  shortcuts: true,
  apps: Object.values(APP_IDS).filter((appId) => appId !== APP_IDS.status),
});

const statusCollection = resourceCollection<StatusResource>({
  persistent: true,
  shortcuts: true,
  apps: [APP_IDS.status],
});

function buildAppContributions() {
  return [
    { id: APP_IDS.entities, name: "Home Assistant Entities", icon: "mdi:home-assistant" },
    { id: APP_IDS.lights, name: "Home Assistant Lights", icon: "mdi:lightbulb" },
    { id: APP_IDS.automations, name: "Home Assistant Automations", icon: "mdi:robot" },
    { id: APP_IDS.helpers, name: "Home Assistant Helpers", icon: "mdi:form-select" },
    { id: APP_IDS.sensors, name: "Home Assistant Sensors", icon: "mdi:eye" },
    { id: APP_IDS.scenes, name: "Home Assistant Scenes", icon: "mdi:palette" },
    { id: APP_IDS.scripts, name: "Home Assistant Scripts", icon: "mdi:script-text" },
    { id: APP_IDS.devices, name: "Home Assistant Devices", icon: "mdi:devices" },
    { id: APP_IDS.status, name: "Home Assistant Status", icon: "mdi:heart-pulse" },
  ] as const;
}

const actionDefinitions = actions;
const statusPublishers = new WeakMap<object, (state: ConnectionStatus) => Promise<void>>();

const entityListConfig = {
  selectedEntities: {
    type: "shortcut-select",
    label: "Entities",
    description: "Choose Home Assistant entities to display.",
    multiple: true,
    appIds: [APP_IDS.entities],
  },
} as const satisfies IntegrationConfigSchema;
const entityListWidget = {
  id: "entity-list",
  name: "Home Assistant Entity List",
  description: "Show selected entities and their current state.",
  template: "vertical-list",
  properties: {
    header: { title: "Home Assistant entities", icon: "mdi:home-assistant" },
    list: {
      iterate_over: "entities",
      max_items: 20,
      prototype: { title: "${name}", subtitle: "${state}", icon: "${icon}" },
    },
  },
  exampleProps: {
    entities: [
      { name: "Kitchen light", state: "on", icon: "mdi:lightbulb" },
      { name: "Hall temperature", state: "21.5", icon: "mdi:thermometer" },
    ],
  },
  configSchema: entityListConfig,
  resourceBindings: {
    entities: { type: "shortcut-select", configKey: "selectedEntities" },
  },
} as const satisfies WidgetContribution<typeof entityListConfig>;

const sensorOverviewConfig = {
  sensors: {
    type: "shortcut-select",
    label: "Sensors",
    description: "Choose sensors to display.",
    multiple: true,
    appIds: [APP_IDS.sensors],
  },
} as const satisfies IntegrationConfigSchema;
const sensorOverviewWidget = {
  id: "sensor-overview",
  name: "Home Assistant Sensor Overview",
  description: "Show the latest values from selected sensors.",
  template: "vertical-list",
  properties: {
    header: { title: "Home Assistant sensors", icon: "mdi:eye" },
    list: {
      iterate_over: "sensors",
      max_items: 20,
      prototype: { title: "${name}", subtitle: "${state}", icon: "${icon}" },
    },
  },
  exampleProps: {
    sensors: [
      { name: "Living room temperature", state: "21.5", icon: "mdi:thermometer" },
      { name: "Humidity", state: "46", icon: "mdi:water-percent" },
    ],
  },
  configSchema: sensorOverviewConfig,
  resourceBindings: {
    sensors: { type: "shortcut-select", configKey: "sensors" },
  },
} as const satisfies WidgetContribution<typeof sensorOverviewConfig>;

const sensorGlanceableConfig = {
  sensor: {
    type: "shortcut-select",
    label: "Sensor",
    appIds: [APP_IDS.sensors],
  },
} as const satisfies IntegrationConfigSchema;
const sensorValueGlanceable = {
  id: "sensor-value",
  name: "Home Assistant Sensor Value",
  icon: { file: "${sensor.icon}", size: 16, description: "Selected Home Assistant sensor" },
  text: "${sensor.name}: ${sensor.state}",
  columns: [{ icon: "${sensor.icon}", text: "${sensor.state}", format: "text" }],
  properties: { label: "${sensor.name}", value: "${sensor.state}" },
  exampleProps: { sensor: { name: "Living room temperature", state: "21.5", icon: "mdi:thermometer" } },
  configSchema: sensorGlanceableConfig,
  resourceBindings: {
    sensor: { type: "shortcut-select", configKey: "sensor" },
  },
} as const satisfies GlanceableContribution<typeof sensorGlanceableConfig>;

const connectionStatusConfig = {
  connectionStatus: {
    type: "shortcut-select",
    label: "Connection status resource",
    required: true,
    default: STATUS_RESOURCE_IDS.connection,
    appIds: [APP_IDS.status],
    collectionIds: ["status"],
  },
} as const satisfies IntegrationConfigSchema;
const connectionStatusGlanceable = {
  id: "connection-status",
  name: "Home Assistant Connection",
  icon: { file: "${connection.icon}", size: 16, description: "Home Assistant connection" },
  text: "${connection.state}",
  columns: [{ icon: "${connection.icon}", text: "${connection.state}", format: "text" }],
  properties: { label: "Connection", value: "${connection.state}" },
  exampleProps: { connection: { state: "connected", icon: "mdi:lan-connect" } },
  configSchema: connectionStatusConfig,
  resourceBindings: {
    connection: { type: "shortcut-select", configKey: "connectionStatus" },
  },
} as const satisfies GlanceableContribution<typeof connectionStatusConfig>;

const lightsOnConfig = {
  lightsOn: {
    type: "shortcut-select",
    label: "Lights on resource",
    required: true,
    default: STATUS_RESOURCE_IDS.lightsOn,
    appIds: [APP_IDS.status],
    collectionIds: ["status"],
  },
} as const satisfies IntegrationConfigSchema;
const lightsOnGlanceable = {
  id: "lights-on-count",
  name: "Home Assistant Lights On",
  icon: { file: "${lightsOn.icon}", size: 16, description: "Home Assistant lights currently on" },
  text: "${lightsOn.state} lights on",
  columns: [{ icon: "${lightsOn.icon}", text: "${lightsOn.state}", format: "number" }],
  properties: { label: "Lights on", value: "${lightsOn.state}" },
  exampleProps: { lightsOn: { state: 2, icon: "mdi:lightbulb-on" } },
  configSchema: lightsOnConfig,
  resourceBindings: {
    lightsOn: { type: "shortcut-select", configKey: "lightsOn" },
  },
} as const satisfies GlanceableContribution<typeof lightsOnConfig>;

function activityError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Home Assistant integration error";
}

function eventContextId(event: unknown): string | undefined {
  if (typeof event !== "object" || event === null) return undefined;
  const context = (event as { context?: { id?: unknown } }).context;
  return typeof context?.id === "string" ? context.id : undefined;
}

const homeAssistant = defineIntegration({
  id: "homeassistant",
  name: "Home Assistant",
  version: "1.0.0",
  description: "Discover and control Home Assistant entities through Dashwise.",
  config: {
    url: { type: "url", required: true, title: "Home Assistant URL" },
    accessToken: { type: "secret", required: true, title: "Long-lived access token" },
  },
  resources: { entities: entityCollection, status: statusCollection },
  actions: actionDefinitions,
  apps: buildAppContributions(),
  widgets: [entityListWidget, sensorOverviewWidget],
  glanceables: [
    connectionStatusGlanceable,
    lightsOnGlanceable,
    sensorValueGlanceable,
  ],

  async setup(integrations) {
    if (!integrations.config.url) throw new Error("Home Assistant URL is required");
    if (!await integrations.secrets.get("accessToken")) {
      throw new Error("Home Assistant long-lived access token is required");
    }
  },

  async start(integrations) {
    const accessToken = await integrations.secrets.get("accessToken");
    if (!accessToken) throw new Error("Home Assistant long-lived access token is missing");

    const client = new HomeAssistantWebSocketClient(integrations.config.url, accessToken);
    let connectionStatus: ConnectionStatus = "connecting";
    let hasSnapshot = false;
    let lightsOn = 0;
    let statusSync = Promise.resolve();
    const publishStatuses = () => {
      const records = buildStatusResources({
        connection: connectionStatus,
        lightsOn,
        hasSnapshot,
        updatedAt: new Date().toISOString(),
      });
      statusSync = statusSync.catch(() => undefined).then(() =>
        integrations.resources.status.sync(records, { completeness: "complete" }),
      );
      return statusSync;
    };
    statusPublishers.set(integrations, async (state) => {
      connectionStatus = state;
      await publishStatuses();
    });
    let connectionLossCount = 0;
    let reportedOffline = false;
    const stopConnectionListener = client.onConnectionChange((connectionState) => {
      if (connectionState === "disconnected") {
        connectionStatus = "disconnected";
        void publishStatuses().catch((error) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error) }));
        connectionLossCount += 1;
        const thisLoss = connectionLossCount;
        integrations.scheduler.timeout("connection-lost-activity", 30_000, async (signal) => {
          if (signal.aborted) return;
          reportedOffline = true;
          await integrations.activities.publish({
            type: "homeassistant.connection.lost",
            title: "Home Assistant is unreachable",
            description: "Dashwise has not received a Home Assistant connection for 30 seconds.",
            severity: "warning",
            idempotencyKey: `${integrations.instanceId}:connection-lost:${thisLoss}`,
          });
        });
      } else if (connectionState === "ready") {
        connectionStatus = "connected";
        void publishStatuses().catch((error) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error) }));
        integrations.scheduler.cancel("connection-lost-activity");
        if (reportedOffline) {
          reportedOffline = false;
          void integrations.activities.publish({
            type: "homeassistant.connection.recovered",
            title: "Home Assistant connection recovered",
            description: "Dashwise reconnected to Home Assistant and resumed synchronization.",
            severity: "success",
            idempotencyKey: `${integrations.instanceId}:connection-recovered:${connectionLossCount}`,
          }).catch((error) => integrations.logger.error("Could not publish Home Assistant recovery activity", { error: activityError(error) }));
        }
      } else {
        connectionStatus = "reconnect_error";
        void publishStatuses().catch((error) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error) }));
        integrations.scheduler.cancel("connection-lost-activity");
        void integrations.activities.publish({
          type: "homeassistant.connection.reconnect_failed",
          title: "Home Assistant could not reconnect",
          description: "Check that Home Assistant is reachable and the configured access token is valid.",
          severity: "warning",
          idempotencyKey: `${integrations.instanceId}:reconnect-error:${connectionLossCount}`,
        }).catch((error) => integrations.logger.error("Could not publish Home Assistant connection activity", { error: activityError(error) }));
      }
    });
    integrations.onDispose(stopConnectionListener);

    try {
      await publishStatuses();
      await client.start(async (states: HassState[], registries) => {
        if (registries.registryErrors?.length) {
          integrations.logger.warn("Home Assistant registry metadata is incomplete; retaining the last known registry data", {
            errors: registries.registryErrors,
          });
        }
        const records = mapEntities(states, registries.entities);
        await integrations.resources.entities.sync(records, { completeness: "complete" });
        lightsOn = countLightsOn(records);
        hasSnapshot = true;
        if (connectionStatus === "connecting") connectionStatus = "connected";
        await publishStatuses();
      });
      attachClient(integrations, client);
      integrations.onDispose(() => detachClient(integrations));
      integrations.logger.info("Home Assistant connected and entities synchronized", {
        instanceId: integrations.instanceId,
      });
    } catch (error) {
      connectionStatus = "reconnect_error";
      await publishStatuses().catch((statusError) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(statusError) }));
      statusPublishers.delete(integrations);
      await client.stop();
      stopConnectionListener();
      throw error;
    }

    try {
      for (const eventType of [
        "entity_registry_updated",
        "device_registry_updated",
        "area_registry_updated",
      ]) {
        await client.subscribeEvent(eventType, () => {
          void client.refreshDiscovery().catch((error) => {
            integrations.logger.warn("Home Assistant registry refresh failed; retaining the last complete entity snapshot", {
              eventType,
              error: activityError(error),
            });
          });
        });
      }
      await client.subscribeEvent("homeassistant_stop", async (event) => {
        const eventId = eventContextId(event);
        await integrations.activities.publish({
          type: "homeassistant.server.stopping",
          title: "Home Assistant is restarting or shutting down",
          description: "Home Assistant announced that it is stopping.",
          severity: "warning",
          idempotencyKey: eventId ?? `${integrations.instanceId}:server-stopping:${Date.now()}`,
        });
      });
      await client.subscribeEvent("homeassistant_start", async (event) => {
        const eventId = eventContextId(event);
        await integrations.activities.publish({
          type: "homeassistant.server.started",
          title: "Home Assistant started",
          description: "Home Assistant announced that it has started.",
          severity: "success",
          idempotencyKey: eventId ?? `${integrations.instanceId}:server-started:${Date.now()}`,
        });
      });
    } catch (error) {
      integrations.logger.warn("Home Assistant lifecycle events could not be subscribed", {
        error: activityError(error),
      });
    }
  },

  async stop(integrations) {
    integrations.scheduler.cancel("connection-lost-activity");
    const publishStatus = statusPublishers.get(integrations);
    statusPublishers.delete(integrations);
    await publishStatus?.("disconnected").catch((error) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error) }));
    await stopClient(integrations);
  },
  async dispose(integrations) {
    integrations.scheduler.cancel("connection-lost-activity");
    const publishStatus = statusPublishers.get(integrations);
    statusPublishers.delete(integrations);
    await publishStatus?.("disconnected").catch((error) => integrations.logger.error("Could not update Home Assistant status resources", { error: activityError(error) }));
    await stopClient(integrations);
  },
});

export default homeAssistant;
export { homeAssistant };
