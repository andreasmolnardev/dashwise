import { afterEach, describe, expect, mock, test } from "bun:test";

const saveSystemAgentStats = mock(async (_hostId: string, _stats: Record<string, unknown>) => undefined);
const updateSystemAgentConnection = mock(async (_hostId: string, _status: string, _info?: Record<string, unknown>) => undefined);

mock.module("./data/monitoring", () => ({
  getAllSystemAgentHosts: async () => [],
  getSystemAgentToken: () => "test-token",
  getSystemAgentUrl: () => "http://agent.test",
  saveSystemAgentStats,
  updateSystemAgentConnection,
}));

class TestWebSocket {
  static OPEN = 1;
  readyState = TestWebSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() { this.readyState = 3; }
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const host = { id: "system-agent-test", credentialEncrypted: "test", systemInfo: { liveUrl: "ws://agent.test/live" } } as any;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  saveSystemAgentStats.mockClear();
  updateSystemAgentConnection.mockClear();
});

describe("System Agent polling", () => {
  test("uses fresh live samples instead of polling metrics and flushes the latest coalesced value on stop", async () => {
    const paths: string[] = [];
    let failHttp = false;
    globalThis.fetch = mock(async (input: Parameters<typeof fetch>[0]) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return Response.json(
        path.endsWith("/system") ? { name: "agent" } : { timestamp: "http", metrics: { cpu: { average: 1 } } },
        { status: failHttp ? 503 : 200 },
      );
    }) as unknown as typeof fetch;
    globalThis.WebSocket = TestWebSocket as unknown as typeof WebSocket;

    const { SystemAgentClient } = await import("./systemAgent");
    const client = new SystemAgentClient();
    try {
      await client.refresh(host);
      expect(paths.filter((path) => path.endsWith("/metrics/latest"))).toHaveLength(1);

      const socket = (client as any).sockets.get(host.id) as TestWebSocket;
      socket.onmessage?.({ data: JSON.stringify({ timestamp: "live-1", metrics: { cpu: { average: 2 } } }) });
      socket.onmessage?.({ data: JSON.stringify({ timestamp: "live-2", metrics: { cpu: { average: 3 } } }) });
      await client.refresh(host);
      expect(paths.filter((path) => path.endsWith("/metrics/latest"))).toHaveLength(1);

      (client as any).lastLiveSampleAt.set(host.id, Date.now() - 60_000);
      failHttp = true;
      await client.refresh(host);
      expect(updateSystemAgentConnection.mock.calls.map((call) => call[1])).toContain("offline");

      failHttp = false;
      await client.refresh(host);
      expect(paths.filter((path) => path.endsWith("/metrics/latest"))).toHaveLength(3);
      expect(updateSystemAgentConnection.mock.calls.map((call) => call[1])).toEqual(["online", "offline", "online"]);
    } finally {
      client.stop(host.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveSystemAgentStats).toHaveBeenCalledTimes(1);
    expect(saveSystemAgentStats.mock.calls[0]?.[1].current).toMatchObject({ timestamp: "http" });
  });
});
