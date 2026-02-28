"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getIntegrations, postIntegrations, postIntegrationsFetchendpoint } from "@/lib/generatedApiClient";
import { load } from "js-yaml";
import { Badge } from "@/components/ui/badge";
import { EndpointTestResult, EnvDefinition } from "@/lib/integrations/types";
import { AddIntegrationConfigDialog } from "@/components/settings/integrations/AddIntegrationConfigDialog";
import { TestEndpointDialog } from "@/components/settings/integrations/TestEndpointDialog";
import { useAuth } from "@/context/useAuth";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

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



export default function NewIntegrationsSettingsPage() {
    const { token } = useAuth();
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

    const visibleEnvFields = useMemo(() => envDefinitions.filter((def) => !def.userHidden), [envDefinitions]);

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
                const response = await postIntegrationsFetchendpoint({ target }, { token });
                setTestResult(response as EndpointTestResult);
            } catch (err) {
                console.error("Unable to test endpoint", err);
                setTestError("Unable to reach the endpoint right now.");
            } finally {
                setTesting(false);
            }
        },
        [selectedIntegration, token]
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
            for (const def of definitions) {
                next[def.key] = prev[def.key] ?? def.defaultValue ?? "";
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
            const response = await getIntegrations<{ integrations?: IntegrationRecord[] }>({ token });
            const list = Array.isArray(response?.integrations) ? response.integrations : [];
            const normalized = list.map((integration) => ({
                ...integration,
                environment: decodeIntegrationEnvironment(integration.environment),
            }));
            setIntegrations(normalized);
            setSelectedId((current) => {
                if (current && list.some((item) => item.id === current)) {
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
    }, [token]);

    const resolveEndpoints = useCallback(
        async (entryId: string) => {
            if (!token) {
                setError("Sign in to resolve endpoints.");
                return [] as ResolvedEndpoint[];
            }

            setError(null);
            setResolvingId(entryId);
            try {
                const response = await getIntegrations<{ resolvedEndpoints?: ResolvedEndpoint[] }>({
                    token,
                    qs: { id: entryId, resolveEndpoints: true },
                });
                const resolved = Array.isArray(response?.resolvedEndpoints) ? response.resolvedEndpoints : [];
                setResolveCache((prev) => ({
                    ...prev,
                    [entryId]: resolved,
                }));
                return resolved;
            } catch (err) {
                console.error("Unable to resolve endpoints", err);
                setError("Unable to resolve endpoints for this integration.");
                return [] as ResolvedEndpoint[];
            } finally {
                setResolvingId(null);
            }
        },
        [token]
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

        const payload = {
            name: newName.trim() || undefined,
            source: "manual",
            config: parsedConfig,
            environment: environmentOverrides,
        } as Record<string, unknown>;

        setCreating(true);
        setFormError(null);
        try {
            await postIntegrations(payload, { token });
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
    }, [environmentOverrides, fetchIntegrations, newConfig, newName, token, visibleEnvFields]);

    const endpointCount = getEndpointCount(selectedIntegration?.config);
    const environmentOverrideCount = environmentEntries.length;

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
                                            isSelected
                                                ? "border-primary bg-primary/10"
                                                : ""
                                        )}
                                    >
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-semibold group-hover:text-(--primary)">{integration.name ?? "Unnamed"}</p>
                                            <span className="text-xs">
                                                {integration.source ?? "manual"}
                                            </span>
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


            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Widget Templates</h3>
                </div>
            </div>

            <Sheet
                open={Boolean(selectedIntegration && detailsSheetOpen)}
                onOpenChange={(open) => setDetailsSheetOpen(open)}
            >
                <SheetContent className="max-w-3xl frosted text-foreground">
                    {selectedIntegration ? (
                        <>
                            <SheetHeader>
                                <SheetTitle className="flex items-center gap-1 text-foreground">{selectedIntegration.name ?? "Untitled"}<Badge>Source: {selectedIntegration.source ?? "manual"}</Badge></SheetTitle>
                                <SheetDescription className="text-sm text-foreground">
                                    Manage the integration's config and environment.
                                </SheetDescription>
                            </SheetHeader>
                            <div className="space-y-6 px-6 pb-6">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs">Updated {formatDate(selectedIntegration.updated)}</p>
                                </div>

                                <Accordion collapsible type="single" className="w-full" defaultValue="endpoints">
                                    <AccordionItem value="environment">
                                        <AccordionTrigger>Environment</AccordionTrigger>
                                        <AccordionContent>
                                            {environmentEntries.length ? (
                                                <div className="grid grid-cols-1 gap-2 text-sm text-foreground md:grid-cols-2">
                                                    {environmentEntries.map(([key, value]) => {
                                                        const definition = integrationEnvDefinitionMap[key];
                                                        const displayValue = definition?.overwriteOnly ? "******" : value;
                                                        return (
                                                            <div
                                                                key={key}
                                                                className="rounded-xl px-3 py-2 frosted"
                                                            >
                                                                <p className="text-xs">{key}</p>
                                                                <p className="font-mono text-sm">{displayValue}</p>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <p className="text-sm">No explicit overrides stored — defaults are used.</p>
                                            )}
                                        </AccordionContent>
                                    </AccordionItem>
                                    <AccordionItem value="endpoints">
                                        <AccordionTrigger>
                                            Endpoints ({endpointCount})
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            {resolvedEndpoints.length ? (
                                                <div className="space-y-3">
                                                    {resolvedEndpoints.map((endpoint) => {
                                                        const identifier = endpoint.id ?? endpoint.name;
                                                        const testTarget = identifier ? `${selectedIntegration.id}.${identifier}` : null;
                                                        console.log(endpoint)
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

                                                                        <p className="text-xs">
                                                                            {endpoint.description ?? "No description"}
                                                                        </p>
                                                                    </div>
                                                                </div>

                                                                <p className="text-xs">
                                                                    <Badge>{endpoint.method}</Badge>  {endpoint.resolvedUrl ?? endpoint.url}
                                                                </p>
                                                                <div className="text-[0.75rem]">
                                                                    Auth: {endpoint.auth || "none"}
                                                                </div>

                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => triggerEndpointTest(endpoint)}
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
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>

                                <section>
                                    <h3>Actions</h3>
                                    <div className="flex">
                                        <Button>Delete</Button>
                                    </div>
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

// Format timestamps in a readable style, falling back to the raw string on errors.
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

// Parse JSON strings safely, returning null for invalid input or empty input.
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

// Attempt to parse integration configs as JSON or YAML, returning null on failure.
function parseConfigValue(value: string) {
    if (!value.trim()) {
        return null;
    }

    const parsedJson = parseSafeJson(value);
    if (parsedJson !== null) {
        return parsedJson;
    }

    try {
        return load(value);
    } catch {
        return null;
    }
}

// Inspect the integration config to derive the declared environment variables.
function buildEnvDefinitions(config: Record<string, unknown>) {
    const envDefinition = (config.configuration as Record<string, unknown> | undefined)?.environment_variables;
    if (!envDefinition) {
        return [] as EnvDefinition[];
    }

    const defs: EnvDefinition[] = [];

    if (Array.isArray(envDefinition)) {
        for (const item of envDefinition) {
            const record = isRecord(item) ? item : {};
            const key = typeof record.key === "string" ? record.key : typeof record.name === "string" ? record.name : null;
            if (!key) {
                continue;
            }
            defs.push({
                key,
                userHidden: record.user_hidden === true,
                required: record.required === true,
                overwriteOnly: record.edit === "overwrite-only",
                defaultValue: resolveEnvDefault(record),
                description: typeof record.description === "string" ? record.description : undefined,
            });
        }
        return defs;
    }

    if (isRecord(envDefinition)) {
        for (const [key, raw] of Object.entries(envDefinition)) {
            const record = isRecord(raw) ? raw : {};
            defs.push({
                key,
                userHidden: record.user_hidden === true,
                required: record.required === true,
                overwriteOnly: record.edit === "overwrite-only",
                defaultValue: resolveEnvDefault(record),
                description: typeof record.description === "string" ? record.description : undefined,
            });
        }
    }

    return defs;
}

// Normalize declared default/test values to strings for form placeholders.
function resolveEnvDefault(definition: Record<string, unknown>) {
    const fallback = definition.testValue ?? definition.test_value ?? definition.default;
    if (fallback === undefined || fallback === null) {
        return undefined;
    }
    return typeof fallback === "string" ? fallback : String(fallback);
}

// Narrow a value to a record if it is a plain object (not array/null).
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Count how many endpoints are declared in the integration configuration.
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

// Coerce stored environment overrides into a consistent string map.
function decodeIntegrationEnvironment(value: unknown): Record<string, string> {
    const candidate = parseNullableJson(value);
    return toEnvMap(candidate);
}

// Interpret stored data as JSON, supporting raw strings, serialized JSON, or base64 blobs.
function parseNullableJson(value: unknown) {
    if (value === undefined || value === null) {
        return null;
    }

    if (Array.isArray(value) || isRecord(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = parseSafeJson(value);
        if (parsed !== null) {
            return parsed;
        }
        return tryDecodeBase64Json(value);
    }

    return null;
}

// Attempt to base64-decode a string and parse it as JSON.
function tryDecodeBase64Json(value: string) {
    try {
        const decoded =
            typeof window !== "undefined" && typeof window.atob === "function"
                ? window.atob(value)
                : typeof Buffer !== "undefined"
                    ? Buffer.from(value, "base64").toString("utf-8")
                    : value;
        return parseSafeJson(decoded);
    } catch {
        return null;
    }
}

// Convert heterogeneous values into stringified environment key/value pairs.
function toEnvMap(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {} as Record<string, string>;
    }

    const entries = raw as Record<string, unknown>;
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(entries)) {
        if (value === undefined || value === null) {
            continue;
        }
        if (typeof value === "string") {
            result[key] = value;
            continue;
        }
        if (typeof value === "number" || typeof value === "boolean") {
            result[key] = value.toString();
            continue;
        }

        try {
            result[key] = JSON.stringify(value);
        } catch {
            result[key] = String(value);
        }
    }

    return result;
}