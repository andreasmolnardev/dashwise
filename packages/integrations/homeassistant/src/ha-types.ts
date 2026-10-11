export type HassState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
  context?: { id?: string };
};

export type EntityRegistryEntry = {
  entity_id: string;
  unique_id?: string;
  name?: string | null;
  original_name?: string | null;
  platform?: string;
  device_id?: string | null;
  area_id?: string | null;
  disabled_by?: string | null;
  entity_category?: string | null;
};

export type DeviceRegistryEntry = {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  area_id?: string | null;
  identifiers?: Array<[string, string]>;
};

export type AreaRegistryEntry = { area_id: string; name: string };

export type HassDiscovery = {
  states: HassState[];
  entities?: EntityRegistryEntry[];
  devices?: DeviceRegistryEntry[];
  areas?: AreaRegistryEntry[];
  registryErrors?: string[];
};

export type HassRegistrySnapshot = Pick<HassDiscovery, "entities" | "devices" | "areas" | "registryErrors">;

export type HomeAssistantClient = {
  start(onSnapshot: (states: HassState[], registries: HassRegistrySnapshot) => Promise<void>): Promise<void>;
  refreshDiscovery(): Promise<void>;
  stop(): Promise<void>;
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown>;
  refreshRegistries(): Promise<HassRegistrySnapshot>;
  onConnectionChange(listener: (state: "ready" | "disconnected" | "error") => void): () => void;
  subscribeEvent(eventType: string, listener: (event: unknown) => void): Promise<() => Promise<void>>;
};

