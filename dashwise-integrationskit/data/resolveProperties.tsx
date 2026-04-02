// dashwise-integrationskit/data/resolveProperties.tsx
//
// Resolves a widget definition (from YAML) + hydrated data into flat, renderable structs.
// Integration-backed widgets can also resolve their runtime data here so the
// kit owns the endpoint/computed-field boundary.

import { resolveEndpointCatalog } from "./getEndpointData";
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
  icon?: { type?: string; file?: string; size?: number; description?: string };
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
};

export type RuntimeDataResolution = {
  data: Record<string, any> | null;
  env: Record<string, string>;
};

// ── Main entry ────────────────────────────────────────────────────────────────

export function resolveWidgetProperties(opts: ResolveOptions): ResolvedWidget {
  const { widgetJSON, data, isPreview } = opts;
  const props: Record<string, any> = widgetJSON.properties ?? {};
  const env = buildEnv(opts);
  const template: string = widgetJSON.template ?? "columns";

  const header = props.header ? resolveHeader(props.header, env) : undefined;

  if (template === "columns") {
    return { header, columns: resolveColumns(props.columns, env, data, isPreview), raw: props };
  }

  if (template === "vertical-list") {
    return { header, list: resolveList(props.list, env, data, isPreview), raw: props };
  }

  if (template === "icon-details-card") {
    return {
      header,
      card: {
        icon: resolveValue(props.icon, env),
        primary: resolveValue(props.primary, env),
        secondary: resolveValue(props.secondary, env),
      },
      raw: props,
    };
  }

  return { header, raw: props };
}

export async function resolveWidgetRuntimeData(
  opts: ResolveOptions,
): Promise<RuntimeDataResolution> {
  const { widgetJSON, integrationJSON, data, isPreview } = opts;

  if (isPreview) {
    return { data: null, env: buildEnv(opts) };
  }

  if (data) {
    return { data, env: buildEnv(opts) };
  }

  const integrationConfig = (integrationJSON?.configuration ?? {}) as Record<string, any>;
  const baseEnv = buildEnv(opts);
  const endpointResult = await resolveEndpointCatalog(integrationConfig.endpoints, {
    env: baseEnv,
    scope: {},
  });

  const computed = resolveComputedFields(integrationConfig.computed, {
    env: endpointResult.env,
    scope: {
      endpoints: endpointResult.endpoints,
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
  const show = def.show_if !== undefined ? evaluateCondition(String(def.show_if), env) : true;
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
      .filter((c) => (c.show_if !== undefined ? evaluateCondition(String(c.show_if), env) : true))
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

function resolveColumnItem(c: Record<string, any>, env: Record<string, string>): ResolvedColumn {
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
export function resolveValue(val: any, env: Record<string, string>): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "string") return resolveStringWithFallback(val, env);
  if (typeof val === "object") {
    // operation-based field — we can't execute operations here (SDK does that),
    // so return the fallback if present
    if (typeof val.fallback === "string") return val.fallback;
    if (typeof val.value === "string") return resolveStringWithFallback(val.value, env);
    return undefined;
  }
  return String(val);
}

/**
 * Handles "primary_expr ??? fallback_value" chains.
 * Tries each segment left-to-right; returns first non-empty result.
 */
function resolveStringWithFallback(template: string, env: Record<string, string>): string {
  const segments = template.split("???");
  for (const seg of segments) {
    const result = interpolateString(seg.trim(), env);
    if (result.trim()) return result;
  }
  // All segments empty — return the last one as-is (it's the final fallback)
  return segments[segments.length - 1].trim();
}

/** Replaces ${KEY} placeholders with env values. Missing keys → "". */
export function interpolateString(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, key) => env[key.trim()] ?? "");
}

function resolveNumber(val: any, env: Record<string, string>): number | undefined {
  const str = resolveValue(val, env);
  if (!str) return undefined;
  const n = parseFloat(str);
  return isNaN(n) ? undefined : n;
}

function resolveAction(raw: string | undefined, env: Record<string, string>): string | undefined {
  if (!raw) return undefined;
  const resolved = interpolateString(raw, env);
  return resolved.startsWith("url:") ? resolved.slice(4) : resolved || undefined;
}

/**
 * Resolves a value that may be a direct string or a { value, map } object
 * (used for accent color and icon in vertical-list prototypes).
 */
function resolveMappedValue(def: any, env: Record<string, string>): string | undefined {
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
  const show =
    def.show_if !== undefined ? evaluateCondition(String(def.show_if), env) : true;
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
function evaluateCondition(condition: string, env: Record<string, string>): boolean {
  const resolved = interpolateString(condition, env).trim();
  if (resolved === "true") return true;
  if (resolved === "false" || resolved === "") return false;

  const notContains = resolved.match(/^(.+?)\s+not\s+contains\s+'?([^']+)'?\s*$/i);
  if (notContains) {
    const lhs = (resolveValue(notContains[1].trim(), env) ?? notContains[1]).toLowerCase();
    return !lhs.includes(notContains[2].toLowerCase());
  }

  const contains = resolved.match(/^(.+?)\s+contains\s+'?([^']+)'?\s*$/i);
  if (contains) {
    const lhs = (resolveValue(contains[1].trim(), env) ?? contains[1]).toLowerCase();
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
    return isPreview ? [{ name: "Example Item", title: "Example", id: "preview-1" }] : [];
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

  // 1. Integration-level env var defaults
  const envVarDefs: Record<string, any> =
    integrationJSON?.configuration?.environment_variables ?? {};
  for (const [k, def] of Object.entries(envVarDefs)) {
    if ((def as any)?.default !== undefined) {
      env[k] = String((def as any).default);
    }
  }

  // 2. Widget input values (resolved env vars baked in by SDK at hydration time)
  const input: Record<string, any> = widgetJSON?.data?.input ?? {};
  for (const [k, v] of Object.entries(input)) {
    env[k] = String(v ?? "");
  }

  // 3. Flatten live data — skipped in preview mode
  if (data && !isPreview) {
    Object.assign(env, flattenToEnv(data));
  }

  return env;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {flattenToEnv};