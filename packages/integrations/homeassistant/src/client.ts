import {
  callService,
  createConnection,
  createLongLivedTokenAuth,
  getStates,
  subscribeEntities,
  type Connection,
  type ConnectionOptions,
  type HaWebSocket,
} from "home-assistant-js-websocket";
import type {
  AreaRegistryEntry,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HassState,
  HomeAssistantClient,
  HassRegistrySnapshot,
} from "./ha-types";
import { parseEntitySnapshot } from "./snapshot";

type HassEntitySnapshot = Record<string, HassState>;

export type HomeAssistantWebSocketApi = {
  createConnection: typeof createConnection;
  createLongLivedTokenAuth: typeof createLongLivedTokenAuth;
  getStates: typeof getStates;
  subscribeEntities: typeof subscribeEntities;
  callService: typeof callService;
};

const defaultHomeAssistantWebSocketApi: HomeAssistantWebSocketApi = {
  createConnection,
  createLongLivedTokenAuth,
  getStates,
  subscribeEntities,
  callService,
};

/**
 * Uses Home Assistant's maintained websocket client for authentication,
 * event subscription, state snapshots, service calls, and reconnects.
 */
export class HomeAssistantWebSocketClient implements HomeAssistantClient {
  private connection?: Connection;
  private unsubscribeEntities?: () => void;
  private readonly unsubscribeEvents: Array<() => Promise<void>> = [];
  private readonly listeners = new Set<(state: "ready" | "disconnected" | "error") => void>();
  private stopped = false;
  private snapshotHandler?: (
    states: HassState[],
    registries: HassRegistrySnapshot,
  ) => Promise<void>;
  private registryRefresh?: Promise<void>;
  private registryCache: { entities?: EntityRegistryEntry[]; devices?: DeviceRegistryEntry[]; areas?: AreaRegistryEntry[] } = {};

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly snapshotTimeoutMs = 30_000,
    private readonly api: HomeAssistantWebSocketApi = defaultHomeAssistantWebSocketApi,
    private readonly connectWebSocket?: (url: string | URL) => Promise<WebSocket>,
  ) {}

  async start(
    onSnapshot: (
      states: HassState[],
      registries: HassRegistrySnapshot,
    ) => Promise<void>,
  ): Promise<void> {
    if (this.connection) throw new Error("Home Assistant client already started");
    const url = normalizeHomeAssistantUrl(this.url);
    if (!this.token.trim()) throw new Error("Home Assistant access token is required");
    this.stopped = false;
    this.snapshotHandler = onSnapshot;
    const auth = this.api.createLongLivedTokenAuth(url, this.token);
    const connectWebSocket = this.connectWebSocket;
    const connection = await this.api.createConnection({
      auth,
      setupRetry: 2,
      connectTimeout: 10_000,
      ...(connectWebSocket ? { createSocket: (options) => createAuthenticatedSocket(options, connectWebSocket) } : {}),
    });
    this.connection = connection;
    connection.addEventListener("ready", this.handleReady);
    connection.addEventListener("disconnected", this.handleDisconnect);
    connection.addEventListener("reconnect-error", this.handleReconnectError);

    // Registry data enriches the authoritative state snapshot. A registry request
    // failure doesn't convert a successful state discovery into an empty sync.
    const registries = await this.refreshRegistries();
    await this.waitForFirstSnapshot(connection, registries, onSnapshot);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.connection?.removeEventListener("ready", this.handleReady);
    this.connection?.removeEventListener("disconnected", this.handleDisconnect);
    this.connection?.removeEventListener("reconnect-error", this.handleReconnectError);
    this.listeners.clear();
    this.unsubscribeEntities?.();
    this.unsubscribeEntities = undefined;
    await Promise.allSettled(this.unsubscribeEvents.splice(0).map((unsubscribe) => unsubscribe()));
    const connection = this.connection;
    this.connection = undefined;
    this.snapshotHandler = undefined;
    this.registryRefresh = undefined;
    connection?.close();
  }

  async callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.connection || this.stopped) throw new Error("Home Assistant is not connected");
    return this.api.callService(this.connection, domain, service, serviceData, target);
  }

  async refreshRegistries(): Promise<HassRegistrySnapshot> {
    const connection = this.connection;
    if (!connection || this.stopped) throw new Error("Home Assistant is not connected");
    const commands = [
      ["entities", "config/entity_registry/list"],
      ["devices", "config/device_registry/list"],
      ["areas", "config/area_registry/list"],
    ] as const;
    const results = await Promise.all(commands.map(async ([key, command]) => {
      try {
        const value = await commandArray<unknown>(connection, command);
        if (key === "entities") this.registryCache.entities = value as EntityRegistryEntry[];
        if (key === "devices") this.registryCache.devices = value as DeviceRegistryEntry[];
        if (key === "areas") this.registryCache.areas = value as AreaRegistryEntry[];
        return undefined;
      } catch (error) {
        return `${command}: ${error instanceof Error ? error.message : "request failed"}`;
      }
    }));
    const registryErrors = results.filter((error): error is string => Boolean(error));
    return { ...this.registryCache, ...(registryErrors.length ? { registryErrors } : {}) };
  }

  async refreshDiscovery(): Promise<void> {
    if (this.registryRefresh) return this.registryRefresh;
    const connection = this.connection;
    const snapshotHandler = this.snapshotHandler;
    if (!connection || !snapshotHandler || this.stopped) throw new Error("Home Assistant discovery is not active");
    this.registryRefresh = (async () => {
      const [registries, states] = await Promise.all([
        this.refreshRegistries(),
        this.api.getStates(connection) as Promise<HassState[]>,
      ]);
      if (!Array.isArray(states)) throw new Error("Home Assistant returned an invalid state snapshot");
      await snapshotHandler(states, registries);
    })();
    try {
      await this.registryRefresh;
    } finally {
      this.registryRefresh = undefined;
    }
  }

  onConnectionChange(listener: (state: "ready" | "disconnected" | "error") => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async subscribeEvent(eventType: string, listener: (event: unknown) => void): Promise<() => Promise<void>> {
    if (!this.connection || this.stopped) throw new Error("Home Assistant is not connected");
    const unsubscribe = await this.connection.subscribeEvents(listener, eventType);
    this.unsubscribeEvents.push(unsubscribe);
    return async () => {
      const index = this.unsubscribeEvents.indexOf(unsubscribe);
      if (index !== -1) this.unsubscribeEvents.splice(index, 1);
      await unsubscribe();
    };
  }

  private async waitForFirstSnapshot(
    connection: Connection,
    registries: HassRegistrySnapshot,
    onSnapshot: (states: HassState[], registries: HassRegistrySnapshot) => Promise<void>,
  ): Promise<void> {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for Home Assistant entity snapshot")), this.snapshotTimeoutMs);
        try {
          unsubscribe = this.api.subscribeEntities(connection, (snapshot: HassEntitySnapshot) => {
            let states: HassState[];
            try {
              states = parseEntitySnapshot(snapshot);
            } catch (error) {
              if (settled) return;
              settled = true;
              if (timeout) clearTimeout(timeout);
              reject(error);
              return;
            }
            // Empty arrays are valid only after a successful upstream callback.
            void onSnapshot(states, registries).then(() => {
              if (settled) return;
              settled = true;
              if (timeout) clearTimeout(timeout);
              resolve();
            }).catch((error: unknown) => {
              if (settled) return;
              settled = true;
              if (timeout) clearTimeout(timeout);
              reject(error);
            });
          });
        } catch (error) {
          reject(error);
        }
      });
      this.unsubscribeEntities = unsubscribe;
    } catch (error) {
      unsubscribe?.();
      throw error;
    }
  }

  private handleReady = (): void => {
    if (!this.stopped) this.emit("ready");
  };

  private handleDisconnect = (): void => {
    if (!this.stopped) this.emit("disconnected");
  };

  private handleReconnectError = (): void => {
    if (!this.stopped) this.emit("error");
  };

  private emit(state: "ready" | "disconnected" | "error"): void {
    for (const listener of this.listeners) listener(state);
  }
}

async function createAuthenticatedSocket(
  options: ConnectionOptions,
  connectWebSocket: (url: string | URL) => Promise<WebSocket>,
): Promise<HaWebSocket> {
  const auth = options.auth;
  if (!auth) throw new Error("Home Assistant authentication is required");
  const timeoutMs = options.connectTimeout ?? 10_000;
  let retriesLeft = options.setupRetry;

  for (;;) {
    let socket: WebSocket | undefined;
    try {
      socket = await connectWebSocket(auth.wsUrl);
      if (auth.expired) await auth.refreshAccessToken();
      const haVersion = await waitForAuthResult(socket, timeoutMs, auth.accessToken);
      Object.assign(socket, { haVersion });
      if (supportsCoalescedMessages(haVersion)) {
        socket.send(JSON.stringify({ type: "supported_features", id: 1, features: { coalesce_messages: 1 } }));
      }
      return socket as HaWebSocket;
    } catch (error) {
      socket?.close();
      if (error instanceof InvalidHomeAssistantAuthError || retriesLeft === 0) throw error;
      if (retriesLeft > 0) retriesLeft -= 1;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

class InvalidHomeAssistantAuthError extends Error {}

function waitForAuthResult(socket: WebSocket, timeoutMs: number, accessToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Home Assistant authentication"));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      let message: { type?: string; ha_version?: string; message?: string };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        cleanup();
        reject(new Error("Home Assistant sent an invalid authentication response"));
        return;
      }
      if (message.type === "auth_required") return;
      if (message.type === "auth_invalid") {
        cleanup();
        reject(new InvalidHomeAssistantAuthError("Home Assistant rejected the access token"));
        return;
      }
      if (message.type !== "auth_ok" || typeof message.ha_version !== "string") return;
      cleanup();
      resolve(message.ha_version);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Home Assistant closed the socket during authentication"));
    };
    const onError = () => {
      cleanup();
      reject(new Error("Home Assistant socket failed during authentication"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose, { once: true });
    socket.addEventListener("error", onError, { once: true });
    try {
      socket.send(JSON.stringify({ type: "auth", access_token: accessToken }));
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function supportsCoalescedMessages(version: string) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 2022 || (major === 2022 && minor >= 9);
}

async function commandArray<T>(connection: Connection, type: string): Promise<T[]> {
  const result = await connection.sendMessagePromise<unknown>({ type });
  if (!Array.isArray(result)) throw new Error(`Home Assistant returned an invalid ${type} response`);
  return result as T[];
}

export function normalizeHomeAssistantUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (!(["http:", "https:"].includes(parsed.protocol))) {
    throw new Error("Home Assistant URL must use http or https");
  }
  if (parsed.username || parsed.password) throw new Error("Credentials must not be embedded in the Home Assistant URL");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

