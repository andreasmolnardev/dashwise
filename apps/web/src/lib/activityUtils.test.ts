import { describe, expect, test } from "bun:test";
import { formatActivityTime, safeActivityTarget } from "./activityUtils";

describe("activity utilities", () => {
  test("allows safe same-origin paths and preserves query and hash", () => {
    expect(safeActivityTarget("/apps/monitoring?host=one#status")).toBe("/apps/monitoring?host=one#status");
  });

  test("rejects external, protocol-relative, and malformed paths", () => {
    expect(safeActivityTarget("https://example.com")).toBeNull();
    expect(safeActivityTarget("//example.com/path")).toBeNull();
    expect(safeActivityTarget("/\\\\example.com")).toBeNull();
  });

  test("formats activity times and handles invalid dates", () => {
    expect(formatActivityTime("bad date", 0)).toBe("");
    expect(formatActivityTime("1970-01-01T00:00:00.000Z", 0)).toBe("now");
  });
});
