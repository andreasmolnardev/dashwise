import type { EntityRegistryEntry, HassState } from "./ha-types";
import type { JsonValue, ResourceRecord } from "@dashwise/integrations-sdk";

export const APP_IDS = {
  entities: "entities",
  lights: "lights",
  automations: "automations",
  helpers: "helpers",
  sensors: "sensors",
  scenes: "scenes",
  scripts: "scripts",
  devices: "devices",
} as const;

export type HomeAssistantAction =
  | "openDetails"
  | "toggle"
  | "turnOn"
  | "turnOff"
  | "setBrightness"
  | "setColor"
  | "enable"
  | "disable"
  | "trigger"
  | "setValue"
  | "press"
  | "open"
  | "close"
  | "stop"
  | "lock"
  | "unlock"
  | "setTemperature"
  | "start"
  | "pause"
  | "cancel"
  | "increment"
  | "decrement"
  | "reset"
  | "execute"
  | "activate";

export type MappedEntity = ResourceRecord & {
  type: string;
  state: string;
  attributes: Record<string, JsonValue>;
  actions: HomeAssistantAction[];
  apps: string[];
};

const HELPER_DOMAINS = new Set([
  "input_boolean", "input_button", "input_datetime", "input_number",
  "input_select", "input_text", "counter", "timer",
]);
const SENSOR_DOMAINS = new Set(["sensor", "binary_sensor"]);

export function getDomain(entityId: string): string {
  return entityId.split(".", 1)[0]?.toLowerCase() ?? "unknown";
}

export function appsForEntity(entityId: string, deviceId?: string | null): string[] {
  const domain = getDomain(entityId);
  const apps: string[] = [APP_IDS.entities];
  if (domain === "light") apps.push(APP_IDS.lights);
  if (domain === "automation") apps.push(APP_IDS.automations);
  if (HELPER_DOMAINS.has(domain)) apps.push(APP_IDS.helpers);
  if (SENSOR_DOMAINS.has(domain)) apps.push(APP_IDS.sensors);
  if (domain === "scene") apps.push(APP_IDS.scenes);
  if (domain === "script") apps.push(APP_IDS.scripts);
  if (deviceId) apps.push(APP_IDS.devices);
  return apps;
}

export function actionsForEntity(entityId: string, state: HassState): HomeAssistantAction[] {
  const domain = getDomain(entityId);
  if (state.state === "unavailable" || state.state === "unknown") return ["openDetails"];
  const actions: HomeAssistantAction[] = ["openDetails"];
  if (domain === "light") {
    actions.push("toggle", "turnOn", "turnOff");
    const modes = Array.isArray(state.attributes.supported_color_modes)
      ? state.attributes.supported_color_modes
      : [];
    if (typeof state.attributes.brightness === "number" || modes.some((mode) => mode !== "onoff")) {
      actions.push("setBrightness");
    }
    if (modes.some((mode) => ["hs", "xy", "rgb", "rgbw", "rgbww"].includes(String(mode)))) {
      actions.push("setColor");
    }
  } else if (["switch", "input_boolean"].includes(domain)) {
    actions.push("toggle", "turnOn", "turnOff");
  } else if (domain === "automation") {
    actions.push("enable", "disable", "trigger");
  } else if (domain === "input_button") {
    actions.push("press");
  } else if (domain === "script") {
    actions.push("execute");
  } else if (domain === "scene") {
    actions.push("activate");
  } else if (["input_number", "input_text", "input_select", "input_datetime", "number"].includes(domain)) {
    actions.push("setValue");
  } else if (domain === "cover") {
    actions.push("open", "close", "stop");
  } else if (domain === "lock") {
    actions.push("lock", "unlock");
  } else if (domain === "fan") {
    actions.push("turnOn", "turnOff");
  } else if (domain === "climate") {
    actions.push("setTemperature");
  } else if (domain === "timer") {
    actions.push("start", "pause", "cancel");
  } else if (domain === "media_player") {
    actions.push("turnOn", "turnOff");
  }
  if (domain === "counter") actions.push("increment", "decrement", "reset");
  return actions;
}

export function mapEntity(
  state: HassState,
  registryEntry?: EntityRegistryEntry,
): MappedEntity {
  const domain = getDomain(state.entity_id);
  const name = registryEntry?.name || registryEntry?.original_name ||
    String(state.attributes.friendly_name || state.entity_id);
  const icon = typeof state.attributes.icon === "string"
    ? state.attributes.icon
    : defaultIcon(domain);
  const apps = appsForEntity(state.entity_id, registryEntry?.device_id);
  return {
    id: state.entity_id,
    name,
    icon,
    type: domain,
    tags: [domain, ...apps, ...(registryEntry?.area_id ? [`area:${registryEntry.area_id}`] : [])],
    state: state.state,
    attributes: jsonObject(state.attributes),
    available: state.state !== "unavailable" && state.state !== "unknown",
    actions: actionsForEntity(state.entity_id, state),
    updatedAt: state.last_updated ?? state.last_changed,
    upstreamId: registryEntry?.unique_id,
    apps,
  };
}

function jsonObject(value: Record<string, unknown>): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = jsonValue(item);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => jsonValue(item) ?? null);
  if (typeof value === "object") return jsonObject(value as Record<string, unknown>);
  return undefined;
}

export function mapEntities(
  states: HassState[],
  registryEntries: EntityRegistryEntry[] = [],
): MappedEntity[] {
  const registry = new Map(registryEntries.map((entry) => [entry.entity_id, entry]));
  return states
    .filter((state) => !registry.get(state.entity_id)?.disabled_by)
    .map((state) => mapEntity(state, registry.get(state.entity_id)));
}

function defaultIcon(domain: string): string {
  const icons: Record<string, string> = {
    light: "mdi:lightbulb", switch: "mdi:toggle-switch", automation: "mdi:robot",
    sensor: "mdi:eye", binary_sensor: "mdi:eye", scene: "mdi:palette",
    script: "mdi:script-text", device_tracker: "mdi:account", climate: "mdi:thermostat",
  };
  return icons[domain] ?? "mdi:home-assistant";
}

