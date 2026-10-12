import type { HomeAssistantClient } from "./ha-types";
import type { IntegrationAction, ResourceRecord } from "@dashwise/integrations-sdk";
import { getDomain } from "./mapping";

const clients = new WeakMap<object, HomeAssistantClient>();

export function attachClient(integrations: object, client: HomeAssistantClient): void {
  clients.set(integrations, client);
}

export function detachClient(integrations: object): void {
  clients.delete(integrations);
}

export async function stopClient(integrations: object): Promise<void> {
  const client = clients.get(integrations);
  clients.delete(integrations);
  await client?.stop();
}

function clientFor(integrations: object): HomeAssistantClient {
  const client = clients.get(integrations);
  if (!client) throw new Error("Home Assistant connection is not running");
  return client;
}

function targetFor(resource: ResourceRecord): Record<string, unknown> {
  return { entity_id: resource.id };
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function isNumberTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

async function call(
  integrations: object,
  resource: ResourceRecord,
  service: string,
  data?: Record<string, unknown>,
): Promise<{ accepted: true; entityId: string; service: string }> {
  const domain = resource.type ?? getDomain(resource.id);
  await clientFor(integrations).callService(domain, service, data, targetFor(resource));
  // Home Assistant's call_service result acknowledges command execution, not
  // the resulting state. The entity subscription is the source of confirmation.
  return { accepted: true, entityId: resource.id, service: `${domain}.${service}` };
}

export const actions = {
  openDetails: {
    id: "openDetails",
    name: "Open details",
    async execute(_integrations: object, resource: ResourceRecord) {
      return { entityId: resource.id, domain: resource.type ?? getDomain(resource.id) };
    },
  },
  toggle: {
    id: "toggle",
    name: "Toggle",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "toggle");
    },
  },
  turnOn: {
    id: "turnOn",
    name: "Turn on",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "turn_on");
    },
  },
  turnOff: {
    id: "turnOff",
    name: "Turn off",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "turn_off");
    },
  },
  setBrightness: {
    id: "setBrightness",
    name: "Set brightness",
    inputSchema: {
      type: "object",
      required: ["brightness"],
      properties: { brightness: { type: "integer", minimum: 0, maximum: 255 } },
      additionalProperties: false,
    },
    async execute(integrations: object, resource: ResourceRecord, input: unknown) {
      const { brightness } = objectInput(input);
      if (typeof brightness !== "number" || !Number.isInteger(brightness) || brightness < 0 || brightness > 255) {
        throw new Error("Brightness must be an integer between 0 and 255");
      }
      return call(integrations, resource, "turn_on", { brightness });
    },
  },
  setColor: {
    id: "setColor",
    name: "Set color",
    inputSchema: {
      type: "object",
      properties: {
        rgb_color: { type: "array", items: { type: "integer", minimum: 0, maximum: 255 } },
        hs_color: { type: "array", items: { type: "number" } },
        color_temp_kelvin: { type: "integer", minimum: 1000, maximum: 40000 },
      },
      additionalProperties: false,
    },
    async execute(integrations: object, resource: ResourceRecord, input: unknown) {
      const values = objectInput(input);
      const supported = ["rgb_color", "hs_color", "color_temp_kelvin"]
        .filter((key) => values[key] !== undefined);
      if (supported.length !== 1) throw new Error("Provide exactly one supported color value");
      if (values.rgb_color !== undefined && (!isNumberTuple(values.rgb_color, 3) || values.rgb_color.some((v) => !Number.isInteger(v) || v < 0 || v > 255))) {
        throw new Error("RGB color must contain three integers from 0 to 255");
      }
      if (values.hs_color !== undefined && (!isNumberTuple(values.hs_color, 2) || values.hs_color[0]! < 0 || values.hs_color[0]! > 360 || values.hs_color[1]! < 0 || values.hs_color[1]! > 100)) {
        throw new Error("HS color must contain a hue from 0 to 360 and saturation from 0 to 100");
      }
      if (values.color_temp_kelvin !== undefined && (typeof values.color_temp_kelvin !== "number" || !Number.isInteger(values.color_temp_kelvin) || values.color_temp_kelvin < 1000 || values.color_temp_kelvin > 40000)) {
        throw new Error("Color temperature must be an integer from 1000 to 40000 Kelvin");
      }
      return call(integrations, resource, "turn_on", values);
    },
  },
  enable: {
    id: "enable",
    name: "Enable",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "turn_on");
    },
  },
  disable: {
    id: "disable",
    name: "Disable",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "turn_off");
    },
  },
  trigger: {
    id: "trigger",
    name: "Trigger",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "trigger");
    },
  },
  setValue: {
    id: "setValue",
    name: "Set value",
    inputSchema: {
      type: "object",
      required: ["value"],
      properties: { value: {} },
      additionalProperties: false,
    },
    async execute(integrations: object, resource: ResourceRecord, input: unknown) {
      const { value } = objectInput(input);
      switch (resource.type ?? getDomain(resource.id)) {
        case "input_number": return call(integrations, resource, "set_value", { value });
        case "input_text": return call(integrations, resource, "set_value", { value });
        case "input_select": return call(integrations, resource, "select_option", { option: value });
        case "input_datetime": {
          const data = typeof value === "object" && value !== null && !Array.isArray(value)
            ? value as Record<string, unknown>
            : {};
          if (!data.date && !data.time && !data.datetime) throw new Error("Input datetime requires date, time, or datetime");
          return call(integrations, resource, "set_datetime", data);
        }
        case "number": return call(integrations, resource, "set_value", { value });
        default: throw new Error(`Setting values is not supported for ${resource.type ?? getDomain(resource.id)}`);
      }
    },
  },
  press: {
    id: "press",
    name: "Press",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "press");
    },
  },
  open: {
    id: "open",
    name: "Open cover",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "open_cover");
    },
  },
  close: {
    id: "close",
    name: "Close cover",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "close_cover");
    },
  },
  stop: {
    id: "stop",
    name: "Stop cover",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "stop_cover");
    },
  },
  lock: {
    id: "lock",
    name: "Lock",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "lock");
    },
  },
  unlock: {
    id: "unlock",
    name: "Unlock",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "unlock");
    },
  },
  setTemperature: {
    id: "setTemperature",
    name: "Set target temperature",
    inputSchema: {
      type: "object",
      required: ["temperature"],
      properties: { temperature: { type: "number" } },
      additionalProperties: false,
    },
    async execute(integrations: object, resource: ResourceRecord, input: unknown) {
      const { temperature } = objectInput(input);
      if (typeof temperature !== "number" || !Number.isFinite(temperature)) throw new Error("Temperature must be a finite number");
      return call(integrations, resource, "set_temperature", { temperature });
    },
  },
  start: {
    id: "start",
    name: "Start timer",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "start");
    },
  },
  pause: {
    id: "pause",
    name: "Pause timer",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "pause");
    },
  },
  cancel: {
    id: "cancel",
    name: "Cancel timer",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "cancel");
    },
  },
  increment: {
    id: "increment",
    name: "Increment counter",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "increment");
    },
  },
  decrement: {
    id: "decrement",
    name: "Decrement counter",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "decrement");
    },
  },
  reset: {
    id: "reset",
    name: "Reset counter",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "reset");
    },
  },
  execute: {
    id: "execute",
    name: "Run script",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "turn_on");
    },
  },
  activate: {
    id: "activate",
    name: "Activate scene",
    async execute(integrations: object, resource: ResourceRecord) {
      return call(integrations, resource, "turn_on");
    },
  },
} satisfies Record<string, IntegrationAction<any, ResourceRecord, any, any>>;

