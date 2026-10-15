import { describe, expect, test } from "bun:test";
import { assertSafeIntegrationUrl, createGuardedIntegrationWebSocket, guardedIntegrationFetch, pinIntegrationHttpRequest } from "./network-guard";

const privateResolver = async () => ["192.168.1.20"];

describe("SDK integration outbound network guard", () => {
  test("permits private homelab endpoints only when explicitly configured", async () => {
    await expect(assertSafeIntegrationUrl("http://192.168.1.20:8123", ["http:"], privateResolver))
      .rejects.toThrow("not explicitly configured");
    await expect(assertSafeIntegrationUrl("http://192.168.1.20:8123", ["http:"], privateResolver, ["http://192.168.1.20:8123"]))
      .resolves.toMatchObject({
      hostname: "192.168.1.20",
      port: "8123",
    });
    await expect(assertSafeIntegrationUrl("https://ha.home.arpa", ["https:"], privateResolver, ["https://ha.home.arpa"]))
      .resolves.toMatchObject({ hostname: "ha.home.arpa" });
    await expect(assertSafeIntegrationUrl("wss://ha.home.arpa", ["wss:"], privateResolver, ["https://ha.home.arpa"]))
      .resolves.toMatchObject({ hostname: "ha.home.arpa" });
    await expect(assertSafeIntegrationUrl("http://192.168.1.20:8124", ["http:"], privateResolver, ["http://192.168.1.20:8123"]))
      .rejects.toThrow("not explicitly configured");
  });

  test("rejects cloud metadata names and literal addresses, including alternate IP forms", async () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://2852039166/latest/meta-data/",
      "http://169.254.2.4/",
      "http://100.100.100.200/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://metadata.google.internal./",
    ]) {
      await expect(assertSafeIntegrationUrl(url)).rejects.toThrow("cloud metadata endpoint");
    }
  });

  test("requires exact configuration for IPv4 and IPv6 special-use addresses", async () => {
    await expect(assertSafeIntegrationUrl("http://10.0.0.8:8080"))
      .rejects.toThrow("not explicitly configured");
    await expect(assertSafeIntegrationUrl("http://[fd00::1]:8123"))
      .rejects.toThrow("not explicitly configured");
    await expect(assertSafeIntegrationUrl("http://[fd00::1]:8123", ["http:"], undefined, ["http://[fd00::1]:8123"]))
      .resolves.toMatchObject({ hostname: "[fd00::1]", port: "8123" });
    await expect(assertSafeIntegrationUrl("https://[2606:4700:4700::1111]"))
      .resolves.toMatchObject({ hostname: "[2606:4700:4700::1111]" });
  });

  test("rejects a hostname that resolves to a metadata address", async () => {
    await expect(assertSafeIntegrationUrl("http://ha.home.arpa", ["http:"], async () => ["169.254.169.254"]))
      .rejects.toThrow("resolves to a cloud metadata endpoint");
  });

  test("rejects unresolved hostnames before fetch can resolve them differently", async () => {
    await expect(assertSafeIntegrationUrl("http://ha.home.arpa", ["http:"], async () => {
      throw new Error("no DNS answer");
    })).rejects.toThrow("hostname could not be resolved");
  });

  test("blocks cross-origin redirects before issuing the redirected request", async () => {
    let calls = 0;
    const fetchImpl = async (_request: Request) => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "https://other.example/status" } });
    };

    await expect(guardedIntegrationFetch("http://ha.home.arpa/status", {}, {
      resolveHost: async (hostname) => hostname === "ha.home.arpa" ? ["192.168.1.20"] : ["93.184.216.34"],
      allowedPrivateUrls: ["http://ha.home.arpa"],
      fetchImpl,
    })).rejects.toThrow("cross-origin redirect");
    expect(calls).toBe(1);
  });

  test("follows same-origin redirects and preserves the request", async () => {
    const requests: Request[] = [];
    const fetchImpl = async (input: Request) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return requests.length === 1
        ? new Response(null, { status: 307, headers: { location: "/v2/status" } })
        : new Response("ok", { status: 200 });
    };

    const response = await guardedIntegrationFetch("http://ha.home.arpa/status", {
      method: "POST",
      body: "payload",
      headers: { "content-type": "text/plain" },
    }, { resolveHost: privateResolver, allowedPrivateUrls: ["http://ha.home.arpa"], fetchImpl });

    expect(await response.text()).toBe("ok");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toBe("http://ha.home.arpa/v2/status");
    expect(requests[1]?.method).toBe("POST");
    expect(await requests[1]?.text()).toBe("payload");
  });

  test("preserves the validated WebSocket hostname", async () => {
    let target: string | URL | undefined;
    let options: Bun.WebSocketOptions | undefined;
    const socket = {} as WebSocket;
    await createGuardedIntegrationWebSocket("wss://ha.home.arpa:8443/api/websocket", ["ha-v1"], {
      resolveHost: privateResolver,
      allowedPrivateUrls: ["https://ha.home.arpa:8443"],
      webSocketFactory(url, init) {
        target = url;
        options = init;
        return socket;
      },
    });

    expect(target?.toString()).toBe("wss://ha.home.arpa:8443/api/websocket");
    expect(options?.headers).toEqual({ Host: "ha.home.arpa:8443" });
    expect((options as { protocols?: string | string[] } | undefined)?.protocols).toEqual(["ha-v1"]);
    expect(options?.tls?.serverName).toBe("ha.home.arpa");
  });

  test("passes the checked DNS address to the HTTP transport", async () => {
    let checkedAddress: string | undefined;
    const response = await guardedIntegrationFetch("https://status.example/health", {}, {
      resolveHost: async () => ["93.184.216.34"],
      fetchImpl: async (_request, destination) => {
        checkedAddress = destination.address;
        return new Response("ok");
      },
    });

    expect(await response.text()).toBe("ok");
    expect(checkedAddress).toBe("93.184.216.34");
  });

  test("pins HTTP transport to the checked address while preserving the origin host and TLS name", () => {
    const { request, init } = pinIntegrationHttpRequest(
      new Request("https://status.example/health?full=1", { headers: { Authorization: "Bearer test" } }),
      new URL("https://status.example/health?full=1"),
      "93.184.216.34",
    );
    expect(request.url).toBe("https://93.184.216.34/health?full=1");
    expect(request.headers.get("host")).toBe("status.example");
    expect(request.headers.get("authorization")).toBe("Bearer test");
    expect((init as RequestInit & { tls?: { serverName: string }; proxy?: false }).tls?.serverName).toBe("status.example");
    expect((init as RequestInit & { proxy?: false }).proxy).toBe(false);
    expect(init.redirect).toBe("manual");
  });
});
