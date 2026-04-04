"use client";

import React, { useEffect, useMemo, useState } from "react";
import { interpolateString, flattenToEnv } from "./data/resolveProperties";

export type GlanceableProps = {
  /** The glanceable definition from configuration.glanceables[] */
  glanceableJSON?: Record<string, any>;
  /** Runtime data hydrated by the SDK. Omit / null in preview mode. */
  data?: Record<string, any> | null;
  /** When true, renders fallback/example values */
  isPreview?: boolean;
  className?: string;
  /** Legacy compatibility: render from a glanceable type + params payload. */
  type?: string;
  params?: Record<string, any>;
};

export default function Glanceable({
  glanceableJSON,
  data,
  isPreview = false,
  className,
  type,
  params,
}: GlanceableProps) {
  if (!glanceableJSON && type) {
    return <LegacyGlanceable type={type} params={params} className={className} />;
  }

  const safeGlanceableJSON = glanceableJSON ?? {};
  const env: Record<string, string> = isPreview
    ? buildPreviewEnv(safeGlanceableJSON)
    : flattenToEnv(data ?? {});

  const rawText = typeof safeGlanceableJSON.text === "string" ? safeGlanceableJSON.text : "";
  const text = rawText ? interpolateString(rawText, env) : (safeGlanceableJSON.name ?? "");

  const iconSrc =
    safeGlanceableJSON.icon && safeGlanceableJSON.icon !== "none"
      ? typeof safeGlanceableJSON.icon === "string"
        ? safeGlanceableJSON.icon
        : null
      : null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-sm ${className ?? ""}`}
    >
      {iconSrc && (
        <img src={iconSrc} alt="" className="h-4 w-4 object-contain shrink-0" />
      )}
      <span>{text}</span>
    </span>
  );
}

function LegacyGlanceable({
  type,
  params,
  className,
}: {
  type: string;
  params?: Record<string, any>;
  className?: string;
}) {
  switch (type) {
    case "date":
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{formatDate(new Date(), params?.format)}</span>;

    case "greeting":
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>Hello</span>;

    case "local-timezone":
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{getLocalTimezoneLabel()}</span>;

    case "weather":
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{formatWeather(params)}</span>;

    case "world-clock":
      return <LegacyWorldClock params={params} className={className} />;

    default:
      return <span className={`inline-flex items-center text-sm ${className ?? ""}`}>{params?.name ?? type}</span>;
  }
}

function LegacyWorldClock({
  params,
  className,
}: {
  params?: Record<string, any>;
  className?: string;
}) {
  const timezone = useMemo(() => normalizeTimezone(params?.timezone), [params?.timezone]);
  const location = useMemo(() => parseTemplateLikeString(params?.location) || "", [params?.location]);
  const [time, setTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const formatted = timezone ? formatTime(now, { timeZone: timezone }) : formatTime(now);
      setTime(formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 60 * 1000);
    return () => clearInterval(interval);
  }, [timezone]);

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

function formatWeather(params?: Record<string, any>) {
  const description = params?.description;
  const weatherCode = params?.weatherCode;
  const emoji = getWeatherEmoji(weatherCode, description);
  const temperature = params?.temperature ?? params?.temp ?? "";
  const unit = params?.unit ?? "";
  const location = params?.showLocation === true && typeof params?.name === "string"
    ? ` in ${params.name.split(",")[0]}`
    : "";

  return `${emoji} ${temperature}${unit}${location}`.trim();
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

function formatDate(input?: Date | string | number, overrideFormat?: string) {
  const date = toDate(input);
  const pattern = overrideFormat || "DD-MM-YYYY";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());

  const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);

  return pattern
    .replace("dddd", weekdayLong)
    .replace("ddd", weekdayShort)
    .replace("DD", day)
    .replace("MM", month)
    .replace("YYYY", year)
    .trim();
}

function formatTime(input?: Date | string | number, opts?: Intl.DateTimeFormatOptions) {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPreviewEnv(def: Record<string, any>): Record<string, string> {
  const env: Record<string, string> = {};

  // Stub lib.date values
  env["lib.date.now"] = new Date().toLocaleDateString();
  env["lib.date.current_timezone"] = Intl.DateTimeFormat().resolvedOptions().timeZone;
  env["lib.date.time"] = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // Expose declared properties as both bare key and properties.key
  const props = def.properties ?? {};
  for (const [k, v] of Object.entries(props)) {
    const str = String(v ?? "");
    env[k] = str;
    env[`properties.${k}`] = str;
  }

  return env;
}
