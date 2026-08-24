// components/widgets/dashboard/GlanceableClock.tsx
"use client";

import { useEffect, useState } from "react";
import ClockWidget from "../ClockWidget";
import useAuth from "@/context/useAuth";
import { getConsumerDataAction } from '@/lib/apiClient';
import { updatePageIntegrationConsumerCache } from "@/lib/pageIntegrationDataCache";
import GlanceableComponent from "@dashwise/integrationskit/Glanceable";
import { usePageConfig } from "@/hooks/usePageConfig";
import type { WidgetItemProps } from "../Widget";
import { useLocalization } from "@/context/LocalizationContext";
import { useActivity } from "@/context/ActivityContext";
import { Bell, CalendarDays } from "lucide-react";
import { readPageIntegrationConsumer } from "@/lib/pageIntegrationDataCache";
import type { ClockAppearance } from "../../settings/ClockFontSelectionCarousel";

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
const DEFAULT_CAROUSEL_INTERVAL_SECONDS = 5;
const CAROUSEL_FADE_DURATION_MS = 250;
type LocalizationFormatters = Pick<ReturnType<typeof useLocalization>, "formatTemperature" | "formatTime" | "formatDate">;
const LOCAL_ONLY_GLANCEABLES = new Set([
  "date",
  "greeting",
  "local-timezone",
  "world-clock",
  "progress",
  "day-progress",
  "week-progress",
  "month-progress",
  "year-progress",
  "latest-activities",
]);

type GlanceableClockWidgetProps = WidgetItemProps & {
  isPreview?: boolean;
};

export default function GlanceableClockWidget({ className, params, isPreview }: GlanceableClockWidgetProps) {
  const { pageConfig } = usePageConfig();
  const { user } = useAuth();
  const localization = useLocalization();
  const clockStyle = params?.["clock-style"] as Record<string, any> | undefined;
  const clockAppearance = user?.appearancePreferences?.clock as ClockAppearance | undefined;

  // params.glanceables overrides config-level glanceables
  const glanceableOverrides: Record<string, any> | undefined = params?.glanceables;
  const defaultGlanceables: any[] = pageConfig?.glanceables ?? [];

  const glanceableKeys = glanceableOverrides
    ? Object.keys(glanceableOverrides)
    : defaultGlanceables.map((g) => g?.type).filter(Boolean);

  const getParams = (type: string) => {
    const override = glanceableOverrides?.[type];
    if (override && typeof override === "object") {
      return type === "greeting"
        ? { ...override, username: override.username ?? user?.username }
        : override;
    }
    const fallback = defaultGlanceables.find((g) => g?.type === type);
    if (!fallback) return undefined;
    const { type: _t, ...rest } = fallback;
    if (type === "greeting") {
      return {
        ...(Object.keys(rest).length > 0 ? rest : {}),
        username: (rest as Record<string, any>).username ?? user?.username,
      };
    }
    return Object.keys(rest).length > 0 ? rest : undefined;
  };
  const slots = glanceableOverrides?.slots as Partial<Record<"left" | "right", Array<{ type: string; params?: Record<string, any> }>>> | undefined;
  const carouselIntervals = glanceableOverrides?.intervals as Partial<Record<"left" | "right", unknown>> | undefined;

  const previewGridStyle = isPreview
    ? { gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)", gridTemplateAreas: '"gl1 clock gl2"' }
    : undefined;
  const clockTextClassName = isPreview ? "text-xs leading-none" : "text-2xl md:text-4xl leading-tight";

  return (
    <section
      className={`responsive-glance-grid w-full overflow-hidden ${className ?? ""}`}
      style={previewGridStyle}
    >
      <div style={{ gridArea: "clock" }} className={`area-clock min-w-0 overflow-hidden w-full flex items-center justify-center ${clockTextClassName}`}>
        <div style={{ margin: "0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 0, overflow: "hidden" }}>
          <ClockWidget
            font={clockStyle?.defaultFont ?? clockAppearance?.defaultFont}
            weight={clockStyle?.fontWeight}
            color={clockStyle?.color}
            letterSpacing={clockStyle?.letterSpacing}
            opacity={clockStyle?.opacity}
            outlineEnabled={clockStyle?.outlineEnabled}
            outlineColor={clockStyle?.outlineColor}
            outlineWidth={clockStyle?.outlineWidth}
            isPreview={isPreview}
          />
        </div>
      </div>
      <div style={{ gridArea: "gl1" }} className="area-gl1 min-w-0 overflow-hidden">
        <GlanceableCarousel
          items={slots?.left ?? (glanceableKeys[0] ? [{ type: glanceableKeys[0], params: getParams(glanceableKeys[0]) }] : [])}
          intervalSeconds={getCarouselInterval(carouselIntervals?.left)}
          formatters={localization}
        />
      </div>
      <div style={{ gridArea: "gl2" }} className="area-gl2 min-w-0 overflow-hidden">
        <GlanceableCarousel
          items={slots?.right ?? (glanceableKeys[1] ? [{ type: glanceableKeys[1], params: getParams(glanceableKeys[1]) }] : [])}
          intervalSeconds={getCarouselInterval(carouselIntervals?.right)}
          formatters={localization}
        />
      </div>
    </section>
  );
}

function GlanceableCarousel({
  items,
  intervalSeconds,
  formatters,
}: {
  items: Array<{ type: string; params?: Record<string, any> }>;
  intervalSeconds: number;
  formatters: LocalizationFormatters;
}) {
  const [index, setIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    setIndex(0);
    setIsFading(false);
    if (items.length < 2) return;

    let transitionTimeout: number | undefined;
    const advance = () => {
      setIsFading(true);
      transitionTimeout = window.setTimeout(() => {
        setIndex((current) => (current + 1) % items.length);
        setIsFading(false);
      }, CAROUSEL_FADE_DURATION_MS);
    };
    const interval = window.setInterval(advance, intervalSeconds * 1000);
    return () => {
      window.clearInterval(interval);
      if (transitionTimeout !== undefined) window.clearTimeout(transitionTimeout);
    };
  }, [intervalSeconds, items.length]);

  const item = items[index];
  return item ? (
    <div
      key={`${index}:${item.type}`}
      className={`min-w-0 transition-opacity ease-out ${isFading ? "opacity-30" : "opacity-100"}`}
      style={{ transitionDuration: `${CAROUSEL_FADE_DURATION_MS}ms` }}
    >
      <ResolvedGlanceable type={item.type} params={item.params} formatters={formatters} className="font-medium" />
    </div>
  ) : null;
}

function getCarouselInterval(value: unknown) {
  const interval = Number(value);
  return Number.isFinite(interval) && interval >= 1 ? interval : DEFAULT_CAROUSEL_INTERVAL_SECONDS;
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
  const { unreadCount, calendarEvents } = useActivity();
  const { withAuth } = useAuth();
  const [backendPayload, setBackendPayload] = useState<ResolvedGlanceablePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheKey = `${type}:${stableStringify(params ?? {})}`;
  const preloaded = readPageIntegrationConsumer("glanceable", type, params);
  const resolved = preloaded?.consumer === "glanceable"
    ? (glanceableConsumerCache.set(cacheKey, preloaded as ResolvedGlanceablePayload), preloaded as ResolvedGlanceablePayload)
    : backendPayload ?? glanceableConsumerCache.get(cacheKey);
  const shouldUseBackend = !LOCAL_ONLY_GLANCEABLES.has(type) && type !== "latest-activities";
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

  if (type === "latest-activities") {
    return <LatestActivitiesGlanceable className={className} unreadCount={unreadCount} calendarEvents={calendarEvents} />;
  }

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
        data={resolved?.data}
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

function LatestActivitiesGlanceable({
  className,
  unreadCount,
  calendarEvents,
}: {
  className?: string;
  unreadCount: number;
  calendarEvents: Array<{ id: string; title: string }>;
}) {
  const activities = [
    ...(unreadCount > 0 ? [{ id: "notifications", icon: <Bell className="size-4" />, text: `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` }] : []),
    ...calendarEvents.slice(0, 5).map((event) => ({ id: event.id, icon: <CalendarDays className="size-4" />, text: event.title })),
  ];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (activities.length < 2) return;
    const interval = window.setInterval(() => setIndex((current) => (current + 1) % activities.length), 5_000);
    return () => window.clearInterval(interval);
  }, [activities.length]);

  const activity = activities[index];
  return activity ? <span className={`inline-flex items-center gap-1 text-center ${className ?? ""}`}>{activity.icon}{activity.text}</span> : null;
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
