import { Buffer } from "buffer";
import https from "https";
import axios from "axios";
import YAML from "yaml";
import config from "@/lib/config";
import { ApiActionError } from "@dashwise/sdk/data/auth";
import { getSuperuserPB } from "@dashwise/sdk/lib/pocketbase";

const ENDPOINT_TOKEN_REGEX = /\$\{([A-Za-z0-9_]+)\}/g;
const METHOD_WITHOUT_BODY = new Set(["GET", "HEAD"]);
const UNRESOLVED_TOKEN_REGEX = /\$\{[A-Za-z0-9_]+\}/;

type IntegrationRecord = {
    id: string;
    name: string | null;
    source: string | null;
    userId: string | null;
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

export type CreateIntegrationPayload = {
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

    return { integrations: list.map(mapIntegration) };
}

export async function getIntegration(userId: string, integrationId: string, resolveEndpoints = false) {
    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);

    if (!ownsIntegration(record, userId)) {
        throw new ApiActionError("Not found", 404, { error: "Not found" });
    }

    const integration = mapIntegration(record);
    if (!resolveEndpoints) {
        return { integration };
    }

    return {
        integration,
        resolvedEndpoints: buildResolvedEndpoints(integration.config, integration.environment),
    };
}

export async function createIntegration(userId: string, payload: CreateIntegrationPayload) {
    const pb = await getSuperuserPB();

    const record = await pb.collection("integrations").create({
        name: typeof payload.name === "string" ? payload.name.trim() || null : null,
        source: typeof payload.source === "string" ? payload.source : "manual",
        config: normalizeConfig(payload.config),
        environment: encodeEnvironment(payload.environment),
        user: userId,
    });

    return { integration: mapIntegration(record) };
}

export async function testIntegrationEndpoint(userId: string, rawTarget: string) {
    console.log("Test23")
    if (!rawTarget) {
        throw new ApiActionError("Missing target", 400, { error: "Missing target" });
    }

    const dotIndex = rawTarget.indexOf(".");
    if (dotIndex <= 0 || dotIndex === rawTarget.length - 1) {
        throw new ApiActionError("Invalid target format", 400, { error: "Invalid target format" });
    }

    const integrationId = rawTarget.slice(0, dotIndex);
    const endpointKey = rawTarget.slice(dotIndex + 1);

    const pb = await getSuperuserPB();
    const record = await pb.collection("integrations").getOne(integrationId);

    if (!ownsIntegration(record, userId)) {
        throw new ApiActionError("Not found", 404, { error: "Not found" });
    }

    const integration = mapIntegration(record);
    const resolvedEndpoints = buildResolvedEndpoints(integration.config, integration.environment);
    console.log("Resolved endpoints for testing:", resolvedEndpoints);
    const endpoint = resolvedEndpoints.find(
        (candidate) => candidate.id === endpointKey || candidate.name === endpointKey
    );

    if (!endpoint) {
        throw new ApiActionError("Endpoint not found", 404, { error: "Endpoint not found" });
    }

    console.log("TEST")

    const resolvedUrl = endpoint.resolvedUrl || endpoint.url;
    if (!resolvedUrl) {
        throw new ApiActionError("Endpoint URL is empty", 400, { error: "Endpoint URL is empty" });
    }

    const method = (typeof endpoint.method === "string" ? endpoint.method : "GET").toUpperCase();
    const allowBody = !METHOD_WITHOUT_BODY.has(method);
    const envMap = buildEnvValueMap(integration.config, integration.environment);

    const requestHeaders: Record<string, string> = { ...(endpoint.resolvedHeaders ?? {}) };
    for (const [key, value] of Object.entries(requestHeaders)) {
        requestHeaders[key] = interpolateString(String(value ?? ""), envMap);
    }

    const resolvedAuth = interpolateString(endpoint.resolvedAuth || endpoint.auth || "", envMap);
    const hasAuthorizationHeader = Object.keys(requestHeaders).some(
        (key) => key.toLowerCase() === "authorization"
    );
    if (!hasAuthorizationHeader && resolvedAuth) {
        requestHeaders.Authorization = resolvedAuth;
    }

    if (hasAuthorizationHeader) {
        const authHeaderKey = Object.keys(requestHeaders).find(
            (key) => key.toLowerCase() === "authorization"
        );
        if (authHeaderKey) {
            const existing = requestHeaders[authHeaderKey];
            if (UNRESOLVED_TOKEN_REGEX.test(existing) && resolvedAuth) {
                requestHeaders[authHeaderKey] = resolvedAuth;
            }
        }
    }
    let requestBody: string | null = null;

    if (allowBody && endpoint.resolvedBody !== null && endpoint.resolvedBody !== undefined) {
        requestBody =
            typeof endpoint.resolvedBody === "string"
                ? endpoint.resolvedBody
                : JSON.stringify(endpoint.resolvedBody);

        const hasContentType = Object.keys(requestHeaders).some(
            (key) => key.toLowerCase() === "content-type"
        );
        if (!hasContentType) {
            requestHeaders["content-type"] = "application/json";
        }
    }

    const insecureRequested =
        endpoint.allow_insecure_ssl === true ||
        endpoint.allow_insecure_ssl === "true" ||
        (endpoint as any).insecure_skip_verify === true ||
        (endpoint as any).insecure_skip_verify === "true";
    const allowInsecure =
        !!config.allowInsecureCertsForIntegrationUrls || insecureRequested;

    const curlCommand = buildCurlCommand({
        url: resolvedUrl,
        method,
        headers: requestHeaders,
        body: requestBody,
    });
    console.log(`[Integrations] Endpoint test cURL (${integrationId}.${endpointKey}): ${curlCommand}`);

    const response = await axios.request({
        url: resolvedUrl,
        method: method as any,
        headers: requestHeaders,
        data: requestBody,
        timeout: resolveTimeout(endpoint.timeout),
        validateStatus: () => true,
        ...(allowInsecure
            ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
            : {}),
    });

    const rawResponseBody =
        typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? "");
    const parsedResponseBody =
        typeof response.data === "string" ? tryParseJson(response.data) : response.data;

    const endpointConfig = findEndpointConfig(integration.config, endpointKey);
    const responseDirective = endpointConfig?.response as Record<string, unknown> | undefined;
    const dataSetEnv =
        typeof responseDirective?.data_set_env === "string" ? responseDirective.data_set_env : null;
    const dataPath = typeof responseDirective?.data_path === "string" ? responseDirective.data_path : undefined;

    if (dataSetEnv && parsedResponseBody !== null && parsedResponseBody !== undefined) {
        const resolvedValue = extractValueFromPath(parsedResponseBody, dataPath);
        if (resolvedValue !== undefined && resolvedValue !== null) {
            const formattedValue = formatEnvValue(resolvedValue);
            if (integration.environment[dataSetEnv] !== formattedValue) {
                const updatedEnvironment = { ...integration.environment, [dataSetEnv]: formattedValue };
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
}

export async function getWidgetProperties(userId: string, widgetSlug: string) {
    if (!widgetSlug || !widgetSlug.trim()) {
        throw new ApiActionError("Missing widget slug", 400, { error: "Missing widget slug" });
    }

    const normalizedSlug = widgetSlug.trim().toLowerCase();
    const pb = await getSuperuserPB();
    const list = await pb.collection("integrations").getFullList({
        filter: `user="${userId}"`,
        sort: "-updated",
    });

    for (const record of list) {
        if (!ownsIntegration(record, userId)) {
            continue;
        }

        const integration = mapIntegration(record);
        const rawWidgets = (integration.config?.configuration as Record<string, unknown> | undefined)?.widgets;
        if (!Array.isArray(rawWidgets) || rawWidgets.length === 0) {
            continue;
        }

        for (const rawWidget of rawWidgets) {
            if (!isPlainObject(rawWidget)) {
                continue;
            }

            const resolvedWidget = resolveWidgetDefinition(
                rawWidget,
                integration.config,
                integration.environment
            );
            if (!resolvedWidget) {
                continue;
            }

            if (resolvedWidget.slug.toLowerCase() !== normalizedSlug) {
                continue;
            }

            return {
                widget: resolvedWidget,
                integration: {
                    id: integration.id,
                    name: integration.name,
                },
            };
        }
    }

    return { widget: null, integration: null };
}



function toResponseHeaders(headers: Record<string, unknown>) {
    const result: Record<string, string> = {};

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

function buildCurlCommand(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string | null;
}) {
    const tokens: { text: string; quoted: boolean }[] = [{ text: "curl", quoted: false }];

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

function resolveWidgetDefinition(
    widget: Record<string, unknown>,
    config: Record<string, unknown>,
    environment: Record<string, string>
) {
    const name = typeof widget.name === "string" && widget.name.trim() ? widget.name.trim() : null;
    const slugFromConfig = typeof widget.slug === "string" && widget.slug.trim() ? widget.slug.trim() : null;
    const slug = slugFromConfig ?? normalizeWidgetSlug(name);
    if (!slug) {
        return null;
    }

    const envMap = buildEnvValueMap(config, environment);
    const template =
        typeof widget.template === "string" && widget.template.trim()
            ? widget.template.trim()
            : "columns";

    const properties = isPlainObject(widget.properties)
        ? (resolveValue(widget.properties, envMap) as Record<string, unknown>)
        : {};
    const exampleProps = isPlainObject(widget.exampleProps)
        ? (resolveValue(widget.exampleProps, envMap) as Record<string, unknown>)
        : {};

    return {
        slug,
        name: name ?? slug,
        template,
        properties,
        exampleProps,
    };
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

function findEndpointConfig(config: Record<string, unknown>, key: string) {
    if (!key) {
        return null;
    }

    const rawEndpoints = (config?.configuration as Record<string, unknown> | undefined)?.endpoints;
    if (!rawEndpoints) {
        return null;
    }

    const candidates: Record<string, unknown>[] = Array.isArray(rawEndpoints)
        ? rawEndpoints
        : objectToEndpointList(rawEndpoints);

    for (const candidate of candidates) {
        const id = typeof candidate?.id === "string" ? candidate.id : null;
        const name = typeof candidate?.name === "string" ? candidate.name : null;
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
        if (entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)) {
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

    return {
        id: record.id,
        name: typeof record.name === "string" ? record.name : null,
        source: typeof record.source === "string" ? record.source : null,
        userId: typeof record.user === "string" ? record.user : record.user?.id ?? null,
        config,
        environment,
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
    environment: Record<string, string>
): ResolvedEndpoint[] {
    const envMap = buildEnvValueMap(config, environment);
    const endpoints = normalizeEndpoints(config);

    return endpoints.map((endpoint) => {
        const method = typeof endpoint.method === "string" ? endpoint.method : "GET";
        const headerSources: Record<string, unknown> = {
            ...(isPlainObject(endpoint.headers) ? (endpoint.headers as Record<string, unknown>) : {}),
            ...(isPlainObject(endpoint.custom_headers) ? endpoint.custom_headers : {}),
        };

        const resolvedHeadersRaw = resolveValue(headerSources, envMap);
        const resolvedHeaders = isPlainObject(resolvedHeadersRaw)
            ? Object.fromEntries(
                Object.entries(resolvedHeadersRaw).map(([key, value]) => [
                    key,
                    value === undefined || value === null ? "" : String(value),
                ])
            )
            : {};

        const resolvedAuthFromHeaders = extractAuthorizationHeader(resolvedHeaders);
        const interpolatedAuth = interpolateString(typeof endpoint.auth === "string" ? endpoint.auth : "", envMap);
        const finalResolvedAuth = interpolatedAuth || resolvedAuthFromHeaders || "";

        return {
            id: typeof endpoint.id === "string" ? endpoint.id : endpoint.name ?? null,
            name: typeof endpoint.name === "string" ? endpoint.name : null,
            description: typeof endpoint.description === "string" ? endpoint.description : null,
            method,
            url: typeof endpoint.url === "string" ? endpoint.url : "",
            auth: typeof endpoint.auth === "string" ? endpoint.auth : "",
            allow_insecure_ssl:
                endpoint.allow_insecure_ssl ??
                (endpoint as any).insecure_skip_verify ??
                (endpoint as any).allowInsecureSSL,
            timeout: endpoint.timeout,
            body: endpoint.body ?? null,
            custom_headers: endpoint.custom_headers ?? {},
            response_body_types: endpoint.response_body_types ?? {},
            response_mappings: Array.isArray((endpoint as any).response_mappings)
                ? (endpoint as any).response_mappings
                : isPlainObject((endpoint as any).response_mapping)
                    ? [(endpoint as any).response_mapping]
                    : [],
            resolvedUrl: interpolateString(typeof endpoint.url === "string" ? endpoint.url : "", envMap),
            resolvedAuth: finalResolvedAuth,
            resolvedHeaders,
            resolvedBody: resolveValue(endpoint.body ?? null, envMap),
        };
    });
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

function buildEnvValueMap(config: Record<string, unknown>, storedEnv: Record<string, string>) {
    const defaults = getConfigEnvDefaults(config);
    return { ...defaults, ...storedEnv };
}

function getConfigEnvDefaults(config: Record<string, unknown>) {
    const envDefinition = (config.configuration as Record<string, unknown>)?.environment_variables;
    const defaults: Record<string, string> = {};

    if (Array.isArray(envDefinition)) {
        for (const item of envDefinition) {
            const key = typeof item?.key === "string" ? item.key : null;
            if (!key) continue;
            const fallback = item?.testValue ?? item?.test_value ?? item?.default;
            if (fallback === undefined || fallback === null) continue;
            defaults[key] = typeof fallback === "string" ? fallback : JSON.stringify(fallback);
        }
        return defaults;
    }

    if (isPlainObject(envDefinition)) {
        for (const [key, value] of Object.entries(envDefinition)) {
            const definition = value as Record<string, unknown>;
            const fallback = definition.test_value ?? definition.testValue ?? definition.default;
            if (fallback === undefined || fallback === null) continue;
            defaults[key] = typeof fallback === "string" ? fallback : JSON.stringify(fallback);
        }
    }

    return defaults;
}

function resolveValue(value: unknown, envMap: Record<string, string>): unknown {
    if (value === undefined || value === null) {
        return value;
    }
    if (typeof value === "string") {
        return interpolateString(value, envMap);
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
