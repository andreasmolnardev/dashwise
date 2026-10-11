import { describe, expect, it } from "bun:test";
import { homeAssistant } from "../src";

describe("Home Assistant widget and glanceable contributions", () => {
  it("declares renderable list Widgets bound to live entity resources", () => {
    expect(homeAssistant.widgets?.map((widget) => widget.template)).toEqual([
      "vertical-list",
      "vertical-list",
    ]);
    expect(homeAssistant.widgets?.[0]?.resourceBindings).toEqual({
      entities: { type: "shortcut-select", configKey: "selectedEntities" },
    });
    expect(homeAssistant.widgets?.[1]?.resourceBindings).toEqual({
      sensors: { type: "shortcut-select", configKey: "sensors" },
    });
    expect(homeAssistant.widgets?.every((widget) => Boolean(
      widget.properties?.list && Object.keys(widget.exampleProps ?? {}).length,
    ))).toBe(true);
  });

  it("declares visible sensor and status Glanceables backed by live resource bindings", () => {
    const glanceables = Object.fromEntries(homeAssistant.glanceables?.map((item) => [item.id, item]) ?? []);
    for (const id of ["sensor-value", "connection-status", "lights-on-count"]) {
      const glanceable = glanceables[id];
      expect(glanceable?.text).toBeString();
      expect(glanceable?.icon).toBeDefined();
      expect(glanceable?.columns?.length).toBeGreaterThan(0);
      expect(glanceable?.resourceBindings).toBeDefined();
    }
    expect(Object.keys(homeAssistant.resources)).toContain("status");
  });
});
