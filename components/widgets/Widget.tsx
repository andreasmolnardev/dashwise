"use client";

import { useEffect, useState, type ReactNode } from "react";
import GlanceableClockWidget from "./dashboard/GlanceableClock";
import LinkView from "./LinkView";
import SearchBar from "./SearchBar";
import Widget from "@/dashwise-integrationskit/Widget";
import useAuth from "@/context/useAuth";
import { getIntegrationWithWidgetAction } from "@/app/actions/integrations";

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

export function renderWidget({
  type,
  params,
  className,
  isPreview,
  defaultOpen,
}: WidgetProps): ReactNode {
  switch (type) {
    case "main-clock":
    case "glanceable-clock":
      return <GlanceableClockWidget className={className} params={params} />;

    case "search-bar":
      return (
        <div className={className}>
          <SearchBar useRedirect={false} defaultOpen={defaultOpen} />
        </div>
      );

    case "link-view": return (<LinkView/>);

    case "placeholder":
      return <div className={`frosted rounded-xl ${className ?? ""}`} />;

    default:  
      return (
        <IntegrationWidget type={type} isPreview={isPreview} />
      );
  }
}

function IntegrationWidget({
  type,
  isPreview,
}: {
  type: string;
  isPreview?: boolean;
}) {
  const { withAuth } = useAuth();
  const [integrationJSON, setIntegrationJSON] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const data = await withAuth((auth) =>
        getIntegrationWithWidgetAction(auth, type)
      );
      console.log(`Fetched integration data for widget "${type}":`, data);
      setIntegrationJSON(data);
    };

    load();
  }, [type, withAuth]);

  if (!integrationJSON) return null; // or loading UI

  return (
    <Widget
      isPreview={isPreview ?? false}
      widgetKey={type}
      widgetJSON={integrationJSON.widgetJSON}
      integrationJSON={integrationJSON.integration}
    />
  );
}