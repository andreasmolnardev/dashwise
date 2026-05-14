"use client";

import React, { useEffect, useMemo, useState } from "react";
import AppIcon from "@dashwise/app-icon";
import {
  flattenToEnv,
  resolveStringWithCasts,
  resolveGlanceableRuntimeData,
} from "./data/resolveProperties";
import { renderLocalizedText, type TextFormatters } from "./data/renderText";

export type GlanceableProps = {
  /** The glanceable definition from configuration.glanceables[] */
  glanceableJSON?: Record<string, any>;
  /** Full integration JSON used to resolve runtime environment values. */
  integrationJSON?: Record<string, any> | null;
  /** Runtime data hydrated by the SDK. Omit / null in preview mode. */
  data?: Record<string, any> | null;
  /** When true, renders fallback/example values */
  isPreview?: boolean;
  className?: string;
  /** Legacy compatibility: render from a glanceable type + params payload. */
  type?: string;
  params?: Record<string, any>;
  /** Optional fully resolved glanceable payload from backend. */
  resolved?: {
    text: string;
    icon?: string | null;
  };
  formatters?: TextFormatters;
};

export default function Glanceable({
  glanceableJSON,
  integrationJSON,
  data,
  isPreview = false,
  className,
  type,
  params,
  resolved,
  formatters,
}: GlanceableProps) {
  if (resolved) {
    return (
      <span
        className={`inline-flex items-center gap-1 ${className ?? ""}`}
      >
        {resolved.icon && (
          <AppIcon source={resolved.icon} alt="" className="text-lg object-contain shrink-0" />
        )}
        <span>{renderLocalizedText(resolved.text, formatters)}</span>
      </span>
    );
  }

  if (!glanceableJSON && type) {
    return <LegacyGlanceable type={type} params={params} className={className} formatters={formatters} />;
  }

  const safeGlanceableJSON = useMemo(
    () => mergeGlanceableJSON(glanceableJSON ?? {}, params),
    [glanceableJSON, params],
  );
  const baseEnv = useMemo(
    () => (isPreview ? buildPreviewEnv(safeGlanceableJSON) : buildGlanceableEnv(safeGlanceableJSON)),
    [isPreview, safeGlanceableJSON],
  );
  const [resolvedRuntimeData, setResolvedRuntimeData] = useState<
    Record<string, any> | null
  >(data ?? null);

  useEffect(() => {
    let cancelled = false;

    if (data !== undefined) {
      setResolvedRuntimeData(data);
      return () => {
        cancelled = true;
      };
    }

    if (!integrationJSON || isPreview) {
      setResolvedRuntimeData(null);
      return () => {
        cancelled = true;
      };
    }

    const loadRuntimeData = async () => {
      try {
        const runtimeData = await resolveGlanceableRuntimeData({
          glanceableJSON: safeGlanceableJSON,
          integrationJSON,
          data: null,
          isPreview,
          baseEnv,
        });

        if (!cancelled) {
          setResolvedRuntimeData(runtimeData.data);
        }
      } catch {
        if (!cancelled) {
          setResolvedRuntimeData(null);
        }
      }
    };

    void loadRuntimeData();

    return () => {
      cancelled = true;
    };
  }, [baseEnv, data, formatters, integrationJSON, isPreview, safeGlanceableJSON]);

  const env = useMemo(() => {
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
      ...baseEnv,
      ...integrationEnv,
      ...(resolvedRuntimeData ? flattenToEnv(resolvedRuntimeData) : {}),
    };
  }, [integrationJSON, isPreview, resolvedRuntimeData, safeGlanceableJSON]);

  const rawText = typeof safeGlanceableJSON.text === "string" ? safeGlanceableJSON.text : "";
  const text = rawText ? resolveGlanceableText(rawText, env, formatters) : (safeGlanceableJSON.name ?? "");

  const iconSrc = getGlanceableIconSource(safeGlanceableJSON.icon);

  return (
    <span
      className={`inline-flex items-center gap-1 ${className ?? ""}`}
    >
      {iconSrc && (
        <AppIcon source={iconSrc} alt="" className="text-lg object-contain shrink-0" />
      )}
      <span>{text}</span>
    </span>
  );
}

function LegacyGlanceable({
  type,
  params,
  className,
  formatters,
}: {
  type: string;
  params?: Record<string, any>;
  className?: string;
  formatters?: TextFormatters;
}) {
  switch (type) {
    case "date":
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{formatDate(new Date(), params?.format, formatters)}</span>;

    case "greeting":
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>Hello</span>;

    case "local-timezone":
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{getLocalTimezoneLabel()}</span>;

    case "weather":
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{formatWeather(params, formatters)}</span>;

    case "world-clock":
      return <LegacyWorldClock params={params} className={className} formatters={formatters} />;

    default:
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{params?.name ?? type}</span>;
  }
}

function LegacyWorldClock({
  params,
  className,
  formatters,
}: {
  params?: Record<string, any>;
  className?: string;
  formatters?: TextFormatters;
}) {
  const timezone = useMemo(() => normalizeTimezone(params?.timezone), [params?.timezone]);
  const location = useMemo(() => parseTemplateLikeString(params?.location) || "", [params?.location]);
  const [time, setTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const formatted = timezone ? formatTime(now, { timeZone: timezone }, formatters) : formatTime(now, undefined, formatters);
      setTime(formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 60 * 1000);
    return () => clearInterval(interval);
  }, [formatters, timezone]);

  return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{time}{location ? ` in ${location}` : ""}</span>;
}

function getLocalTimezoneLabel() {
  const timezoneName = Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value || "";

  if (timezoneName) return timezoneName;

  const offset = -new Date().getTimezoneOffset() / 60;
  return `GMT${offset >= 0 ? "+" : ""}${offset}`;
}

function formatWeather(params?: Record<string, any>, formatters?: TextFormatters) {
  const description = params?.description;
  const weatherCode = params?.weatherCode;
  const emoji = getWeatherEmoji(weatherCode, description);
  const temperature = params?.temperature ?? params?.temp ?? "";
  const unit = params?.unit ?? "";
  const location = params?.showLocation === true && typeof params?.name === "string"
    ? ` in ${params.name.split(",")[0]}`
    : "";

  const temperatureText = formatters?.formatTemperature
    ? formatters.formatTemperature(Number(temperature), params?.temperatureUnit ?? "c")
    : `${temperature}${unit}`;
  return `${emoji} ${temperatureText}${location}`.trim();
}

function getWeatherEmoji(weatherCode: unknown, description: unknown) {
  const code = typeof weatherCode === "number" ? weatherCode : Number(weatherCode);
  if (Number.isFinite(code)) {
    if (code === 0) return "☀️";
    if (code === 1 || code === 2) return "🌤️";
    if (code === 3) return "☁️";
    if (code === 45 || code === 48) return "🌫️";
    if (code === 51 || code === 53 || code === 55) return "🌦️";
    if (code === 56 || code === 57) return "🌧️";
    if (code === 61 || code === 63 || code === 65) return "🌧️";
    if (code === 66 || code === 67) return "🌨️";
    if (code === 71 || code === 73 || code === 75) return "❄️";
    if (code === 80 || code === 81 || code === 82) return "🌧️";
    if (code === 95 || code === 96 || code === 99) return "⛈️";
  }

  const text = typeof description === "string" ? description.toLowerCase() : "";
  if (text.includes("snow")) return "❄️";
  if (text.includes("thunder")) return "⛈️";
  if (text.includes("fog")) return "🌫️";
  if (text.includes("rain") || text.includes("drizzle")) return "🌧️";
  if (text.includes("cloud")) return "☁️";
  if (text.includes("sun") || text.includes("clear")) return "☀️";
  return "🌡️";
}

function normalizeTimezone(raw: unknown): string | undefined {
  const parsed = parseTemplateLikeString(raw);
  if (!parsed) return undefined;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: parsed });
    return parsed;
  } catch {
    return undefined;
  }
}

function parseTemplateLikeString(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;

  const text = String(raw).trim();
  if (!text) return undefined;

  const segments = text.includes("???") ? text.split("???") : [text];
  for (const segment of segments) {
    const candidate = segment.trim();
    if (!candidate || /^type:/i.test(candidate)) continue;
    return candidate.replace(/^['\"]|['\"]$/g, "").trim();
  }

  return undefined;
}

function formatDate(input?: Date | string | number, overrideFormat?: string, formatters?: TextFormatters) {
  if (formatters?.formatDate) return formatters.formatDate(input, overrideFormat);
  const date = toDate(input);
  const pattern = overrideFormat || "DD-MM-YYYY";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
  const monthLong = new Intl.DateTimeFormat(undefined, { month: "long" }).format(date);
  const year = String(date.getFullYear());

  const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);

  return pattern
    .replace("dddd", weekdayLong)
    .replace("ddd", weekdayShort)
    .replace("mmmm", monthLong)
    .replace("mmm", monthShort)
    .replace("DD", day)
    .replace("MM", month)
    .replace("YYYY", year)
    .trim();
}

function formatTime(input?: Date | string | number, opts?: Intl.DateTimeFormatOptions, formatters?: TextFormatters) {
  if (formatters?.formatTime) return formatters.formatTime(input, opts);
  const date = toDate(input);
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...opts,
  }).format(date);
}

function toDate(input?: Date | string | number): Date {
  if (!input) return new Date();
  return input instanceof Date ? input : new Date(input);
}

function mergeGlanceableJSON(glanceableJSON: Record<string, any>, params?: Record<string, any>) {
  if (!params || typeof params !== "object") {
    return glanceableJSON;
  }

  return {
    ...glanceableJSON,
    properties: {
      ...(glanceableJSON.properties ?? {}),
      ...params,
    },
  };
}

function getGlanceableIconSource(icon: unknown) {
  if (!icon || icon === "none") return null;
  if (typeof icon === "string") return icon;

  if (typeof icon === "object") {
    const iconRecord = icon as Record<string, any>;
    const source =
      iconRecord.source ??
      iconRecord.file ??
      iconRecord.icon ??
      iconRecord.value;

    if (typeof source === "string" && source.trim()) {
      return source.trim();
    }
  }

  return null;
}

function resolveGlanceableText(template: string, env: Record<string, string>, formatters?: TextFormatters) {
  const withLibDate = template.replace(/\$\{lib\.date\.time\((.+)\)\}/g, (_match, rawTimezone: string) => {
    const timezone = normalizeTimezone(resolveStringWithCasts(String(rawTimezone).trim(), env));
    return timezone ? formatTime(new Date(), { timeZone: timezone }, formatters) : formatTime(new Date(), undefined, formatters);
  });

  return resolveStringWithCasts(withLibDate, env);
}

function buildGlanceableEnv(def: Record<string, any>): Record<string, string> {
  const env: Record<string, string> = {};
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  env["date.now"] = now.toLocaleDateString();
  env["user.current_timezone"] = timezone;
  env["lib.date.now"] = now.toLocaleDateString();
  env["lib.date.current_timezone"] = timezone;
  env["lib.date.time"] = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const props = def.properties ?? {};
  for (const [k, v] of Object.entries(props)) {
    const str = String(v ?? "");
    env[k] = str;
    env[`properties.${k}`] = str;
  }

  return env;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPreviewEnv(def: Record<string, any>): Record<string, string> {
  return buildGlanceableEnv(def);
}
