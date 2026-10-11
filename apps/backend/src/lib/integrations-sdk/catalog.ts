import type { IntegrationConfigSchema, IntegrationDefinition } from "@dashwise/integrations-sdk";
import { ApiActionError } from "../data/auth";

const definitions = new Map<string, IntegrationDefinition>();

/** Register trusted, statically bundled integrations. User supplied code is never evaluated. */
export function registerSdkIntegration(definition: IntegrationDefinition) {
  const id = definition.id.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(id)) throw new Error(`Invalid integration id: ${id}`);
  if (!definition.name.trim() || !definition.version.trim()) throw new Error(`Integration ${id} requires a name and version`);
  if (definitions.has(id)) throw new Error(`Integration ${id} is already registered`);
  validateDefinitionSelectors(definition);
  definitions.set(id, definition);
}

function validateDefinitionSelectors(definition: IntegrationDefinition) {
  const appIds = new Set((definition.apps ?? []).map((app) => app.id));
  for (const [collectionId, collection] of Object.entries(definition.resources)) {
    for (const appId of collection.apps ?? []) {
      if (!appIds.has(appId)) throw new Error(`Resource collection ${collectionId} references undeclared App ${appId}`);
    }
    if (collection.shortcuts && !collection.apps?.length && appIds.size !== 1) {
      throw new Error(`Shortcut resource collection ${collectionId} must declare Apps or be the only App in its integration`);
    }
  }
  for (const contribution of [...(definition.widgets ?? []), ...(definition.glanceables ?? [])]) {
    for (const [fieldName, field] of Object.entries(contribution.configSchema ?? {})) {
      if (field.type !== "shortcut-select") continue;
      for (const appId of field.appIds ?? []) {
        if (!appIds.has(appId)) throw new Error(`${contribution.id}.${fieldName} references undeclared App ${appId}`);
      }
      for (const collectionId of field.collectionIds ?? []) {
        if (!definition.resources[collectionId]?.shortcuts) {
          throw new Error(`${contribution.id}.${fieldName} references a resource collection that does not expose Shortcuts: ${collectionId}`);
        }
      }
    }
    for (const [outputKey, binding] of Object.entries(contribution.resourceBindings ?? {})) {
      if (!outputKey.trim() || binding.type !== "shortcut-select") {
        throw new Error(`${contribution.id} has an invalid resource binding`);
      }
      const field = (contribution.configSchema as IntegrationConfigSchema | undefined)?.[binding.configKey];
      if (!field || field.type !== "shortcut-select") {
        throw new Error(`${contribution.id}.${outputKey} must reference a shortcut-select config field`);
      }
    }
  }
}

export function getSdkIntegrationDefinition(id: string) {
  return definitions.get(id) ?? null;
}

export function requireSdkIntegrationDefinition(id: string) {
  const definition = getSdkIntegrationDefinition(id);
  if (!definition) throw new ApiActionError("Integration is not installed", 404, { error: "Integration is not installed" });
  return definition;
}

export function listSdkIntegrationCatalog() {
  return [...definitions.values()].map((definition) => ({
    id: definition.id,
    name: definition.name,
    version: definition.version,
    ...(definition.description ? { description: definition.description } : {}),
    config: Object.fromEntries(Object.entries(definition.config).map(([key, field]) => [
      key,
      field.type === "secret" ? { ...field, ...(field.default !== undefined ? { default: undefined } : {}) } : field,
    ])),
    resources: Object.fromEntries(Object.entries(definition.resources).map(([id, collection]) => [id, {
      persistent: collection.persistent === true,
      shortcuts: collection.shortcuts === true,
      apps: collection.apps ?? [],
      ...(collection.schema ? { schema: collection.schema } : {}),
    }])),
    actions: Object.values(definition.actions ?? {}).map(({ id, name, description, inputSchema }) => ({
      id, name, ...(description ? { description } : {}), ...(inputSchema ? { inputSchema } : {}),
    })),
    apps: (definition.apps ?? []).map(({ id, name, description, icon }) => ({
      id, name, ...(description ? { description } : {}), ...(icon ? { icon } : {}),
    })),
    widgets: definition.widgets ?? [],
    glanceables: definition.glanceables ?? [],
  }));
}

export function validateSdkConfig(definition: IntegrationDefinition, input: unknown, previous: Record<string, unknown> = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiActionError("Integration config must be an object", 400, { error: "Integration config must be an object" });
  }
  const supplied = input as Record<string, unknown>;
  const publicConfig: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  const known = new Set(Object.keys(definition.config));
  if (Object.keys(supplied).some((key) => !known.has(key))) {
    throw new ApiActionError("Integration config contains an unknown field", 400, { error: "Integration config contains an unknown field" });
  }
  for (const [key, field] of Object.entries(definition.config)) {
    const value = supplied[key] ?? field.default ?? (field.type === "secret" ? previous[key] : undefined);
    if (value === undefined || value === "") {
      if (field.required) throw new ApiActionError(`Missing required config: ${key}`, 400, { error: `Missing required config: ${key}` });
      continue;
    }
    const valid = validateConfigValue(field, value);
    if (!valid) throw new ApiActionError(`Invalid config value: ${key}`, 400, { error: `Invalid config value: ${key}` });
    if (field.type === "secret") secrets[key] = String(value);
    else publicConfig[key] = value;
  }
  return { publicConfig, secrets, complete: { ...publicConfig, ...secrets } };
}

function validateConfigValue(field: IntegrationDefinition["config"][string], value: unknown) {
  switch (field.type) {
    case "string": case "secret": return typeof value === "string";
    case "url": {
      if (typeof value !== "string") return false;
      try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
    }
    case "number": return typeof value === "number" && Number.isFinite(value)
      && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
    case "boolean": return typeof value === "boolean";
    case "enum": return field.options.includes(value as string | number);
  }
}
