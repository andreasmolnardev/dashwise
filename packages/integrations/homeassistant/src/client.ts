import {
  callService,
  createConnection,
  createLongLivedTokenAuth,
  getStates,
  subscribeEntities,
  type Connection,
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
    const auth = createLongLivedTokenAuth(url, this.token);
    const connection = await createConnection({ auth, setupRetry: 2, connectTimeout: 10_000 });
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
    return callService(this.connection, domain, service, serviceData, target);
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
        getStates(connection) as Promise<HassState[]>,
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
          unsubscribe = subscribeEntities(connection, (snapshot: HassEntitySnapshot) => {
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

