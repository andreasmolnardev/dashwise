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
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!cancelled) {
        setIsLoading(true);
        setLoadError(null);
        setIntegrationJSON(null);
      }

      try {
        const data = await withAuth((auth) =>
          getIntegrationWithWidgetAction(auth, type)
        );

        if (cancelled) return;

        if (!data?.integration || !data?.widgetJSON) {
          throw new Error(`Widget "${type}" could not be loaded.`);
        }

        setIntegrationJSON(data);
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
  }, [type, withAuth]);

  if (isLoading) {
    return <WidgetLoadingState className="w-full" />;
  }

  if (loadError || !integrationJSON) {
    return (
      <WidgetErrorState
        className="w-full"
        message={loadError ?? `Widget "${type}" could not be loaded.`}
      />
    );
  }

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
      <p className="mt-1 text-xs leading-snug text-red-100/80 break-words max-h-10 overflow-x-scroll">
        {message}
      </p>
    </div>
  );
}