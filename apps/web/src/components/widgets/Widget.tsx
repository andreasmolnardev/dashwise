"use client";

import { useEffect, useState, type ReactNode } from "react";
import GlanceableClockWidget from "./dashboard/GlanceableClock";
import LinkView from "./LinkView";
import SearchBar from "./SearchBar";
import Widget from "@dashwise/integrationskit/Widget";
import { useLocalization } from "@/context/LocalizationContext";
import { readPageIntegrationConsumer } from "@/lib/pageIntegrationDataCache";

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
  const localization = useLocalization();

  const consumerPayload = readPageIntegrationConsumer("widget", type, properties);

  if (!consumerPayload?.blueprint?.widgetJSON) {
    return (
      <WidgetErrorState
        className="w-full"
        message={`Widget "${type}" could not be loaded.`}
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