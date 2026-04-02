"use client";

import React from "react";
import { interpolateString, flattenToEnv } from "./data/resolveProperties";

export type GlanceableProps = {
  /** The glanceable definition from configuration.glanceables[] */
  glanceableJSON: Record<string, any>;
  /** Runtime data hydrated by the SDK. Omit / null in preview mode. */
  data?: Record<string, any> | null;
  /** When true, renders fallback/example values */
  isPreview?: boolean;
  className?: string;
};

export default function Glanceable({
  glanceableJSON,
  data,
  isPreview = false,
  className,
}: GlanceableProps) {
  const env: Record<string, string> = isPreview
    ? buildPreviewEnv(glanceableJSON)
    : flattenToEnv(data ?? {});

  const rawText = typeof glanceableJSON.text === "string" ? glanceableJSON.text : "";
  const text = rawText ? interpolateString(rawText, env) : (glanceableJSON.name ?? "");

  const iconSrc =
    glanceableJSON.icon && glanceableJSON.icon !== "none"
      ? typeof glanceableJSON.icon === "string"
        ? glanceableJSON.icon
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
