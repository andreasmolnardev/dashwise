
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/src/lib/utils";
import YAML from "yaml";
import {
  createIntegrationAction,
  getIntegrationsAction,
  testIntegrationEndpointAction,
} from "@/app/actions/integrations";
import { AddIntegrationConfigDialog } from "@/components/settings/integrations/AddIntegrationConfigDialog";
import { TestEndpointDialog } from "@/components/settings/integrations/TestEndpointDialog";
import useAuth from "@/src/context/useAuth";
import { EndpointTestResult, EnvDefinition } from "@/src/lib/integrations/types";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

type IntegrationRecord = {
  id: string;
  name: string | null;
  source: string | null;
  config: Record<string, unknown>;
  environment: Record<string, string>;
  created: string;
  updated: string;
};

type ResolvedEndpoint = {
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
};

export default function IntegrationsModularSettingsPage() {
  const { token, withAuth } = useAuth();

  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolveCache, setResolveCache] = useState<Record<string, ResolvedEndpoint[]>>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newConfig, setNewConfig] = useState("");
  const [envDefinitions, setEnvDefinitions] = useState<EnvDefinition[]>([]);
  const [environmentOverrides, setEnvironmentOverrides] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);

  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testResult, setTestResult] = useState<EndpointTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testingTarget, setTestingTarget] = useState<string | null>(null);

  const handleTestDialogOpenChange = (open: boolean) => {
    if (!open) {
      setTestResult(null);
      setTestError(null);
      setTestingTarget(null);
    }
    setTestDialogOpen(open);
  };

  const selectedIntegration = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    return integrations.find((item) => item.id === selectedId) ?? null;
  }, [integrations, selectedId]);

  const resolvedEndpoints = useMemo(() => {
    if (!selectedIntegration) {
      return [] as ResolvedEndpoint[];
    }
    return resolveCache[selectedIntegration.id] ?? [];
  }, [resolveCache, selectedIntegration]);

  const integrationEnvDefinitions = useMemo(() => {
    if (!selectedIntegration) {
      return [] as EnvDefinition[];
    }
    const config = selectedIntegration.config;
    if (!isRecord(config)) {
      return [] as EnvDefinition[];
    }
    return buildEnvDefinitions(config);
  }, [selectedIntegration]);

  const integrationEnvDefinitionMap = useMemo(() => {
    const map: Record<string, EnvDefinition> = {};
    for (const definition of integrationEnvDefinitions) {
      map[definition.key] = definition;
    }
    return map;
  }, [integrationEnvDefinitions]);

  const environmentEntries = useMemo(() => {
    if (!selectedIntegration) {
      return [] as [string, string][];
    }
    const entries = Object.entries(selectedIntegration.environment ?? {});
    return entries.filter(([key]) => !integrationEnvDefinitionMap[key]?.userHidden);
  }, [selectedIntegration, integrationEnvDefinitionMap]);

  const visibleEnvFields = useMemo(
    () => envDefinitions.filter((definition) => !definition.userHidden),
    [envDefinitions]
  );

  const openIntegrationDetails = (integrationId: string) => {
    setSelectedId(integrationId);
    setDetailsSheetOpen(true);
  };

  const triggerEndpointTest = useCallback(
    async (endpoint: ResolvedEndpoint) => {
      if (!selectedIntegration) {
        return;
      }

      if (!token) {
        setTestResult(null);
        setTestError("Sign in before testing endpoints.");
        setTestDialogOpen(true);
        return;
      }

      const key = endpoint.id ?? endpoint.name;
      if (!key) {
        setTestResult(null);
        setTestError("This endpoint cannot be tested because it lacks an identifier.");
        setTestDialogOpen(true);
        return;
      }

      const target = `${selectedIntegration.id}.${key}`;
      setTestingTarget(target);
      setTestDialogOpen(true);
      setTesting(true);
      setTestResult(null);
      setTestError(null);

      try {
        const response = await withAuth((auth) => testIntegrationEndpointAction(auth, target));
        setTestResult(response as EndpointTestResult);
      } catch (err) {
        console.error("Unable to test endpoint", err);
        setTestError("Unable to reach the endpoint right now.");
      } finally {
        setTesting(false);
      }
    },
    [selectedIntegration, token, withAuth]
  );

  useEffect(() => {
    const parsed = parseConfigValue(newConfig);
    if (!isRecord(parsed)) {
      setEnvDefinitions([]);
      setEnvironmentOverrides({});
      return;
    }

    const definitions = buildEnvDefinitions(parsed);
    setEnvDefinitions(definitions);
    setEnvironmentOverrides((prev) => {
      const next: Record<string, string> = {};
      for (const definition of definitions) {
        next[definition.key] = prev[definition.key] ?? definition.defaultValue ?? "";
      }
      return next;
    });
  }, [newConfig]);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!token) {
      setError("Sign in with PocketBase to manage integrations.");
      setLoading(false);
      return;
    }

    try {
      const response = await withAuth((auth) => getIntegrationsAction(auth));
      const list =
        response && "integrations" in response && Array.isArray(response.integrations)
          ? response.integrations
          : [];
      setIntegrations(list as IntegrationRecord[]);
      setSelectedId((current) => {
        if (current && list.some((item: any) => item.id === current)) {
          return current;
        }
        return null;
      });
      setResolveCache({});
    } catch (err) {
      console.error("Failed to load integrations", err);
      setError("Unable to load integrations right now.");
    } finally {
      setLoading(false);
    }
  }, [token, withAuth]);

  const resolveEndpoints = useCallback(
    async (integrationId: string) => {
      if (!token) {
        setError("Sign in to resolve endpoints.");
        return [] as ResolvedEndpoint[];
      }

      setError(null);
      setResolvingId(integrationId);
      try {
        const response = await withAuth((auth) =>
          getIntegrationsAction(auth, {
            id: integrationId,
            resolveEndpoints: true,
          })
        );
        const resolved =
          response &&
          "resolvedEndpoints" in response &&
          Array.isArray(response.resolvedEndpoints)
            ? response.resolvedEndpoints
            : [];
        setResolveCache((prev) => ({
          ...prev,
          [integrationId]: resolved,
        }));
        return resolved as ResolvedEndpoint[];
      } catch (err) {
        console.error("Unable to resolve endpoints", err);
        setError("Unable to resolve endpoints for this integration.");
        return [] as ResolvedEndpoint[];
      } finally {
        setResolvingId(null);
      }
    },
    [token, withAuth]
  );

  useEffect(() => {
    void fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    if (!selectedIntegration) {
      return;
    }
    if (resolveCache[selectedIntegration.id]) {
      return;
    }
    void resolveEndpoints(selectedIntegration.id);
  }, [selectedIntegration, resolveCache, resolveEndpoints]);

  useEffect(() => {
    if (!selectedIntegration && detailsSheetOpen) {
      setDetailsSheetOpen(false);
    }
  }, [detailsSheetOpen, selectedIntegration]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    if (!integrations.some((item) => item.id === selectedId)) {
      setSelectedId(null);
      setDetailsSheetOpen(false);
    }
  }, [integrations, selectedId]);

  const createIntegration = useCallback(async () => {
    if (!token) {
      setFormError("Sign in before creating integrations.");
      return;
    }

    const parsedConfig = parseConfigValue(newConfig);
    if (!isRecord(parsedConfig)) {
      setFormError("Config JSON or YAML is invalid.");
      return;
    }

    for (const field of visibleEnvFields) {
      if (field.required && !environmentOverrides[field.key]?.trim()) {
        setFormError(`${field.key} is required.`);
        return;
      }
    }

    setCreating(true);
    setFormError(null);
    try {
      await withAuth((auth) =>
        createIntegrationAction(auth, {
          name: newName.trim() || undefined,
          source: "manual",
          config: parsedConfig,
          environment: environmentOverrides,
        })
      );

      setAddDialogOpen(false);
      setNewName("");
      setNewConfig("");
      await fetchIntegrations();
    } catch (err) {
      console.error("Unable to create integration", err);
      setFormError("Could not create the integration right now.");
    } finally {
      setCreating(false);
    }
  }, [
    environmentOverrides,
    fetchIntegrations,
    newConfig,
    newName,
    token,
    visibleEnvFields,
    withAuth,
  ]);

  const endpointCount = getEndpointCount(selectedIntegration?.config);

  return (
    <section className="space-y-6">
      <header className="flex flex-col items-center gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-2xl font-semibold">Manage your integrations</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void fetchIntegrations()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
          <Button onClick={() => setAddDialogOpen(true)}>Add integration</Button>
        </div>
      </header>

      {error && (
        <Card className="border border-destructive/40 bg-destructive/5 text-destructive-foreground">
          <CardContent>
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Your integrations</h3>
          <p className="text-xs">{integrations.length} total</p>
        </div>
        <div>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : integrations.length === 0 ? (
            <p className="p-6 text-sm">No integrations yet. Create one to get started.</p>
          ) : (
            <div className="space-y-2">
              {integrations.map((integration) => {
                const isSelected = integration.id === selectedIntegration?.id;
                return (
                  <button
                    key={integration.id}
                    type="button"
                    onClick={() => openIntegrationDetails(integration.id)}
                    className={cn(
                      "flex w-full flex-col gap-2 rounded-2xl border p-4 text-left transition frosted group",
                      isSelected ? "border-primary bg-primary/10" : ""
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold group-hover:text-(--primary)">
                        {integration.name ?? "Unnamed"}
                      </p>
                      <span className="text-xs">{integration.source ?? "manual"}</span>
                    </div>
                    <p className="text-xs">
                      {getEndpointCount(integration.config)} endpoints · Updated {formatDate(integration.updated)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Sheet open={Boolean(selectedIntegration && detailsSheetOpen)} onOpenChange={setDetailsSheetOpen}>
        <SheetContent className="max-w-3xl frosted text-(--text-primary) overflow-y-scroll">
          {selectedIntegration ? (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-1 text-(--text-primary)">
                  {selectedIntegration.name ?? "Untitled"}
                  <Badge>Source: {selectedIntegration.source ?? "manual"}</Badge>
                </SheetTitle>
                <SheetDescription className="text-sm text-(--text-primary)">
                  Manage the integration config and endpoint tests.
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 px-6 pb-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs">Updated {formatDate(selectedIntegration.updated)}</p>
                </div>

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
                    Endpoints ({resolvingId === selectedIntegration.id ? "…" : endpointCount})
                  </h3>
                  {resolvedEndpoints.length ? (
                    <div className="space-y-3">
                      {resolvedEndpoints.map((endpoint) => {
                        const identifier = endpoint.id ?? endpoint.name;
                        const testTarget = identifier
                          ? `${selectedIntegration.id}.${identifier}`
                          : null;

                        return (
                          <div
                            key={endpoint.id ?? endpoint.name ?? `${endpoint.method}-${endpoint.resolvedUrl}`}
                            className="space-y-1 rounded-2xl frosted p-3 text-sm"
                          >
                            <div className="flex items-start justify-between gap-3 text-xs">
                              <div className="flex flex-col">
                                <span className="break-words text-[1rem]">
                                  {endpoint.name ?? endpoint.id ?? "Untitled endpoint"}
                                </span>
                                <p className="text-xs">{endpoint.description ?? "No description"}</p>
                              </div>
                            </div>

                            <p className="text-xs">
                              <Badge>{endpoint.method}</Badge> {endpoint.resolvedUrl ?? endpoint.url}
                            </p>
                            <div className="text-[0.75rem]">Auth: {endpoint.auth || "none"}</div>

                            <Button
                              variant="outline"
                              size="sm" 
                              onClick={() => void triggerEndpointTest(endpoint)}
                              disabled={testing && testTarget ? testingTarget === testTarget : false}
                            >
                              Test endpoint
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm">No endpoints declared in the config, or unable to resolve.</p>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <TestEndpointDialog
        open={testDialogOpen}
        testing={testing}
        testError={testError}
        testResult={testResult}
        testingTarget={testingTarget}
        onOpenChange={handleTestDialogOpenChange}
      />

      <AddIntegrationConfigDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        newName={newName}
        onNewNameChange={setNewName}
        newConfig={newConfig}
        onNewConfigChange={setNewConfig}
        visibleEnvFields={visibleEnvFields}
        environmentOverrides={environmentOverrides}
        onEnvironmentOverrideChange={(key, value) =>
          setEnvironmentOverrides((prev) => ({
            ...prev,
            [key]: value,
          }))
        }
        formError={formError}
        creating={creating}
        onCancel={() => setAddDialogOpen(false)}
        onCreate={() => void createIntegration()}
      />
    </section>
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

function parseSafeJson(value: string) {
  if (!value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseConfigValue(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsedJson = parseSafeJson(value);
  if (parsedJson) {
    return parsedJson;
  }

  try {
    return YAML.parse(value);
  } catch {
    return null;
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
