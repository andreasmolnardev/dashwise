import { describe, expect, it } from "bun:test";
import { mapEntities } from "../src/mapping";
import { buildStatusResources, countLightsOn, STATUS_RESOURCE_IDS } from "../src/status";

describe("Home Assistant status resources", () => {
  it("counts enabled lights in the on state only", () => {
    const entities = mapEntities([
      { entity_id: "light.kitchen", state: "on", attributes: {} },
      { entity_id: "light.hall", state: "off", attributes: {} },
      { entity_id: "light.disabled", state: "on", attributes: {} },
      { entity_id: "switch.plug", state: "on", attributes: {} },
    ], [{ entity_id: "light.disabled", disabled_by: "user" }]);

    expect(countLightsOn(entities)).toBe(1);
  });

  it("publishes connection and light metrics as status App shortcuts", () => {
    const [connection, lightsOn] = buildStatusResources({
      connection: "connected",
      lightsOn: 3,
      hasSnapshot: true,
      updatedAt: "2026-10-11T20:00:00.000Z",
    });

    expect(connection.id).toBe(STATUS_RESOURCE_IDS.connection);
    expect(connection.state).toBe("connected");
    expect(connection.available).toBe(true);
    expect(connection.apps).toEqual(["status"]);
    expect(lightsOn.id).toBe(STATUS_RESOURCE_IDS.lightsOn);
    expect(lightsOn.state).toBe(3);
    expect(lightsOn.attributes.count).toBe(3);
    expect(lightsOn.available).toBe(true);
    expect(lightsOn.apps).toEqual(["status"]);
  });

  it("keeps connection state visible while withholding an unverified light count", () => {
    const [connection, lightsOn] = buildStatusResources({
      connection: "disconnected",
      lightsOn: 2,
      hasSnapshot: true,
      updatedAt: "2026-10-11T20:00:00.000Z",
    });

    expect(connection.state).toBe("disconnected");
    expect(connection.available).toBe(true);
    expect(lightsOn.state).toBe(2);
    expect(lightsOn.available).toBe(false);
  });
});
