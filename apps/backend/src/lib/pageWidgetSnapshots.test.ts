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

  it("expires cached items and isolates users and pages", async () => {
    let now = 1_000;
    let calls = 0;
    const clock = () => now;
    const producer = async () => [{ call: ++calls }];
    const first = await getSharedPageWidgetSnapshot("expiry-test-user", "expiry-test-page", producer, clock);
    expect(await getSharedPageWidgetSnapshot("expiry-test-user", "expiry-test-page", producer, clock)).toBe(first);
    expect(await getSharedPageWidgetSnapshot("expiry-test-user-2", "expiry-test-page", producer, clock)).not.toBe(first);
    expect(await getSharedPageWidgetSnapshot("expiry-test-user", "expiry-test-page-2", producer, clock)).not.toBe(first);
    now += 10_000;
    expect(await getSharedPageWidgetSnapshot("expiry-test-user", "expiry-test-page", producer, clock)).not.toBe(first);
    expect(calls).toBe(4);
  });

  it("allows a failed resolution to be retried", async () => {
    let attempts = 0;
    const producer = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
      return [{ key: "recovered" }];
    };
    await expect(getSharedPageWidgetSnapshot("retry-test-user", "retry-test-page", producer)).rejects.toThrow("temporary failure");
    expect(await getSharedPageWidgetSnapshot("retry-test-user", "retry-test-page", producer)).toEqual([{ key: "recovered" }]);
    expect(attempts).toBe(2);
  });
});
