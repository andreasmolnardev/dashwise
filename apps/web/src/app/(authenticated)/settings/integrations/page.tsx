
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import YAML from "yaml";
import {
  createIntegrationAction,
  getIntegrationsAction,
  testIntegrationEndpointAction,
} from "@/app/actions/integrations";
import { AddIntegrationConfigDialog } from "@/components/settings/integrations/AddIntegrationConfigDialog";
import { TestEndpointDialog } from "@/components/settings/integrations/TestEndpointDialog";
import { DebugIntegrationDialog } from "@/components/settings/integrations/DebugIntegrationDialog";
import useAuth from "@/context/useAuth";
import { EndpointTestResult, EnvDefinition } from "@/lib/integrations/types";

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

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newConfig, setNewConfig] = useState("");
  const [envDefinitions, setEnvDefinitions] = useState<EnvDefinition[]>([]);
  const [environmentOverrides, setEnvironmentOverrides] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);

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

  const visibleEnvFields = useMemo(
    () => envDefinitions.filter((definition) => !definition.userHidden),
    [envDefinitions]
  );

  const openIntegrationDetails = (integrationId: string) => {
    setSelectedId(integrationId);
    setDetailsDialogOpen(true);
  };

  const handleDetailsOpenChange = (open: boolean) => {
    setDetailsDialogOpen(open);
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
          ? (response.integrations as IntegrationRecord[])
          : ([] as IntegrationRecord[]);
      setIntegrations(list);
      setSelectedId((current) => {
        if (current && list.some((item: any) => item.id === current)) {
          return current;
        }
        return null;
      });
    } catch (err) {
      console.error("Failed to load integrations", err);
      setError("Unable to load integrations right now.");
    } finally {
      setLoading(false);
    }
  }, [token, withAuth]);

  useEffect(() => {
    void fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    if (!integrations.some((item) => item.id === selectedId)) {
      setSelectedId(null);
      setDetailsDialogOpen(false);
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

      <DebugIntegrationDialog
        open={detailsDialogOpen}
        integration={selectedIntegration}
        onOpenChange={handleDetailsOpenChange}
        onTriggerTest={triggerEndpointTest}
        testing={testing}
        testTarget={testingTarget}
      />

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
