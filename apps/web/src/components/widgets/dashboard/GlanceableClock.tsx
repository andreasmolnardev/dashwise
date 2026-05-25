// components/widgets/dashboard/GlanceableClock.tsx
"use client";

import ClockWidget from "../ClockWidget";
import GlanceableComponent from "@dashwise/integrationskit/Glanceable";
import { usePageConfig } from "@/hooks/usePageConfig";
import type { WidgetItemProps } from "../Widget";
import useAuth from "@/context/useAuth";
import { useLocalization } from "@/context/LocalizationContext";
import { readPageIntegrationConsumer } from "@/lib/pageIntegrationDataCache";
import { usePageIntegrationStream } from "@/context/PageIntegrationStreamContext";

type ResolvedGlanceablePayload = {
  consumer: "glanceable";
  blueprint: {
    text: string;
    icon: string | null;
    glanceableJSON: Record<string, any>;
  };
  data: Record<string, any> | null;
};

const glanceableConsumerCache = new Map<string, ResolvedGlanceablePayload | null>();
type LocalizationFormatters = Pick<ReturnType<typeof useLocalization>, "formatTemperature" | "formatTime" | "formatDate">;

export default function GlanceableClockWidget({ className, params }: WidgetItemProps) {
  const { pageConfig } = usePageConfig();
  const { user } = useAuth();
  const localization = useLocalization();
  const clockStyle = params?.["clock-style"] as Record<string, any> | undefined;

  // params.glanceables overrides config-level glanceables
  const glanceableOverrides: Record<string, any> | undefined = params?.glanceables;
  const defaultGlanceables: any[] = pageConfig?.glanceables ?? [];

  const glanceableKeys = glanceableOverrides
    ? Object.keys(glanceableOverrides)
    : defaultGlanceables.map((g) => g?.type).filter(Boolean);

  const getParams = (type: string) => {
    const override = glanceableOverrides?.[type];
    if (override && typeof override === "object") return override;
    const fallback = defaultGlanceables.find((g) => g?.type === type);
    if (!fallback) return undefined;
    const { type: _t, ...rest } = fallback;
    return Object.keys(rest).length > 0 ? rest : undefined;
  };

  return (
    <section className={`responsive-glance-grid w-full ${className ?? ""}`}>
      <div style={{ gridArea: "clock" }} className="area-clock w-full flex items-center justify-center text-2xl md:text-4xl leading-tight">
        <div style={{ margin: "0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <ClockWidget
            font={clockStyle?.defaultFont ?? user?.appearancePreferences?.clock?.defaultFont}
            weight={clockStyle?.fontWeight}
            color={clockStyle?.color}
            letterSpacing={clockStyle?.letterSpacing}
            opacity={clockStyle?.opacity}
            outlineEnabled={clockStyle?.outlineEnabled}
            outlineColor={clockStyle?.outlineColor}
            outlineWidth={clockStyle?.outlineWidth}
          />
        </div>
      </div>
      <div style={{ gridArea: "gl1" }} className="area-gl1">
        {glanceableKeys[0] && (
          <ResolvedGlanceable
            type={glanceableKeys[0]}
            params={getParams(glanceableKeys[0])}
            formatters={localization}
            className="font-medium"
          />
        )}
      </div>
      <div style={{ gridArea: "gl2" }} className="area-gl2">
        {glanceableKeys[1] && (
          <ResolvedGlanceable
            type={glanceableKeys[1]}
            params={getParams(glanceableKeys[1])}
            formatters={localization}
            className="font-medium"
          />
        )}
      </div>
    </section>
  );
}

function ResolvedGlanceable({
  type,
  params,
  className,
  formatters,
}: {
  type: string;
  params?: Record<string, any>;
  className?: string;
  formatters?: LocalizationFormatters;
}) {
  const { phase } = usePageIntegrationStream();
  const cacheKey = `${type}:${stableStringify(params ?? {})}`;
  const preloaded = readPageIntegrationConsumer("glanceable", type, params);
  const resolved = preloaded?.consumer === "glanceable"
    ? (glanceableConsumerCache.set(cacheKey, preloaded as ResolvedGlanceablePayload), preloaded as ResolvedGlanceablePayload)
    : glanceableConsumerCache.get(cacheKey);

  if (preloaded?.success === false) {
    return (
      <div className={`frosted rounded-md px-2 py-1 text-xs text-red-200 ${className ?? ""}`}>
        Glanceable failed to load
      </div>
    );
  }

  if (phase === "streaming" && !resolved?.blueprint?.glanceableJSON) {
    return (
      <div className={`frosted rounded-md px-2 py-1 text-xs text-white/60 ${className ?? ""}`}>
        Loading...
      </div>
    );
  }

  if (resolved?.blueprint?.glanceableJSON) {
    return (
      <GlanceableComponent
        glanceableJSON={resolved.blueprint.glanceableJSON}
        resolved={{
          text: resolved.blueprint.text,
          icon: resolved.blueprint.icon,
        }}
        params={params}
          formatters={formatters}
        className={className}
      />
    );
  }

  return <GlanceableComponent type={type} params={params} formatters={formatters} className={className} />;
}

function stableStringify(value: Record<string, any>) {
  const sorted = Object.keys(value)
    .sort()
    .reduce<Record<string, any>>((acc, key) => {
      acc[key] = value[key];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}