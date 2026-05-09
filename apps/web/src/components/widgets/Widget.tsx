"use client";

import { useEffect, useState, type ReactNode } from "react";
import GlanceableClockWidget from "./dashboard/GlanceableClock";
import CalendarWeekWidget, { CalendarTodayWidget, CalendarUpcomingWidget } from "@dashwise/integrationskit/static-widgets/CalendarWidgets";
import LinkView from "./LinkView";
import SearchBar from "./SearchBar";
import IframeTemplate from "@dashwise/integrationskit/templates/IFrame";
import Widget from "@dashwise/integrationskit/Widget";
import { useLocalization } from "@/context/LocalizationContext";
import { readPageIntegrationConsumer } from "@/lib/pageIntegrationDataCache";
import useAuth from "@/context/useAuth";
import { getIntegrationCalendarEventsAction, getConsumerDataAction } from "@/app/actions/integrations";

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

  switch (type) {
    case "main-clock":
    case "glanceable-clock":
      return <GlanceableClockWidget className={className} params={renderParams} />;

    case "search-bar":
      return (
        <div className={finalClassName}>
          <SearchBar useRedirect={false} defaultOpen={defaultOpen} />
        </div>
      );

    case "calendar-week":
      return <CalendarWeekWidget className={finalClassName} {...renderParams} />;

    case "calendar-today":
      return <CalendarTodayWidget className={finalClassName} {...renderParams} />;

    case "calendar-upcoming":
      return <CalendarUpcomingWidgetWrapper className={finalClassName} {...renderParams} />;

    case "link-view": return (<LinkView />);

    case "placeholder":
      return <div className={`${className ?? ""}`} />;

    case "iframe":
      return <IframeWidget className={finalClassName} params={renderParams} />;

    default:
      return (
        <IntegrationWidget type={type} isPreview={isPreview} properties={renderParams} className={finalClassName} />
      );
  }
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
  const [localPayload, setLocalPayload] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const consumerPayload = readPageIntegrationConsumer("widget", type, properties) || localPayload;

  useEffect(() => {
    if (consumerPayload?.blueprint?.widgetJSON || loading) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    void withAuth((auth) =>
      getConsumerDataAction(auth, type, properties ?? {}, {
        type: "widget",
        isPreview,
      })
    )
      .then((payload) => {
        if (cancelled) return;
        const casted = payload as any;
        if (casted?.success) {
          setLocalPayload(casted);
        }
      })
      .catch((err) => {
        console.error(`Failed to fetch widget data for ${type}`, err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [type, properties, isPreview, withAuth, consumerPayload, loading]);

  if (loading) {
    return (
      <div className={`rounded-xl p-3 flex items-center justify-center min-h-[100px] ${className ?? "frosted"}`}>
        <div className="text-xs text-white/50 animate-pulse">Loading widget...</div>
      </div>
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