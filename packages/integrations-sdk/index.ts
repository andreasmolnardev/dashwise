/** JSON-compatible values accepted by runtime storage and transport. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = Readonly<Record<string, JsonValue>>;

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
  execute(integrations: Integrations, resource: Resource, input: Input, signal?: AbortSignal): Result | Promise<Result>;
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
/** Legacy JSON Schema configs remain accepted alongside typed property fields. */
export type ContributionConfigSchema = IntegrationConfigSchema | JsonSchema;
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

export type ResourceBinding<ConfigKey extends string = string> = {
  type: "shortcut-select";
  configKey: ConfigKey;
};
export type ShortcutSelectConfigKey<Schema extends IntegrationConfigSchema> = {
  [Key in keyof Schema]: Schema[Key] extends { type: "shortcut-select" } ? Key : never;
}[keyof Schema] & string;
export type ResourceBindings<Schema extends IntegrationConfigSchema> = Readonly<
  Record<string, ResourceBinding<ShortcutSelectConfigKey<Schema>>>
>;
type ResourceBindingsFor<Schema extends ContributionConfigSchema> = Schema extends IntegrationConfigSchema
  ? ResourceBindings<Schema>
  : Readonly<Record<string, ResourceBinding<string>>>;
type ResourceBindingValue<Schema extends IntegrationConfigSchema, ConfigKey extends keyof Schema> =
  Schema[ConfigKey] extends { type: "shortcut-select"; multiple: true }
    ? readonly ResourceRecord[]
    : ResourceRecord | undefined;
/** Resolved resource values keyed by a contribution's declared output bindings. */
export type ResourceBindingValues<
  Schema extends IntegrationConfigSchema,
  Bindings extends ResourceBindings<Schema>,
> = {
  readonly [OutputKey in keyof Bindings]: Bindings[OutputKey] extends ResourceBinding<infer ConfigKey>
    ? ConfigKey extends keyof Schema
      ? ResourceBindingValue<Schema, ConfigKey>
      : never
    : never;
};

/** Templates currently dispatched by @dashwise/integrationskit/Widget. */
export type WidgetTemplate =
  | "columns"
  | "vertical-list"
  | "icon-details-card"
  | "iframe"
  | "image";
export type GlanceableIcon =
  | string
  | null
  | {
      file?: string;
      size?: number;
      description?: string;
      useFrostedGradient?: boolean;
    };
export type GlanceableColumn = Readonly<Record<string, JsonValue>>;

export type WidgetContribution<
  Config extends ContributionConfigSchema = ContributionConfigSchema,
  Bindings extends ResourceBindingsFor<Config> = ResourceBindingsFor<Config>,
> = {
  id: string;
  name: string;
  description?: string;
  /** Existing IntegrationsKit renderer template; omitted values use "columns". */
  template?: WidgetTemplate;
  configSchema?: Config;
  /** JSON-safe declarative properties consumed by the selected renderer. */
  properties?: JsonObject;
  /** JSON-safe fallback values used by the existing Widget preview renderer. */
  exampleProps?: JsonObject;
  /** Resolved current resource data supplied under each declared output key. */
  resourceBindings?: Bindings;
};
export type GlanceableContribution<
  Config extends ContributionConfigSchema = ContributionConfigSchema,
  Bindings extends ResourceBindingsFor<Config> = ResourceBindingsFor<Config>,
> = {
  id: string;
  name: string;
  description?: string;
  configSchema?: Config;
  /** JSON-safe declarative values consumed by the existing Glanceable renderer. */
  properties?: JsonObject;
  icon?: GlanceableIcon;
  text?: JsonValue;
  columns?: readonly GlanceableColumn[];
  /** JSON-safe fallback values used by the existing Glanceable preview renderer. */
  exampleProps?: JsonObject;
  /** Resolved current resource data supplied under each declared output key. */
  resourceBindings?: Bindings;
};

/** Broad input shape used only while inferring contribution literals in defineIntegration. */
type IntegrationContributionInput = {
  id: string;
  name: string;
  description?: string;
  template?: WidgetTemplate;
  configSchema?: ContributionConfigSchema;
  properties?: JsonObject;
  exampleProps?: JsonObject;
  icon?: GlanceableIcon;
  text?: JsonValue;
  columns?: readonly GlanceableColumn[];
  resourceBindings?: Readonly<Record<string, ResourceBinding<string>>>;
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
export type IntegrationHttp = {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  /** Validate a configured endpoint before handing it to a client with its own transport. */
  assertSafeUrl(input: string | URL, protocols?: readonly string[]): Promise<URL>;
};
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
  Widgets extends readonly IntegrationContributionInput[] = readonly IntegrationContributionInput[],
  Glanceables extends readonly IntegrationContributionInput[] = readonly IntegrationContributionInput[],
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
  const Widgets extends readonly IntegrationContributionInput[] = readonly IntegrationContributionInput[],
  const Glanceables extends readonly IntegrationContributionInput[] = readonly IntegrationContributionInput[],
>(
  definition: IntegrationDefinition<Config, Resources, Widgets, Glanceables>,
): IntegrationDefinition<Config, Resources, Widgets, Glanceables> {
  return definition;
}
