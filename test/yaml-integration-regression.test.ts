import { describe, expect, test } from "bun:test";
import { weatherIntegrationBlueprint } from "../packages/assets/index";

describe("bundled YAML integration compatibility", () => {
  test("loads the Weather blueprint with its endpoint, computed data, Widgets, and Glanceables", () => {
    const weather = weatherIntegrationBlueprint as {
      details: { name: string };
      configuration: {
        environment_variables: Record<string, { type?: string; required?: boolean }>;
        endpoints: Record<string, { method: string; url: string; response_mapping: unknown }>;
        computed: Record<string, { fields: Record<string, unknown> }>;
        widgets: Array<{ key: string; data: { source: string } }>;
        glanceables: Array<{ key: string }>;
        cache: { policy: string; retention: number };
      };
    };

    expect(weather.details.name).toBe("Weather");
    expect(weather.configuration.environment_variables).toMatchObject({
      WEATHER_LOCATION: { type: "location", required: true },
      UNIT: { type: "select", required: false },
    });
    expect(weather.configuration.endpoints["fetch-weather"]).toMatchObject({
      method: "GET",
      url: expect.stringContaining("api.open-meteo.com/v1/forecast"),
      response_mapping: expect.any(Object),
    });
    expect(weather.configuration.computed.weather.fields).toMatchObject({
      temperature: expect.any(String),
      description: { operation: "lookup", table: "weather_code_map" },
      insight: { operation: "expr" },
    });
    expect(weather.configuration.widgets.map(({ key }) => key)).toEqual([
      "weather-forecast",
      "current-weather",
    ]);
    expect(weather.configuration.widgets.every(({ data }) => data.source === "computed.weather")).toBe(true);
    expect(weather.configuration.glanceables.map(({ key }) => key)).toEqual(["local-weather", "sunrise-sunset"]);
    expect(weather.configuration.cache).toEqual({ policy: "strict", retention: 300 });
  });
});
