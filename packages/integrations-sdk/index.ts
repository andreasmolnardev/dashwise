/** JSON-compatible values accepted by runtime storage and transport. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

type ConfigFieldBase = { required?: boolean; title?: string; description?: string };
export type ConfigField =
  | (ConfigFieldBase & { type: "string" | "url" | "secret"; default?: string })
  | (ConfigFieldBase & { type: "number"; default?: number; min?: number; max?: number })
  | (ConfigFieldBase & { type: "boolean"; default?: boolean })
  | (ConfigFieldBase & { type: "enum"; options: readonly (string | number)[]; default?: string | number });
export type ConfigSchema = Readonly<Record<string, ConfigField>>;

type ConfigFieldValue<Field extends ConfigField> = Field extends { type: "number" }
  ? number
  : Field extends { type: "boolean" }
    ? boolean
    : Field extends { type: "enum"; options: readonly (infer Option)[] }
      ? Option
      : string;
export type ConfigValues<Schema extends ConfigSchema> = {
  readonly [Key in keyof Schema as Schema[Key]["type"] extends "secret" ? never : Key]:
    Schema[Key] extends { required: true } | { default: unknown }
      ? ConfigFieldValue<Schema[Key]>
      : ConfigFieldValue<Schema[Key]> | undefined;
};
export type SecretConfigKey<Schema extends ConfigSchema> = {
  [Key in keyof Schema]: Schema[Key]["type"] extends "secret" ? Key : never;
}[keyof Schema] & string;

export type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly JsonValue[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};

export type ResourceRecord = {
  id: string;
  name: string;
  icon?: string;
  type?: string;
  tags?: readonly string[];
  state?: JsonValue;
  attributes?: Readonly<Record<string, JsonValue>>;
  available?: boolean;
  actions?: readonly string[];
  /** App IDs for this Shortcut; may place the same resource in multiple Apps. */
  apps?: readonly string[];
  updatedAt?: string;
  upstreamId?: string;
};
export type ResourceCollectionDefinition<Resource extends ResourceRecord = ResourceRecord> = {
  persistent?: boolean;
  shortcuts?: boolean;
  /** Default App membership for shortcuts from this collection. */
  apps?: readonly string[];
  schema?: JsonSchema;
  /** Type-only marker retained by resourceCollection<T>(). */
  readonly __resourceType?: Resource;
};
export function resourceCollection<Resource extends ResourceRecord = ResourceRecord>(
  options: Omit<ResourceCollectionDefinition<Resource>, "__resourceType"> = {},
): ResourceCollectionDefinition<Resource> {
  return options;
}
export type ResourceIdentity = { integrationInstanceId: string; collectionId: string; resourceId: string };
export type ResourceSyncOptions = { completeness: "complete" | "partial" };
export type ResourceCollectionApi<Resource extends ResourceRecord> = {
  get(id: string): Resource | undefined;
  upsert(resource: Resource): Promise<Resource>;
  update(id: string, changes: Partial<Omit<Resource, "id">>): Promise<Resource | undefined>;
  remove(id: string): Promise<boolean>;
  sync(resources: readonly Resource[], options: ResourceSyncOptions): Promise<void>;
};
export type ResourceCollectionsApi<Definitions extends Record<string, ResourceCollectionDefinition>> = {
  readonly [Key in keyof Definitions]: ResourceCollectionApi<
    Definitions[Key] extends ResourceCollectionDefinition<infer Resource> ? Resource : ResourceRecord
  >;
};

export type ActionResult<Value extends JsonValue = JsonValue> = {
  success: boolean;
  value?: Value;
  message?: string;
  error?: { code: string; message: string };
};
export type IntegrationAction<
  Integrations extends IntegrationsRuntime = IntegrationsRuntime,
  Resource extends ResourceRecord = ResourceRecord,
  Input = unknown,
  Result extends JsonValue = JsonValue,
> = {
  id: string;
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
  execute(integrations: Integrations, resource: Resource, input: Input): Result | Promise<Result>;
};
export function defineAction<
  Input = unknown,
  Resource extends ResourceRecord = ResourceRecord,
  Result extends JsonValue = JsonValue,
>(action: IntegrationAction<IntegrationsRuntime, Resource, Input, Result>) {
  return action;
}

export type AppContribution = { id: string; name: string; description?: string; icon?: string };

export type IntegrationConfigFieldBase = {
  label?: string;
  description?: string;
  required?: boolean;
};
export type IntegrationConfigField =
  | (IntegrationConfigFieldBase & {
      type: "text" | "url";
      default?: string;
      placeholder?: string;
    })
  | (IntegrationConfigFieldBase & {
      type: "number";
      default?: number;
      min?: number;
      max?: number;
      step?: number;
    })
  | (IntegrationConfigFieldBase & { type: "boolean"; default?: boolean })
  | (IntegrationConfigFieldBase & {
      type: "select";
      options: readonly { label: string; value: string }[];
      default?: string;
    })
  | (IntegrationConfigFieldBase & {
      type: "shortcut-select";
      /** Single selector stores one Shortcut resource ID. */
      multiple?: false;
      /** Limit choices to Shortcuts exposed in any of these Apps. */
      appIds?: readonly string[];
      /** Limit choices to resources from any of these collections. */
      collectionIds?: readonly string[];
      default?: string;
    })
  | (IntegrationConfigFieldBase & {
      type: "shortcut-select";
      /** Multiple selector stores an array of Shortcut resource IDs. */
      multiple: true;
      appIds?: readonly string[];
      collectionIds?: readonly string[];
      default?: readonly string[];
    });

/** Per-contribution property fields; separate from JSON Schema action inputs. */
export type IntegrationConfigSchema = Readonly<Record<string, IntegrationConfigField>>;
type IntegrationConfigFieldValue<Field extends IntegrationConfigField> =
  Field extends { type: "number" }
    ? number
    : Field extends { type: "boolean" }
      ? boolean
      : Field extends { type: "shortcut-select"; multiple: true }
        ? readonly string[]
        : Field extends { type: "select"; options: readonly (infer Option)[] }
          ? Option extends { value: infer Value extends string }
            ? Value
            : string
          : string;
export type IntegrationConfigValues<Schema extends IntegrationConfigSchema> = {
  readonly [Key in keyof Schema]: Schema[Key] extends { required: true } | { default: unknown }
    ? IntegrationConfigFieldValue<Schema[Key]>
    : IntegrationConfigFieldValue<Schema[Key]> | undefined;
};

export type WidgetContribution<Config extends IntegrationConfigSchema = IntegrationConfigSchema> = {
  id: string;
  name: string;
  description?: string;
  configSchema?: Config;
};
export type GlanceableContribution<Config extends IntegrationConfigSchema = IntegrationConfigSchema> = {
  id: string;
  name: string;
  description?: string;
  configSchema?: Config;
};
export type IntegrationActivity = {
  type: string;
  title: string;
  description?: string;
  severity?: "info" | "success" | "warning" | "error";
  idempotencyKey?: string;
  metadata?: Record<string, JsonValue>;
};
export type IntegrationStorage = {
  get<Value extends JsonValue = JsonValue>(key: string): Promise<Value | undefined>;
  set(key: string, value: JsonValue): Promise<void>;
  delete(key: string): Promise<void>;
};
export type IntegrationLogger = {
  debug(message: string, metadata?: Record<string, JsonValue>): void;
  info(message: string, metadata?: Record<string, JsonValue>): void;
  warn(message: string, metadata?: Record<string, JsonValue>): void;
  error(message: string, metadata?: Record<string, JsonValue>): void;
};
export type IntegrationHttp = { fetch(input: string | URL, init?: RequestInit): Promise<Response> };
export type IntegrationWebSocket = { connect(url: string | URL, protocols?: string | string[]): Promise<WebSocket> };
export type IntegrationScheduler = {
  every(name: string, intervalMs: number, task: (signal: AbortSignal) => void | Promise<void>): void;
  timeout(name: string, delayMs: number, task: (signal: AbortSignal) => void | Promise<void>): void;
  cancel(name: string): void;
};
export type IntegrationEvent = { name: string; payload: JsonValue };

export type IntegrationsRuntime<
  Config extends object = Record<string, unknown>,
  Secrets extends string = string,
  Resources extends Record<string, ResourceCollectionDefinition> = Record<string, ResourceCollectionDefinition>,
> = {
  readonly instanceId: string;
  readonly config: Readonly<Config>;
  readonly secrets: { get<Key extends Secrets>(key: Key): Promise<string | undefined> };
  readonly resources: ResourceCollectionsApi<Resources>;
  readonly storage: IntegrationStorage;
  readonly actions: {
    execute<Input extends JsonValue = JsonValue>(actionId: string, resource: ResourceIdentity, input: Input): Promise<ActionResult>;
  };
  readonly activities: { publish(activity: IntegrationActivity): Promise<{ id: string; duplicate: boolean }> };
  readonly events: {
    publish(event: IntegrationEvent): void;
    subscribe(name: string, handler: (event: IntegrationEvent) => void | Promise<void>): () => void;
  };
  readonly http: IntegrationHttp;
  readonly websocket: IntegrationWebSocket;
  readonly mcp: { call<T extends JsonValue = JsonValue>(server: string, tool: string, input?: JsonValue): Promise<T> };
  readonly scheduler: IntegrationScheduler;
  readonly logger: IntegrationLogger;
  onDispose(cleanup: () => void | Promise<void>): void;
};

export type IntegrationDefinition<
  Config extends ConfigSchema = ConfigSchema,
  Resources extends Record<string, ResourceCollectionDefinition> = Record<string, ResourceCollectionDefinition>,
  Widgets extends readonly WidgetContribution[] = readonly WidgetContribution[],
  Glanceables extends readonly GlanceableContribution[] = readonly GlanceableContribution[],
> = {
  id: string;
  name: string;
  version: string;
  description?: string;
  config: Config;
  resources: Resources;
  actions?: Readonly<Record<string, IntegrationAction<any, any, any, any>>>;
  apps?: readonly AppContribution[];
  widgets?: Widgets;
  glanceables?: Glanceables;
  setup?(integrations: IntegrationsRuntime<ConfigValues<Config>, SecretConfigKey<Config>, Resources>): void | Promise<void>;
  start?(integrations: IntegrationsRuntime<ConfigValues<Config>, SecretConfigKey<Config>, Resources>): void | Promise<void>;
  stop?(integrations: IntegrationsRuntime<ConfigValues<Config>, SecretConfigKey<Config>, Resources>): void | Promise<void>;
  dispose?(integrations: IntegrationsRuntime<ConfigValues<Config>, SecretConfigKey<Config>, Resources>): void | Promise<void>;
};
/** Preserve and type-check a public integration definition without runtime side effects. */
export function defineIntegration<
  const Config extends ConfigSchema,
  const Resources extends Record<string, ResourceCollectionDefinition>,
  const Widgets extends readonly WidgetContribution[] = readonly WidgetContribution[],
  const Glanceables extends readonly GlanceableContribution[] = readonly GlanceableContribution[],
>(
  definition: IntegrationDefinition<Config, Resources, Widgets, Glanceables>,
): IntegrationDefinition<Config, Resources, Widgets, Glanceables> {
  return definition;
}
