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
      return <div className={`frosted rounded-xl ${className ?? ""}`} />;

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
  const { withAuth, user } = useAuth();
  const [integrationJSON, setIntegrationJSON] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const data = await withAuth((auth) =>
        getIntegrationWithWidgetAction(auth, type)
      );
      setIntegrationJSON(data);
    };

    load();
  }, [type, withAuth]);

  if (!integrationJSON) return null; // or loading UI

  const resolvedInput = resolveUserInjectedEnv(
    integrationJSON.integration?.configuration.environment_variables,
    user
  );

  return (
    <Widget
      isPreview={isPreview ?? false}
      widgetKey={type}
      widgetJSON={integrationJSON.widgetJSON}
      integrationJSON={integrationJSON.integration}
      input={resolvedInput}
    />
  );
}
function resolveUserInjectedEnv(envVars: any, user: any): any {
  if (envVars == null) return envVars;

  const resolveString = (str: string) => {
    if (typeof str !== "string" || str.indexOf("${") === -1) return str;
    return str.replace(/\$\{([^}]+)\}/g, (_m, expr: string) => {
      const trimmed = expr.trim();
      if (!trimmed.startsWith("user.")) return "";
      const path = trimmed.slice(5).split(".");
      let val: any = user;
      for (const seg of path) {
        if (val == null) return "";
        val = val[seg];
      }
      if (val == null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
  };

  if (typeof envVars === "string") return resolveString(envVars);
  if (Array.isArray(envVars)) return envVars.map((v) => resolveUserInjectedEnv(v, user));
  if (typeof envVars === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(envVars)) {
      out[k] = resolveUserInjectedEnv(v, user);
    }
    return out;
  }

  return envVars;
}