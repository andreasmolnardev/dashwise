"use client";

import { useEffect, useState } from "react";
import { renderWidget } from "@/components/widgets/Widget";
import { getIntegrationWithWidgetAction } from "@/app/actions/integrations";
import IntegrationWidget from "@/dashwise-integrationskit/Widget";
import useAuth from "@/context/useAuth";

type WidgetPropertiesResult = {
  widgetJSON: Record<string, unknown> | null;
  integration: Record<string, unknown> | null;
};

type SettingsWidgetPreviewProps = {
  type: string;
  params?: Record<string, any>;
  className?: string;
  isIntegrationWidget?: boolean;
};

const widgetPropertiesCache = new Map<string, WidgetPropertiesResult | null>();

export function SettingsWidgetPreview({
  type,
  params,
  className,
  isIntegrationWidget = false,
}: SettingsWidgetPreviewProps) {
  const { token, withAuth } = useAuth();
  const [integrationWidget, setIntegrationWidget] = useState<WidgetPropertiesResult | null>(
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
          getIntegrationWithWidgetAction(auth, type)
        )) as WidgetPropertiesResult;
        const widget = response?.integration && response?.widgetJSON ? response : null;
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

  if (isIntegrationWidget && integrationWidget?.integration && integrationWidget?.widgetJSON) {
    const previewWidget = integrationWidget.widgetJSON;

    return (
      <IntegrationWidget
        widgetKey={type}
        widgetJSON={previewWidget as Record<string, any>}
        integrationJSON={integrationWidget.integration as Record<string, any>}
        input={params ?? {}}
        preview={true}
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
