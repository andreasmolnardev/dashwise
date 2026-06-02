// components/widgets/dashboard/GlanceableClock.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import ClockWidget from "../ClockWidget";
import useAuth from "@/context/useAuth";
import { getConsumerDataAction } from "@/app/actions/integrations";
import { updatePageIntegrationConsumerCache } from "@/lib/pageIntegrationDataCache";
import GlanceableComponent from "@dashwise/integrationskit/Glanceable";
import { usePageConfig } from "@/hooks/usePageConfig";
import type { WidgetItemProps } from "../Widget";
import { useLocalization } from "@/context/LocalizationContext";
import { readPageIntegrationConsumer } from "@/lib/pageIntegrationDataCache";

type ResolvedGlanceablePayload = {
  consumer: "glanceable";
  blueprint: {
    text?: string;
    icon?: string | null;
    glanceableJSON?: Record<string, any>;
  };
  data: Record<string, any> | null;
};

const glanceableConsumerCache = new Map<string, ResolvedGlanceablePayload | null>();
type LocalizationFormatters = Pick<ReturnType<typeof useLocalization>, "formatTemperature" | "formatTime" | "formatDate">;
const LOCAL_ONLY_GLANCEABLES = new Set([
  "date",
  "greeting",
  "local-timezone",
  "world-clock",
]);

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
  const { withAuth } = useAuth();
  const [backendPayload, setBackendPayload] = useState<ResolvedGlanceablePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheKey = `${type}:${stableStringify(params ?? {})}`;
  const preloaded = readPageIntegrationConsumer("glanceable", type, params);
  const resolved = preloaded?.consumer === "glanceable"
    ? (glanceableConsumerCache.set(cacheKey, preloaded as ResolvedGlanceablePayload), preloaded as ResolvedGlanceablePayload)
    : backendPayload ?? glanceableConsumerCache.get(cacheKey);
  const shouldUseBackend = !LOCAL_ONLY_GLANCEABLES.has(type);
  const blueprint = resolved?.blueprint;
  const hasBackendBlueprint = Boolean(blueprint?.text || blueprint?.icon || blueprint?.glanceableJSON);

  useEffect(() => {
    let cancelled = false;

    if (!shouldUseBackend) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (preloaded?.consumer === "glanceable") {
      setBackendPayload(preloaded as ResolvedGlanceablePayload);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (resolved?.blueprint?.glanceableJSON) {
      setBackendPayload(resolved as ResolvedGlanceablePayload);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);

    void withAuth((auth) =>
      getConsumerDataAction(auth, type, params ?? {}, {
        type: "glanceable",
      }),
    )
      .then((payload) => {
        if (cancelled || !payload || (payload as any).success === false) return;

        const nextPayload = payload as ResolvedGlanceablePayload;
        glanceableConsumerCache.set(cacheKey, nextPayload);
        updatePageIntegrationConsumerCache({
          ...nextPayload,
          consumer: "glanceable",
          key: type,
          properties: params ?? {},
          consumerKey: `${type}:${stableStringify(params ?? {})}`,
          success: true,
        } as any);
        setBackendPayload(nextPayload);
        setLoading(false);
      })
      .catch((error) => {
        console.error(`Failed to fetch glanceable data for ${type}`, error);
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, params, preloaded, resolved, shouldUseBackend, type, withAuth]);

  if (preloaded?.success === false) {
    return (
      <div className={`frosted rounded-md px-2 py-1 text-xs text-red-200 ${className ?? ""}`}>
        Glanceable failed to load
      </div>
    );
  }

  if (loading && shouldUseBackend && !hasBackendBlueprint) {
    return (
      <div className={`rounded-md px-2 py-1 text-xs text-white/60 ${className ?? ""}`}>
        Loading...
      </div>
    );
  }

  if (hasBackendBlueprint) {
    return (
      <GlanceableComponent
        glanceableJSON={blueprint?.glanceableJSON}
        resolved={{
          text: blueprint?.text ?? "",
          icon: blueprint?.icon,
        }}
        params={params}
          formatters={formatters}
        className={className}
      />
    );
  }

  if (shouldUseBackend) {
    return (
      <div className={`rounded-md px-2 py-1 text-xs text-white/60 ${className ?? ""}`}>
        Loading...
      </div>
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