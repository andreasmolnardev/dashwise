// dashwise-integrationskit/data/getEndpointData.tsx
//
// Endpoint fetching lives in the integrations kit for integration-backed
// widgets. The helpers here resolve request config, execute the fetch, and
// return a normalized response object that computed fields can consume.

import { getNestedValue, resolveComputedFieldValue } from "./getComputedField";

export type EndpointDefinition = Record<string, any>;

export type ResolvedEndpointData = {
	id: string | null;
	name: string | null;
	method: string;
	url: string;
	resolvedUrl: string;
	requestHeaders: Record<string, string>;
	requestBody: string | null;
	rawResponse: unknown;
	mappedResponse: unknown;
};

export type EndpointResolutionContext = {
	env: Record<string, string>;
	scope?: Record<string, any>;
	signal?: AbortSignal;
};

export async function resolveEndpointCatalog(
	endpoints: unknown,
	context: EndpointResolutionContext,
): Promise<{ endpoints: Record<string, ResolvedEndpointData>; env: Record<string, string> }> {
	const normalized = normalizeEndpoints(endpoints);
	const nextEnv = { ...context.env };
	const resolved: Record<string, ResolvedEndpointData> = {};

	for (const endpoint of normalized) {
		const resolvedEndpoint = await getEndpointData(endpoint, {
			...context,
			env: nextEnv,
			scope: {
				...(context.scope ?? {}),
				endpoints: resolved,
			},
		});

		const key = resolvedEndpoint.id ?? resolvedEndpoint.name;
		if (key) {
			resolved[key] = resolvedEndpoint;
		}

		const responseDirective = isPlainObject(endpoint.response) ? endpoint.response : null;
		const dataSetEnv = typeof responseDirective?.data_set_env === "string"
			? responseDirective.data_set_env
			: null;
		const dataPath = typeof responseDirective?.data_path === "string"
			? responseDirective.data_path
			: undefined;

		if (dataSetEnv) {
			const nextValue = getNestedValue(
				resolvedEndpoint.mappedResponse as Record<string, any>,
				dataPath ?? "",
			);
			if (nextValue !== undefined && nextValue !== null) {
				nextEnv[dataSetEnv] = formatEnvValue(nextValue);
			}
		}
	}

	return { endpoints: resolved, env: nextEnv };
}

export async function getEndpointData(
	endpoint: EndpointDefinition,
	context: EndpointResolutionContext,
): Promise<ResolvedEndpointData> {
	const method = String(endpoint.method ?? "GET").toUpperCase();
	const resolvedUrl = resolveStringValue(String(endpoint.url ?? ""), context);
	const requestHeaders = resolveHeaders(endpoint, context);
	const requestBody = resolveBody(endpoint, context, method);
	const endpointLabel = typeof endpoint.name === "string"
		? endpoint.name
		: typeof endpoint.id === "string"
			? endpoint.id
			: "endpoint";

	if (!resolvedUrl) {
		return {
			id: typeof endpoint.id === "string" ? endpoint.id : null,
			name: typeof endpoint.name === "string" ? endpoint.name : null,
			method,
			url: typeof endpoint.url === "string" ? endpoint.url : "",
			resolvedUrl: "",
			requestHeaders,
			requestBody,
			rawResponse: null,
			mappedResponse: null,
		};
	}

	let response: Response;
	try {
		response = await fetch(resolvedUrl, {
			method,
			headers: requestHeaders,
			body: requestBody,
			signal: context.signal,
		});
	} catch (error) {
		throw new Error(
			`Failed to fetch endpoint "${endpointLabel}" (${method} ${resolvedUrl}): ${getErrorMessage(error)}`,
		);
	}

	const contentType = response.headers.get("content-type") ?? "";
	const rawResponse = contentType.includes("application/json")
		? await response.json().catch(async () => await response.text())
		: await response.text();

	if (!response.ok) {
		const responseSummary = typeof rawResponse === "string"
			? rawResponse.trim()
			: JSON.stringify(rawResponse);
		const suffix = responseSummary ? ` - ${responseSummary}` : "";
		throw new Error(
			`Failed to fetch endpoint "${endpointLabel}" (${method} ${resolvedUrl}): ${response.status} ${response.statusText}${suffix}`,
		);
	}

	return {
		id: typeof endpoint.id === "string" ? endpoint.id : null,
		name: typeof endpoint.name === "string" ? endpoint.name : null,
		method,
		url: typeof endpoint.url === "string" ? endpoint.url : "",
		resolvedUrl,
		requestHeaders,
		requestBody,
		rawResponse,
		mappedResponse: mapResponseBody(rawResponse, endpoint),
	};
}

function getErrorMessage(error: unknown) {
	if (error instanceof Error) return error.message;
	return String(error);
}

function normalizeEndpoints(endpoints: unknown): EndpointDefinition[] {
	if (!endpoints) return [];
	if (Array.isArray(endpoints)) {
		return endpoints.filter(isPlainObject);
	}

	if (isPlainObject(endpoints)) {
		return Object.entries(endpoints).map(([key, value]) => ({
			id: key,
			...(isPlainObject(value) ? value : {}),
		}));
	}

	return [];
}

function resolveHeaders(endpoint: EndpointDefinition, context: EndpointResolutionContext) {
	const rawHeaders = isPlainObject(endpoint.headers)
		? endpoint.headers
		: isPlainObject(endpoint.custom_headers)
			? endpoint.custom_headers
			: {};

	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(rawHeaders)) {
		headers[key] = resolveStringValue(String(value ?? ""), context);
	}

	const auth = resolveStringValue(String(endpoint.auth ?? ""), context);
	if (auth && !Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) {
		headers.Authorization = auth;
	}

	return headers;
}

function resolveBody(endpoint: EndpointDefinition, context: EndpointResolutionContext, method: string) {
	if (["GET", "HEAD"].includes(method)) return null;

	const rawBody = endpoint.body;
	if (rawBody === undefined || rawBody === null) return null;

	const resolvedBody = resolveComputedFieldValue(rawBody, context as any);
	return typeof resolvedBody === "string" ? resolvedBody : JSON.stringify(resolvedBody);
}

function mapResponseBody(body: unknown, endpoint: EndpointDefinition) {
	const mappings = Array.isArray(endpoint.response_mappings)
		? endpoint.response_mappings
		: isPlainObject(endpoint.response_mapping)
			? [endpoint.response_mapping]
			: [];

	if (mappings.length === 0 || !isPlainObject(body)) {
		return body;
	}

	const mapped: Record<string, any> = { ...(body as Record<string, any>) };
	for (const mapping of mappings) {
		if (!isPlainObject(mapping)) continue;
		for (const [target, source] of Object.entries(mapping)) {
			if (typeof source !== "string") continue;
			mapped[target] = getNestedValue(body as Record<string, any>, source);
		}
	}

	return mapped;
}

function resolveStringValue(template: string, context: EndpointResolutionContext) {
	return template.replace(/\$\{([^}]+)\}/g, (_, key) => context.env[key.trim()] ?? "");
}

function formatEnvValue(value: unknown) {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}