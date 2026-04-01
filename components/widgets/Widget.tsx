"use client";

import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import GlanceableClockWidget from "./dashboard/GlanceableClock";
import LinkView from "./LinkView";
import SearchBar from "./SearchBar";
import IconDetailsCard from "./templates/IconDetailsCard";

export type WidgetProps = {
  type: string;
  params?: Record<string, any>;
  className?: string;
  isPreview?: boolean;
  previewTemplate?: string;
  defaultOpen?: boolean;
};

export type WidgetItemProps = {
  className?: string;
  params?: Record<string, any>;
  isPreview?: boolean;
};

function toText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getPreviewText(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const preferred =
    record.fallback ?? record.value ?? record.primary ?? record.title ?? record.label ?? record.text;
  if (preferred !== undefined && preferred !== null) {
    return toText(preferred);
  }

  return toText(value);
}

function getImageUrl(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const direct = record.file ?? record.iconUrl ?? record.url;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  if (typeof record.value === "string") {
    return record.value;
  }

  return "";
}

function getIconFromProperties(properties: Record<string, unknown>) {
  const icon = properties.icon;
  if (typeof icon === "string") {
    return icon;
  }

  if (icon && typeof icon === "object") {
    const iconRecord = icon as Record<string, unknown>;
    if (typeof iconRecord.file === "string") {
      return iconRecord.file.startsWith("/") ? iconRecord.file : `/weather-icons/${iconRecord.file}`;
    }
    if (typeof iconRecord.value === "string") {
      return iconRecord.value;
    }
  }

  const header = properties.header;
  if (header && typeof header === "object") {
    const headerRecord = header as Record<string, unknown>;
    const headerIcon = headerRecord.icon;
    if (typeof headerIcon === "string") {
      return headerIcon;
    }
  }

  return null;
}

function renderPreviewTemplate(
  template: string,
  properties: Record<string, unknown>,
  className?: string,
) {
  const normalizedTemplate = template.toLowerCase();

  if (normalizedTemplate === "overview") {
    const icon = getIconFromProperties(properties);
    const primary = toText(properties.primary) || "Overview";
    const secondary = toText(properties.secondary);

    return (
      <div className={`frosted rounded-lg p-3 flex items-center gap-3 ${className || ""}`}>
        {icon ? <img src={icon} className="h-8 w-8 object-contain" alt="" /> : null}
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{primary}</p>
          {secondary ? <p className="text-xs truncate">{secondary}</p> : null}
        </div>
      </div>
    );
  }

  if (normalizedTemplate === "vertical-list") {
    const header = (properties.header && typeof properties.header === "object"
      ? properties.header
      : {}) as Record<string, unknown>;
    const title = toText(header.title) || "Items";
    const icon = typeof header.icon === "string" ? header.icon : null;
    const listRaw = properties.list;
    const listItems = Array.isArray(listRaw)
      ? listRaw
      : listRaw && typeof listRaw === "object" && Array.isArray((listRaw as Record<string, unknown>).items)
        ? ((listRaw as Record<string, unknown>).items as unknown[])
        : listRaw && typeof listRaw === "object" && (listRaw as Record<string, unknown>).prototype
          ? [
              (listRaw as Record<string, unknown>).prototype,
              (listRaw as Record<string, unknown>).prototype,
              (listRaw as Record<string, unknown>).prototype,
            ]
          : [];

    return (
      <div className={`frosted rounded-lg p-3 flex flex-col gap-2 ${className || ""}`}>
        <div className="flex items-center gap-2">
          {icon ? <img src={icon} className="h-4 w-4 object-contain" alt="" /> : null}
          <p className="text-xs font-semibold truncate">{title}</p>
        </div>
        {(listItems.length ? listItems.slice(0, 3) : [null, null, null]).map((item, index) => {
          const itemRecord = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          const itemTitle = getPreviewText(itemRecord.title) || `Item ${index + 1}`;
          const itemSubtitle = getPreviewText(itemRecord.subtitle);
          const itemThumbnail = getPreviewText(itemRecord.thumbnail);

          return (
            <div key={index} className="rounded-md bg-black/10 px-2 py-1 text-xs truncate">
              <div className="flex items-center gap-2">
                {itemThumbnail ? <span className="h-4 w-4 shrink-0 rounded bg-white/10" /> : null}
                <div className="min-w-0 text-left">
                  <p className="truncate">{itemTitle}</p>
                  {itemSubtitle ? <p className="truncate text-[10px] text-white/70">{itemSubtitle}</p> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (normalizedTemplate === "icon-details-card") return IconDetailsCard(properties, className);

  const header = (properties.header && typeof properties.header === "object"
    ? properties.header
    : {}) as Record<string, unknown>;
  const title = toText(header.title) || "Widget";
  const icon = typeof header.icon === "string" ? header.icon : null;
  const columnsRaw = properties.columns;
  const columns = Array.isArray(columnsRaw) ? columnsRaw.slice(0, 3) : [];

  return (
    <div className={`frosted rounded-lg p-2 flex flex-col gap-2 ${className || ""}`}>
      <div className="flex items-center gap-2 text-xs">
        {icon ? <img src={icon} className="h-4 w-4 object-contain" alt="" /> : null}
        <p className="font-semibold truncate">{title}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {(columns.length ? columns : [{}, {}, {}]).map((column, index) => {
          const columnRecord =
            column && typeof column === "object" ? (column as Record<string, unknown>) : {};
          const label = getPreviewText(columnRecord.label) || `Col ${index + 1}`;
          const primary = getPreviewText(columnRecord.primary) || "—";
          const secondary = getPreviewText(columnRecord.secondary);
          const iconUrl = getImageUrl(columnRecord.icon);

          return (
            <div key={index} className="rounded-md bg-black/10 px-2 py-1">
              {iconUrl ? (
                <img src={iconUrl} className="mx-auto mb-1 h-5 w-5 object-contain" alt="" />
              ) : null}
              <p className="text-[10px] truncate">{label}</p>
              <p className="text-xs font-medium truncate">{primary}</p>
              {secondary ? <p className="text-[10px] truncate text-white/70">{secondary}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function getWeatherCardData(params?: Record<string, any>) {
  const data = params?.data && typeof params.data === "object" ? (params.data as Record<string, any>) : params ?? {};
  return data;
}

function getWeatherIconPath(file: unknown) {
  if (typeof file !== "string" || !file.trim()) {
    return null;
  }

  return file.startsWith("/") ? file : `/weather-icons/${file}`;
}

function buildWeatherOverviewCard(params?: Record<string, any>, className?: string) {
  const data = getWeatherCardData(params);
  const iconPath = getWeatherIconPath(data.iconFile ?? data.icon_file ?? data.icon?.file);
  const temperature = data.temperature ?? data.primary ?? "";
  const unit = data.unit ?? "";
  const description = data.description ?? data.title ?? "Weather";
  const primary = typeof data.primary === "string"
    ? data.primary
    : `${temperature !== "" ? `${temperature}${unit}` : "Weather"}${description ? ` ${description}` : ""}`.trim();
  const secondary = typeof data.secondary === "string"
    ? data.secondary
    : data.insight ?? data.rainMessage ?? data.description ?? "";

  return IconDetailsCard(
    {
      icon: iconPath,
      primary,
      secondary,
    },
    className,
  );
}

function buildWeatherColumnsCard(params?: Record<string, any>, className?: string) {
  const data = getWeatherCardData(params);
  const iconPath = getWeatherIconPath(data.iconFile ?? data.icon_file ?? data.icon?.file);
  const tonightIconPath = getWeatherIconPath(data.tonight?.iconFile ?? data.tonight?.icon_file);
  const tomorrowIconPath = getWeatherIconPath(data.tomorrow?.iconFile ?? data.tomorrow?.icon_file);

  const columns = [
    {
      label: "Now",
      icon: iconPath ? { file: iconPath } : undefined,
      primary: typeof data.primary === "string"
        ? data.primary
        : `${data.temperature ?? "—"}${data.unit ?? ""} ${data.precipitationProbability ?? data.precipitation_probability ?? ""}`.trim(),
    },
    {
      label: "Tonight",
      icon: tonightIconPath ? { file: tonightIconPath } : undefined,
      primary: `${data.tonight?.temperature ?? "—"}${data.unit ?? ""} ${data.tonight?.precipitationProbability ?? data.tonight?.precipitation_probability ?? ""}`.trim(),
    },
    {
      label: "Tomorrow",
      icon: tomorrowIconPath ? { file: tomorrowIconPath } : undefined,
      primary: `${data.tomorrow?.temperature ?? "—"}${data.unit ?? ""} ${data.tomorrow?.precipitationProbability ?? data.tomorrow?.precipitation_probability ?? ""}`.trim(),
    },
  ];

  return renderPreviewTemplate(
    "columns",
    {
      header: {
        title: data.locationName ?? data.name ?? "Weather",
        icon: iconPath ? { file: iconPath } : undefined,
      },
      columns,
    },
    className,
  );
}

function renderWeatherWidget(
  type: string,
  params: Record<string, any>,
  className?: string,
) {
  const normalizedType = type.toLowerCase();

  if (normalizedType.includes("overview") || normalizedType.includes("card")) {
    return buildWeatherOverviewCard(params, className);
  }

  return buildWeatherColumnsCard(params, className);
}

function renderFallbackWidget(
  type: string,
  className?: string,
  params?: Record<string, any>,
) {
  const fallbackParams = params && typeof params === "object" ? params : {};

  if (type.toLowerCase().includes("weather")) {
    return renderWeatherWidget(type, fallbackParams, className);
  }

  if (fallbackParams.header || fallbackParams.list) {
    return renderPreviewTemplate("vertical-list", fallbackParams, className);
  }

  if (fallbackParams.header || fallbackParams.columns) {
    return renderPreviewTemplate("columns", fallbackParams, className);
  }

  return (
    <div className={`widget-default frosted ${className || ""}`}>
      Go to settings to configure
    </div>
  );
}

export function renderWidget({
  type,
  className,
  params,
  isPreview = false,
  previewTemplate,
  defaultOpen,
}: WidgetProps): ReactNode {
  const previewProperties = params && typeof params === "object" ? params : {};

  if (isPreview && previewTemplate) {
    return renderPreviewTemplate(previewTemplate, previewProperties, className);
  }

  switch (type) {
    case "main-clock":
      return <GlanceableClockWidget params={params} className={className} />;
    case "search-bar":
      return <SearchBar useRedirect={true} defaultOpen={defaultOpen} />;
    case "link-view":
      return <LinkView links={(params?.data ?? params?.links ?? []) as any[]} />;
    case "weather-upcoming":
    case "weather-overview":
      return renderWeatherWidget(type, params ?? {}, className);
    default:
      if (type.toLowerCase().includes("weather")) {
        return renderWeatherWidget(type, params ?? {}, className);
      }
    case "placeholder":
      return <WidgetComponent type={type} className={className} params={params} isPreview={isPreview} />;
  }
}

export default function WidgetComponent(
  { type, className, params }: WidgetProps,
) {
  const [Component, setComponent] = useState<ComponentType<WidgetItemProps> | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    const loadComponent = async () => {
      try {
        let imported: { default: ComponentType<WidgetItemProps> } | null = null;

        switch (type) {
          case "calendar-weekly":
            imported = await import("./dashboard/Calendar");
            break;
          case "calendar-today":
            imported = await import("./dashboard/Calendar").then((mod) => ({
              default: mod.CalendarTodayWidget,
            }));
            break;
          case "placeholder":
            imported = await import("./dashboard/Placeholder");
            break;
          case "glanceable-clock":
            imported = await import("./dashboard/GlanceableClock");
            break;
          default:
            imported = null;
        }

        if (!cancelled && imported?.default) {
          setComponent(() => imported!.default);
        }
      } catch (err) {
        console.error("Failed to load widget:", err);
      }
    };

    loadComponent();
    return () => {
      cancelled = true;
    };
  }, [type]);

  if (!Component) {
    return renderFallbackWidget(type, className, params);
  }

  return (
    <Component
      className={`frosted rounded-lg flex items-center ${className || ""}`}
      params={params}
    />
  );
}
