import type { ServerWebSocket } from "bun";
import { createServer } from "node:net";
import type { AreaRegistryEntry, DeviceRegistryEntry, EntityRegistryEntry, HassState } from "../src/ha-types";

type MockSocketData = {
  authenticated: boolean;
  subscriptions: Map<number, string>;
};

type HomeAssistantMessage = {
  id?: number;
  type: string;
  access_token?: string;
  event_type?: string;
  [key: string]: unknown;
};

/** A protocol-level Home Assistant fixture for exercising the maintained WebSocket client. */
export class MockHomeAssistantServer {
  private server?: ReturnType<typeof Bun.serve<MockSocketData>>;
  private unavailable = false;
  private readonly sockets = new Set<ServerWebSocket<MockSocketData>>();
  private nextSubscriptionId = 1;

  readonly validToken = "test-homeassistant-long-lived-token";
  readonly serviceCalls: HomeAssistantMessage[] = [];
  readonly availableServices = {
    light: { toggle: {}, turn_on: {}, turn_off: {} },
    switch: { toggle: {}, turn_on: {}, turn_off: {} },
  };
  states: HassState[] = [{
    entity_id: "light.study",
    state: "off",
    attributes: { friendly_name: "Study lamp", supported_color_modes: ["brightness"] },
  }];
  entityRegistry: EntityRegistryEntry[] = [{ entity_id: "light.study", unique_id: "study-lamp" }];
  deviceRegistry: DeviceRegistryEntry[] = [{ id: "study-device", name: "Study" }];
  areaRegistry: AreaRegistryEntry[] = [{ area_id: "office", name: "Office" }];

  get url(): string {
    if (!this.server) throw new Error("Mock Home Assistant server is not running");
    return `http://127.0.0.1:${this.server.port}`;
  }

  async start(): Promise<void> {
    if (this.server) throw new Error("Mock Home Assistant server is already running");
    const port = await findAvailablePort();
    this.server = Bun.serve<MockSocketData>({
      hostname: "127.0.0.1",
      port,
      fetch: (request, server) => {
        if (this.unavailable) return new Response("Home Assistant is restarting", { status: 503 });
        if (server.upgrade(request, { data: { authenticated: false, subscriptions: new Map() } })) {
          return undefined;
        }
        return new Response("WebSocket endpoint only", { status: 404 });
      },
      websocket: {
        open: (socket) => {
          this.sockets.add(socket);
          socket.send(JSON.stringify({ type: "auth_required", ha_version: "2025.1.0" }));
        },
        message: (socket, rawMessage) => this.handleMessage(socket, rawMessage),
        close: (socket) => { this.sockets.delete(socket); },
      },
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.close(1001, "Mock server stopped");
    this.sockets.clear();
    this.server?.stop(true);
    this.server = undefined;
  }

  /** Simulates an upstream restart while keeping the same address for reconnects. */
  async restart(downtimeMs = 100): Promise<void> {
    this.unavailable = true;
    for (const socket of this.sockets) socket.close(1012, "Home Assistant restart");
    this.sockets.clear();
    await new Promise((resolve) => setTimeout(resolve, downtimeMs));
    this.unavailable = false;
  }

  replaceStates(states: HassState[], entityRegistry = this.entityRegistry): void {
    const previousIds = new Set(this.states.map(({ entity_id }) => entity_id));
    this.states = states;
    this.entityRegistry = entityRegistry;
    const nextIds = new Set(states.map(({ entity_id }) => entity_id));
    const removed = [...previousIds].filter((id) => !nextIds.has(id));
    const additions = Object.fromEntries(states.map((state) => [state.entity_id, this.compressState(state)]));

    for (const socket of this.sockets) {
      for (const [id, eventType] of socket.data.subscriptions) {
        if (eventType === "__entities__") {
          socket.send(JSON.stringify({ type: "event", id, event: { a: additions, r: removed, c: {} } }));
        }
      }
    }
  }

  emitEvent(eventType: string, event: unknown): void {
    for (const socket of this.sockets) {
      for (const [id, subscribedEvent] of socket.data.subscriptions) {
        if (subscribedEvent === eventType) {
          socket.send(JSON.stringify({ type: "event", id, event }));
        }
      }
    }
  }

  private handleMessage(socket: ServerWebSocket<MockSocketData>, rawMessage: string | Buffer): void {
    let message: HomeAssistantMessage;
    try {
      message = JSON.parse(typeof rawMessage === "string" ? rawMessage : rawMessage.toString()) as HomeAssistantMessage;
    } catch {
      socket.close(1003, "Invalid JSON");
      return;
    }

    if (message.type === "auth") {
      if (message.access_token !== this.validToken) {
        socket.send(JSON.stringify({ type: "auth_invalid", message: "Invalid access token" }));
        socket.close(1008, "Invalid access token");
        return;
      }
      socket.data.authenticated = true;
      socket.send(JSON.stringify({ type: "auth_ok", ha_version: "2025.1.0" }));
      return;
    }
    if (!socket.data.authenticated) {
      socket.close(1008, "Authentication required");
      return;
    }
    if (message.type === "ping") {
      socket.send(JSON.stringify({ type: "pong", id: message.id }));
      return;
    }

    switch (message.type) {
      case "supported_features":
        this.result(socket, message.id, true, {});
        return;
      case "config/entity_registry/list":
        this.result(socket, message.id, true, this.entityRegistry);
        return;
      case "config/device_registry/list":
        this.result(socket, message.id, true, this.deviceRegistry);
        return;
      case "config/area_registry/list":
        this.result(socket, message.id, true, this.areaRegistry);
        return;
      case "get_services":
        this.result(socket, message.id, true, this.availableServices);
        return;
      case "get_states":
        this.result(socket, message.id, true, this.states);
        return;
      case "subscribe_entities":
        this.subscribe(socket, message.id, "__entities__");
        this.event(socket, message.id, {
          a: Object.fromEntries(this.states.map((state) => [state.entity_id, this.compressState(state)])),
          r: [],
          c: {},
        });
        return;
      case "subscribe_events":
        this.subscribe(socket, message.id, String(message.event_type ?? "*"));
        return;
      case "unsubscribe_events": {
        const subscriptionId = Number(message.subscription);
        socket.data.subscriptions.delete(subscriptionId);
        this.result(socket, message.id, true, null);
        return;
      }
      case "call_service":
        this.serviceCalls.push(message);
        this.result(socket, message.id, true, { context: { id: "mock-service-context" } });
        return;
      default:
        this.result(socket, message.id, false, undefined, { code: "unknown_command", message: `Unsupported command: ${message.type}` });
    }
  }

  private subscribe(socket: ServerWebSocket<MockSocketData>, id: number | undefined, eventType: string): void {
    if (id === undefined) {
      socket.close(1002, "Subscription requires an ID");
      return;
    }
    socket.data.subscriptions.set(id, eventType);
    this.result(socket, id, true, null);
  }

  private result(
    socket: ServerWebSocket<MockSocketData>,
    id: number | undefined,
    success: boolean,
    result: unknown,
    error?: { code: string; message: string },
  ): void {
    if (id === undefined) return;
    socket.send(JSON.stringify({ type: "result", id, success, result, ...(error ? { error } : {}) }));
  }

  private event(socket: ServerWebSocket<MockSocketData>, id: number | undefined, event: unknown): void {
    if (id === undefined) return;
    socket.send(JSON.stringify({ type: "event", id, event }));
  }

  private compressState(state: HassState): Record<string, unknown> {
    const seconds = Date.parse(state.last_updated ?? state.last_changed ?? new Date().toISOString()) / 1000;
    return {
      s: state.state,
      a: state.attributes,
      c: state.context?.id,
      lc: seconds,
      lu: seconds,
    };
  }
}

async function findAvailablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("Could not allocate a local port for the Home Assistant fixture");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}
