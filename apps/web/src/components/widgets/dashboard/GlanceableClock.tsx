// components/widgets/dashboard/GlanceableClock.tsx
"use client";

import ClockWidget from "../ClockWidget";
import GlanceableComponent from "../../glanceables/Glanceable";
import { usePageConfig } from "@/src/hooks/usePageConfig";
import type { WidgetItemProps } from "../Widget";

export default function GlanceableClockWidget({ className, params }: WidgetItemProps) {
  const { config } = usePageConfig();
  const clockStyle = params?.["clock-style"] as Record<string, any> | undefined;

  // params.glanceables overrides config-level glanceables
  const glanceableOverrides: Record<string, any> | undefined = params?.glanceables;
  const defaultGlanceables: any[] = config?.glanceables ?? [];

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
            font={clockStyle?.defaultFont ?? config?.appearance?.clock?.defaultFont}
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
          <GlanceableComponent type={glanceableKeys[0]} params={getParams(glanceableKeys[0])} className="font-medium" />
        )}
      </div>
      <div style={{ gridArea: "gl2" }} className="area-gl2">
        {glanceableKeys[1] && (
          <GlanceableComponent type={glanceableKeys[1]} params={getParams(glanceableKeys[1])} className="font-medium" />
        )}
      </div>
    </section>
  );
}