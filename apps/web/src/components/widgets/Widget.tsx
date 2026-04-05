"use client";

import { useEffect, useState, type ReactNode } from "react";
import GlanceableClockWidget from "./dashboard/GlanceableClock";
import LinkView from "./LinkView";
import SearchBar from "./SearchBar";
import Widget from "@dashwise/integrationskit/Widget";
import useAuth from "@/context/useAuth";
import { getConsumerDataAction } from "@/app/actions/integrations";
import { useLocalization } from "@/context/LocalizationContext";

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

  const { index: _index, ...rest } = params;
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

  switch (type) {
    case "main-clock":
    case "glanceable-clock":
      return <GlanceableClockWidget className={className} params={renderParams} />;

    case "search-bar":
      return (
        <div className={className}>
          <SearchBar useRedirect={false} defaultOpen={defaultOpen} />
        </div>
      );

    case "link-view": return (<LinkView/>);

    case "placeholder":
      return <div className={`${className ?? ""}`} />;

    default:
      return (
        <IntegrationWidget type={type} isPreview={isPreview} properties={renderParams} />
      );
  }
}

function IntegrationWidget({
  type,
  properties,
  isPreview,
}: {
  type: string;
  properties?: Record<string, any>;
  isPreview?: boolean;
}) {
  const { withAuth } = useAuth();
  const localization = useLocalization();
  const [consumerPayload, setConsumerPayload] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!cancelled) {
        setIsLoading(true);
        setLoadError(null);
        setConsumerPayload(null);
      }

      try {
        const data = await withAuth((auth) =>
          getConsumerDataAction(auth, type, properties, {
            type: "widget",
            isPreview,
          })
        );

        if (cancelled) return;

        if (data?.consumer !== "widget" || !data?.blueprint?.widgetJSON) {
          throw new Error(`Widget "${type}" could not be loaded.`);
        }

        setConsumerPayload(data);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isPreview, properties, type, withAuth]);

  if (isLoading) {
    return <WidgetLoadingState className="w-full" />;
  }

  if (loadError || !consumerPayload) {
    return (
      <WidgetErrorState
        className="w-full"
        message={loadError ?? `Widget "${type}" could not be loaded.`}
      />
    );
  }

  return (
    <Widget
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

function WidgetLoadingState({ className }: { className?: string }) {
  return (
    <div
      className={`frosted rounded-xl border border-white/10 bg-white/5 p-3 ${className ?? ""}`}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 animate-pulse rounded-full bg-white/20" />
        <div className="h-3 w-24 animate-pulse rounded-full bg-white/15" />
      </div>

      <div className="mt-3 space-y-2">
        <div className="h-3 w-3/4 animate-pulse rounded-full bg-white/15" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-white/10" />
        <div className="h-3 w-5/6 animate-pulse rounded-full bg-white/10" />
      </div>
    </div>
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