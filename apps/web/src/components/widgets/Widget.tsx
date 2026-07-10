"use client";

import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import GlanceableClockWidget from "./dashboard/GlanceableClock";
import {
  CalendarTodayWidget,
  CalendarUpcomingWidget,
  default as CalendarWeekWidget,
} from "@dashwise/integrationskit/static-widgets/CalendarWidgets";
import CountdownWidget from "@dashwise/integrationskit/static-widgets/CountdownWidget";
import RssFeedWidget from "@dashwise/integrationskit/static-widgets/RssFeedWidget";
import VerticalList from "@dashwise/integrationskit/templates/VerticalList";
import LinkView from "./LinkView";
import SearchBar from "./SearchBar";
import IframeTemplate from "@dashwise/integrationskit/templates/IFrame";
import Widget from "@dashwise/integrationskit/Widget";
import ProgressWidget from "./ProgressWidget";
import { useLocalization } from "@/context/LocalizationContext";
import useAuth from "@/context/useAuth";
import {
  getConsumerDataAction,
  getIntegrationCalendarEventsAction,
  getLinksCollectionsAction,
  getLinksItemsAction,
  getNewsFeedAction,
} from '@/lib/apiClient';

export type WidgetProps = {
  type: string;
  consumerKey?: string;
  params?: Record<string, any>;
  className?: string;
  isPreview?: boolean;
  previewTemplate?: string;
  defaultOpen?: boolean;
};

// Kept for compatibility with existing widget item components.
export type WidgetItemProps = Pick<WidgetProps, "params" | "className">;

function stripWidgetIndex(params?: Record<string, any>) {
  if (!params || typeof params !== "object") return params;

  const { index: _index, _rev: _rev, ...rest } = params;
  return rest;
}

export function renderWidget({
  type,
  consumerKey,
  params,
  className,
  isPreview,
  defaultOpen,
}: WidgetProps): ReactNode {
  const renderParams = stripWidgetIndex(params);
  const resolvedType = type === "widget" && typeof renderParams?.key === "string" && renderParams.key.trim()
    ? renderParams.key.trim()
    : type;
  const finalClassName = `${className ?? ""} frosted`.trim();
  const progressPeriod = resolveProgressPeriod(resolvedType, params);

  switch (resolvedType) {
    case "main-clock":
    case "glanceable-clock":
      return <GlanceableClockWidget className={className} params={renderParams} isPreview={isPreview} />;

    case "search-bar":
      return <SearchBar useRedirect={false} defaultOpen={defaultOpen} />;

    case "calendar-today":
      return <CalendarTodayWidget className={finalClassName} {...renderParams} />;

    case "calendar-week":
      return <CalendarWeekWidget className={finalClassName} {...renderParams} />;

    case "calendar-upcoming":
      return (
        <CalendarUpcomingWidgetWrapper
          className={finalClassName}
          {...renderParams}
        />
      );

    case "rss-feed":
    case "latest-rss-feed":
      return <RssFeedWidgetWrapper className={finalClassName} {...renderParams} />;

    case "latest-links":
      return <LatestLinksWidgetWrapper className={finalClassName} {...renderParams} />;

    case "countdown":
      return <CountdownWidget className={finalClassName} {...renderParams} />;

    case "progress":
    case "day-progress":
    case "week-progress":
    case "month-progress":
    case "year-progress":
      return <ProgressWidget period={progressPeriod} className={finalClassName} />;

    case "link-view":
      return <LinkView />;

    case "placeholder":
      return <div className={`${className ?? ""}`} />;

    case "iframe":
      return <IframeWidget className={finalClassName} params={renderParams} />;

    default:
      return (
        <IntegrationWidget
          type={resolvedType}
          consumerKey={consumerKey ?? (resolvedType.includes("#") ? resolvedType : undefined)}
          isPreview={isPreview}
          properties={renderParams}
          className={finalClassName}
        />
      );
  }
}

type LatestLinkItem = {
  id: string;
  url?: string;
  title?: string;
  iconUrl?: string;
  description?: string;
  collection?: string;
  created?: string;
  updated?: string;
};

function LatestLinksWidgetWrapper({
  className,
  listId,
  collectionId,
  maxItems = 8,
  title = "Latest Links",
}: {
  className?: string;
  listId?: string;
  collectionId?: string;
  maxItems?: number;
  title?: string;
}) {
  const { withAuth } = useAuth();
  const [items, setItems] = useState<LatestLinkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const selectedListId = String(listId || collectionId || "").trim();

    setLoading(true);

    const fetchItems = async () => {
      const links = await withAuth(async (auth) => {
        if (selectedListId) {
          const listItems = await getLinksItemsAction(auth, selectedListId);
          return Array.isArray(listItems) ? listItems : [];
        }

        const collections = await getLinksCollectionsAction(auth);
        const listIds = Array.isArray(collections)
          ? collections.map((collection: any) => String(collection?.id ?? "").trim()).filter(Boolean)
          : [];
        const groupedItems = await Promise.all(
          listIds.map(async (id) => {
            try {
              const listItems = await getLinksItemsAction(auth, id);
              return Array.isArray(listItems) ? listItems : [];
            } catch {
              return [];
            }
          }),
        );

        return groupedItems.flat();
      });

      return Array.isArray(links) ? links : [];
    };

    void fetchItems()
      .then((links) => {
        if (!cancelled) {
          setItems(sortLatestLinks(links).slice(0, maxItems));
        }
      })
      .catch((err) => {
        console.error("Failed to fetch latest links", err);
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [collectionId, listId, maxItems, withAuth]);

  if (loading) {
    return (
      <div className={`rounded-lg p-2 flex flex-col ${className ?? ""}`}>
        <div className="text-sm opacity-50 py-4 text-center text-foreground">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <VerticalList
      className={className}
      itemClassName="gap-1"
      resolved={{
        header: {
          title,
          show: true,
          icon: "fa6-solid:link",
          titleAction: "/apps/links",
        },
        list: items.map((item) => ({
          title: item.title || "Untitled",
          titleAction: item.url || undefined,
          subtitle: [item.description || item.url, formatLatestLinkDate(item.created)].filter(Boolean) as string[],
          thumbnail: item.iconUrl || undefined,
          icon: "fa6-solid:link",
        })),
        raw: {},
      }}
    />
  );
}

function sortLatestLinks(items: LatestLinkItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.created || left.updated || 0).getTime();
    const rightTime = new Date(right.created || right.updated || 0).getTime();
    return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
  });
}

function formatLatestLinkDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function resolveProgressPeriod(type: string, params?: Record<string, any>) {
  const candidate = String(params?.period ?? type ?? "day").trim();
  if (candidate === "year" || candidate === "month" || candidate === "day" || candidate === "week") {
    return candidate;
  }

  if (candidate === "year-progress") return "year";
  if (candidate === "month-progress") return "month";
  if (candidate === "week-progress") return "week";
  return "day";
}

function RssFeedWidgetWrapper({
  className,
  feedId = "all",
  subscriptionId,
  maxItems = 8,
  title = "Latest Articles",
}: {
  className?: string;
  feedId?: string;
  subscriptionId?: string;
  maxItems?: number;
  title?: string;
}) {
  const { withAuth } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const selectedFeedId = String(subscriptionId || feedId || "all").trim() || "all";

    setLoading(true);
    void withAuth((auth) => getNewsFeedAction(auth, selectedFeedId, Math.max(maxItems, 50)))
      .then((feedItems) => {
        if (!cancelled) {
          setItems(Array.isArray(feedItems?.items) ? feedItems.items : []);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch RSS feed items", err);
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [feedId, subscriptionId, withAuth]);

  if (loading) {
    return (
      <div className={`rounded-lg p-2 flex flex-col ${className ?? ""}`}>
        <div className="text-sm opacity-50 py-4 text-center text-foreground">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <RssFeedWidget
      className={className}
      items={items}
      maxItems={maxItems}
      title={title}
    />
  );
}

function CalendarUpcomingWidgetWrapper({
  className,
  integrationId,
  maxItems = 5,
}: {
  className?: string;
  integrationId?: string;
  maxItems?: number;
}) {
  const { withAuth } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchEvents = async () => {
      if (!integrationId) {
        if (!withAuth) return;
        try {
          if (!cancelled) {
            const eventsData = await withAuth((auth) =>
              getIntegrationCalendarEventsAction(auth) // todo: take calendarId as param to fetch events for specific calendar
            ) as any;
            setEvents(eventsData?.events ?? []);
          }
        } catch (err) {
          console.error("Failed to fetch calendar events", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      try {
        const eventsData = await withAuth((auth) =>
          getIntegrationCalendarEventsAction(auth, integrationId)
        ) as any;
        if (!cancelled) {
          setEvents(eventsData?.events ?? []);
        }
      } catch (err) {
        console.error("Failed to fetch calendar events", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchEvents();

    return () => {
      cancelled = true;
    };
  }, [integrationId, withAuth]);

  if (loading) {
    return (
      <div className={`rounded-lg p-2 flex flex-col ${className}`}>
        <div className="text-sm opacity-50 py-4 text-center text-foreground">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <CalendarUpcomingWidget
      className={className}
      items={events}
      maxItems={maxItems}
    />
  );
}

function IframeWidget({
  className,
  params,
}: {
  className?: string;
  params?: Record<string, any>;
}) {
  const localization = useLocalization();
  const { url, min_height, max_height, title, icon, title_action } = params ??
    {};

  const resolved = {
    header: {
      title: title || "",
      show: !!title,
      icon: icon || "",
      titleAction: title_action || "",
    },
    iframe: {
      url: url || "",
      minHeight: min_height,
      maxHeight: max_height,
    },
  };

  return (
    <IframeTemplate
      resolved={resolved as any}
      className={className}
      formatters={{
        formatTemperature: localization.formatTemperature,
        formatTime: localization.formatTime,
        formatDate: localization.formatDate,
      }}
    />
  );
}

function IntegrationWidget({
  type,
  consumerKey,
  properties,
  isPreview,
  className,
}: {
  type: string;
  consumerKey?: string;
  properties?: Record<string, any>;
  isPreview?: boolean;
  className?: string;
}) {
  const localization = useLocalization();
  const { withAuth } = useAuth();
  const [consumerPayload, setConsumerPayload] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const loadingTimeoutRef = useRef<number | null>(null);

  const MIN_LOADING_MS = 750;

  // Serialize to a stable string so object identity changes from the parent
  // don't re-trigger the effect when the contents haven't actually changed.
  const propertiesKey = useMemo(
    () => JSON.stringify(properties ?? {}),
    [properties],
  );

  const requestKey = useMemo(
    () => resolveConsumerRequestKey(type, consumerKey, properties),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, consumerKey, propertiesKey],
  );

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    // Parse once inside the effect so we always work with a stable snapshot.
    const resolvedProperties = JSON.parse(propertiesKey) as Record<string, any>;
    const environmentOverrides = extractEnvironmentOverrides(
      resolvedProperties,
    );

    if (loadingTimeoutRef.current !== null) {
      window.clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }

    setLoading(true);
    setLocalError(null);
    setConsumerPayload(null);

    const stopLoading = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      if (remaining > 0) {
        loadingTimeoutRef.current = window.setTimeout(() => {
          loadingTimeoutRef.current = null;
          if (!cancelled) setLoading(false);
        }, remaining);
      } else {
        setLoading(false);
      }
    };

    void withAuth((auth) =>
      getConsumerDataAction(auth, requestKey, resolvedProperties, {
        type: "widget",
        isPreview,
        environmentOverrides,
      })
    )
      .then((payload) => {
        if (cancelled) return;
        setConsumerPayload(payload as any);
        stopLoading();
      })
      .catch((err) => {
        console.error(`Failed to fetch widget data for ${type}`, err);
        if (!cancelled) {
          setLocalError(
            err instanceof Error ? err.message : "Widget data request failed.",
          );
          stopLoading();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [type, requestKey, propertiesKey, isPreview, withAuth]);

  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  // In IntegrationWidget
  if (loading || !consumerPayload) {
    return <WidgetLoadingState className={className} />;
  }

  const consumerError = consumerPayload?.success === false
    ? typeof consumerPayload?.error === "string"
      ? consumerPayload.error
      : `Widget "${type}" data failed to load.`
    : null;
  const errorMessage = localError ?? consumerError;

  if (errorMessage) {
    return (
      <WidgetErrorState
        className={className}
        message={errorMessage}
      />
    );
  }

  if (!consumerPayload?.blueprint?.widgetJSON) {
    return (
      <WidgetErrorState
        className={className}
        message={`Widget "${type}" could not be loaded.`}
      />
    );
  }

  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      <Widget
        className={className ?? "frosted"}
        isPreview={isPreview ?? false}
        widgetKey={type}
        widgetJSON={consumerPayload.blueprint.widgetJSON}
        input={properties}
        data={consumerPayload.data}
        resolved={consumerPayload.blueprint.resolved}
        formatters={{
          formatTemperature: localization.formatTemperature,
          formatTime: localization.formatTime,
          formatDate: localization.formatDate,
        }}
      />
    </div>
  );
}

function resolveWidgetLabel(widgetKey: string, payload?: any) {
  const widgetJSON = payload?.blueprint?.widgetJSON;
  const widgetName =
    typeof widgetJSON?.name === "string" && widgetJSON.name.trim()
      ? widgetJSON.name.trim()
      : typeof widgetJSON?.details?.name === "string" &&
          widgetJSON.details.name.trim()
      ? widgetJSON.details.name.trim()
      : typeof widgetJSON?.label === "string" && widgetJSON.label.trim()
      ? widgetJSON.label.trim()
      : "";

  return widgetName || widgetKey;
}

function resolveConsumerRequestKey(
  widgetType: string,
  consumerKey?: string,
  properties?: Record<string, any>,
) {
  if (consumerKey && typeof consumerKey === "string" && consumerKey.trim()) {
    return consumerKey.trim();
  }

  const configKey = properties && typeof properties.configKey === "string"
    ? properties.configKey.trim()
    : "";
  if (configKey) {
    return configKey;
  }

  return widgetType;
}

function extractEnvironmentOverrides(
  properties?: Record<string, any>,
): Record<string, string> {
  if (!properties || typeof properties !== "object") {
    return {};
  }

  const rawOverrides =
    (typeof properties.environmentOverrides === "object" &&
        properties.environmentOverrides !== null
      ? properties.environmentOverrides
      : null) ??
      (typeof properties.envOverrides === "object" &&
          properties.envOverrides !== null
        ? properties.envOverrides
        : null) ??
      (typeof properties.input === "object" && properties.input !== null
        ? properties.input
        : null);

  if (!rawOverrides || typeof rawOverrides !== "object") {
    return {};
  }

  return Object.entries(rawOverrides as Record<string, unknown>).reduce<
    Record<string, string>
  >(
    (acc, [key, value]) => {
      if (typeof value === "string") {
        acc[key] = value;
        return acc;
      }

      if (typeof value === "number" || typeof value === "boolean") {
        acc[key] = String(value);
      }

      return acc;
    },
    {},
  );
}

function WidgetErrorState({
  className,
  message,
}: {
  className?: string;
  message: string;
}) {
  return (
    <div
      className={`frosted rounded-xl border border-red-500/30 bg-red-500/10 p-3 ${
        className ?? ""
      }`}
    >
      <p className="text-sm font-semibold text-red-200">
        Widget failed to load
      </p>
      <p className="mt-1 text-xs leading-snug text-red-100/80 wrap-break-word max-h-10 overflow-x-scroll">
        {message}
      </p>
    </div>
  );
}

function WidgetLoadingState({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-xl p-3 flex items-center justify-center min-h-25 ${
        className ?? "frosted"
      }`}
    >
      <div className="text-xs text-white/50 animate-pulse">Loading widget data...</div>
    </div>
  );
}
