"use client";

import { useEffect, useMemo, useState } from "react";
import WidgetComponent from "@/components/widgets/Widget";
import { getWidgetPropertiesAction } from "@/app/actions/integrations";
import useAuth from "@/context/useAuth";

type WidgetPropertiesResult = {
  widget: {
    slug: string;
    name: string;
    template: string;
    properties: Record<string, unknown>;
    exampleProps?: Record<string, unknown>;
  } | null;
  integration: {
    id: string;
    name: string | null;
  } | null;
};

type SettingsWidgetPreviewProps = {
  type: string;
  params?: Record<string, any>;
  className?: string;
  isIntegrationWidget?: boolean;
};

const widgetPropertiesCache = new Map<string, WidgetPropertiesResult["widget"]>();

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

function IntegrationTemplateWidget({
  template,
  properties,
  className,
}: {
  template: string;
  properties: Record<string, unknown>;
  className?: string;
}) {
  const normalizedTemplate = template.toLowerCase();

  if (normalizedTemplate === "overview") {
    const icon = getIconFromProperties(properties);
    const primary = toText(properties.primary) || "Overview";
    const secondary = toText(properties.secondary);

    return (
      <div className={`frosted rounded-lg p-3 flex items-center gap-3 ${className || ""}`}>
        {icon ? <img src={icon} className="h-8 w-8 object-contain" /> : null}
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

    return (
      <div className={`frosted rounded-lg p-3 flex flex-col gap-2 ${className || ""}`}>
        <div className="flex items-center gap-2">
          {icon ? <img src={icon} className="h-4 w-4 object-contain" /> : null}
          <p className="text-xs font-semibold truncate">{title}</p>
        </div>
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-md bg-black/10 px-2 py-1 text-xs truncate">
            Item {index + 1}
          </div>
        ))}
      </div>
    );
  }

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
        {icon ? <img src={icon} className="h-4 w-4 object-contain" /> : null}
        <p className="font-semibold truncate">{title}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {(columns.length ? columns : [{}, {}, {}]).map((column, index) => {
          const columnRecord =
            column && typeof column === "object" ? (column as Record<string, unknown>) : {};
          const label = toText(columnRecord.label) || `Col ${index + 1}`;
          const primary = toText(columnRecord.primary) || "—";

          return (
            <div key={index} className="rounded-md bg-black/10 px-2 py-1">
              <p className="text-[10px] truncate">{label}</p>
              <p className="text-xs font-medium truncate">{primary}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsWidgetPreview({
  type,
  params,
  className,
  isIntegrationWidget = false,
}: SettingsWidgetPreviewProps) {
  const { token, withAuth } = useAuth();
  const [integrationWidget, setIntegrationWidget] = useState<WidgetPropertiesResult["widget"] | null>(
    widgetPropertiesCache.get(type) ?? null
  );

  useEffect(() => {
    let cancelled = false;

    async function loadIntegrationWidget() {
      if (!isIntegrationWidget || !type) {
        if (!cancelled) {
          setIntegrationWidget(null);
        }
        return;
      }

      const cached = widgetPropertiesCache.get(type);
      if (cached !== undefined) {
        if (!cancelled) {
          setIntegrationWidget(cached);
        }
        return;
      }

      if (!token) {
        if (!cancelled) {
          setIntegrationWidget(null);
        }
        return;
      }

      try {
        const response = (await withAuth((auth) =>
          getWidgetPropertiesAction(auth, type)
        )) as WidgetPropertiesResult;
        const widget = response?.widget ?? null;
        widgetPropertiesCache.set(type, widget);
        if (!cancelled) {
          setIntegrationWidget(widget);
        }
      } catch {
        widgetPropertiesCache.set(type, null);
        if (!cancelled) {
          setIntegrationWidget(null);
        }
      }
    }

    void loadIntegrationWidget();

    return () => {
      cancelled = true;
    };
  }, [isIntegrationWidget, token, type, withAuth]);

  const integrationTemplate = useMemo(() => {
    if (!isIntegrationWidget || !integrationWidget) {
      return null;
    }

    const properties =
      integrationWidget.properties && typeof integrationWidget.properties === "object"
        ? (integrationWidget.properties as Record<string, unknown>)
        : {};

    return {
      template: integrationWidget.template || "columns",
      properties,
    };
  }, [integrationWidget, isIntegrationWidget]);

  if (integrationTemplate) {
    return (
      <IntegrationTemplateWidget
        template={integrationTemplate.template}
        properties={integrationTemplate.properties}
        className={className}
      />
    );
  }

  if (isIntegrationWidget) {
    const fallbackProperties =
      params && typeof params === "object"
        ? {
            header: {
              title: type,
            },
            columns: [{ primary: "Loading" }, { primary: "…" }, { primary: "…" }],
            ...(params as Record<string, unknown>),
          }
        : {
            header: { title: type },
            columns: [{ primary: "Loading" }, { primary: "…" }, { primary: "…" }],
          };

    return <IntegrationTemplateWidget template="columns" properties={fallbackProperties} className={className} />;
  }

  return <WidgetComponent type={type} className={className} params={params || {}} />;
}
