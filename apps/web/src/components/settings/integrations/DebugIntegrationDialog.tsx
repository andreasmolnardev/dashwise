import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { EnvDefinition } from "@/lib/integrations/types";
import { getIntegrationsAction } from "@/app/actions/integrations";
import useAuth from "@/context/useAuth";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export type ResolvedEndpoint = {
  id: string | null;
  name: string | null;
  description: string | null;
  method: string;
  url: string;
  auth: string;
  allow_insecure_ssl?: boolean | string | null;
  timeout?: number | string | null;
  body: unknown;
  custom_headers: Record<string, unknown>;
  response_body_types: Record<string, unknown>;
  response_mappings: unknown[];
  resolvedUrl: string;
  resolvedAuth: string;
  resolvedHeaders: Record<string, string>;
  resolvedBody: unknown;
  response?: {
    id: string | null;
    name: string | null;
    method: string;
    url: string;
    resolvedUrl: string;
    requestHeaders: Record<string, string>;
    requestBody: string | null;
    rawResponse: unknown;
    mappedResponse: unknown;
  } | null;
};

type IntegrationRecord = {
  id: string;
  name: string | null;
  source: string | null;
  config: Record<string, unknown>;
  environment: Record<string, string>;
  created: string;
  updated: string;
};

type DebugIntegrationDialogProps = {
  open: boolean;
  integration: IntegrationRecord | null;
  onOpenChange: (open: boolean) => void;
};

export function DebugIntegrationDialog({
  open,
  integration,
  onOpenChange,
}: DebugIntegrationDialogProps) {
  const { withAuth } = useAuth();
  const [selectedInspectTab, setSelectedInspectTab] = useState<string | null>(null);
  const [resolveCache, setResolveCache] = useState<Record<string, { endpoints: ResolvedEndpoint[]; computed: Record<string, unknown> }>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedInspectTab(null);
    }
  }, [open]);

  const resolvedEndpoints = useMemo(() => {
    if (!integration) {
      return [] as ResolvedEndpoint[];
    }
    return resolveCache[integration.id]?.endpoints ?? [];
  }, [resolveCache, integration]);

  const resolvedComputed = useMemo(() => {
    if (!integration) {
      return {} as Record<string, unknown>;
    }
    return resolveCache[integration.id]?.computed ?? {};
  }, [resolveCache, integration]);

  const integrationEnvDefinitions = useMemo(() => {
    if (!integration) {
      return [] as EnvDefinition[];
    }
    const config = integration.config;
    if (!isRecord(config)) {
      return [] as EnvDefinition[];
    }
    return buildEnvDefinitions(config);
  }, [integration]);

  const integrationEnvDefinitionMap = useMemo(() => {
    const map: Record<string, EnvDefinition> = {};
    for (const definition of integrationEnvDefinitions) {
      map[definition.key] = definition;
    }
    return map;
  }, [integrationEnvDefinitions]);

  const environmentEntries = useMemo(() => {
    if (!integration) {
      return [] as [string, string][];
    }
    const entries = Object.entries(integration.environment ?? {});
    return entries.filter(([key]) => !integrationEnvDefinitionMap[key]?.userHidden);
  }, [integration, integrationEnvDefinitionMap]);

  const resolveEndpoints = useCallback(async () => {
    if (!integration || !open) {
      return;
    }

    if (resolveCache[integration.id]) {
      return;
    }

    try {
      const response = await withAuth((auth) =>
        getIntegrationsAction(auth, {
          id: integration.id,
          resolveEndpoints: true,
        })
      ) as any;
      const endpointList: ResolvedEndpoint[] = Array.isArray(response?.resolvedEndpoints)
        ? response.resolvedEndpoints
        : [];
      const computedData: Record<string, unknown> =
        typeof response?.resolvedComputed === "object" && response.resolvedComputed !== null
          ? (response.resolvedComputed as Record<string, unknown>)
          : ({} as Record<string, unknown>);
      setResolveCache((prev) => ({
        ...prev,
        [integration.id]: { endpoints: endpointList, computed: computedData },
      }));
    } catch (err) {
      console.error("Unable to resolve endpoints", err);
    } finally {
      setResolvingId(null);
    }
  }, [integration, open, withAuth, resolveCache]);

  useEffect(() => {
    if (integration) {
      void resolveEndpoints();
    }
  }, [integration, resolveEndpoints]);

  const endpointCount = getEndpointCount(integration?.config);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} >
      <DialogContent className="frosted text-(--text-primary) overflow-hidden max-w-[60vw] w-full">
        {integration ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-(--text-primary)">
                {integration.name ?? "Untitled"}
                <Badge variant="outline">{integration.source ?? "manual"}</Badge>
              </DialogTitle>
              <DialogDescription className="text-sm text-(--text-primary)">
                Integration inspect panel
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="w-48 shrink-0 space-y-1">
                {[
                  { label: "static", items: ["Environment", "Lookup tables"] },
                  { label: "runtime", items: ["endpoints", "computed"] },
                  { label: "templated", items: ["widgets", "glanceable", "shortcuts"] },
                ].map((section) => (
                  <div key={section.label} className="space-y-1">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      {section.label}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {section.items.map((item) => {
                        const isActive = selectedInspectTab === item;
                        return (
                          <button
                            key={item}
                            onClick={() => setSelectedInspectTab(isActive ? null : item)}
                            className={cn(
                              "rounded-md px-2 py-1 text-xs transition-colors",
                              isActive
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary/50 hover:bg-secondary"
                            )}
                          >
                            {item}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto max-h-[60vh] px-4 border-l">
                <div className="flex items-center justify-between">
                  <p className="text-xs">Updated {formatDate(integration.updated)}</p>
                </div>

                {selectedInspectTab === null && (
                  <>
                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold">Environment</h3>
                      {environmentEntries.length ? (
                        <div className="grid grid-cols-1 gap-2 text-sm text-foreground md:grid-cols-2">
                          {environmentEntries.map(([key, value]) => {
                            const definition = integrationEnvDefinitionMap[key];
                            const displayValue = definition?.overwriteOnly ? "******" : value;
                            return (
                              <div key={key} className="rounded-xl px-3 py-2 frosted">
                                <p className="text-xs">{key}</p>
                                <p className="font-mono text-sm">{displayValue}</p>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm">No explicit overrides stored — defaults are used.</p>
                      )}
                    </section>

                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold">
                        Endpoints ({resolvingId === integration.id ? "…" : endpointCount})
                      </h3>
                      {resolvedEndpoints.length ? (
                        <div className="space-y-4">
                          {resolvedEndpoints.map((endpoint) => {
                            const resp = endpoint.response;
                            const hasResponse = resp && resp.mappedResponse !== undefined;

                            return (
                              <div
                                key={endpoint.id ?? endpoint.name ?? `${endpoint.method}-${endpoint.resolvedUrl}`}
                                className="space-y-2 rounded-2xl frosted p-3 text-sm"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex flex-col">
                                    <span className="break-words text-[1rem] font-medium">
                                      {endpoint.name ?? endpoint.id ?? "Untitled endpoint"}
                                    </span>
                                    <p className="text-xs text-muted-foreground">{endpoint.description ?? "No description"}</p>
                                  </div>
                                  {hasResponse && (
                                    <Badge variant={resp.rawResponse ? "default" : "outline"}>
                                      {resp.rawResponse ? "OK" : "empty"}
                                    </Badge>
                                  )}
                                </div>

                                <div className="space-y-1 mt-2">
                                  <p className="text-xs font-medium text-muted-foreground">Request</p>
                                  <div className="rounded-lg bg-muted/50 p-2 font-mono text-xs">
                                    <div>
                                      <Badge>{endpoint.method}</Badge>{" "}
                                      {endpoint.resolvedUrl || endpoint.url}
                                    </div>
                                    {Object.keys(endpoint.resolvedHeaders ?? {}).length > 0 && (
                                      <div className="mt-1 text-muted-foreground">
                                        Headers: {JSON.stringify(endpoint.resolvedHeaders)}
                                      </div>
                                    )}
                                    {endpoint.resolvedBody && (
                                      <div className="mt-1 text-muted-foreground">
                                        Body: {typeof endpoint.resolvedBody === "string" ? endpoint.resolvedBody : JSON.stringify(endpoint.resolvedBody as Record<string, unknown>)}
                                      </div>
                                    )}
                                    {endpoint.auth && (
                                      <div className="mt-1 text-muted-foreground">
                                        Auth: {endpoint.auth}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {hasResponse && (
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground">Response</p>
                                    <div className="rounded-lg bg-muted/50 p-2 font-mono text-xs max-h-48 overflow-auto">
                                      {resp.rawResponse !== undefined && (
                                        <div className="mb-2">
                                          <span className="text-muted-foreground">Raw: </span>
                                          {typeof resp.rawResponse === "string" 
                                            ? resp.rawResponse 
                                            : JSON.stringify(resp.rawResponse, null, 2)}
                                        </div>
                                      )}
                                      {resp.mappedResponse !== undefined && (
                                        <div>
                                          <span className="text-muted-foreground">Mapped: </span>
                                          {typeof resp.mappedResponse === "string"
                                            ? resp.mappedResponse
                                            : JSON.stringify(resp.mappedResponse, null, 2)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm">No endpoints declared in the config, or unable to resolve.</p>
                      )}
                    </section>
                  </>
                )}

                {selectedInspectTab === "Environment" && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Environment</h3>
                    {environmentEntries.length ? (
                      <div className="grid grid-cols-1 gap-2 text-sm text-foreground md:grid-cols-2">
                        {environmentEntries.map(([key, value]) => {
                          const definition = integrationEnvDefinitionMap[key];
                          const displayValue = definition?.overwriteOnly ? "******" : value;
                          return (
                            <div key={key} className="rounded-xl px-3 py-2 frosted">
                              <p className="text-xs">{key}</p>
                              <p className="font-mono text-sm">{displayValue}</p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm">No explicit overrides stored — defaults are used.</p>
                    )}
                  </section>
                )}

                {selectedInspectTab === "Lookup tables" && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Lookup Tables</h3>
                    {(() => {
                      const config = integration.config;
                      const lookup = (config?.configuration as Record<string, unknown> | undefined)?.lookup_tables;
                      if (!lookup || typeof lookup !== "object") {
                        return <p className="text-sm">No lookup tables defined.</p>;
                      }
                      const entries = Object.entries(lookup as Record<string, unknown>);
                      if (entries.length === 0) {
                        return <p className="text-sm">No lookup tables defined.</p>;
                      }
                      return (
                        <pre className="max-h-96 overflow-auto rounded-xl bg-muted p-3 text-xs">
                          {JSON.stringify(lookup, null, 2)}
                        </pre>
                      );
                    })()}
                  </section>
                )}

                {selectedInspectTab === "endpoints" && (
<section className="space-y-3">
                                        <h3 className="text-sm font-semibold">
                                          Endpoints ({resolvingId === integration.id ? "…" : endpointCount})
                                        </h3>
                                        {resolvedEndpoints.length ? (
                                          <div className="space-y-4">
                                            {resolvedEndpoints.map((endpoint) => {
                                              const resp = endpoint.response;
                                              const hasResponse = resp && resp.mappedResponse !== undefined;

                                              return (
                                                <div
                                                  key={endpoint.id ?? endpoint.name ?? `${endpoint.method}-${endpoint.resolvedUrl}`}
                                                  className="space-y-2 rounded-2xl frosted p-3 text-sm"
                                                >
                                                  <div className="flex items-start justify-between gap-3">
                                                    <div className="flex flex-col">
                                                      <span className="break-words text-[1rem] font-medium">
                                                        {endpoint.name ?? endpoint.id ?? "Untitled endpoint"}
                                                      </span>
                                                      <p className="text-xs text-muted-foreground">{endpoint.description ?? "No description"}</p>
                                                    </div>
                                                    {hasResponse && (
                                                      <Badge variant={resp.rawResponse ? "default" : "outline"}>
                                                        {resp.rawResponse ? "OK" : "empty"}
                                                      </Badge>
                                                    )}
                                                  </div>

                                                  <div className="space-y-1 mt-2">
                                                    <p className="text-xs font-medium text-muted-foreground">Request</p>
                                                    <div className="rounded-lg bg-muted/50 p-2 font-mono text-xs">
                                                      <div>
                                                        <Badge>{endpoint.method}</Badge>{" "}
                                                        {endpoint.resolvedUrl || endpoint.url}
                                                      </div>
                                                      {Object.keys(endpoint.resolvedHeaders ?? {}).length > 0 && (
                                                        <div className="mt-1 text-muted-foreground">
                                                          Headers: {JSON.stringify(endpoint.resolvedHeaders)}
                                                        </div>
                                                      )}
                                                      {endpoint.resolvedBody && (
                                                        <div className="mt-1 text-muted-foreground">
                                                          Body: {typeof endpoint.resolvedBody === "string" ? endpoint.resolvedBody : JSON.stringify(endpoint.resolvedBody as object)}
                                                        </div>
                                                      )}
                                                      {endpoint.auth && (
                                                        <div className="mt-1 text-muted-foreground">
                                                          Auth: {endpoint.auth}
                                                        </div>
                                                      )}
                                                    </div>
                                                  </div>

                                                  {hasResponse && (
                                                    <div className="space-y-1">
                                                      <p className="text-xs font-medium text-muted-foreground">Response</p>
                                                      <div className="rounded-lg bg-muted/50 p-2 font-mono text-xs max-h-48 overflow-auto">
                                                        {resp.rawResponse !== undefined && (
                                                          <div className="mb-2">
                                                            <span className="text-muted-foreground">Raw: </span>
                                                            {typeof resp.rawResponse === "string" 
                                                              ? resp.rawResponse 
                                                              : JSON.stringify(resp.rawResponse, null, 2)}
                                                          </div>
                                                        )}
                                                        {resp.mappedResponse !== undefined && (
                                                          <div>
                                                            <span className="text-muted-foreground">Mapped: </span>
                                                            {typeof resp.mappedResponse === "string"
                                                              ? resp.mappedResponse
                                                              : JSON.stringify(resp.mappedResponse, null, 2)}
                                                          </div>
                                                        )}
                                                      </div>
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <p className="text-sm">No endpoints declared in the config, or unable to resolve.</p>
                                        )}
                                      </section>
                )}

                {selectedInspectTab === "shortcuts" && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Shortcuts Template</h3>
                    {(() => {
                      const config = integration.config;
                      const shortcuts = config?.shortcuts;
                      if (!shortcuts) {
                        return <p className="text-sm">No shortcuts defined.</p>;
                      }
                      return (
                        <pre className="max-h-96 overflow-auto rounded-xl bg-muted p-3 text-xs">
                          {JSON.stringify(shortcuts, null, 2)}
                        </pre>
                      );
                    })()}
                  </section>
                )}

                {selectedInspectTab === "widgets" && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Widgets</h3>
                    {(() => {
                      const config = integration.config;
                      const widgets = config?.widgets;
                      if (!widgets) {
                        return <p className="text-sm">No widgets defined.</p>;
                      }
                      return (
                        <pre className="max-h-96 overflow-auto rounded-xl bg-muted p-3 text-xs">
                          {JSON.stringify(widgets, null, 2)}
                        </pre>
                      );
                    })()}
                  </section>
                )}

                {selectedInspectTab === "glanceable" && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Glanceable</h3>
                    {(() => {
                      const config = integration.config;
                      const glanceable = config?.glanceable;
                      if (!glanceable) {
                        return <p className="text-sm">No glanceable defined.</p>;
                      }
                      return (
                        <pre className="max-h-96 overflow-auto rounded-xl bg-muted p-3 text-xs">
                          {JSON.stringify(glanceable, null, 2)}
                        </pre>
                      );
                    })()}
                  </section>
                )}

                {selectedInspectTab === "computed" && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Computed Fields</h3>
                    {Object.keys(resolvedComputed).length > 0 ? (
                      <>
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Resolved values</p>
                          <pre className="max-h-64 overflow-auto rounded-xl bg-muted p-3 text-xs">
                            {JSON.stringify(resolvedComputed, null, 2)}
                          </pre>
                        </div>
                      </>
                    ) : null}
                    {(() => {
                      const config = integration.config;
                      const computed = (config?.configuration as Record<string, unknown> | undefined)?.computed;
                      if (!computed || typeof computed !== "object") {
                        return <p className="text-sm">No computed fields defined.</p>;
                      }
                      return (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Configuration</p>
                          <pre className="max-h-64 overflow-auto rounded-xl bg-muted p-3 text-xs">
                            {JSON.stringify(computed, null, 2)}
                          </pre>
                        </div>
                      );
                    })()}
                  </section>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-xs">Updated {formatDate(integration.updated)}</p>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "–";
  }
  try {
    return dateFormatter.format(new Date(value));
  } catch {
    return value;
  }
}

function buildEnvDefinitions(config: Record<string, unknown>) {
  const envDefinition =
    (config.configuration as Record<string, unknown> | undefined)?.environment_variables;
  if (!envDefinition) {
    return [] as EnvDefinition[];
  }

  const definitions: EnvDefinition[] = [];

  if (Array.isArray(envDefinition)) {
    for (const item of envDefinition) {
      const record = isRecord(item) ? item : {};
      const key =
        typeof record.key === "string"
          ? record.key
          : typeof record.name === "string"
            ? record.name
            : null;
      if (!key) {
        continue;
      }
      definitions.push({
        key,
        userHidden: record.user_hidden === true,
        required: record.required === true,
        overwriteOnly: record.edit === "overwrite-only",
        defaultValue: resolveEnvDefault(record),
        description: typeof record.description === "string" ? record.description : undefined,
      });
    }
    return definitions;
  }

  if (isRecord(envDefinition)) {
    for (const [key, raw] of Object.entries(envDefinition)) {
      const record = isRecord(raw) ? raw : {};
      definitions.push({
        key,
        userHidden: record.user_hidden === true,
        required: record.required === true,
        overwriteOnly: record.edit === "overwrite-only",
        defaultValue: resolveEnvDefault(record),
        description: typeof record.description === "string" ? record.description : undefined,
      });
    }
  }

  return definitions;
}

function resolveEnvDefault(definition: Record<string, unknown>) {
  const fallback = definition.testValue ?? definition.test_value ?? definition.default;
  if (fallback === undefined || fallback === null) {
    return undefined;
  }
  return typeof fallback === "string" ? fallback : String(fallback);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEndpointCount(config?: Record<string, unknown>) {
  const candidate = (config?.configuration as Record<string, unknown> | undefined)?.endpoints;
  if (!candidate) {
    return 0;
  }
  if (Array.isArray(candidate)) {
    return candidate.length;
  }
  if (isRecord(candidate)) {
    return Object.keys(candidate).length;
  }
  return 0;
}