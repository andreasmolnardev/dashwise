import { describe, expect, it } from "bun:test";
import { normalizeHomeAssistantUrl } from "../src/client";

describe("Home Assistant connection URL", () => {
  it("preserves a reverse proxy path and removes query and fragment values", () => {
    expect(normalizeHomeAssistantUrl(" https://ha.example/homeassistant/?view=dashboard#home "))
      .toBe("https://ha.example/homeassistant");
  });

  it("rejects non-HTTP protocols and embedded credentials", () => {
    expect(() => normalizeHomeAssistantUrl("ws://ha.example")).toThrow("http or https");
    expect(() => normalizeHomeAssistantUrl("https://user:secret@ha.example")).toThrow("Credentials");
  });
});
