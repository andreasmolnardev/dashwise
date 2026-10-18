import { describe, expect, it } from "bun:test";
import { getSharedPageWidgetSnapshot } from "./pageWidgetSnapshots";

describe("shared page widget snapshots", () => {
  it("coalesces concurrent resolutions and shares the resulting items by user and page", async () => {
    let resolve!: (items: Array<Record<string, unknown>>) => void;
    let calls = 0;
    const producer = () => {
      calls += 1;
      return new Promise<Array<Record<string, unknown>>>((done) => { resolve = done; });
    };

    const first = getSharedPageWidgetSnapshot("snapshot-test-user", "snapshot-test-page", producer);
    const second = getSharedPageWidgetSnapshot("snapshot-test-user", "snapshot-test-page", producer);
    expect(calls).toBe(1);
    const items = [{ key: "weather", data: { temperature: 21 } }];
    resolve(items);
    expect(await first).toBe(items);
    expect(await second).toBe(items);
    expect(await getSharedPageWidgetSnapshot("snapshot-test-user", "snapshot-test-page", producer)).toBe(items);
    expect(calls).toBe(1);

    await getSharedPageWidgetSnapshot("snapshot-test-user", "another-page", async () => []);
    expect(calls).toBe(1);
  });
});
