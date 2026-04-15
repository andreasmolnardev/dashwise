import { encodeTypedText } from "../renderText";

export function resolveValue(
  val: any,
  env: Record<string, string>,
): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "string") return resolveStringWithFallback(val, env);
  if (typeof val === "object") {
    if (typeof val.fallback === "string") return resolveStringWithFallback(val.fallback, env);
    if (typeof val.value === "string") {
      return resolveStringWithFallback(val.value, env);
    }
    return undefined;
  }
  return String(val);
}

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

    const result = resolveStringWithCasts(trimmed, env);
    if (result.trim()) return result;
  }

  return segments[segments.length - 1].trim();
}

export function resolveStringWithCasts(
  template: string,
  env: Record<string, string>,
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, rawKey) => {
    const { path, cast, castArgs } = parseTypedPlaceholder(String(rawKey));
    const resolved = interpolateString("${" + path + "}", env);

    if (!cast) {
      return resolved;
    }

    if (resolved === undefined || resolved === null || `${resolved}`.trim() === "") {
      return "";
    }

    return encodeTypedText(cast, resolved, castArgs);
  });
}

function parseTypedPlaceholder(rawKey: string) {
  const parts = rawKey.split(":").map((part) => part.trim()).filter(Boolean);
  const path = parts.shift() ?? "";
  const cast = parts.shift() ?? "";
  return {
    path,
    cast: cast || undefined,
    castArgs: parts,
  };
}

export function interpolateString(
  template: string,
  env: Record<string, string>,
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, key) => {
    const trimmed = key.trim();

    if (trimmed in env) return env[trimmed] ?? "";

    const parts = trimmed.split(".");
    for (let i = parts.length - 1; i >= 1; i--) {
      const baseKey = parts.slice(0, i).join(".");
      if (!(baseKey in env)) continue;

      const raw = env[baseKey];
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

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

    return "";
  });
}

export function resolveNumber(
  val: any,
  env: Record<string, string>,
): number | undefined {
  const str = resolveValue(val, env);
  if (!str) return undefined;
  const n = parseFloat(str);
  return isNaN(n) ? undefined : n;
}

export function resolveAction(
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

export function resolveMappedValue(
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

export function resolveSubtitle(
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

export function resolveBadge(
  def: Record<string, any>,
  env: Record<string, string>,
) {
  const show = def.show_if !== undefined
    ? evaluateCondition(String(def.show_if), env)
    : true;
  return {
    show,
    icon: def.icon,
    tooltip: resolveValue(def.tooltip, env),
  };
}

export function evaluateCondition(
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
