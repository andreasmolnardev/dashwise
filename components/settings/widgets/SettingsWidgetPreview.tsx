"use client";

import { useEffect, useState } from "react";
import { renderWidget } from "@/components/widgets/Widget";
import { getWidgetPropertiesAction } from "@/app/actions/integrations";
import useAuth from "@/context/useAuth";

type WidgetPropertiesResult = {
  widget: {
    slug: string;
    name: string;
    template: string;
    properties: Record<string, unknown>;
    data?: {
      source?: string;
      input?: Record<string, unknown>;
    };
    exampleProps?: Record<string, unknown>;
    preview?: {
      template?: string;
      properties?: Record<string, unknown>;
    };
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

  if (isIntegrationWidget && integrationWidget) {
    const mergedParams = {
      ...(integrationWidget.properties && typeof integrationWidget.properties === "object"
        ? (integrationWidget.properties as Record<string, unknown>)
        : (params && typeof params === "object" ? params : {})),
      ...(integrationWidget.data ? { data: integrationWidget.data } : {}),
    };

    return renderWidget({
      type,
      params: mergedParams,
      className,
    });
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

    return renderWidget({
      type,
      params: fallbackProperties,
      className,
    });
  }

  return renderWidget({
    type,
    className,
    params: params || {},
  });
}
