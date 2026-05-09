import { Buffer } from "buffer";
import YAML from "yaml";
import fs from "fs/promises";
import path from "path";
import { defaultIntegrationsBlueprint, weatherIntegrationBlueprint } from "@dashwise/assets";
import { ApiActionError } from "@dashwise/sdk/data/auth";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";
import { resolveIntegrationRuntimeProperties } from "@dashwise/integrationskit/data/resolveProperties";
import config from "lib/config";

const ENDPOINT_TOKEN_REGEX = /\$\{([A-Za-z0-9_]+)\}/g;
const METHOD_WITHOUT_BODY = new Set(["GET", "HEAD"]);
const UNRESOLVED_TOKEN_REGEX = /\$\{[A-Za-z0-9_]+\}/;

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

export type CreateIntegrationPayload = {
    type?: "plugin" | "caldav";
    name?: string;
    source?: string;
    config: unknown;
    environment?: unknown;
};

export async function listIntegrations(userId: string) {
    const pb = await getSuperuserPB();
    const list = await pb.collection("integrations").getFullList({
        filter: `user="${userId}"`,
        sort: "-updated",
    });

    const builtinConfigs = [
        {
            id: "builtin:default",
            config: defaultIntegrationsBlueprint,
        },
        {
            id: "builtin:weather",
            config: weatherIntegrationBlueprint,
        },
    ];

    const builtinRecords = (
        await Promise.all(
            builtinConfigs.map(async (b) => ({
                id: b.id,
                name: typeof b.config?.details?.name === "string"
                    ? b.config.details.name
                    : null,
                source: "builtin",
                user: null,
                config: b.config,
                environment: {},
                created: null,
                updated: null,
            })),
        )
    ).filter(Boolean as any) as any[];

    const combined = [...list, ...builtinRecords];

    return { integrations: combined.map(mapIntegration) };
}

export async function getIntegration(
    userId: string,
    integrationId: string,
    resolveEndpoints = false,
) {
    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);

    if (!ownsIntegration(record, userId)) {
        throw new ApiActionError("Not found", 404, { error: "Not found" });
    }

    const integration = mapIntegration(record);
    if (!resolveEndpoints) {
        return { integration };
    }

    const hydratedEnvironment = await resolveEnvVarsViaEndpoints(
        integration.id,
        integration.config,
        integration.environment,
        pb,
    );
    integration.environment = hydratedEnvironment;

    const envMap = buildEnvValueMap(integration.config, integration.environment);
    const resolvedEndpoints = buildResolvedEndpoints(
        integration.config,
        integration.environment,
    );

    const runtimeProperties = await resolveIntegrationRuntimeProperties({
        integrationJSON: integration.config,
        env: envMap,
        isPreview: false,
        allowInsecureEndpoints: config.allowInsecureCertsForIntegrationUrls,
    });

    const resolvedEndpointsWithData = resolvedEndpoints.map((ep) => {
        const key = ep.id ?? ep.name ?? "";
        const response = key ? runtimeProperties.endpoints[key] : null;
        return {
            ...ep,
            response: response ?? null,
        };
    });

    const resolvedComputed = runtimeProperties.computed ?? {};

    return {
        integration,
        resolvedEndpoints: resolvedEndpointsWithData,
        resolvedComputed: Object.keys(resolvedComputed).length > 0
            ? resolvedComputed
            : undefined,
    };
}

export async function createIntegration(
    userId: string,
    payload: CreateIntegrationPayload,
) {
    const pb = await getSuperuserPB();

    const createData: Record<string, unknown> = {
        name: typeof payload.name === "string"
            ? payload.name.trim() || null
            : null,
        source: typeof payload.source === "string" ? payload.source : "manual",
        config: normalizeConfig(payload.config),
        environment: encodeEnvironment(payload.environment),
        user: userId,
    };

    if (payload.type === "caldav" || payload.type === "plugin") {
        createData.type = payload.type;
    }

    const record = await pb.collection("integrations").create(createData);

    return { integration: mapIntegration(record) };
}

export async function updateIntegration(
    userId: string,
    integrationId: string,
    payload: Partial<CreateIntegrationPayload> & { localData?: any },
) {
    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);

    if (!ownsIntegration(record, userId)) {
        throw new ApiActionError("Not found", 404, { error: "Not found" });
    }

    const updateData: Record<string, unknown> = {};
    if (payload.name !== undefined) updateData.name = payload.name;
    if (payload.config !== undefined) updateData.config = normalizeConfig(payload.config);
    if (payload.environment !== undefined) updateData.environment = encodeEnvironment(payload.environment);
    if (payload.localData !== undefined) updateData.localData = payload.localData;

    const updated = await pb.collection("integrations").update(integrationId, updateData);

    return { integration: mapIntegration(updated) };
}


export async function testIntegrationEndpoint(
    userId: string,
    rawTarget: string,
) {
    if (!rawTarget) {
        throw new ApiActionError("Missing target", 400, {
            error: "Missing target",
        });
    }

    const dotIndex = rawTarget.indexOf(".");
    if (dotIndex <= 0 || dotIndex === rawTarget.length - 1) {
        throw new ApiActionError("Invalid target format", 400, {
            error: "Invalid target format",
        });
    }

    const integrationId = rawTarget.slice(0, dotIndex);
    const endpointKey = rawTarget.slice(dotIndex + 1);

    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);

    if (!ownsIntegration(record, userId)) {
        throw new ApiActionError("Not found", 404, { error: "Not found" });
    }

    const integration = mapIntegration(record);

    // Ensure all env vars that can be provided by an endpoint are resolved
    // before we attempt to call the target endpoint.
    integration.environment = await resolveEnvVarsViaEndpoints(
        integration.id,
        integration.config,
        integration.environment,
        pb,
        endpointKey, // skip this key — it's the one we're about to test
    );

    const resolvedEndpoints = buildResolvedEndpoints(
        integration.config,
        integration.environment,
    );
   
    const endpoint = resolvedEndpoints.find(
        (candidate) =>
            candidate.id === endpointKey || candidate.name === endpointKey,
    );

    if (!endpoint) {
        throw new ApiActionError("Endpoint not found", 404, {
            error: "Endpoint not found",
        });
    }

    const resolvedUrl = endpoint.resolvedUrl || endpoint.url;
    if (!resolvedUrl) {
        throw new ApiActionError("Endpoint URL is empty", 400, {
            error: "Endpoint URL is empty",
        });
    }

    const method = (typeof endpoint.method === "string" ? endpoint.method : "GET").toUpperCase();
    const allowBody = !METHOD_WITHOUT_BODY.has(method);
    const envMap = buildEnvValueMap(integration.config, integration.environment);

    const requestHeaders: Record<string, string> = {
        ...(endpoint.resolvedHeaders ?? {}),
    };
    for (const [key, value] of Object.entries(requestHeaders)) {
        requestHeaders[key] = interpolateString(String(value ?? ""), envMap);
    }

    const resolvedAuth = interpolateString(endpoint.resolvedAuth || endpoint.auth || "", envMap);
    const hasAuthorizationHeader = Object.keys(requestHeaders).some((key) => key.toLowerCase() === "authorization");
    if (!hasAuthorizationHeader && resolvedAuth) {
        requestHeaders.Authorization = resolvedAuth;
    }

    if (hasAuthorizationHeader) {
        const authHeaderKey = Object.keys(requestHeaders).find((key) => key.toLowerCase() === "authorization");
        if (authHeaderKey) {
            const existing = requestHeaders[authHeaderKey];
            if (UNRESOLVED_TOKEN_REGEX.test(existing) && resolvedAuth) {
                requestHeaders[authHeaderKey] = resolvedAuth;
            }
        }
    }

    let requestBody: string | null = null;
    if (allowBody && endpoint.resolvedBody !== null && endpoint.resolvedBody !== undefined) {
        requestBody = typeof endpoint.resolvedBody === "string"
            ? endpoint.resolvedBody
            : JSON.stringify(endpoint.resolvedBody);

        const hasContentType = Object.keys(requestHeaders).some((key) => key.toLowerCase() === "content-type");
        if (!hasContentType) {
            requestHeaders["content-type"] = "application/json";
        }
    }

    const curlCommand = buildCurlCommand({
        url: resolvedUrl,
        method,
        headers: requestHeaders,
        body: requestBody,
    });
    console.log(
        `[Integrations] Endpoint test cURL (${integrationId}.${endpointKey}): ${curlCommand}`,
    );

    const timeoutController = createTimeoutController(resolveTimeout(endpoint.timeout));

    try {
        const response = await fetch(resolvedUrl, {
            method,
            headers: requestHeaders,
            body: requestBody,
            signal: timeoutController.signal,
            ...(buildTlsOptions(
                endpoint.allow_insecure_ssl ??
                    (endpoint as any).insecure_skip_verify ??
                    (endpoint as any).allowInsecureSSL,
                resolvedUrl,
            ) as any),
        } as any);

        const rawResponseBody = await response.text();
        const parsedResponseBody = tryParseJson(rawResponseBody);

        const endpointConfig = findEndpointConfig(integration.config, endpointKey);
        const responseDirective = endpointConfig?.response as Record<string, unknown> | undefined;
        const dataSetEnv = typeof responseDirective?.data_set_env === "string"
            ? responseDirective.data_set_env
            : null;
        const dataPath = typeof responseDirective?.data_path === "string"
            ? responseDirective.data_path
            : undefined;

        if (dataSetEnv && parsedResponseBody !== null && parsedResponseBody !== undefined) {
            const resolvedValue = extractValueFromPath(parsedResponseBody, dataPath);
            if (resolvedValue !== undefined && resolvedValue !== null) {
                const formattedValue = formatEnvValue(resolvedValue);
                if (integration.environment[dataSetEnv] !== formattedValue) {
                    const updatedEnvironment = {
                        ...integration.environment,
                        [dataSetEnv]: formattedValue,
                    };
                    await pb.collection("integrations").update(integrationId, {
                        environment: encodeEnvironment(updatedEnvironment),
                    });
                }
            }
        }

        return {
            integration: { id: integration.id, name: integration.name },
            endpoint: {
                id: endpoint.id,
                name: endpoint.name,
                description: endpoint.description,
                method,
                url: resolvedUrl,
            },
            request: {
                url: resolvedUrl,
                method,
                headers: requestHeaders,
                body: requestBody,
            },
            response: {
                status: response.status,
                statusText: response.statusText,
                headers: toResponseHeaders(response.headers),
                body: rawResponseBody,
                parsedBody: parsedResponseBody,
            },
        };
    } finally {
        timeoutController.clear();
    }
}

export async function getWidgetProperties(userId: string, widgetSlug: string) {
    if (!widgetSlug || !widgetSlug.trim()) {
        throw new ApiActionError("Missing widget slug", 400, {
            error: "Missing widget slug",
        });
    }

    const normalizedSlug = widgetSlug.trim().toLowerCase();
    
    const { integrations } = await listIntegrations(userId);

    for (const integration of integrations) {
        const rawWidgets =
            (integration.config?.configuration as
                | Record<string, unknown>
                | undefined)?.widgets;
        if (!Array.isArray(rawWidgets) || rawWidgets.length === 0) {
            continue;
        }

        for (const rawWidget of rawWidgets) {
            if (!isPlainObject(rawWidget)) {
                continue;
            }

            const widgetSlugValue = resolveWidgetIdentifier(rawWidget);

            if (
                !widgetSlugValue ||
                widgetSlugValue.toLowerCase() !== normalizedSlug
            ) {
                continue;
            }

            return {
                widget: {
                    ...rawWidget,
                    slug: widgetSlugValue,
                },
                integration: {
                    id: integration.id,
                    name: integration.name,
                },
            };
        }
    }

    return { widget: null, integration: null };
}

function resolveEnvironmentVariables(
    envDefinitions:
        | Record<string, { default?: string }>
        | undefined
        | null,
    encodedValue: unknown,
) {
    if (!envDefinitions) return null;

    const decoded =
        typeof encodedValue === "string" && encodedValue.trim()
            ? decodeBase64Json<Record<string, string>>(encodedValue) ?? {}
            : isPlainObject(encodedValue)
              ? (encodedValue as Record<string, string>)
              : {};

    const resolved: Record<string, string> = {};

    for (const [name, definition] of Object.entries(envDefinitions)) {
        const currentValue = decoded[name];
        resolved[name] =
            typeof currentValue === "string" && currentValue.length > 0
                ? currentValue
                : definition.default ?? "";
    }

    return resolved;
}

export async function getIntegrationWithWidget(
    userId: string,
    widgetKey: string,
) {
    if (!widgetKey || !widgetKey.trim()) {
        throw new ApiActionError("Missing widget key", 400, {
            error: "Missing widget key",
        });
    }

    const integrations = await listIntegrations(userId);

    for (const record of integrations.integrations) {
        const integration = mapIntegration(record);
        const rawWidgets =
            (integration.config?.configuration as
                | Record<string, unknown>
                | undefined)?.widgets;

        if (!Array.isArray(rawWidgets) || rawWidgets.length === 0) {
            continue;
        }

        for (const rawWidget of rawWidgets) {
            if (!isPlainObject(rawWidget)) {
                continue;
            }

            if (rawWidget.key !== widgetKey) {
                continue;
            }

            const resolvedKey = resolveWidgetIdentifier(rawWidget);

            const config = integration.config;
            const configuration = config?.configuration as
                | Record<string, unknown>
                | undefined;
            const environmentDefinitions = isPlainObject(configuration?.environment_variables)
                ? (configuration?.environment_variables as Record<string, unknown>)
                : null;

            const environmentVariables = resolveEnvironmentVariables(
                configuration?.environment_variables as
                    | Record<string, { default?: string }>
                    | undefined,
                integration?.environment,
            );

            return {
                integrationId: integration.id,
                integration: {
                    ...config,
                    configuration: {
                        ...configuration,
                        environment_variables: environmentVariables,
                    },
                },
                environmentDefinitions,
                widgetJSON: {
                    ...rawWidget,
                    key: resolvedKey,
                },
                localData: integration.localData,
            };
        }
    }

    return { integrationId: null, integration: null, widgetJSON: null, localData: null };
}

export async function getIntegrationWithGlanceable(
    userId: string,
    glanceableType: string,
) {
    if (!glanceableType || !glanceableType.trim()) {
        throw new ApiActionError("Missing glanceable type", 400, {
            error: "Missing glanceable type",
        });
    }

    const normalizedType = glanceableType.trim().toLowerCase();
    
    const { integrations } = await listIntegrations(userId);

    for (const integration of integrations) {
        const rawGlanceables =
            (integration.config?.configuration as
                | Record<string, unknown>
                | undefined)?.glanceables;

        if (!Array.isArray(rawGlanceables) || rawGlanceables.length === 0) {
            continue;
        }

        for (const rawGlanceable of rawGlanceables) {
            if (!isPlainObject(rawGlanceable)) {
                continue;
            }

            const resolvedType = resolveGlanceableIdentifier(rawGlanceable);

            if (
                !resolvedType ||
                resolvedType.toLowerCase() !== normalizedType
            ) {
                continue;
            }

            const config = integration.config;
            const configuration = config?.configuration as
                | Record<string, unknown>
                | undefined;
            const environmentDefinitions = isPlainObject(configuration?.environment_variables)
                ? (configuration?.environment_variables as Record<string, unknown>)
                : null;

            const environmentVariables = resolveEnvironmentVariables(
                configuration?.environment_variables as
                    | Record<string, { default?: string }>
                    | undefined,
                integration?.environment,
            );

            return {
                integrationId: integration.id,
                integration: {
                    ...config,
                    configuration: {
                        ...configuration,
                        environment_variables: environmentVariables,
                    },
                },
                environmentDefinitions,
                glanceableJSON: {
                    ...rawGlanceable,
                    type: resolvedType,
                },
                localData: integration.localData,
            };
        }
    }

    return { integrationId: null, integration: null, glanceableJSON: null, localData: null };
}

function escapeFilter(value: string) {
    return value.replace(/"/g, '\\"');
}

function normalizeObject(raw: unknown): Record<string, any> {
    if (!raw) return {};
    if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, any>;
    if (typeof raw !== "string") return {};

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, any>;
        }
    } catch {
        // noop
    }

    try {
        const decoded = Buffer.from(raw, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, any>;
        }
    } catch {
        // noop
    }

    return {};
}

function decodeMaybeBase64(value: string | undefined | null) {
    if (!value) return "";
    try {
        const decoded = Buffer.from(value, "base64").toString("utf8");
        if (decoded && /[\x20-\x7E]/.test(decoded)) {
            return decoded;
        }
        return value;
    } catch {
        return value;
    }
}
// ---------------------------------------------------------------------------
// resolveEnvVarsViaEndpoints
//
// Inspects the current env map and finds env vars that are missing/empty.
// For each such var, checks whether any endpoint declares `data_set_env` that
// would fill it.  Those "provider" endpoints are fetched first (in declaration
// order, so dependencies chain correctly) and their responses are used to
// update the environment.  The updated environment is persisted to the DB and
// returned so subsequent callers work with the fully-resolved map.
//
// @param skipEndpointKey - optional endpoint key to exclude (e.g. the one
//   currently being tested so we don't call it twice).
// ---------------------------------------------------------------------------
async function resolveEnvVarsViaEndpoints(
    integrationId: string,
    config: Record<string, unknown>,
    environment: Record<string, string>,
    pb: Awaited<ReturnType<typeof getSuperuserPB>>,
    skipEndpointKey?: string,
): Promise<Record<string, string>> {
    const envMap = buildEnvValueMap(config, environment);

    // Collect every env var that currently has no usable value.
    const missingVars = new Set<string>(
        Object.entries(envMap)
            .filter(([, v]) => !v || !v.trim())
            .map(([k]) => k),
    );

    // Also include env vars that are referenced in endpoint URLs/auth/body but
    // not yet set (they might not appear in the definition at all).
    collectTokensFromConfig(config).forEach((token) => {
        if (!envMap[token] || !envMap[token].trim()) {
            missingVars.add(token);
        }
    });

    if (missingVars.size === 0) {
        return environment; // nothing to resolve
    }

    // Build a list of endpoints that declare data_set_env for a missing var.
    const endpointConfigs = normalizeEndpoints(config);
    const providerEndpoints = endpointConfigs.filter((ep) => {
        const epKey = typeof ep.id === "string" ? ep.id : typeof ep.name === "string" ? ep.name : null;
        if (skipEndpointKey && epKey === skipEndpointKey) return false;

        const responseDirective = ep.response as Record<string, unknown> | undefined;
        const dataSetEnv = typeof responseDirective?.data_set_env === "string"
            ? responseDirective.data_set_env
            : null;
        return dataSetEnv !== null && missingVars.has(dataSetEnv);
    });

    if (providerEndpoints.length === 0) {
        return environment; // no endpoint can help
    }

    // Fetch provider endpoints sequentially so that earlier ones can populate
    // env vars consumed by later ones (e.g. an auth token endpoint feeding a
    // data endpoint).
    let currentEnvironment = { ...environment };

    for (const epConfig of providerEndpoints) {
        const epKey = typeof epConfig.id === "string"
            ? epConfig.id
            : typeof epConfig.name === "string"
            ? epConfig.name
            : null;

        const responseDirective = epConfig.response as Record<string, unknown> | undefined;
        const dataSetEnv = typeof responseDirective?.data_set_env === "string"
            ? responseDirective.data_set_env
            : null;
        const dataPath = typeof responseDirective?.data_path === "string"
            ? responseDirective.data_path
            : undefined;

        if (!dataSetEnv) continue;

        // Re-build resolved endpoints each iteration so newly set env vars are
        // available for the next provider (e.g. TOKEN set by retrieve-token is
        // used by fetch-systems).
        const currentEnvMap = buildEnvValueMap(config, currentEnvironment);
        const [resolvedEp] = buildResolvedEndpointsFromList([epConfig], currentEnvMap);

        if (!resolvedEp) continue;

        const resolvedUrl = resolvedEp.resolvedUrl || resolvedEp.url;
        if (!resolvedUrl || UNRESOLVED_TOKEN_REGEX.test(resolvedUrl)) {
            console.warn(
                `[Integrations] Skipping provider endpoint "${epKey}" — URL still has unresolved tokens: ${resolvedUrl}`,
            );
            continue;
        }

        const method = (typeof resolvedEp.method === "string" ? resolvedEp.method : "GET").toUpperCase();
        const allowBody = !METHOD_WITHOUT_BODY.has(method);

        const requestHeaders: Record<string, string> = { ...(resolvedEp.resolvedHeaders ?? {}) };

        const resolvedAuth = resolvedEp.resolvedAuth || resolvedEp.auth || "";
        const hasAuthorizationHeader = Object.keys(requestHeaders).some(
            (k) => k.toLowerCase() === "authorization",
        );
        if (!hasAuthorizationHeader && resolvedAuth && !UNRESOLVED_TOKEN_REGEX.test(resolvedAuth)) {
            requestHeaders.Authorization = resolvedAuth;
        }

        let requestBody: string | null = null;
        if (allowBody && resolvedEp.resolvedBody !== null && resolvedEp.resolvedBody !== undefined) {
            requestBody = typeof resolvedEp.resolvedBody === "string"
                ? resolvedEp.resolvedBody
                : JSON.stringify(resolvedEp.resolvedBody);

            const hasContentType = Object.keys(requestHeaders).some(
                (k) => k.toLowerCase() === "content-type",
            );
            if (!hasContentType) {
                requestHeaders["content-type"] = "application/json";
            }
        }

        console.log(
            `[Integrations] Fetching provider endpoint "${epKey}" to resolve env var "${dataSetEnv}"`,
        );

        try {
            const timeoutController = createTimeoutController(resolveTimeout(resolvedEp.timeout));
            let responseBody: string;

            try {
                const response = await fetch(resolvedUrl, {
                    method,
                    headers: requestHeaders,
                    body: requestBody,
                    signal: timeoutController.signal,
                    ...(buildTlsOptions(
                        resolvedEp.allow_insecure_ssl ??
                            (resolvedEp as any).insecure_skip_verify ??
                            (resolvedEp as any).allowInsecureSSL,
                        resolvedUrl,
                    ) as any),
                } as any);

                if (!response.ok) {
                    console.warn(
                        `[Integrations] Provider endpoint "${epKey}" returned HTTP ${response.status} — skipping`,
                    );
                    continue;
                }

                responseBody = await response.text();
            } finally {
                timeoutController.clear();
            }

            const parsedBody = tryParseJson(responseBody);
            if (parsedBody === null && responseBody.trim()) {
                console.warn(
                    `[Integrations] Provider endpoint "${epKey}" response is not JSON — skipping`,
                );
                continue;
            }

            const resolvedValue = extractValueFromPath(parsedBody, dataPath);
            if (resolvedValue === undefined || resolvedValue === null) {
                console.warn(
                    `[Integrations] Provider endpoint "${epKey}" response did not contain a value at path "${dataPath ?? "(root)"}" — skipping`,
                );
                continue;
            }

            const formattedValue = formatEnvValue(resolvedValue);

            if (currentEnvironment[dataSetEnv] !== formattedValue) {
                currentEnvironment = { ...currentEnvironment, [dataSetEnv]: formattedValue };

                // Persist immediately so subsequent requests benefit too.
                await pb.collection("integrations").update(integrationId, {
                    environment: encodeEnvironment(currentEnvironment),
                });

                console.log(
                    `[Integrations] Resolved and persisted env var "${dataSetEnv}" via endpoint "${epKey}"`,
                );
            }

            // Remove from missing set so we don't try to resolve it again.
            missingVars.delete(dataSetEnv);
        } catch (err) {
            console.warn(
                `[Integrations] Failed to fetch provider endpoint "${epKey}":`,
                err,
            );
        }
    }

    return currentEnvironment;
}

/**
 * Collect all ${TOKEN} references used anywhere inside an integration's
 * endpoint definitions (url, auth, body, headers).
 */
function collectTokensFromConfig(config: Record<string, unknown>): Set<string> {
    const tokens = new Set<string>();
    const endpointConfigs = normalizeEndpoints(config);

    for (const ep of endpointConfigs) {
        const candidates = [
            typeof ep.url === "string" ? ep.url : "",
            typeof ep.auth === "string" ? ep.auth : "",
            JSON.stringify(ep.body ?? ""),
            JSON.stringify(ep.headers ?? ""),
            JSON.stringify(ep.custom_headers ?? ""),
        ];

        for (const candidate of candidates) {
            for (const match of candidate.matchAll(new RegExp(ENDPOINT_TOKEN_REGEX.source, "g"))) {
                if (match[1]) tokens.add(match[1]);
            }
        }
    }

    return tokens;
}

/**
 * Variant of buildResolvedEndpoints that operates on an already-normalised
 * list of endpoint config objects and a pre-built envMap, so callers can
 * pass a subset of endpoints without re-parsing the full config.
 */
function buildResolvedEndpointsFromList(
    endpoints: Record<string, unknown>[],
    envMap: Record<string, string>,
): ResolvedEndpoint[] {
    return endpoints.map((endpoint) => {
        const method = typeof endpoint.method === "string"
            ? endpoint.method
            : "GET";
        const headerSources: Record<string, unknown> = {
            ...(isPlainObject(endpoint.headers)
                ? (endpoint.headers as Record<string, unknown>)
                : {}),
            ...(isPlainObject(endpoint.custom_headers)
                ? endpoint.custom_headers
                : {}),
        };

        const resolvedHeadersRaw = resolveValue(headerSources, envMap);
        const resolvedHeaders = isPlainObject(resolvedHeadersRaw)
            ? Object.fromEntries(
                Object.entries(resolvedHeadersRaw).map(([key, value]) => [
                    key,
                    value === undefined || value === null ? "" : String(value),
                ]),
            )
            : {};

        const resolvedAuthFromHeaders = extractAuthorizationHeader(resolvedHeaders);
        const interpolatedAuth = interpolateString(
            typeof endpoint.auth === "string" ? endpoint.auth : "",
            envMap,
        );
        const finalResolvedAuth = interpolatedAuth || resolvedAuthFromHeaders || "";
        const timeout =
            typeof endpoint.timeout === "number" || typeof endpoint.timeout === "string"
                ? endpoint.timeout
                : endpoint.timeout == null
                    ? null
                    : undefined;

        return {
            id: typeof endpoint.id === "string" ? endpoint.id : (endpoint.name as string) ?? null,
            name: typeof endpoint.name === "string" ? endpoint.name : null,
            description: typeof endpoint.description === "string" ? endpoint.description : null,
            method,
            url: typeof endpoint.url === "string" ? endpoint.url : "",
            auth: typeof endpoint.auth === "string" ? endpoint.auth : "",
            allow_insecure_ssl: endpoint.allow_insecure_ssl ??
                (endpoint as any).insecure_skip_verify ??
                (endpoint as any).allowInsecureSSL,
            timeout,
            body: endpoint.body ?? null,
            custom_headers: (endpoint.custom_headers as Record<string, unknown>) ?? {},
            response_body_types: (endpoint.response_body_types as Record<string, unknown>) ?? {},
            response_mappings: Array.isArray((endpoint as any).response_mappings)
                ? (endpoint as any).response_mappings
                : isPlainObject((endpoint as any).response_mapping)
                ? [(endpoint as any).response_mapping]
                : [],
            resolvedUrl: interpolateString(
                typeof endpoint.url === "string" ? endpoint.url : "",
                envMap,
            ),
            resolvedAuth: finalResolvedAuth,
            resolvedHeaders,
            resolvedBody: resolveValue(endpoint.body ?? null, envMap),
        };
    });
}

function toResponseHeaders(headers: unknown) {
    const result: Record<string, string> = {};

    if (headers && typeof headers === "object" && "entries" in headers) {
        for (const [key, value] of (headers as { entries(): IterableIterator<[string, string]> }).entries()) {
            result[key] = value;
        }

        return result;
    }

    for (const [key, value] of Object.entries(headers ?? {})) {
        if (value === undefined || value === null) {
            continue;
        }

        if (Array.isArray(value)) {
            result[key] = value.join(", ");
            continue;
        }

        result[key] = String(value);
    }

    return result;
}

function buildTlsOptions(
    allowInsecureSsl: unknown,
    url: string,
) {
    const shouldIgnoreCertificateErrors =
        isTruthyValue(allowInsecureSsl) && url.startsWith("https://");

    return shouldIgnoreCertificateErrors
        ? { tls: { rejectUnauthorized: false } }
        : {};
}

function createTimeoutController(timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    return {
        signal: controller.signal,
        clear() {
            clearTimeout(timeout);
        },
    };
}

function isTruthyValue(value: unknown) {
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
    }

    return Boolean(value);
}

function buildCurlCommand(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
}) {
    const tokens: { text: string; quoted: boolean }[] = [{
        text: "curl",
        quoted: false,
    }];

    const method = (request.method || "GET").toUpperCase();
    if (method && method !== "GET") {
        tokens.push({ text: "-X", quoted: false });
        tokens.push({ text: method, quoted: true });
    }

    for (const [key, value] of Object.entries(request.headers || {})) {
        if (value === undefined || value === null) {
            continue;
        }
        tokens.push({ text: "-H", quoted: false });
        tokens.push({ text: `${key}: ${value}`, quoted: true });
    }

    if (request.body !== null && request.body !== undefined) {
        tokens.push({ text: "-d", quoted: false });
        tokens.push({ text: request.body, quoted: true });
    }

    tokens.push({ text: request.url, quoted: true });

    return tokens
        .map((token) => (token.quoted ? quoteShellArg(token.text) : token.text))
        .join(" ");
}

function quoteShellArg(value: string) {
    const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$/g, "\\$")
        .replace(/`/g, "\\`")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
    return `"${escaped}"`;
}

function resolveTimeout(timeout: unknown) {
    const parsed = Number(timeout);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return 20_000;
}

function normalizeWidgetSlug(value: string | null) {
    if (!value) {
        return null;
    }
    const normalized = value
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
    return normalized || null;
}

function resolveWidgetIdentifier(rawWidget: Record<string, unknown>) {
    if (typeof rawWidget.key === "string" && rawWidget.key.trim()) {
        return rawWidget.key.trim();
    }
    if (typeof rawWidget.slug === "string" && rawWidget.slug.trim()) {
        return rawWidget.slug.trim();
    }
    return normalizeWidgetSlug(
        typeof rawWidget.name === "string" ? rawWidget.name : null,
    );
}

function resolveGlanceableIdentifier(rawGlanceable: Record<string, unknown>) {
    if (typeof rawGlanceable.type === "string" && rawGlanceable.type.trim()) {
        return rawGlanceable.type.trim();
    }
    if (typeof rawGlanceable.slug === "string" && rawGlanceable.slug.trim()) {
        return rawGlanceable.slug.trim();
    }
    return normalizeWidgetSlug(
        typeof rawGlanceable.name === "string"
            ? rawGlanceable.name
            : typeof rawGlanceable.displayName === "string"
                ? rawGlanceable.displayName
                : null,
    );
}

function findEndpointConfig(config: Record<string, unknown>, key: string) {
    if (!key) {
        return null;
    }

    const rawEndpoints =
        (config?.configuration as Record<string, unknown> | undefined)
            ?.endpoints;
    if (!rawEndpoints) {
        return null;
    }

    const candidates: Record<string, unknown>[] = Array.isArray(rawEndpoints)
        ? rawEndpoints
        : objectToEndpointList(rawEndpoints);

    for (const candidate of candidates) {
        const id = typeof candidate?.id === "string" ? candidate.id : null;
        const name = typeof candidate?.name === "string"
            ? candidate.name
            : null;
        if (id === key || name === key) {
            return candidate;
        }
    }

    return null;
}

function objectToEndpointList(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return [] as Record<string, unknown>[];
    }

    return Object.entries(raw).map(([entryKey, entryValue]) => {
        if (
            entryValue && typeof entryValue === "object" &&
            !Array.isArray(entryValue)
        ) {
            return { id: entryKey, ...(entryValue as Record<string, unknown>) };
        }
        return { id: entryKey };
    });
}

function extractValueFromPath(body: unknown, path?: string) {
    if (!path) {
        return body;
    }

    const segments = path.split(".").filter(Boolean);
    let current: unknown = body;

    for (const segment of segments) {
        if (current === undefined || current === null) {
            return undefined;
        }

        if (Array.isArray(current)) {
            const index = Number.parseInt(segment, 10);
            if (Number.isNaN(index)) {
                return undefined;
            }
            current = current[index];
            continue;
        }

        if (typeof current === "object") {
            current = (current as Record<string, unknown>)[segment];
            continue;
        }

        return undefined;
    }

    return current;
}

function formatEnvValue(value: unknown) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return value.toString();
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function normalizeConfig(value: unknown) {
    if (typeof value === "string") {
        const parsed = tryParseJson(value);
        if (isPlainObject(parsed)) {
            return parsed;
        }

        const yamlParsed = tryParseYaml(value);
        if (isPlainObject(yamlParsed)) {
            return yamlParsed;
        }

        const decoded = tryDecodeBase64Json(value);
        if (isPlainObject(decoded)) {
            return decoded;
        }
        return {};
    }

    if (isPlainObject(value)) {
        return value;
    }

    return {};
}

export function encodeEnvironment(value: unknown) {
    if (typeof value === "string" && value.trim()) {
        return value;
    }

    const payload = isPlainObject(value) ? value : value ?? {};
    return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function decodeEnvironment(value: unknown) {
    const candidate = parseNullableJson(value);
    return toEnvMap(candidate);
}

function parseNullableJson(value: unknown) {
    if (value === undefined || value === null) {
        return null;
    }
    if (Array.isArray(value) || isPlainObject(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = tryParseJson(value);
        if (parsed !== null) {
            return parsed;
        }
        return tryDecodeBase64Json(value);
    }
    return null;
}

function tryParseJson(value: string) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function tryParseYaml(value: string) {
    try {
        return YAML.parse(value);
    } catch {
        return null;
    }
}

function tryDecodeBase64Json(value: string) {
    try {
        const decoded = Buffer.from(value, "base64").toString("utf-8");
        return tryParseJson(decoded);
    } catch {
        return null;
    }
}

function toEnvMap(raw: unknown) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {} as Record<string, string>;
    }

    const entries = raw as Record<string, unknown>;
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(entries)) {
        if (value === undefined || value === null) continue;
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

function mapIntegration(record: any): IntegrationRecord {
    const config = normalizeConfig(record.config);
    const environment = decodeEnvironment(record.environment);
    const localDataRaw = parseNullableJson(record.localData);
    const localData = isPlainObject(localDataRaw)
        ? (localDataRaw as Record<string, unknown>)
        : {};

    const recordType = record.type;
    const type: "plugin" | "caldav" | undefined =
        recordType === "plugin" || recordType === "caldav"
            ? recordType
            : undefined;

    return {
        id: record.id,
        type,
        name: typeof record.name === "string" ? record.name : null,
        source: typeof record.source === "string" ? record.source : null,
        userId: typeof record.user === "string"
            ? record.user
            : record.user?.id ?? null,
        config,
        environment,
        localData,
        created: record.created,
        updated: record.updated,
    };
}

function ownsIntegration(record: any, userId: string) {
    if (!record) return false;
    if (typeof record.user === "string") {
        return record.user === userId;
    }
    const expandedId = record.user?.id;
    return typeof expandedId === "string" ? expandedId === userId : false;
}

export function buildResolvedEndpoints(
    config: Record<string, unknown>,
    environment: Record<string, string>,
): ResolvedEndpoint[] {
    const envMap = buildEnvValueMap(config, environment);
    const endpoints = normalizeEndpoints(config);
    return buildResolvedEndpointsFromList(endpoints, envMap);
}

function normalizeEndpoints(config: Record<string, unknown>) {
    const raw = (config?.configuration as Record<string, unknown>)?.endpoints;
    if (!raw) {
        return [] as Record<string, unknown>[];
    }

    if (Array.isArray(raw)) {
        return raw;
    }

    if (isPlainObject(raw)) {
        return Object.entries(raw).map(([key, value]) => ({
            id: key,
            ...(isPlainObject(value) ? value : {}),
        }));
    }

    return [];
}

function buildEnvValueMap(
    config: Record<string, unknown>,
    storedEnv: Record<string, string>,
) {
    const defaults = getConfigEnvDefaults(config);
    return { ...defaults, ...storedEnv };
}

function getConfigEnvDefaults(config: Record<string, unknown>) {
    const envDefinition = (config.configuration as Record<string, unknown>)
        ?.environment_variables;
    const defaults: Record<string, string> = {};

    if (Array.isArray(envDefinition)) {
        for (const item of envDefinition) {
            const key = typeof item?.key === "string" ? item.key : null;
            if (!key) continue;
            const fallback = item?.testValue ?? item?.test_value ??
                item?.default;
            if (fallback === undefined || fallback === null) continue;
            defaults[key] = typeof fallback === "string"
                ? fallback
                : JSON.stringify(fallback);
        }
        return defaults;
    }

    if (isPlainObject(envDefinition)) {
        for (const [key, value] of Object.entries(envDefinition)) {
            const definition = value as Record<string, unknown>;
            const fallback = definition.test_value ?? definition.testValue ??
                definition.default;
            if (fallback === undefined || fallback === null) continue;
            defaults[key] = typeof fallback === "string"
                ? fallback
                : JSON.stringify(fallback);
        }
    }

    return defaults;
}

function resolveValue(value: unknown, envMap: Record<string, string>): unknown {
    if (value === undefined || value === null) {
        return value;
    }
    if (typeof value === "string") {
        return resolveStringValue(value, envMap);
    }
    if (Array.isArray(value)) {
        return value.map((item) => resolveValue(item, envMap));
    }
    if (isPlainObject(value)) {
        const resolved: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            resolved[key] = resolveValue(item, envMap);
        }
        return resolved;
    }
    return value;
}

/**
 * Resolve a YAML template string.
 *
 * Supported forms:
 * - "${VAR}" interpolation
 * - "primary ??? fallback" fallback semantics
 *
 * The fallback is used only when the primary side resolves to an empty string
 * or still contains unresolved `${...}` tokens.
 *
 * After interpolation, values that start with `{` or `[` are parsed as JSON.
 */
function resolveStringValue(template: string, envMap: Record<string, string>) {
    const fallbackSeparator = template.indexOf("???");
    if (fallbackSeparator === -1) {
        return parseMaybeJson(interpolateString(template, envMap));
    }

    const primaryTemplate = template.slice(0, fallbackSeparator).trim();
    const fallbackTemplate = template.slice(fallbackSeparator + 3).trim();
    const primaryValue = interpolateString(primaryTemplate, envMap).trim();

    if (primaryValue && !primaryValue.includes("${")) {
        return parseMaybeJson(primaryValue);
    }

    const fallbackValue = interpolateString(fallbackTemplate, envMap).trim();
    return parseMaybeJson(fallbackValue);
}

function parseMaybeJson(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return value;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

function interpolateString(template: string, envMap: Record<string, string>) {
    return template.replace(ENDPOINT_TOKEN_REGEX, (match, token) => {
        const order = [token, token.toUpperCase(), token.toLowerCase()];
        for (const candidate of order) {
            if (candidate in envMap) {
                return envMap[candidate];
            }
        }
        return match;
    });
}

function extractAuthorizationHeader(headers: Record<string, string>) {
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "authorization") {
            return value;
        }
    }
    return null;
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBase64Json<T = Record<string, unknown>>(value: string): T | null {
    try {
        return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
    } catch {
        return null;
    }
}