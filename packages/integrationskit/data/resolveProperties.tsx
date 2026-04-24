import { resolveEndpointCatalog } from "./getEndpointData";
import type {
  EndpointRuntimeCacheAdapter,
  ResolvedEndpointData,
  IntegrationRuntimeProperties,
  ResolveOptions,
  RuntimeDataResolution,
  ResolvedColumn,
  ResolvedIcon,
  ResolvedListItem,
  ResolvedWidget,
} from "../types";
import {
  flattenToEnv,
  getNestedValue,
  resolveComputedFields,
} from "./getComputedField";
import {
  resolveAction,
  resolveBadge,
  resolveMappedValue,
  resolveNumber,
  resolveSubtitle,
  resolveValue,
  resolveStringWithCasts,
  interpolateString,
  evaluateCondition,
} from "./resolvers/operations";
export { resolveValue, resolveStringWithCasts, interpolateString } from "./resolvers/operations";

// ── Public types ──────────────────────────────────────────────────────────────

export function getRuntimeEnv(
  integrationJSON: Record<string, any> | null,
  baseEnv: Record<string, string> = {},
): Record<string, string> {
  const integrationEnv =
    integrationJSON?.configuration?.environment_variables &&
    typeof integrationJSON.configuration.environment_variables === "object"
      ? flattenToEnv(
          integrationJSON.configuration.environment_variables as Record<
            string,
            any
          >,
        )
      : {};

  return {
    ...integrationEnv,
    ...baseEnv,
  };
}

export async function resolveIntegrationRuntimeProperties(
  opts: {
    integrationJSON: Record<string, any> | null;
    env?: Record<string, string>;
    isPreview?: boolean;
    endpointCache?: EndpointRuntimeCacheAdapter;
    allowInsecureEndpoints?: boolean;
  },
): Promise<IntegrationRuntimeProperties> {
  const {
    integrationJSON,
    env = {},
    isPreview = false,
    endpointCache,
    allowInsecureEndpoints,
  } = opts;
  const runtimeEnv = getRuntimeEnv(integrationJSON, env);
  const integrationConfig = (integrationJSON?.configuration ?? {}) as Record<
    string,
    any
  >;
  const lookup_tables = integrationConfig.lookup_tables;

  if (isPreview) {
    return {
      endpoints: {},
      computed: {},
      lookup_tables,
      env: runtimeEnv,
    };
  }

  const endpointResult = await resolveEndpointCatalog(
    integrationConfig.endpoints,
    {
      env: runtimeEnv,
      scope: {},
      cache: endpointCache,
    },
    allowInsecureEndpoints,
  );

  const computed = resolveComputedFields(integrationConfig.computed, {
    env: endpointResult.env,
    scope: {
      endpoints: endpointResult.endpoints,
      lookup_tables,
    },
  });

  const runtimeScope = {
    endpoints: endpointResult.endpoints,
    computed,
  };

  return {
    endpoints: endpointResult.endpoints,
    computed,
    lookup_tables,
    env: {
      ...endpointResult.env,
      ...flattenToEnv(runtimeScope),
    },
  };
}

type RuntimeDataResolutionOptions = {
  integrationJSON: Record<string, any> | null;
  data: Record<string, any> | null;
  isPreview: boolean;
  env: Record<string, string>;
  endpointCache?: EndpointRuntimeCacheAdapter;
};

// ── Main entry ────────────────────────────────────────────────────────────────

export function resolveWidgetProperties(opts: ResolveOptions): ResolvedWidget {
  const { widgetJSON, data, isPreview, integrationJSON } = opts;
  const props: Record<string, any> = widgetJSON.properties ?? {};
  const env = buildEnv(opts);
  const template: string = widgetJSON.template ?? "columns";

  const header = props.header ? resolveHeader(props.header, env) : undefined;

  if (template === "columns") {
    const result: ResolvedWidget = {
      header,
      columns: resolveColumns(props.columns, env, data, isPreview),
      raw: props,
    };
    return patchIntegrationIcons(result, env);
  }

  if (template === "vertical-list") {
    const result: ResolvedWidget = {
      header,
      list: resolveList(props.list, env, data, isPreview),
      raw: props,
    };
    return patchIntegrationIcons(result, env);
  }

  if (template === "icon-details-card") {
    const result: ResolvedWidget = {
      header,
      card: {
        icon: resolveValue(props.icon.file, env),
        primary: resolveValue(props.primary, env),
        secondary: resolveValue(props.secondary, env),
      },
      raw: props,
    };
    return patchIntegrationIcons(result, env);
  }

  const result: ResolvedWidget = { header, raw: props };
  return patchIntegrationIcons(result, env);
}

function patchIntegrationIcons(res: ResolvedWidget, env: Record<string, any>) {
  if (res.header && res.header.icon) {
    res.header.icon = resolveIntegrationIconReference(res.header.icon, env);
  }

  if (res.card && res.card.icon) {
    res.card.icon = resolveIntegrationIconReference(res.card.icon, env);
  }

  if (res.columns) {
    res.columns = res.columns.map((c) => ({
      ...c,
      icon: c.icon
        ? { ...c.icon, file: resolveIntegrationIconReference(c.icon.file, env) }
        : c.icon,
    }));
  }

  if (res.list) {
    res.list = res.list.map((item) => ({
      ...item,
      icon: resolveIntegrationIconReference(item.icon, env),
    }));
  }

  return res;
}

function resolveIntegrationIconReference(
  value: unknown,
  env: Record<string, any>,
): string | undefined {
  if (!value || typeof value !== "string") return undefined;
  return resolveValue(value, env) ?? undefined;
}

export async function resolveWidgetRuntimeData(
  opts: ResolveOptions,
): Promise<RuntimeDataResolution> {
  const { widgetJSON, integrationJSON, data, isPreview, endpointCache } = opts;

  return resolveIntegrationRuntimeData({
    integrationJSON,
    data,
    isPreview,
    env: buildEnv({ widgetJSON, integrationJSON, data, isPreview }),
    endpointCache,
  }, opts.allowInsecureEndpoints);
}

export async function resolveGlanceableRuntimeData(opts: {
  glanceableJSON: Record<string, any>;
  integrationJSON: Record<string, any> | null;
  data: Record<string, any> | null;
  isPreview: boolean;
  baseEnv?: Record<string, string>;
  endpointCache?: EndpointRuntimeCacheAdapter;
  allowInsecureEndpoints?: boolean;
}): Promise<RuntimeDataResolution> {
  const { integrationJSON, data, isPreview, baseEnv = {}, endpointCache } = opts;
  const runtimeEnv = getRuntimeEnv(integrationJSON, baseEnv);

  return resolveIntegrationRuntimeData({
    integrationJSON,
    data,
    isPreview,
    env: runtimeEnv,
    endpointCache,
  }, opts.allowInsecureEndpoints);
}

async function resolveIntegrationRuntimeData(
  opts: RuntimeDataResolutionOptions,
  allowInsecureEndpoints = false,
): Promise<RuntimeDataResolution> {
  const { integrationJSON, data, isPreview, env, endpointCache } = opts;

  if (isPreview) {
    return { data: null, env };
  }

  if (data) {
    return { data, env };
  }

  const runtimeProperties = await resolveIntegrationRuntimeProperties({
    integrationJSON,
    env,
    endpointCache,
    allowInsecureEndpoints,
  });

  return {
    data: {
      endpoints: runtimeProperties.endpoints,
      computed: runtimeProperties.computed,
    },
    env: runtimeProperties.env,
  };
}

// ── Header ────────────────────────────────────────────────────────────────────

function resolveHeader(
  def: Record<string, any>,
  env: Record<string, string>,
): ResolvedWidget["header"] {
  const show = def.show_if !== undefined
    ? evaluateCondition(String(def.show_if), env)
    : true;
  return {
    title: resolveValue(def.title, env),
    icon: resolveValue(def.icon, env),
    titleAction: resolveAction(def.titleAction, env),
    show,
  };
}

// ── Columns ───────────────────────────────────────────────────────────────────

function resolveColumns(
  colDef: any,
  env: Record<string, string>,
  data: Record<string, any> | null,
  isPreview: boolean,
): ResolvedColumn[] {
  if (!colDef) return [];

  // Static array: [ { label, primary, ... }, ... ]
  if (Array.isArray(colDef)) {
    return colDef
      .filter((
        c,
      ) => (c.show_if !== undefined
        ? evaluateCondition(String(c.show_if), env)
        : true)
      )
      .map((c) => resolveColumnItem(c, env));
  }

  // iterate_over + prototype pattern
  if (colDef.iterate_over && colDef.prototype) {
    const { items, alias } = resolveIteratee(colDef.iterate_over, data, isPreview);
    return items.map((item) => {
      const itemEnv = { ...env, ...flattenToEnv(item) };
      if (alias) itemEnv[alias] = JSON.stringify(item);
      return resolveColumnItem(colDef.prototype, itemEnv);
    });
  }

  return [];
}

function resolveColumnItem(
  c: Record<string, any>,
  env: Record<string, string>,
): ResolvedColumn {
  return {
    label: resolveValue(c.label, env),
    primary: resolveValue(c.primary, env),
    secondary: resolveValue(c.secondary, env),
    title: resolveValue(c.title, env),
    titleAction: resolveAction(c.titleAction, env),
    thumbnail: resolveValue(c.thumbnail, env),
    icon: resolveColumnIcon(c.icon, env),
    progress: c.progress
      ? {
        type: c.progress.type,
        value: resolveNumber(c.progress.value, env),
        thresholds: c.progress.thresholds,
        zero_label: c.progress.zero_label,
      }
      : undefined,
    badge: c.badge ? resolveBadge(c.badge, env) : undefined,
  };
}

function resolveColumnIcon(
  def: any,
  env: Record<string, string>,
): ResolvedColumn["icon"] {
  if (!def) return undefined;
  if (typeof def === "string") {
    return { file: resolveValue(def, env) };
  }

  return {
    type: def.type,
    file: resolveValue(def.file, env),
    size: def.size,
    description: resolveValue(def.description, env),
    useFrostedGradient: def.useFrostedGradient === undefined
      ? undefined
      : Boolean(resolveValue(def.useFrostedGradient, env)),
  };
}

function resolveListItem(
  prototype: any,
  env: Record<string, string>,
): ResolvedListItem {
  return {
    accent: resolveMappedValue(prototype.accent, env),
    icon: resolveMappedValue(prototype.icon, env),
    title: resolveValue(prototype.title, env),
    titleAction: resolveAction(prototype.titleAction, env),
    subtitle: resolveSubtitle(prototype.subtitle, env),
    thumbnail: resolveValue(prototype.thumbnail, env),
    badge: prototype.badge ? resolveBadge(prototype.badge, env) : undefined,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

function resolveList(
  listDef: any,
  env: Record<string, string>,
  data: Record<string, any> | null,
  isPreview: boolean,
): ResolvedListItem[] {
  if (!listDef?.prototype) return [];

  const { items, alias } = resolveIteratee(listDef.iterate_over, data, isPreview);
  const limit = listDef.max_items ?? listDef.max_visible ?? Infinity;

  return items.slice(0, limit).map((item) => {
    const itemEnv = { ...env, ...flattenToEnv(item) };
    if (alias) itemEnv[alias] = JSON.stringify(item);
    return resolveListItem(listDef.prototype, itemEnv);
  });
}

// ── Iteration ─────────────────────────────────────────────────────────────────

/**
 * Resolves the array to iterate over.
 * The SDK should have already materialised computed/endpoint data into the `data`
 * object by the time the widget renders, so we just do a nested key lookup.
 * In preview mode with no data, returns a single stub item.
 */
function resolveIteratee(
  path: string | undefined,
  data: Record<string, any> | null,
  isPreview: boolean,
): { items: Record<string, any>[]; alias?: string } {
  if (!data) {
    return {
      items: isPreview
        ? [{ name: "Example Item", title: "Example", id: "preview-1" }]
        : [],
    };
  }

  if (!path) return { items: [] };

  const normalized = path.replace(/^this\./, "");
  const direct = getNestedValue(data, normalized);
  const alias = deriveIterateeAlias(normalized);
  if (Array.isArray(direct)) return { items: direct, alias };
  if (direct && typeof direct === "object") return { items: Object.values(direct), alias };

  // Strip "computed." or "this.endpoints.*.mappedResponse." prefixes as a fallback.
  const stripped = normalized
    .replace(/^computed\./, "")
    .replace(/^this\.endpoints\.[^.]+\.mappedResponse\./, "");

  const val = getNestedValue(data, stripped);
  if (Array.isArray(val)) return { items: val, alias };
  if (val && typeof val === "object") return { items: Object.values(val), alias };
  return { items: [], alias };
}

function deriveIterateeAlias(path: string): string | undefined {
  const stripped = path
    .replace(/^computed\./, "")
    .replace(/^this\.endpoints\.[^.]+\.mappedResponse\./, "")
    .replace(/\[.*\]$/g, "");

  const segments = stripped.split(".").filter(Boolean);
  if (segments.length === 0) return undefined;

  const last = segments[segments.length - 1];
  if (last.endsWith("s") && last.length > 1) {
    return last.slice(0, -1);
  }
  return last;
}

// ── Env building ──────────────────────────────────────────────────────────────

/**
 * Builds the interpolation environment for a widget render pass.
 * Priority (highest → lowest): live data > widget input > integration env defaults.
 */
function buildEnv(opts: ResolveOptions): Record<string, string> {
  const { widgetJSON, integrationJSON, data, isPreview } = opts;
  const env: Record<string, string> = {};

  const envVarDefs: Record<string, any> =
    integrationJSON?.configuration?.environment_variables ?? {};
  for (const [k, def] of Object.entries(envVarDefs)) {
    if (def?.default !== undefined) {
      env[k] = String(def.default);
    }
  }

  const input: Record<string, any> = widgetJSON?.data?.input ?? {};
  for (const [k, v] of Object.entries(input)) {
    const raw = String(v ?? "");
    const resolved = interpolateString(raw, env).trim();

    // keep existing env value if input is just an unresolved placeholder
    if (resolved && !/^\$\{[^}]+\}$/.test(raw)) {
      env[k] = resolved;
    }
  }

  if (data && !isPreview) {
    Object.assign(env, flattenToEnv(data));
  }
  return env;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export { flattenToEnv };
