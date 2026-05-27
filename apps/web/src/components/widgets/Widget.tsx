"use client";

import { Suspense, lazy, type ReactNode, useEffect, useRef, useState } from "react";
const GlanceableClockWidget = lazy(() =>
  import("./dashboard/GlanceableClock").then((module) => ({
    default: module.default,
  })),
);
const calendarWidgetsImport = import(
  "@dashwise/integrationskit/static-widgets/CalendarWidgets"
);
const CalendarWeekWidget = lazy(() =>
  calendarWidgetsImport.then((module) => ({
    default: module.default,
  })),
);
const CalendarTodayWidget = lazy(() =>
  calendarWidgetsImport.then((module) => ({
    default: module.CalendarTodayWidget,
  })),
);
const CalendarUpcomingWidget = lazy(() =>
  calendarWidgetsImport.then((module) => ({
    default: module.CalendarUpcomingWidget,
  })),
);
const LinkView = lazy(() =>
  import("./LinkView").then((module) => ({
    default: module.default,
  })),
);
const SearchBar = lazy(() =>
  import("./SearchBar").then((module) => ({
    default: module.default,
  })),
);
const IframeTemplate = lazy(() =>
  import("@dashwise/integrationskit/templates/IFrame").then((module) => ({
    default: module.default,
  })),
);
const Widget = lazy(() =>
  import("@dashwise/integrationskit/Widget").then((module) => ({
    default: module.default,
  })),
);
import { useLocalization } from "@/context/LocalizationContext";
import { readPageIntegrationConsumer } from "@/lib/pageIntegrationDataCache";
import useAuth from "@/context/useAuth";
import { usePageIntegrationStream } from "@/context/PageIntegrationStreamContext";
import {
  getConsumerDataAction,
  getIntegrationCalendarEventsAction,
} from "@/app/actions/integrations";

export type WidgetProps = {
  type: string;
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
  params,
  className,
  isPreview,
  defaultOpen,
}: WidgetProps): ReactNode {
  const renderParams = stripWidgetIndex(params);
  const finalClassName = `${className ?? ""} frosted`.trim();

  let content: ReactNode;

  switch (type) {
    case "main-clock":
    case "glanceable-clock":
      content = (
        <GlanceableClockWidget className={className} params={renderParams} />
      );
      break;

    case "search-bar":
      content = <SearchBar useRedirect={false} defaultOpen={defaultOpen} />;
      break;

    case "calendar-week":
      content = (
        <CalendarWeekWidget className={finalClassName} {...renderParams} />
      );
      break;

    case "calendar-today":
      content = (
        <CalendarTodayWidget className={finalClassName} {...renderParams} />
      );
      break;

    case "calendar-upcoming":
      content = (
        <CalendarUpcomingWidgetWrapper
          className={finalClassName}
          {...renderParams}
        />
      );
      break;

    case "link-view":
      content = <LinkView />;
      break;

    case "placeholder":
      content = <div className={`${className ?? ""}`} />;
      break;

    case "iframe":
      content = <IframeWidget className={finalClassName} params={renderParams} />;
      break;

    default:
      content = (
        <IntegrationWidget
          type={type}
          isPreview={isPreview}
          properties={renderParams}
          className={finalClassName}
        />
      );
      break;
  }

  return (
    <Suspense fallback={<WidgetLoadingState className={className} label={type} />}>
      {content}
    </Suspense>
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
        <div className="text-sm opacity-50 py-4 text-center text-foreground">Loading...</div>
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
  const { url, min_height, max_height, title, icon, title_action } = params ?? {};

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
  properties,
  isPreview,
  className,
}: {
  type: string;
  properties?: Record<string, any>;
  isPreview?: boolean;
  className?: string;
}) {
  const localization = useLocalization();
  const { withAuth } = useAuth();
  const { phase, version } = usePageIntegrationStream();
  const [localPayload, setLocalPayload] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const loadingStartedAtRef = useRef<number | null>(null);
  const loadingTimeoutRef = useRef<number | null>(null);

  const consumerPayload = readPageIntegrationConsumer("widget", type, properties) || localPayload;
  const loadingLabel = resolveWidgetLabel(type, consumerPayload);
  const MIN_LOADING_MS = 750;

  const scheduleLoadingStop = () => {
    if (!loading) return;
    if (loadingTimeoutRef.current !== null) return;

    const startedAt = loadingStartedAtRef.current ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, MIN_LOADING_MS - elapsed);

    loadingTimeoutRef.current = window.setTimeout(() => {
      loadingTimeoutRef.current = null;
      setLoading(false);
    }, remaining);
  };

  const hasStreamError = consumerPayload?.success === false;
  const shouldStreamLoad =
    phase === "streaming" && !consumerPayload?.blueprint?.widgetJSON && !hasStreamError;
  const allowLocalFetch = phase === "idle" || phase === "error" || isPreview;

  useEffect(() => {
    if (consumerPayload?.blueprint?.widgetJSON && loading) {
      scheduleLoadingStop();
      setLocalError(null);
      return;
    }

    if (!allowLocalFetch || consumerPayload?.blueprint?.widgetJSON || loading) {
      return;
    }

    let cancelled = false;
    loadingStartedAtRef.current = Date.now();
    if (loadingTimeoutRef.current !== null) {
      window.clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    setLoading(true);
    setLocalError(null);

    void withAuth((auth) =>
      getConsumerDataAction(auth, type, properties ?? {}, {
        type: "widget",
        isPreview,
      })
    )
      .then((payload) => {
        if (cancelled) return;
        const casted = payload as any;
        if (casted?.success === false) {
          setLocalPayload(casted);
          setLocalError(
            typeof casted?.error === "string"
              ? casted.error
              : "Widget data request failed.",
          );
          return;
        }

        setLocalPayload(casted);
      })
      .catch((err) => {
        console.error(`Failed to fetch widget data for ${type}`, err);
        setLocalError(
          err instanceof Error ? err.message : "Widget data request failed.",
        );
      })
      .finally(() => {
        if (!cancelled) scheduleLoadingStop();
      });

    return () => {
      cancelled = true;
    };
  }, [type, properties, isPreview, withAuth, consumerPayload, loading, allowLocalFetch, version]);

  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  if (shouldStreamLoad || loading) {
    return (
      <div
        className={`rounded-xl p-3 flex items-center justify-center min-h-25 ${
          className ?? "frosted"
        }`}
      >
        <div className="text-xs text-white/50 animate-pulse">
          Loading widget from {loadingLabel}...
        </div>
      </div>
    );
  }

  const consumerError =
    consumerPayload?.success === false
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
      : typeof widgetJSON?.details?.name === "string" && widgetJSON.details.name.trim()
        ? widgetJSON.details.name.trim()
        : typeof widgetJSON?.label === "string" && widgetJSON.label.trim()
          ? widgetJSON.label.trim()
          : "";

  return widgetName || widgetKey;
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
      className={`frosted rounded-xl border border-red-500/30 bg-red-500/10 p-3 ${className ?? ""}`}
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

function WidgetLoadingState({
  className,
  label,
}: {
  className?: string;
  label: string;
}) {
  return (
    <div
      className={`rounded-xl p-3 flex items-center justify-center min-h-25 ${
        className ?? "frosted"
      }`}
    >
      <div className="text-xs text-white/50 animate-pulse">
        Loading widget from {label}...
      </div>
    </div>
  );
}