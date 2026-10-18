import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import type { ServerWebSocket } from "bun";
import React, { useEffect, useState } from "react";
import sdkIntegrationsRoute from "../../../backend/src/routes/sdk-integrations.route";
import activityWebSocketRoute, { activityWebSocketServerOptions } from "../../../backend/src/routes/activity.websocket";
import { getDashwiseSDKConnector, registerDashwiseSDKConnector } from "../../../backend/src/lib/pb/pocketbase";
import { registerSdkIntegration, getSdkIntegrationDefinition } from "../../../backend/src/lib/integrations-sdk/catalog";
import { startSdkIntegrationRuntime, stopSdkIntegrationRuntime } from "../../../backend/src/lib/integrations-sdk/runtime";
import { MockHomeAssistantServer } from "../../../../packages/integrations/homeassistant/test/mock-homeassistant-server";
import { createPocketBaseFixture } from "../../../backend/src/routes/sdk-integrations.protocol-fixture";
import { broadcastSdkResourceRevision, subscribeSdkResourceRevisions } from "../../../backend/src/lib/activity";

const sockets: MockWebSocket[] = [];
type ResourceSocketData = { resources: Set<string>; unsubscribe?: () => void };
const NativeWebSocket = globalThis.WebSocket;
let backendSocketBaseUrl = "http://localhost:3000";
let activitySocketMessages: string[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: string[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new dom.Event("open") as unknown as Event);
  }

  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new dom.Event("close") as unknown as CloseEvent);
  }
}

const withAuth = async <T,>(callback: (auth: Record<string, never>) => Promise<T> | T) => callback({});
let activeSessionToken = "session-token";
let contributionState = "21.5";
let contributionRevision = 20;
let contributionApiCalls = 0;
let liveContributionResolutions: Array<{ kind: string; data: Record<string, unknown> }> = [];
let liveSdkRequest: ((path: string, init?: RequestInit) => Promise<Response>) | null = null;
const { homeAssistant } = await import("../../../../packages/integrations/homeassistant/src/index");
const widgetDefinition = homeAssistant.widgets?.find(({ id }) => id === "entity-list");
const glanceableDefinition = homeAssistant.glanceables?.find(({ id }) => id === "sensor-value");
if (!widgetDefinition || !glanceableDefinition) {
  throw new Error("Home Assistant example contributions are missing");
}
const getSdkContributionDefinitionAction = mock(async (_auth: unknown, instanceId: string, kind: string, contributionId: string) => {
  if (liveSdkRequest) {
    const response = await liveSdkRequest(`/api/v1/sdk-integrations/instances/${instanceId}/contributions/${kind}/${contributionId}`);
    const body = await response.json() as { contribution?: Record<string, unknown>; error?: string };
    if (!response.ok || !body.contribution) throw new Error(body.error ?? "Could not load SDK contribution");
    return body.contribution;
  }
  return kind === "widget" ? widgetDefinition : glanceableDefinition;
});
const resolveSdkContributionAction = mock(async (
  _auth: unknown,
  instanceId: string,
  kind: string,
  contributionId: string,
  config: Record<string, unknown>,
) => {
  contributionApiCalls += 1;
  if (liveSdkRequest) {
    const response = await liveSdkRequest(
      `/api/v1/sdk-integrations/instances/${instanceId}/contributions/${kind}/${contributionId}/resolve`,
      { method: "POST", body: JSON.stringify({ config }) },
    );
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not resolve SDK contribution");
    liveContributionResolutions.push({ kind, data: body.data as Record<string, unknown> });
    return body as {
      data: Record<string, unknown>;
      revisions: Array<{ collectionId: string; resourceId: string; revision: number }>;
    };
  }
  const data = kind === "widget"
    ? { entities: [{ name: "Office temperature", state: contributionState, icon: "mdi:thermometer" }] }
    : { sensor: { name: "Office temperature", state: contributionState, icon: "mdi:thermometer" } };
  return {
    data,
    revisions: [{ collectionId: "entities", resourceId: "sensor.office_temperature", revision: contributionRevision }],
  };
});
mock.module("./useAuth", () => ({ default: () => ({ token: activeSessionToken, withAuth }) }));
mock.module("../lib/apiClient", () => ({
  backendUrl: (path: string) => new URL(path, backendSocketBaseUrl).toString(),
  getSdkContributionDefinitionAction,
  resolveSdkContributionAction,
}));

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let ActivityProvider: typeof import("./ActivityContext").ActivityProvider;
let useActivity: typeof import("./ActivityContext").useActivity;
let SdkIntegrationWidget: typeof import("../components/widgets/SdkIntegrationContribution").SdkIntegrationWidget;
let SdkIntegrationGlanceable: typeof import("../components/widgets/SdkIntegrationContribution").SdkIntegrationGlanceable;

beforeAll(async () => {
  dom = new Window({ url: "http://localhost" });
  dom.localStorage.setItem("dashwise_session_id", "browser-session");
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Node: dom.Node,
    Event: dom.Event,
    MessageEvent: dom.MessageEvent,
    WebSocket: MockWebSocket,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  ({ act } = await import("react"));
  ({ createRoot } = await import("react-dom/client"));
  ({ ActivityProvider, useActivity } = await import("./ActivityContext"));
  ({ SdkIntegrationWidget, SdkIntegrationGlanceable } = await import("../components/widgets/SdkIntegrationContribution"));
}, 30_000);

afterAll(() => {
  dom.happyDOM.abort();
  dom.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe("ActivityProvider SDK resource WebSocket transport", () => {
  it("keeps identical snapshots stable and pauses page subscriptions while hidden", async () => {
    sockets.length = 0;
    let renders = 0;
    function Consumer() {
      const { notifications, subscribePageWidgets } = useActivity();
      renders += 1;
      useEffect(() => subscribePageWidgets("home", () => {}), [subscribePageWidgets]);
      return React.createElement("output", null, notifications.length);
    }
    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    let root: ReturnType<typeof createRoot>;
    const queryClient = new QueryClient();
    let activityInvalidations = 0;
    queryClient.invalidateQueries = ((filters: { queryKey?: readonly unknown[] }) => {
      if (filters.queryKey?.includes("activities")) activityInvalidations += 1;
      return Promise.resolve();
    }) as typeof queryClient.invalidateQueries;
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(dom.document, "visibilityState");
    try {
      await act(async () => {
        root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
        root.render(React.createElement(QueryClientProvider, { client: queryClient },
          React.createElement(ActivityProvider, null, React.createElement(Consumer)),
        ));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const socket = sockets[0]!;
      await act(async () => socket.open());
      const snapshot = {
        type: "activity:snapshot",
        notifications: [{ id: "notice-1", content: "hello", status: "unread", created: "2026-01-01", topicId: null, topicName: null }],
        calendarEvents: [],
        activities: [{ id: "activity-1", title: "hello" }],
      };
      await act(async () => socket.receive(snapshot));
      const rendersAfterFirstSnapshot = renders;
      expect(activityInvalidations).toBe(1);
      expect(queryClient.getQueryData(["api", activeSessionToken, "notifications", activeSessionToken, "items", false])).toEqual(snapshot.notifications);
      await act(async () => socket.receive({ ...snapshot, notifications: [...snapshot.notifications], calendarEvents: [], activities: [...snapshot.activities] }));
      expect(renders).toBe(rendersAfterFirstSnapshot);
      expect(activityInvalidations).toBe(1);

      Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "hidden" });
      dom.document.dispatchEvent(new dom.Event("visibilitychange"));
      expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toEqual({ type: "page-goodbye", pageId: "home" });
      Object.defineProperty(dom.document, "visibilityState", { configurable: true, value: "visible" });
      dom.document.dispatchEvent(new dom.Event("visibilitychange"));
      expect(JSON.parse(socket.sent.at(-1) ?? "{}")).toEqual({ type: "page-hello", pageId: "home" });
    } finally {
      if (root!) await act(async () => root.unmount());
      if (visibilityDescriptor) Object.defineProperty(dom.document, "visibilityState", visibilityDescriptor);
      else Reflect.deleteProperty(dom.document, "visibilityState");
      container.remove();
    }
  });

  it("subscribes on connect, dispatches scoped revisions, and unsubscribes when the consumer unmounts", async () => {
    sockets.length = 0;
    const resource = {
      instanceId: "ha-instance",
      collectionId: "entities",
      resourceId: "light.office",
    };
    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    let root: ReturnType<typeof createRoot>;
    let unsubscribeResource: (() => void) | null = null;

    function Subscriber() {
      const { subscribeSdkResources } = useActivity();
      const [lastRevision, setLastRevision] = useState("waiting");
      useEffect(() => {
        unsubscribeResource = subscribeSdkResources([resource], (event) => {
          setLastRevision(`${event.operation}:${event.revision}`);
        });
        return () => unsubscribeResource?.();
      }, [subscribeSdkResources]);
      return React.createElement("output", null, lastRevision);
    }

    await act(async () => {
      root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
      root.render(React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(ActivityProvider, null, React.createElement(Subscriber)),
      ));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const socket = sockets[0];
    expect(socket).toBeDefined();
    const socketUrl = new URL(socket.url);
    expect(socketUrl.searchParams.get("token")).toBe("session-token");
    expect(socketUrl.searchParams.get("sessionId")).toBe("browser-session");

    await act(async () => socket.open());
    const initialMessages = socket.sent.map((message) => JSON.parse(message));
    expect(initialMessages.map((message) => message.type)).toEqual([
      "activity:subscribe",
      "sdk:resources:subscribe",
    ]);
    expect(initialMessages[1].resources).toEqual([resource]);

    await act(async () => socket.receive({
      type: "sdk:resource-revision",
      ...resource,
      revision: 8,
      operation: "upsert",
    }));
    expect(container.textContent).toBe("upsert:8");

    await act(async () => socket.receive({
      type: "sdk:resource-revision",
      ...resource,
      resourceId: "sensor.unselected",
      revision: 99,
      operation: "upsert",
    }));
    expect(container.textContent).toBe("upsert:8");

    await act(async () => unsubscribeResource?.());
    const finalMessage = JSON.parse(socket.sent.at(-1) ?? "{}");
    expect(finalMessage).toEqual({ type: "sdk:resources:unsubscribe", resources: [resource] });

    await act(async () => root.unmount());
    expect(socket.readyState).toBe(MockWebSocket.CLOSED);
    dom.document.body.removeChild(container);
  });

  it("updates a mounted consumer over a real WebSocket connected to the backend resource publisher", async () => {
    const resource = {
      instanceId: "ha-instance",
      collectionId: "entities",
      resourceId: "sensor.office_temperature",
    };
    contributionState = "21.5";
    contributionRevision = 20;
    contributionApiCalls = 0;
    resolveSdkContributionAction.mockClear();
    const identityKey = (value: typeof resource) => JSON.stringify([value.instanceId, value.collectionId, value.resourceId]);
    const sentMessages: Array<Record<string, any>> = [];
    const forwardedRevisions: Array<Record<string, any>> = [];
    const clientMessages: string[] = [];
    const serverSockets = new Set<ServerWebSocket<ResourceSocketData>>();
    const connectedUrls: string[] = [];
    let liveServer: ReturnType<typeof Bun.serve> | undefined;
    liveServer = Bun.serve<ResourceSocketData>({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request, server) => {
        connectedUrls.push(request.url);
        return server.upgrade(request, {
          data: { resources: new Set<string>() },
        }) ? undefined : new Response("WebSocket endpoint only", { status: 404 });
      },
      websocket: {
        open(socket) { serverSockets.add(socket); },
        message(socket, raw) {
          const message = JSON.parse(String(raw)) as Record<string, any>;
          sentMessages.push(message);
          const identities = Array.isArray(message.resources) ? message.resources : [];
          if (message.type === "sdk:resources:subscribe") {
            for (const identity of identities) socket.data.resources.add(identityKey(identity));
            socket.data.unsubscribe?.();
            socket.data.unsubscribe = subscribeSdkResourceRevisions("dom-resource-user", (event) => {
              if (socket.data.resources.has(identityKey(event))) {
                forwardedRevisions.push(event);
                socket.send(JSON.stringify({ type: "sdk:resource-revision", ...event }));
              }
            });
          } else if (message.type === "sdk:resources:unsubscribe") {
            for (const identity of identities) socket.data.resources.delete(identityKey(identity));
            if (socket.data.resources.size === 0) {
              socket.data.unsubscribe?.();
              socket.data.unsubscribe = undefined;
            }
          }
        },
        close(socket) {
          serverSockets.delete(socket);
          socket.data.unsubscribe?.();
        },
      },
    });
    backendSocketBaseUrl = `http://127.0.0.1:${liveServer.port}`;
    const TracedWebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket;
        socket.addEventListener("message", (event) => clientMessages.push(String(event.data)));
        return socket;
      },
    });
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: TracedWebSocket });
    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    let root: ReturnType<typeof createRoot>;
    const clientRevision = { value: "waiting" };

    function LiveConsumer() {
      const { subscribeSdkResources } = useActivity();
      const [revision, setRevision] = useState("waiting");
      useEffect(() => {
        return subscribeSdkResources([resource], (event) => {
          const nextRevision = `${event.operation}:${event.revision}`;
          clientRevision.value = nextRevision;
          setRevision(nextRevision);
        });
      }, [subscribeSdkResources]);
      return React.createElement("output", null, revision);
    }

    function ContributionHost() {
      return React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(ActivityProvider, null, React.createElement(React.Fragment, null,
          React.createElement(LiveConsumer),
          React.createElement(React.Fragment, null,
            React.createElement(SdkIntegrationWidget, {
              address: { instanceId: resource.instanceId, kind: "widget", contributionId: widgetDefinition!.id },
              config: { selectedEntities: [resource.resourceId] },
            }),
            React.createElement(SdkIntegrationGlanceable, {
              address: { instanceId: resource.instanceId, kind: "glanceable", contributionId: glanceableDefinition!.id },
              config: { sensor: resource.resourceId },
            }),
        ))),
      );
    }

    try {
      await act(async () => {
        root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
        root.render(React.createElement(ContributionHost));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const waitUntil = async (label: string, predicate: () => boolean) => {
        for (let attempt = 0; attempt < 50 && !predicate(); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!predicate()) throw new Error(`Timed out waiting for ${label}`);
      };
      await act(async () => waitUntil("socket subscriptions", () => sentMessages.some((message) => message.type === "activity:subscribe")
        && sentMessages.some((message) => message.type === "sdk:resources:subscribe")));
      await act(async () => waitUntil("initial contribution data", () => contributionApiCalls >= 2));
      expect(container.textContent).toContain("Office temperature");
      expect(container.textContent).toContain("21.5");
      const initialContributionCalls = contributionApiCalls;
      const clientUrl = new URL(connectedUrls[0] ?? "http://invalid");
      expect(clientUrl.searchParams.get("token")).toBe("session-token");
      expect(clientUrl.searchParams.get("sessionId")).toBe("browser-session");

      await act(async () => {
        contributionState = "22.0";
        contributionRevision = 21;
        broadcastSdkResourceRevision("dom-resource-user", { ...resource, revision: 21, operation: "upsert" });
        await waitUntil("widget refresh over socket", () => forwardedRevisions.length === 1
          && clientMessages.some((message) => message.includes("sdk:resource-revision"))
          && contributionApiCalls > initialContributionCalls);
      });
      expect(container.textContent).toContain("upsert:21");
      expect(container.textContent).toContain("22.0");

      const forwardedCount = forwardedRevisions.length;
      await act(async () => root.unmount());
      await waitUntil("socket cleanup", () => serverSockets.size === 0);
      broadcastSdkResourceRevision("dom-resource-user", { ...resource, revision: 22, operation: "upsert" });
      expect(forwardedRevisions).toHaveLength(forwardedCount);
      expect(clientRevision.value).toBe("upsert:21");
      dom.document.body.removeChild(container);
    } finally {
      for (const socket of serverSockets) socket.close();
      liveServer.stop(true);
      backendSocketBaseUrl = "http://localhost:3000";
      Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: MockWebSocket });
    }
  });

  it("updates actual Home Assistant contributions through the production Activity WebSocket route", async () => {
    const userId = "dom-ha-protocol-user";
    const token = "dws_dom-ha-protocol-token";
    const previousConnector = getDashwiseSDKConnector();
    const fixture = createPocketBaseFixture(userId, token);
    const homeAssistantServer = new MockHomeAssistantServer();
    let liveServer: ReturnType<typeof Bun.serve> | undefined;
    let root: ReturnType<typeof createRoot> | undefined;
    const container = dom.document.createElement("div");
    dom.document.body.append(container);
    const oldBackendBaseUrl = backendSocketBaseUrl;
    const oldSessionToken = activeSessionToken;
    const oldBrowserSessionId = dom.localStorage.getItem("dashwise_session_id");

    try {
      activeSessionToken = token;
      dom.localStorage.setItem("dashwise_session_id", "session-device");
      registerDashwiseSDKConnector(fixture.connector as never);
      if (!getSdkIntegrationDefinition(homeAssistant.id)) registerSdkIntegration(homeAssistant);
      await homeAssistantServer.start();
      Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: NativeWebSocket });

      const request = async (path: string, init: RequestInit = {}) => await sdkIntegrationsRoute.fetch(new Request(`http://localhost${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      }));
      const createResponse = await request("/api/v1/sdk-integrations/instances", {
        method: "POST",
        body: JSON.stringify({
          source: homeAssistant.id,
          name: "Mounted Home Assistant",
          config: { url: homeAssistantServer.url, accessToken: homeAssistantServer.validToken },
        }),
      });
      expect(createResponse.status).toBe(200);
      const { instance } = await createResponse.json() as { instance: { id: string } };

      let initialEntity: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const resourceResponse = await request(`/api/v1/sdk-integrations/instances/${instance.id}/resources?collectionId=entities`);
        const resourceBody = await resourceResponse.json() as { resources?: Array<Record<string, unknown>> };
        initialEntity = resourceBody.resources?.find(({ id }) => id === "light.study");
        if (initialEntity) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(initialEntity).toMatchObject({ id: "light.study", state: "off", available: true });

      liveServer = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: activityWebSocketRoute.fetch,
        websocket: activityWebSocketServerOptions,
      });
      backendSocketBaseUrl = `http://127.0.0.1:${liveServer.port}`;
      liveSdkRequest = request;
      activitySocketMessages = [];
      liveContributionResolutions = [];
      class ObservedWebSocket extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (String(url).includes("/api/v1/activity")) {
            this.addEventListener("message", (event) => activitySocketMessages.push(String(event.data)));
          }
        }
      }
      Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: ObservedWebSocket });

      const widgetId = homeAssistant.widgets?.find(({ id }) => id === "entity-list")?.id;
      const glanceableId = homeAssistant.glanceables?.find(({ id }) => id === "connection-status")?.id;
      if (!widgetId || !glanceableId) throw new Error("Home Assistant live contributions are missing");

      await act(async () => {
        root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);
        root.render(React.createElement(QueryClientProvider, { client: new QueryClient() },
          React.createElement(ActivityProvider, null, React.createElement(React.Fragment, null,
            React.createElement(SdkIntegrationWidget, {
              address: { instanceId: instance.id, kind: "widget", contributionId: widgetId },
              config: { selectedEntities: ["light.study"] },
            }),
            React.createElement(SdkIntegrationGlanceable, {
              address: { instanceId: instance.id, kind: "glanceable", contributionId: glanceableId },
              config: {},
            }),
          )),
        ));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      const waitUntil = async (label: string, predicate: () => boolean) => {
        for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!predicate()) throw new Error(`Timed out waiting for ${label}`);
      };
      await act(async () => waitUntil("actual Home Assistant contribution data", () =>
        container.textContent?.includes("Study lamp") === true
        && container.textContent.includes("off")
        && container.textContent.includes("connected")
        && activitySocketMessages.some((message) => message.includes("sdk:resources:subscribed"))
      ));
      await waitUntil("Home Assistant entity subscription", () => homeAssistantServer.entitySubscriptionCount > 0);
      const initialEntityRevision = Math.max(0, ...activitySocketMessages.map((message) => {
        try {
          const parsed = JSON.parse(message) as { type?: string; collectionId?: string; resourceId?: string; revision?: number };
          return parsed.type === "sdk:resource-revision" && parsed.collectionId === "entities"
            && parsed.resourceId === "light.study" && typeof parsed.revision === "number"
            ? parsed.revision
            : 0;
        } catch {
          return 0;
        }
      }));
      expect(initialEntityRevision).toBeGreaterThan(0);
      const initialResolveCount = resolveSdkContributionAction.mock.calls.length;
      expect(initialResolveCount).toBeGreaterThanOrEqual(2);

      await act(async () => {
        homeAssistantServer.replaceStates([{
          entity_id: "light.study",
          state: "on",
          attributes: { friendly_name: "Study lamp", supported_color_modes: ["brightness"] },
        }]);
        await waitUntil("Home Assistant resource revision over Activity WebSocket", () =>
          activitySocketMessages.some((message) => {
            try {
              const parsed = JSON.parse(message) as { type?: string; collectionId?: string; resourceId?: string; revision?: number };
              return parsed.type === "sdk:resource-revision" && parsed.collectionId === "entities"
                && parsed.resourceId === "light.study" && typeof parsed.revision === "number"
                && parsed.revision > initialEntityRevision;
            } catch {
              return false;
            }
          })
        );
        await waitUntil("Home Assistant Widget live state", () => {
          const latestWidgetResolution = [...liveContributionResolutions].reverse()
            .find(({ kind }) => kind === "widget");
          const entities = latestWidgetResolution?.data.entities;
          return Array.isArray(entities)
            && (entities[0] as { state?: string } | undefined)?.state === "on"
            && resolveSdkContributionAction.mock.calls.length > initialResolveCount;
        });
      });
      expect(container.textContent).toContain("Study lamp");
      expect(container.textContent).toContain("on");
      expect(resolveSdkContributionAction.mock.calls.length).toBeGreaterThan(initialResolveCount);
    } finally {
      if (root) {
        await act(async () => root?.unmount());
      }
      await stopSdkIntegrationRuntime();
      liveServer?.stop(true);
      await homeAssistantServer.stop();
      liveSdkRequest = null;
      backendSocketBaseUrl = oldBackendBaseUrl;
      activeSessionToken = oldSessionToken;
      if (oldBrowserSessionId) dom.localStorage.setItem("dashwise_session_id", oldBrowserSessionId);
      else dom.localStorage.removeItem("dashwise_session_id");
      registerDashwiseSDKConnector(previousConnector);
      Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value: MockWebSocket });
      dom.document.body.removeChild(container);
    }
  });
});
