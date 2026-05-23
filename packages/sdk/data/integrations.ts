import { Buffer } from "buffer";
import { defaultIntegrationsManifest } from "@dashwise/assets";
import { ApiActionError } from "@dashwise/sdk/data/auth";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import { decodeBase64Json, parseNullableJson, tryParseJson, tryParseYaml } from "@dashwise/sdk/lib/parseHelpers";
import { getEndpointCurl } from "@dashwise/integrationskit/data/getEndpointData";
import { resolveIntegrationRuntimeProperties } from "@dashwise/integrationskit/data/resolveProperties";
import config from "../lib/config";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const TOKEN_REGEX = /\$\{([A-Za-z0-9_]+)\}/g;
const UNRESOLVED_TOKEN_REGEX = /\$\{[A-Za-z0-9_]+\}/;
const METHOD_WITHOUT_BODY = new Set(["GET", "HEAD"]);

type IntegrationRecord = {
    id: string;
    type?: "plugin" | "caldav";
    name: string | null;
    source: string | null;
    userId: string | null;
    config: Record<string, unknown>;
    environment: Record<string, string>;
    localData: Record<string, unknown>;
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

type BuiltinSeed = {
    source: string;
    name: string | null;
    config: Record<string, unknown>;
    defaultEnv: Record<string, unknown>;
};

export type CreateIntegrationPayload = {
    type?: "plugin" | "caldav";
    name?: string;
    source?: string;
    config: unknown;
    environment?: unknown;
};

// ---------------------------------------------------------------------------
// Built-in integration loading (cached)
// ---------------------------------------------------------------------------

const builtinManifest = isPlainObject(defaultIntegrationsManifest)
    ? (defaultIntegrationsManifest as Record<string, { source: string; defaultEnv?: Record<string, unknown> }>)
    : {};

let builtinSeedsPromise: Promise<BuiltinSeed[]> | null = null;

function loadBuiltinSeeds(): Promise<BuiltinSeed[]> {
    if (!builtinSeedsPromise) {
        builtinSeedsPromise = Promise.all(
            Object.values(builtinManifest).map(async (entry) => {
                if (!entry?.source?.trim()) return null;
                const cfg = await fetchBuiltinConfig(entry.source);
                if (!cfg) return null;
                const details = isPlainObject(cfg.details) ? cfg.details as Record<string, unknown> : {};
                const name = typeof details.name === "string" ? details.name.trim() || null : null;
                return {
                    source: entry.source,
                    name,
                    config: cfg,
                    defaultEnv: isPlainObject(entry.defaultEnv) ? entry.defaultEnv : {},
                } satisfies BuiltinSeed;
            }),
        ).then((entries) => entries.filter((e): e is BuiltinSeed => Boolean(e)));
    }
    return builtinSeedsPromise;
}

async function fetchBuiltinConfig(source: string): Promise<Record<string, unknown> | null> {
    try {
        const response = await fetch(new URL(source, config.app_base_url).toString());
        if (!response.ok) return null;
        const parsed = tryParseYaml(await response.text());
        return isPlainObject(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

async function getBuiltinSeedBySource(source: string) {
    const seeds = await loadBuiltinSeeds();
    return seeds.find((s) => s.source === source) ?? null;
}

// ---------------------------------------------------------------------------
// Public CRUD
// ---------------------------------------------------------------------------

export async function listIntegrations(userId: string) {
    const pb = await getSuperuserPB();
    await ensureBuiltinIntegrations(userId, pb);
    const list = await pb.collection("integrations").getFullList({
        filter: `user="${userId}"`,
        sort: "-updated",
    });
    return { integrations: list.map(mapIntegration) };
}

export async function getIntegration(userId: string, integrationId: string, resolveEndpoints = false) {
    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);
    if (!ownsIntegration(record, userId)) throw new ApiActionError("Not found", 404, { error: "Not found" });

    const integration = mapIntegration(record);
    if (!resolveEndpoints) return { integration };

    integration.environment = await resolveEnvVarsViaEndpoints(
        integration.id, integration.config, integration.environment, pb,
    );

    const envMap = buildEnvMap(integration.config, integration.environment);
    const resolvedEndpoints = buildResolvedEndpoints(integration.config, integration.environment);

    const runtimeProperties = await resolveIntegrationRuntimeProperties({
        integrationJSON: integration.config,
        env: envMap,
        isPreview: false,
        allowInsecureEndpoints: config.allowInsecureCertsForIntegrationUrls,
    });

    const resolvedEndpointsWithData = resolvedEndpoints.map((ep) => {
        const key = ep.id ?? ep.name ?? "";
        return { ...ep, response: (key ? runtimeProperties.endpoints[key] : null) ?? null };
    });

    const resolvedComputed = runtimeProperties.computed ?? {};
    return {
        integration,
        resolvedEndpoints: resolvedEndpointsWithData,
        resolvedComputed: Object.keys(resolvedComputed).length > 0 ? resolvedComputed : undefined,
    };
}

export async function createIntegration(userId: string, payload: CreateIntegrationPayload) {
    const pb = await getSuperuserPB();
    const createData: Record<string, unknown> = {
        name: typeof payload.name === "string" ? payload.name.trim() || null : null,
        source: typeof payload.source === "string" ? payload.source : "manual",
        config: normalizeConfig(payload.config),
        environment: encodeEnvironment(payload.environment),
        user: userId,
    };
    if (payload.type === "caldav" || payload.type === "plugin") createData.type = payload.type;
    return { integration: mapIntegration(await pb.collection("integrations").create(createData)) };
}

export async function updateIntegration(
    userId: string,
    integrationId: string,
    payload: Partial<CreateIntegrationPayload> & { localData?: any },
) {
    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);
    if (!ownsIntegration(record, userId)) throw new ApiActionError("Not found", 404, { error: "Not found" });

    const updateData: Record<string, unknown> = {};
    if (payload.name !== undefined) updateData.name = payload.name;
    if (payload.config !== undefined) updateData.config = normalizeConfig(payload.config);
    if (payload.environment !== undefined) updateData.environment = encodeEnvironment(payload.environment);
    if (payload.localData !== undefined) updateData.localData = payload.localData;

    return { integration: mapIntegration(await pb.collection("integrations").update(integrationId, updateData)) };
}

export async function deleteIntegration(userId: string, integrationId: string) {
    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);
    if (!ownsIntegration(record, userId)) throw new ApiActionError("Not found", 404, { error: "Not found" });
    await pb.collection("integrations").delete(integrationId);
    return { success: true };
}

// ---------------------------------------------------------------------------
// Endpoint testing
// ---------------------------------------------------------------------------

export async function testIntegrationEndpoint(userId: string, rawTarget: string) {
    if (!rawTarget) throw new ApiActionError("Missing target", 400, { error: "Missing target" });

    const dotIndex = rawTarget.indexOf(".");
    if (dotIndex <= 0 || dotIndex === rawTarget.length - 1) {
        throw new ApiActionError("Invalid target format", 400, { error: "Invalid target format" });
    }

    const integrationId = rawTarget.slice(0, dotIndex);
    const endpointKey = rawTarget.slice(dotIndex + 1);

    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);
    if (!ownsIntegration(record, userId)) throw new ApiActionError("Not found", 404, { error: "Not found" });

    const integration = mapIntegration(record);
    integration.environment = await resolveEnvVarsViaEndpoints(
        integration.id, integration.config, integration.environment, pb, endpointKey,
    );

    const endpoint = buildResolvedEndpoints(integration.config, integration.environment)
        .find((ep) => ep.id === endpointKey || ep.name === endpointKey);
    if (!endpoint) throw new ApiActionError("Endpoint not found", 404, { error: "Endpoint not found" });

    const envMap = buildEnvMap(integration.config, integration.environment);
    const req = prepareRequest(endpoint, envMap, false);
    if (!req.url) throw new ApiActionError("Endpoint URL is empty", 400, { error: "Endpoint URL is empty" });

    console.log(`[Integrations] Endpoint test cURL (${integrationId}.${endpointKey}): ${getEndpointCurl({
        url: req.url, method: req.method, headers: req.headers, body: req.body,
    })}`);

    const tc = makeTimeoutController(req.timeoutMs);
    try {
        const response = await fetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.body,
            signal: tc.signal,
            ...(tlsOptions(req.allowInsecureSsl, req.url) as any),
        } as any);

        const rawBody = await response.text();
        const parsedBody = tryParseJson(rawBody);

        const epConfig = findEndpointConfig(integration.config, endpointKey);
        const directive = epConfig?.response as Record<string, unknown> | undefined;
        const dataSetEnv = typeof directive?.data_set_env === "string" ? directive.data_set_env : null;
        const dataPath = typeof directive?.data_path === "string" ? directive.data_path : undefined;

        if (dataSetEnv && parsedBody != null) {
            const value = extractValueAtPath(parsedBody, dataPath);
            if (value != null) {
                const formatted = formatEnvValue(value);
                if (integration.environment[dataSetEnv] !== formatted) {
                    await pb.collection("integrations").update(integrationId, {
                        environment: encodeEnvironment({ ...integration.environment, [dataSetEnv]: formatted }),
                    });
                }
            }
        }

        return {
            integration: { id: integration.id, name: integration.name },
            endpoint: { id: endpoint.id, name: endpoint.name, description: endpoint.description, method: req.method, url: req.url },
            request: { url: req.url, method: req.method, headers: req.headers, body: req.body },
            response: {
                status: response.status,
                statusText: response.statusText,
                headers: headersToObject(response.headers),
                body: rawBody,
                parsedBody,
            },
        };
    } finally {
        tc.clear();
    }
}

// ---------------------------------------------------------------------------
// Widget / glanceable lookups
// ---------------------------------------------------------------------------

export async function getWidgetProperties(userId: string, widgetSlug: string) {
    if (!widgetSlug?.trim()) throw new ApiActionError("Missing widget slug", 400, { error: "Missing widget slug" });
    const slug = widgetSlug.trim().toLowerCase();
    const { integrations } = await listIntegrations(userId);

    for (const integration of integrations) {
        const widgets = (integration.config?.configuration as Record<string, unknown> | undefined)?.widgets;
        if (!Array.isArray(widgets)) continue;
        for (const w of widgets) {
            if (!isPlainObject(w)) continue;
            const id = resolveWidgetId(w);
            if (id?.toLowerCase() === slug) return { widget: { ...w, slug: id }, integration: { id: integration.id, name: integration.name } };
        }
    }
    return { widget: null, integration: null };
}

export async function getIntegrationWithConsumer(userId: string, options: { widgetKey?: string; glanceableType?: string }) {
    const widgetKey = options.widgetKey?.trim() ?? "";
    const glanceableType = options.glanceableType?.trim() ?? "";

    if (widgetKey && glanceableType) throw new ApiActionError("Provide only one consumer key", 400, { error: "Provide only one consumer key" });
    if (!widgetKey && !glanceableType) throw new ApiActionError("Missing consumer key", 400, { error: "Missing consumer key" });

    const { integrations } = await listIntegrations(userId);

    for (const record of integrations) {
        const integration = mapIntegration(record);
        const seed = integration.source ? await getBuiltinSeedBySource(integration.source) : null;
        const cfg = seed?.config ?? integration.config;
        const configuration = cfg?.configuration as Record<string, unknown> | undefined;

        const collection = widgetKey ? "widgets" : "glanceables";
        const items = configuration?.[collection];
        if (!Array.isArray(items)) continue;

        const envDefs = isPlainObject(configuration?.environment_variables)
            ? (configuration.environment_variables as Record<string, { default?: string }>)
            : null;
        const envVars = envDefs
            ? resolveEnvironmentVariables(envDefs, integration.environment)
            : null;

        for (const item of items) {
            if (!isPlainObject(item)) continue;

            const matches = widgetKey
                ? item.key === widgetKey
                : (() => {
                    const t = resolveGlanceableId(item);
                    return t !== null && t.toLowerCase() === glanceableType.toLowerCase();
                })();

            if (!matches) continue;

            const sharedIntegration = {
                ...cfg,
                configuration: { ...configuration, environment_variables: envVars ?? {} },
            };

            if (widgetKey) {
                return {
                    integrationId: integration.id,
                    integration: sharedIntegration,
                    environmentDefinitions: envDefs,
                    widgetJSON: { ...item, key: resolveWidgetId(item) },
                    localData: integration.localData,
                };
            } else {
                return {
                    integrationId: integration.id,
                    integration: sharedIntegration,
                    environmentDefinitions: envDefs,
                    glanceableJSON: { ...item, type: resolveGlanceableId(item) },
                    localData: integration.localData,
                };
            }
        }
    }

    return widgetKey
        ? { integrationId: null, integration: null, widgetJSON: null, localData: null }
        : { integrationId: null, integration: null, glanceableJSON: null, localData: null };
}

// ---------------------------------------------------------------------------
// Built-in integration seeding
// ---------------------------------------------------------------------------

async function ensureBuiltinIntegrations(userId: string, pb: Awaited<ReturnType<typeof getSuperuserPB>>) {
    const seeds = await loadBuiltinSeeds();
    if (seeds.length === 0) return;

    const existing = await pb.collection("integrations").getFullList({ filter: `user="${escapeFilter(userId)}"` });

    for (const seed of seeds) {
        // Try matching by source first (most specific)
        const matchBySource = existing.find((r) => r.source === seed.source);

        if (matchBySource) {
            const normalized = normalizeConfig(matchBySource.config);
            const hydrated = Array.isArray(
                (normalized?.configuration as Record<string, unknown> | undefined)?.widgets
            ) || Array.isArray(
                (normalized?.configuration as Record<string, unknown> | undefined)?.glanceables
            );
            if (!hydrated) {
                await pb.collection("integrations").update(matchBySource.id, {
                    name: seed.name,
                    source: seed.source,
                    config: normalizeConfig(seed.config),
                    environment: encodeEnvironment(seed.defaultEnv),
                });
            }
        } else {
            // If no source match, check if an integration with the same name already exists
            if (seed.name) {
                const matchByName = existing.find((r) => r.name === seed.name);
                if (matchByName) {
                    continue;
                }
            }

            await pb.collection("integrations").create({
                user: userId,
                name: seed.name,
                source: seed.source,
                config: normalizeConfig(seed.config),
                environment: encodeEnvironment(seed.defaultEnv),
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Env var resolution via provider endpoints
// ---------------------------------------------------------------------------

async function resolveEnvVarsViaEndpoints(
    integrationId: string,
    config: Record<string, unknown>,
    environment: Record<string, string>,
    pb: Awaited<ReturnType<typeof getSuperuserPB>>,
    skipEndpointKey?: string,
): Promise<Record<string, string>> {
    const envMap = buildEnvMap(config, environment);

    const missingVars = new Set<string>(
        Object.entries(envMap).filter(([, v]) => !v?.trim()).map(([k]) => k),
    );
    for (const token of collectTokensFromEndpoints(config)) {
        if (!envMap[token]?.trim()) missingVars.add(token);
    }
    if (missingVars.size === 0) return environment;

    const providerEndpoints = normalizeEndpointList(config).filter((ep) => {
        const key = typeof ep.id === "string" ? ep.id : typeof ep.name === "string" ? ep.name : null;
        if (skipEndpointKey && key === skipEndpointKey) return false;
        const dataSetEnv = (ep.response as Record<string, unknown> | undefined)?.data_set_env;
        return typeof dataSetEnv === "string" && missingVars.has(dataSetEnv);
    });
    if (providerEndpoints.length === 0) return environment;

    let current = { ...environment };

    for (const epConfig of providerEndpoints) {
        const epKey = typeof epConfig.id === "string" ? epConfig.id : typeof epConfig.name === "string" ? epConfig.name : null;
        const directive = epConfig.response as Record<string, unknown> | undefined;
        const dataSetEnv = typeof directive?.data_set_env === "string" ? directive.data_set_env : null;
        const dataPath = typeof directive?.data_path === "string" ? directive.data_path : undefined;
        if (!dataSetEnv) continue;

        const currentEnvMap = buildEnvMap(config, current);
        const [resolvedEp] = buildResolvedEndpointList([epConfig], currentEnvMap);
        if (!resolvedEp) continue;

        const req = prepareRequest(resolvedEp, currentEnvMap, true);
        if (!req.url || UNRESOLVED_TOKEN_REGEX.test(req.url)) {
            console.warn(`[Integrations] Skipping provider endpoint "${epKey}" — unresolved tokens in URL: ${req.url}`);
            continue;
        }

        console.log(`[Integrations] Fetching provider endpoint "${epKey}" to resolve env var "${dataSetEnv}"`);

        try {
            const tc = makeTimeoutController(req.timeoutMs);
            let responseBody: string;
            try {
                const response = await fetch(req.url, {
                    method: req.method, headers: req.headers, body: req.body,
                    signal: tc.signal,
                    ...(tlsOptions(req.allowInsecureSsl, req.url) as any),
                } as any);
                if (!response.ok) { console.warn(`[Integrations] Provider "${epKey}" returned HTTP ${response.status} — skipping`); continue; }
                responseBody = await response.text();
            } finally {
                tc.clear();
            }

            const parsedBody = tryParseJson(responseBody);
            if (parsedBody === null && responseBody.trim()) { console.warn(`[Integrations] Provider "${epKey}" non-JSON response — skipping`); continue; }

            const value = extractValueAtPath(parsedBody, dataPath);
            if (value == null) { console.warn(`[Integrations] Provider "${epKey}" missing value at path "${dataPath ?? "(root)"}" — skipping`); continue; }

            const formatted = formatEnvValue(value);
            if (current[dataSetEnv] !== formatted) {
                current = { ...current, [dataSetEnv]: formatted };
                await pb.collection("integrations").update(integrationId, { environment: encodeEnvironment(current) });
                console.log(`[Integrations] Resolved env var "${dataSetEnv}" via endpoint "${epKey}"`);
            }
            missingVars.delete(dataSetEnv);
        } catch (err) {
            console.warn(`[Integrations] Failed to fetch provider endpoint "${epKey}":`, err);
        }
    }

    return current;
}

// ---------------------------------------------------------------------------
// Endpoint resolution
// ---------------------------------------------------------------------------

export function buildResolvedEndpoints(config: Record<string, unknown>, environment: Record<string, string>): ResolvedEndpoint[] {
    return buildResolvedEndpointList(normalizeEndpointList(config), buildEnvMap(config, environment));
}

function buildResolvedEndpointList(endpoints: Record<string, unknown>[], envMap: Record<string, string>): ResolvedEndpoint[] {
    return endpoints.map((ep) => {
        const method = typeof ep.method === "string" ? ep.method : "GET";
        const rawHeaders = { ...(isPlainObject(ep.headers) ? ep.headers : {}), ...(isPlainObject(ep.custom_headers) ? ep.custom_headers : {}) };
        const resolvedHeadersRaw = resolveValue(rawHeaders, envMap);
        const resolvedHeaders = isPlainObject(resolvedHeadersRaw)
            ? Object.fromEntries(Object.entries(resolvedHeadersRaw).map(([k, v]) => [k, v == null ? "" : String(v)]))
            : {};

        const authFromHeader = Object.entries(resolvedHeaders).find(([k]) => k.toLowerCase() === "authorization")?.[1] ?? null;
        const interpolatedAuth = interpolate(typeof ep.auth === "string" ? ep.auth : "", envMap);
        const resolvedAuth = interpolatedAuth || authFromHeader || "";

        return {
            id: typeof ep.id === "string" ? ep.id : (ep.name as string) ?? null,
            name: typeof ep.name === "string" ? ep.name : null,
            description: typeof ep.description === "string" ? ep.description : null,
            method,
            url: typeof ep.url === "string" ? ep.url : "",
            auth: typeof ep.auth === "string" ? ep.auth : "",
            allow_insecure_ssl: ep.allow_insecure_ssl ?? (ep as any).insecure_skip_verify ?? (ep as any).allowInsecureSSL,
            timeout: ep.timeout != null ? ep.timeout as number | string : null,
            body: ep.body ?? null,
            custom_headers: (ep.custom_headers as Record<string, unknown>) ?? {},
            response_body_types: (ep.response_body_types as Record<string, unknown>) ?? {},
            response_mappings: Array.isArray((ep as any).response_mappings)
                ? (ep as any).response_mappings
                : isPlainObject((ep as any).response_mapping) ? [(ep as any).response_mapping] : [],
            resolvedUrl: interpolate(typeof ep.url === "string" ? ep.url : "", envMap),
            resolvedAuth,
            resolvedHeaders,
            resolvedBody: resolveValue(ep.body ?? null, envMap),
        };
    });
}

type PreparedRequest = {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
    timeoutMs: number;
    allowInsecureSsl: unknown;
};

function prepareRequest(ep: ResolvedEndpoint, envMap: Record<string, string>, isProvider: boolean): PreparedRequest {
    const method = (ep.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};

    for (const [k, v] of Object.entries(ep.resolvedHeaders ?? {})) {
        headers[k] = interpolate(String(v ?? ""), envMap);
    }

    const resolvedAuth = interpolate(ep.resolvedAuth || ep.auth || "", envMap);
    const authKey = Object.keys(headers).find((k) => k.toLowerCase() === "authorization");

    if (isProvider) {
        if (!authKey && resolvedAuth && !UNRESOLVED_TOKEN_REGEX.test(resolvedAuth)) {
            headers.Authorization = resolvedAuth;
        }
    } else {
        if (!authKey && resolvedAuth) {
            headers.Authorization = resolvedAuth;
        } else if (authKey && UNRESOLVED_TOKEN_REGEX.test(headers[authKey]) && resolvedAuth) {
            headers[authKey] = resolvedAuth;
        }
    }

    let body: string | null = null;
    if (!METHOD_WITHOUT_BODY.has(method) && ep.resolvedBody != null) {
        body = typeof ep.resolvedBody === "string" ? ep.resolvedBody : JSON.stringify(ep.resolvedBody);
        if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
            headers["content-type"] = "application/json";
        }
    }

    return {
        method,
        url: ep.resolvedUrl || ep.url || "",
        headers,
        body,
        timeoutMs: parseTimeout(ep.timeout),
        allowInsecureSsl: ep.allow_insecure_ssl ?? (ep as any).insecure_skip_verify ?? (ep as any).allowInsecureSSL,
    };
}

// ---------------------------------------------------------------------------
// Env map helpers
// ---------------------------------------------------------------------------

function buildEnvMap(config: Record<string, unknown>, stored: Record<string, string>): Record<string, string> {
    const envDef = (config.configuration as Record<string, unknown>)?.environment_variables;
    const defaults: Record<string, string> = {};

    if (Array.isArray(envDef)) {
        for (const item of envDef) {
            const key = typeof item?.key === "string" ? item.key : null;
            if (!key) continue;
            const fallback = item?.testValue ?? item?.test_value ?? item?.default;
            if (fallback != null) defaults[key] = typeof fallback === "string" ? fallback : JSON.stringify(fallback);
        }
    } else if (isPlainObject(envDef)) {
        for (const [key, def] of Object.entries(envDef)) {
            const d = def as Record<string, unknown>;
            const fallback = d.test_value ?? d.testValue ?? d.default;
            if (fallback != null) defaults[key] = typeof fallback === "string" ? fallback : JSON.stringify(fallback);
        }
    }

    return { ...defaults, ...stored };
}

function resolveEnvironmentVariables(
    envDefs: Record<string, { default?: string }>,
    rawEnv: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [name, def] of Object.entries(envDefs)) {
        const current = rawEnv[name];
        result[name] = current?.length ? current : def.default ?? "";
    }
    return result;
}

// ---------------------------------------------------------------------------
// Config / environment encoding
// ---------------------------------------------------------------------------

function normalizeConfig(value: unknown): Record<string, unknown> {
    if (isPlainObject(value)) return value;
    if (typeof value !== "string") return {};
    const asJson = tryParseJson(value);
    if (isPlainObject(asJson)) return asJson;
    const asYaml = tryParseYaml(value);
    if (isPlainObject(asYaml)) return asYaml;
    try {
        const decoded = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
        if (isPlainObject(decoded)) return decoded;
    } catch {}
    return {};
}

export function encodeEnvironment(value: unknown): string {
    if (typeof value === "string" && value.trim()) return value;
    return Buffer.from(JSON.stringify(isPlainObject(value) ? value : value ?? {})).toString("base64");
}

function decodeEnvironment(raw: unknown): Record<string, string> {
    const obj = parseNullableJson(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (v == null) continue;
        result[k] = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Endpoint config helpers
// ---------------------------------------------------------------------------

function normalizeEndpointList(config: Record<string, unknown>): Record<string, unknown>[] {
    const raw = (config?.configuration as Record<string, unknown>)?.endpoints;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (isPlainObject(raw)) {
        return Object.entries(raw).map(([k, v]) => ({ id: k, ...(isPlainObject(v) ? v : {}) }));
    }
    return [];
}

function findEndpointConfig(config: Record<string, unknown>, key: string): Record<string, unknown> | null {
    if (!key) return null;
    return normalizeEndpointList(config).find((ep) => ep.id === key || ep.name === key) ?? null;
}

function collectTokensFromEndpoints(config: Record<string, unknown>): Set<string> {
    const tokens = new Set<string>();
    for (const ep of normalizeEndpointList(config)) {
        const sources = [ep.url, ep.auth, JSON.stringify(ep.body ?? ""), JSON.stringify(ep.headers ?? ""), JSON.stringify(ep.custom_headers ?? "")];
        for (const s of sources) {
            if (typeof s !== "string") continue;
            for (const m of s.matchAll(new RegExp(TOKEN_REGEX.source, "g"))) {
                if (m[1]) tokens.add(m[1]);
            }
        }
    }
    return tokens;
}

// ---------------------------------------------------------------------------
// Value interpolation
// ---------------------------------------------------------------------------

function resolveValue(value: unknown, envMap: Record<string, string>): unknown {
    if (value == null) return value;
    if (typeof value === "string") return resolveString(value, envMap);
    if (Array.isArray(value)) return value.map((v) => resolveValue(v, envMap));
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, envMap)]));
    }
    return value;
}

function resolveString(template: string, envMap: Record<string, string>): unknown {
    const sep = template.indexOf("???");
    if (sep === -1) return maybeParse(interpolate(template, envMap));
    const primary = interpolate(template.slice(0, sep).trim(), envMap).trim();
    if (primary && !primary.includes("${")) return maybeParse(primary);
    return maybeParse(interpolate(template.slice(sep + 3).trim(), envMap).trim());
}

function interpolate(template: string, envMap: Record<string, string>): string {
    return template.replace(TOKEN_REGEX, (match, token) => {
        for (const key of [token, token.toUpperCase(), token.toLowerCase()]) {
            if (key in envMap) return envMap[key];
        }
        return match;
    });
}

function maybeParse(value: string): unknown {
    const t = value.trim();
    if (!t || (!t.startsWith("{") && !t.startsWith("["))) return value;
    try { return JSON.parse(t); } catch { return value; }
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function mapIntegration(record: any): IntegrationRecord {
    return {
        id: record.id,
        type: record.type === "plugin" || record.type === "caldav" ? record.type : undefined,
        name: typeof record.name === "string" ? record.name : null,
        source: typeof record.source === "string" ? record.source : null,
        userId: typeof record.user === "string" ? record.user : record.user?.id ?? null,
        config: normalizeConfig(record.config),
        environment: decodeEnvironment(record.environment),
        localData: (() => { const r = parseNullableJson(record.localData); return isPlainObject(r) ? r : {}; })(),
        created: record.created,
        updated: record.updated,
    };
}

function ownsIntegration(record: any, userId: string): boolean {
    if (!record) return false;
    return typeof record.user === "string" ? record.user === userId : record.user?.id === userId;
}

function resolveWidgetId(w: Record<string, unknown>): string | null {
    if (typeof w.key === "string" && w.key.trim()) return w.key.trim();
    if (typeof w.slug === "string" && w.slug.trim()) return w.slug.trim();
    const name = typeof w.name === "string" ? w.name : null;
    return name ? name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || null : null;
}

function resolveGlanceableId(g: Record<string, unknown>): string | null {
    if (typeof g.type === "string" && g.type.trim()) return g.type.trim();
    if (typeof g.slug === "string" && g.slug.trim()) return g.slug.trim();
    const name = typeof g.name === "string" ? g.name : typeof g.displayName === "string" ? g.displayName : null;
    return name ? name.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || null : null;
}

function extractValueAtPath(body: unknown, path?: string): unknown {
    if (!path) return body;
    let current: unknown = body;
    for (const segment of path.split(".").filter(Boolean)) {
        if (current == null) return undefined;
        if (Array.isArray(current)) {
            const i = parseInt(segment, 10);
            if (isNaN(i)) return undefined;
            current = current[i];
        } else if (typeof current === "object") {
            current = (current as Record<string, unknown>)[segment];
        } else {
            return undefined;
        }
    }
    return current;
}

function formatEnvValue(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try { return JSON.stringify(value); } catch { return String(value); }
}

function headersToObject(headers: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (headers && typeof headers === "object" && "entries" in headers) {
        for (const [k, v] of (headers as { entries(): IterableIterator<[string, string]> }).entries()) result[k] = v;
        return result;
    }
    for (const [k, v] of Object.entries(headers ?? {})) {
        if (v == null) continue;
        result[k] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    return result;
}

function tlsOptions(allowInsecureSsl: unknown, url: string) {
    const allow = typeof allowInsecureSsl === "string"
        ? ["true", "1", "yes", "on"].includes(allowInsecureSsl.trim().toLowerCase())
        : Boolean(allowInsecureSsl);
    return allow && url.startsWith("https://") ? { tls: { rejectUnauthorized: false } } : {};
}

function makeTimeoutController(ms: number) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, clear: () => clearTimeout(t) };
}

function parseTimeout(timeout: unknown): number {
    const n = Number(timeout);
    return Number.isFinite(n) && n > 0 ? n : 20_000;
}

function escapeFilter(value: string): string {
    return value.replace(/"/g, '\\"');
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}