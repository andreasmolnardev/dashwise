// dashwise-integrationskit/data/resolveProperties.tsx
//
// Resolves a widget definition (from YAML) + hydrated data into flat, renderable structs.
// Integration-backed widgets can also resolve their runtime data here so the
// kit owns the endpoint/computed-field boundary.

import { resolveEndpointCatalog } from "./getEndpointData";
import type { EndpointRuntimeCacheAdapter } from "./getEndpointData";
import {
  flattenToEnv,
  getNestedValue,
  resolveComputedFields,
} from "./getComputedField";

// ── Public types ──────────────────────────────────────────────────────────────

export type ResolvedWidget = {
  header?: {
    title?: string;
    icon?: string;
    titleAction?: string;
    /** false when show_if evaluated to false */
    show?: boolean;
  };
  /** Populated for template: "columns" */
  columns?: ResolvedColumn[];
  /** Populated for template: "vertical-list" */
  list?: ResolvedListItem[];
  /** Populated for template: "icon-details-card" */
  card?: {
    icon?: string;
    primary?: string;
    secondary?: string;
  };
  /** The raw properties object, passed through for custom consumers */
  raw: Record<string, any>;
};

export type ResolvedColumn = {
  label?: string;
  icon?: {
    type?: string;
    file?: string;
    size?: number;
    description?: string;
    useFrostedGradient?: boolean;
  };
  primary?: string;
  secondary?: string;
  progress?: {
    type?: string;
    value?: number;
    thresholds?: Array<{ min: number; color: string }>;
    zero_label?: string;
  };
  title?: string;
  titleAction?: string;
  badge?: { show?: boolean; icon?: string; tooltip?: string };
  thumbnail?: string;
};

export type ResolvedIcon = {
  source?: string;
  useFrostedGradient?: boolean;
};

export type ResolvedListItem = {
  accent?: string;
  icon?: string;
  title?: string;
  titleAction?: string;
  subtitle?: string | string[];
  thumbnail?: string;
  badge?: { show?: boolean; icon?: string; tooltip?: string };
};

export type ResolveOptions = {
  widgetJSON: Record<string, any>;
  integrationJSON: Record<string, any> | null;
  data: Record<string, any> | null;
  isPreview: boolean;
  endpointCache?: EndpointRuntimeCacheAdapter;
};

export type RuntimeDataResolution = {
  data: Record<string, any> | null;
  env: Record<string, string>;
};

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
  // Helper to replace values like "integrations.someId.details.icon" -> lookup tail on integrationJSON
  const resolveIfIntegrationRef = (val?: string, env?: Record<string, any>) => {
    if (!val || typeof val !== "string") return val;
    return resolveValue(val, env ?? {}) ?? val;
  };

  if (res.header && res.header.icon) {
    res.header.icon = resolveIfIntegrationRef(res.header.icon, env);
  }

  if (res.card && res.card.icon) {
    res.card.icon = resolveIfIntegrationRef(res.card.icon, env);
  }

  if (res.columns) {
    res.columns = res.columns.map((c) => ({
      ...c,
      // column.icon.file might be an integration ref stored in the file property
      icon: c.icon
        ? { ...c.icon, file: resolveIfIntegrationRef(c.icon.file, env) }
        : c.icon,
    }));
  }

  if (res.list) {
    res.list = res.list.map((item) => ({
      ...item,
      icon: resolveIfIntegrationRef(item.icon, env),
    }));
  }

  return res;
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
  });
}

export async function resolveGlanceableRuntimeData(opts: {
  glanceableJSON: Record<string, any>;
  integrationJSON: Record<string, any> | null;
  data: Record<string, any> | null;
  isPreview: boolean;
  baseEnv?: Record<string, string>;
  endpointCache?: EndpointRuntimeCacheAdapter;
}): Promise<RuntimeDataResolution> {
  const { integrationJSON, data, isPreview, baseEnv = {}, endpointCache } = opts;
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

  return resolveIntegrationRuntimeData({
    integrationJSON,
    data,
    isPreview,
    env: {
      ...baseEnv,
      ...integrationEnv,
    },
    endpointCache,
  });
}

async function resolveIntegrationRuntimeData(
  opts: RuntimeDataResolutionOptions,
): Promise<RuntimeDataResolution> {
  const { integrationJSON, data, isPreview, env, endpointCache } = opts;

  if (isPreview) {
    return { data: null, env };
  }

  if (data) {
    return { data, env };
  }

  const integrationConfig = (integrationJSON?.configuration ?? {}) as Record<
    string,
    any
  >;
  const endpointResult = await resolveEndpointCatalog(
    integrationConfig.endpoints,
    {
      env,
      scope: {},
      cache: endpointCache,
    },
  );

  const computed = resolveComputedFields(integrationConfig.computed, {
    env: endpointResult.env,
    scope: {
      endpoints: endpointResult.endpoints,
      lookup_tables: integrationConfig.lookup_tables,
    },
  });

  const runtimeScope = {
    endpoints: endpointResult.endpoints,
    computed,
  };

  return {
    data: runtimeScope,
    env: {
      ...endpointResult.env,
      ...flattenToEnv(runtimeScope),
    },
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
    const items = resolveIteratee(colDef.iterate_over, data, isPreview);
    return items.map((item) =>
      resolveColumnItem(colDef.prototype, { ...env, ...flattenToEnv(item) })
    );
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
    icon: c.icon
      ? {
        type: c.icon.type,
        file: resolveValue(c.icon.file, env),
        size: c.icon.size,
        description: resolveValue(c.icon.description, env),
        useFrostedGradient: c.icon.useFrostedGradient === undefined
          ? undefined
          : Boolean(resolveValue(c.icon.useFrostedGradient, env)),
      }
      : undefined,
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

function resolveCardIcon(
  def: any,
  env: Record<string, string>,
): ResolvedIcon | undefined {
  if (def === undefined || def === null) return undefined;

  if (typeof def === "string") {
    return { source: resolveValue(def, env) };
  }

  if (typeof def === "object") {
    return {
      source: resolveValue(
        def.source ?? def.file ?? def.icon ?? def.value,
        env,
      ),
      useFrostedGradient: def.useFrostedGradient === undefined
        ? undefined
        : Boolean(resolveValue(def.useFrostedGradient, env)),
    };
  }

  return { source: resolveValue(def, env) };
}

// ── List ──────────────────────────────────────────────────────────────────────

function resolveList(
  listDef: any,
  env: Record<string, string>,
  data: Record<string, any> | null,
  isPreview: boolean,
): ResolvedListItem[] {
  if (!listDef?.prototype) return [];

  const items = resolveIteratee(listDef.iterate_over, data, isPreview);
  const limit = listDef.max_items ?? listDef.max_visible ?? Infinity;

  return items.slice(0, limit).map((item) => {
    const itemEnv = { ...env, ...flattenToEnv(item) };
    const p = listDef.prototype;
    return {
      accent: resolveMappedValue(p.accent, itemEnv),
      icon: resolveMappedValue(p.icon, itemEnv),
      title: resolveValue(p.title, itemEnv),
      titleAction: resolveAction(p.titleAction, itemEnv),
      subtitle: resolveSubtitle(p.subtitle, itemEnv),
      thumbnail: resolveValue(p.thumbnail, itemEnv),
      badge: p.badge ? resolveBadge(p.badge, itemEnv) : undefined,
    };
  });
}

// ── Value resolution ──────────────────────────────────────────────────────────

/**
 * Resolves any YAML value:
 * - string with ${VAR} and "primary ??? fallback" syntax
 * - number / boolean → stringified
 * - object with operation / fallback → returns fallback stub
 */
export function resolveValue(
  val: any,
  env: Record<string, string>,
): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "string") return resolveStringWithFallback(val, env);
  if (typeof val === "object") {
    // operation-based field — we can't execute operations here (SDK does that),
    // so return the fallback if present
    if (typeof val.fallback === "string") return val.fallback;
    if (typeof val.value === "string") {
      return resolveStringWithFallback(val.value, env);
    }
    return undefined;
  }
  return String(val);
}

/**
 * Handles "primary_expr ??? fallback_value" chains.
 * Tries each segment left-to-right; returns first non-empty result.
 */
function resolveStringWithFallback(
  template: string,
  env: Record<string, string>,
): string {
  const segments = template.split("???");
  for (const seg of segments) {
    const trimmed = seg.trim();
    const ifResult = resolveInlineIfExpression(trimmed, env);
    if (ifResult !== undefined) {
      if (ifResult.trim()) return ifResult;
      continue;
    }

    const result = interpolateString(trimmed, env);
    if (result.trim()) return result;
  }
  // All segments empty — return the last one as-is (it's the final fallback)
  return segments[segments.length - 1].trim();
}

/** Replaces ${KEY} placeholders with env values.
 *  Supports dotted paths: ${WEATHER_LOCATION.name} will JSON-parse
 *  the WEATHER_LOCATION env string and traverse into it. */
export function interpolateString(
  template: string,
  env: Record<string, string>,
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const trimmed = key.trim();

    // 1. Direct hit — fast path, no parsing needed
    if (trimmed in env) return env[trimmed] ?? "";

    // 2. Dotted path: try progressively longer prefixes as the base key
    //    e.g. "WEATHER_LOCATION.name" → base="WEATHER_LOCATION", rest=["name"]
    const parts = trimmed.split(".");
    for (let i = parts.length - 1; i >= 1; i--) {
      const baseKey = parts.slice(0, i).join(".");
      if (!(baseKey in env)) continue;

      const raw = env[baseKey];
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue; // not JSON — try a shorter prefix
      }

      // Walk the remaining path segments into the parsed object
      const restPath = parts.slice(i);
      let cursor: unknown = parsed;
      for (const segment of restPath) {
        if (cursor === null || typeof cursor !== "object") {
          cursor = undefined;
          break;
        }
        cursor = (cursor as Record<string, unknown>)[segment];
      }

      if (cursor !== undefined && cursor !== null) return String(cursor);
    }

    return ""; // nothing resolved
  });
}

function resolveNumber(
  val: any,
  env: Record<string, string>,
): number | undefined {
  const str = resolveValue(val, env);
  if (!str) return undefined;
  const n = parseFloat(str);
  return isNaN(n) ? undefined : n;
}

function resolveAction(
  raw: string | undefined,
  env: Record<string, string>,
): string | undefined {
  if (!raw) return undefined;
  const resolved = resolveStringWithFallback(raw, env);
  return resolved.startsWith("url:")
    ? resolved.slice(4)
    : resolved || undefined;
}

function resolveInlineIfExpression(
  template: string,
  env: Record<string, string>,
): string | undefined {
  const trimmed = template.trim();
  const match = trimmed.match(/^if\s*\((.*)\)$/is);
  if (!match) return undefined;

  const parts = splitTopLevelArguments(match[1]);
  if (parts.length < 3) return undefined;

  const condition = interpolateString(parts[0].trim(), env).trim();
  const whenTrue = parts[1].trim();
  const whenFalse = parts.slice(2).join(",").trim();

  return evaluateCondition(condition, env)
    ? resolveValue(whenTrue, env)
    : resolveValue(whenFalse, env);
}

function splitTopLevelArguments(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (quote) {
      current += char;
      if (char === "\\" && index + 1 < value.length) {
        current += value[index + 1];
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Resolves a value that may be a direct string or a { value, map } object
 * (used for accent color and icon in vertical-list prototypes).
 */
function resolveMappedValue(
  def: any,
  env: Record<string, string>,
): string | undefined {
  if (!def) return undefined;
  if (typeof def === "string") return resolveValue(def, env);
  if (def.value !== undefined && def.map) {
    const key = resolveValue(def.value, env) ?? "";
    return key ? (def.map[key] ?? undefined) : undefined;
  }
  return resolveValue(def.value ?? def, env);
}

function resolveSubtitle(
  def: any,
  env: Record<string, string>,
): string | string[] | undefined {
  if (!def) return undefined;
  if (typeof def === "string") return resolveValue(def, env);
  if (def.type === "list" && def.value) {
    const val = resolveValue(def.value, env);
    if (!val) return undefined;
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return resolveValue(def.value ?? def, env);
}

function resolveBadge(
  def: Record<string, any>,
  env: Record<string, string>,
): ResolvedColumn["badge"] {
  const show = def.show_if !== undefined
    ? evaluateCondition(String(def.show_if), env)
    : true;
  return {
    show,
    icon: def.icon,
    tooltip: resolveValue(def.tooltip, env),
  };
}

// ── Condition evaluation ──────────────────────────────────────────────────────

/**
 * Evaluates simple boolean expressions used in show_if / filter.
 * Supports: "X contains Y", "X not contains Y", plain truthy strings.
 */
function evaluateCondition(
  condition: string,
  env: Record<string, string>,
): boolean {
  const resolved = interpolateString(condition, env).trim();
  if (resolved === "true") return true;
  if (resolved === "false" || resolved === "") return false;

  const notContains = resolved.match(
    /^(.+?)\s+not\s+contains\s+'?([^']+)'?\s*$/i,
  );
  if (notContains) {
    const lhs = (resolveValue(notContains[1].trim(), env) ?? notContains[1])
      .toLowerCase();
    return !lhs.includes(notContains[2].toLowerCase());
  }

  const contains = resolved.match(/^(.+?)\s+contains\s+'?([^']+)'?\s*$/i);
  if (contains) {
    const lhs = (resolveValue(contains[1].trim(), env) ?? contains[1])
      .toLowerCase();
    return lhs.includes(contains[2].toLowerCase());
  }

  return !!resolved;
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
): Record<string, any>[] {
  if (!data) {
    return isPreview
      ? [{ name: "Example Item", title: "Example", id: "preview-1" }]
      : [];
  }

  if (!path) return [];

  const normalized = path.replace(/^this\./, "");
  const direct = getNestedValue(data, normalized);
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === "object") return Object.values(direct);

  // Strip "computed." or "this.endpoints.*.mappedResponse." prefixes as a fallback.
  const stripped = normalized
    .replace(/^computed\./, "")
    .replace(/^this\.endpoints\.[^.]+\.mappedResponse\./, "");

  const val = getNestedValue(data, stripped);
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") return Object.values(val);
  return [];
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
