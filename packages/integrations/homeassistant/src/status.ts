import type { JsonValue, ResourceRecord } from "@dashwise/integrations-sdk";
import { APP_IDS, type MappedEntity } from "./mapping";

export const STATUS_RESOURCE_IDS = {
  connection: "connection",
  lightsOn: "lights-on",
} as const;

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnect_error";

export type StatusResource = ResourceRecord & {
  type: "connection-status" | "lights-on-count";
  state: string | number;
  attributes: Record<string, JsonValue>;
  apps: string[];
  available: boolean;
};

export function countLightsOn(entities: readonly MappedEntity[]): number {
  return entities.filter((entity) => entity.apps.includes(APP_IDS.lights) && entity.state === "on").length;
}

export function buildStatusResources(input: {
  connection: ConnectionStatus;
  lightsOn: number;
  hasSnapshot: boolean;
  updatedAt: string;
}): [StatusResource, StatusResource] {
  const connected = input.connection === "connected";
  return [
    {
      id: STATUS_RESOURCE_IDS.connection,
      name: "Home Assistant connection",
      icon: connected ? "mdi:lan-connect" : "mdi:lan-disconnect",
      type: "connection-status",
      state: input.connection,
      attributes: { connected, lastUpdated: input.updatedAt },
      available: true,
      apps: [APP_IDS.status],
      updatedAt: input.updatedAt,
    },
    {
      id: STATUS_RESOURCE_IDS.lightsOn,
      name: "Lights on",
      icon: "mdi:lightbulb-on",
      type: "lights-on-count",
      state: input.lightsOn,
      attributes: { count: input.lightsOn },
      available: input.hasSnapshot && connected,
      apps: [APP_IDS.status],
      updatedAt: input.updatedAt,
    },
  ];
}
