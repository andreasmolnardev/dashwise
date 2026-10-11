import { describe, expect, it } from "bun:test";
import { parseEntitySnapshot } from "../src/snapshot";

describe("Home Assistant authoritative snapshots", () => {
  it("accepts a valid empty snapshot as a successful result", () => {
    expect(parseEntitySnapshot({})).toEqual([]);
  });

  it("rejects failed or malformed discovery values instead of treating them as empty", () => {
    expect(() => parseEntitySnapshot(null)).toThrow("invalid entity snapshot");
    expect(() => parseEntitySnapshot([])).toThrow("invalid entity snapshot");
    expect(() => parseEntitySnapshot({ "light.desk": { state: "on", attributes: {} } })).toThrow("incomplete entity state");
  });
});
