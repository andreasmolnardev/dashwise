import { describe, expect, it } from "bun:test";
import { actionsForEntity, appsForEntity, mapEntities, mapEntity } from "../src/mapping";
import type { HassState } from "../src/ha-types";

function state(entityId: string, value: string, attributes: Record<string, unknown> = {}): HassState {
  return { entity_id: entityId, state: value, attributes };
}

describe("Home Assistant entity mapping", () => {
  it("keeps one entity shortcut identity while assigning it to all relevant Apps", () => {
    const entity = mapEntity(state("light.desk", "on", { friendly_name: "Desk" }), {
      entity_id: "light.desk",
      unique_id: "ha-unique-desk",
      device_id: "device-1",
      area_id: "office",
    });

    expect(entity.id).toBe("light.desk");
    expect(entity.upstreamId).toBe("ha-unique-desk");
    expect(entity.apps).toEqual(["entities", "lights", "devices"]);
    expect(entity.tags).toContain("area:office");
  });

  it("assigns domain-specific Apps and never offers controls to sensors", () => {
    expect(appsForEntity("sensor.temperature")).toEqual(["entities", "sensors"]);
    expect(actionsForEntity("sensor.temperature", state("sensor.temperature", "21"))).toEqual(["openDetails"]);
  });

  it("only exposes color controls when Home Assistant reports color modes", () => {
    const colorLight = state("light.rgb", "on", { supported_color_modes: ["rgb"] });
    const whiteLight = state("light.white", "on", { supported_color_modes: ["brightness"] });
    expect(actionsForEntity(colorLight.entity_id, colorLight)).toContain("setColor");
    expect(actionsForEntity(whiteLight.entity_id, whiteLight)).not.toContain("setColor");
    expect(actionsForEntity(whiteLight.entity_id, whiteLight)).toContain("setBrightness");
  });

  it("omits disabled registry entities while retaining entities without metadata", () => {
    const entities = mapEntities([
      state("light.enabled", "off"),
      state("sensor.disabled", "unknown"),
      state("sensor.no_registry", "22"),
    ], [{ entity_id: "sensor.disabled", disabled_by: "user" }]);
    expect(entities.map((entity) => entity.id)).toEqual(["light.enabled", "sensor.no_registry"]);
  });

  it("marks unknown and unavailable upstream states unavailable", () => {
    expect(mapEntity(state("sensor.offline", "unavailable")).available).toBe(false);
    expect(mapEntity(state("sensor.starting", "unknown")).available).toBe(false);
    expect(mapEntity(state("sensor.ok", "0")).available).toBe(true);
  });
});
