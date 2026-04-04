// components/widgets/dashboard/GlanceableClock.tsx
"use client";

import { useEffect, useState } from "react";
import ClockWidget from "../ClockWidget";
import GlanceableComponent from "@dashwise/integrationskit/Glanceable";
import { usePageConfig } from "@/hooks/usePageConfig";
import type { WidgetItemProps } from "../Widget";
import useAuth from "@/context/useAuth";
import { getIntegrationWithGlanceableAction } from "@/app/actions/widgets";
import { getConsumerDataAction } from "@/app/actions/integrations";

type ResolvedGlanceablePayload = {
  integration: Record<string, any> | null;
  glanceableJSON: Record<string, any> | null;
};

const glanceableIntegrationCache = new Map<string, ResolvedGlanceablePayload | null>();

export default function GlanceableClockWidget({ className, params }: WidgetItemProps) {
  const { pageConfig } = usePageConfig();
  const { user } = useAuth();
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
            className="font-medium"
          />
        )}
      </div>
      <div style={{ gridArea: "gl2" }} className="area-gl2">
        {glanceableKeys[1] && (
          <ResolvedGlanceable
            type={glanceableKeys[1]}
            params={getParams(glanceableKeys[1])}
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
}: {
  type: string;
  params?: Record<string, any>;
  className?: string;
}) {
  const { withAuth } = useAuth();
  const [resolved, setResolved] = useState<ResolvedGlanceablePayload | null | undefined>(() => glanceableIntegrationCache.get(type));
  const [runtimeData, setRuntimeData] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = glanceableIntegrationCache.get(type);

    if (cached !== undefined) {
      setResolved(cached);
      return;
    }

    const load = async () => {
      try {
        const data = await withAuth((auth) => getIntegrationWithGlanceableAction(auth, type));

        if (cancelled) return;

        const next = data?.integration && data?.glanceableJSON ? data : null;
        glanceableIntegrationCache.set(type, next);
        setResolved(next);
      } catch {
        if (cancelled) return;

        glanceableIntegrationCache.set(type, null);
        setResolved(null);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [type, withAuth]);

  useEffect(() => {
    let cancelled = false;

    if (!resolved?.glanceableJSON) {
      setRuntimeData(null);
      return () => {
        cancelled = true;
      };
    }

    const load = async () => {
      try {
        const data = await withAuth((auth) =>
          getConsumerDataAction(auth, "glanceable", type, getGlanceableInput(params))
        );
        if (cancelled) return;
        setRuntimeData((data?.data as Record<string, any> | null) ?? null);
      } catch {
        if (cancelled) return;
        setRuntimeData(null);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [params, resolved, type, withAuth]);

  if (resolved?.glanceableJSON) {
    return (
      <GlanceableComponent
        glanceableJSON={resolved.glanceableJSON}
        integrationJSON={resolved.integration}
        data={runtimeData}
        params={params}
        className={className}
      />
    );
  }

  return <GlanceableComponent type={type} params={params} className={className} />;
}

function getGlanceableInput(params?: Record<string, any>) {
  if (!params || typeof params !== "object") {
    return undefined;
  }
  if (params.input && typeof params.input === "object") {
    return params.input as Record<string, any>;
  }
  return params;
}