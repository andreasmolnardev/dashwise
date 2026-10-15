import { describe, expect, test } from "bun:test";
import jellyfin from "../src/index";

const audio = (id: string) => ({ Id: id, Name: id, Type: "Audio" });

function startupRuntime(pages: (startIndex: number, limit: number) => unknown) {
  const requests: URL[] = [];
  const syncs: Array<{ resources: unknown[]; options: unknown }> = [];
  const runtime: any = {
    instanceId: "jf-instance",
    config: { serverUrl: "https://jelly.example", userId: "user-1" },
    secrets: { get: async () => "token" },
    http: {
      assertSafeUrl: async (url: string) => new URL(url),
      fetch: async (input: string) => {
        const url = new URL(input);
        requests.push(url);
        return Response.json(pages(Number(url.searchParams.get("StartIndex")), Number(url.searchParams.get("Limit"))));
      },
    },
    resources: { items: { sync: async (resources: unknown[], options: unknown) => syncs.push({ resources, options }) } },
    scheduler: { every() {} },
    onDispose() {},
  };
  return { runtime, requests, syncs };
}

describe("Jellyfin library startup pagination", () => {
  test("fetches all pages before one complete sync and deduplicates IDs", async () => {
    const first = Array.from({ length: 500 }, (_, index) => audio(`audio-${index}`));
    const { runtime, requests, syncs } = startupRuntime((startIndex) => startIndex === 0
      ? { Items: first, TotalRecordCount: 501 }
      : { Items: [audio("audio-500"), audio("audio-499")], TotalRecordCount: 501 });

    await (jellyfin as any).start(runtime);

    expect(requests.map((url) => url.searchParams.get("StartIndex"))).toEqual(["0", "500"]);
    expect(requests.every((url) => url.searchParams.get("Limit") === "500")).toBe(true);
    expect(syncs).toHaveLength(1);
    expect((syncs[0]!.resources as Array<{ id: string }>).length).toBe(501);
    expect(new Set((syncs[0]!.resources as Array<{ id: string }>).map(({ id }) => id)).size).toBe(501);
    expect(syncs[0]!.options).toEqual({ completeness: "complete" });
  });

  test("does not replace the snapshot if a later page is malformed", async () => {
    const { runtime, requests, syncs } = startupRuntime((startIndex) => startIndex === 0
      ? { Items: [audio("audio-1")], TotalRecordCount: 501 }
      : { Invalid: [] });

    await expect((jellyfin as any).start(runtime)).rejects.toThrow("invalid item list");
    expect(requests).toHaveLength(2);
    expect(syncs).toHaveLength(0);
  });
});
