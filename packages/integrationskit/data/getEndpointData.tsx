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
	cache?: EndpointRuntimeCacheAdapter;
};

export type EndpointRuntimeCacheAdapter = {
	get: (endpointId: string) => ResolvedEndpointData | null;
	set: (
		endpointId: string,
		payload: ResolvedEndpointData,
		expiresAt: number | null,
	) => void;
};

/**
 * Gets all integrations endpoint data
 */
export async function resolveEndpointCatalog(
	endpoints: unknown,
	context: EndpointResolutionContext,
	allowInsecureEndpoints = false,
): Promise<
	{
		endpoints: Record<string, ResolvedEndpointData>;
		env: Record<string, string>;
	}
> {
	const normalized = normalizeEndpoints(endpoints);
	const nextEnv = { ...context.env };
	const resolved: Record<string, ResolvedEndpointData> = {};

	function extractEnvVarsFromValue(value: unknown): Set<string> {
		const result = new Set<string>();
		if (value === undefined || value === null) return result;
		let text = "";
		if (typeof value === "string") text = value;
		else {
			try {
				text = JSON.stringify(value);
			} catch {
				text = String(value);
			}
		}
		const keywordBlacklist = new Set([
			"if",
			"else",
			"and",
			"or",
			"not",
			"contains",
			"true",
			"false",
			"null",
		]);

		for (const m of text.matchAll(/\$\{([^}]+)\}/g)) {
			if (!m[1]) continue;
			const expr = m[1].trim();
			// If it's a simple variable or dotted path, add both the full ref and the base var
			if (/^[A-Za-z_][A-Za-z0-9_.\[\]]*$/.test(expr)) {
				result.add(expr);
				const base = expr.split(/[.\[]/)[0];
				if (base) result.add(base);
				continue;
			}

			// Otherwise it's likely an expression; extract potential variable tokens
			for (const tok of expr.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
				const name = tok[0];
				if (!keywordBlacklist.has(name)) result.add(name);
			}
		}
		return result;
	}

	function endpointReadVars(endpoint: EndpointDefinition) {
		const vars = new Set<string>();
		varsFor(endpoint.url, vars);
		varsFor(endpoint.auth, vars);
		varsFor(endpoint.method, vars);
		varsFor(endpoint.body, vars);
		varsFor(endpoint.headers ?? endpoint.custom_headers, vars);
		function varsFor(v: unknown, set: Set<string>) {
			for (const e of extractEnvVarsFromValue(v)) set.add(e);
		}
		return vars;
	}

	function endpointProducedVar(endpoint: EndpointDefinition) {
		const responseDirective = isPlainObject(endpoint.response)
			? endpoint.response
			: null;
		return typeof responseDirective?.data_set_env === "string"
			? responseDirective.data_set_env
			: null;
	}

	// Worklist: greedy scheduler that runs any endpoint whose read vars are satisfied
	const work = normalized.slice();

	while (work.length > 0) {
		// find endpoint whose read vars are satisfied by current env
		let idx = work.findIndex((ep) => {
			const reads = endpointReadVars(ep);
			for (const r of reads) {
				const val = nextEnv[r];
				if (val === undefined || val === null || String(val) === "") {
					return false;
				}
			}
			return true;
		});

		// if none found, try to pick a producer (an endpoint that will set a var)
		if (idx === -1) {
			idx = work.findIndex((ep) => endpointProducedVar(ep) !== null);
		}

		// fallback to first endpoint
		if (idx === -1) idx = 0;

		const endpoint = work.splice(idx, 1)[0];
		const endpointKey = resolveEndpointCacheKey(endpoint);
		const ttlSeconds = resolveInvalidateAfterSeconds(endpoint);

		let resolvedEndpoint: ResolvedEndpointData | null = null;
		if (endpointKey && context.cache) {
			resolvedEndpoint = context.cache.get(endpointKey);
		}

		if (!resolvedEndpoint) {
			resolvedEndpoint = await getEndpointData(endpoint, {
				...context,
				env: nextEnv,
				scope: {
					...(context.scope ?? {}),
					endpoints: resolved,
				},
			}, allowInsecureEndpoints);

			if (endpointKey && context.cache && ttlSeconds !== null) {
				const expiresAt = Date.now() + ttlSeconds * 1000;
				context.cache.set(endpointKey, resolvedEndpoint, expiresAt);
			}
		}

		const key = resolvedEndpoint.id ?? resolvedEndpoint.name;
		if (key) resolved[key] = resolvedEndpoint;

		const responseDirective = isPlainObject(endpoint.response)
			? endpoint.response
			: null;
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

function resolveEndpointCacheKey(endpoint: EndpointDefinition): string | null {
	if (typeof endpoint.id === "string" && endpoint.id.trim()) {
		return endpoint.id.trim();
	}
	if (typeof endpoint.name === "string" && endpoint.name.trim()) {
		return endpoint.name.trim();
	}
	return null;
}

function resolveInvalidateAfterSeconds(
	endpoint: EndpointDefinition,
): number | null {
	const responseDirective = isPlainObject(endpoint.response)
		? endpoint.response
		: null;
	const invalidate = isPlainObject(responseDirective?.invalidate)
		? responseDirective.invalidate
		: null;
	const afterRaw = invalidate?.after;
	const parsed = Number(afterRaw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	return parsed;
}

export async function getEndpointData(
	endpoint: EndpointDefinition,
	context: EndpointResolutionContext,
	allowSsl?: boolean,
): Promise<ResolvedEndpointData> {
	const method = String(endpoint.method ?? "GET").toUpperCase();
	const resolvedUrl = resolveStringValue(String(endpoint.url ?? ""), context);
	const requestHeaders = resolveHeaders(endpoint, context);
	const requestBody = resolveBody(endpoint, context, method);

	// If we have a request body but no Content-Type header, default to JSON
	const hasContentType = Object.keys(requestHeaders).some((k) =>
		k.toLowerCase() === "content-type"
	);
	if (requestBody !== null && !hasContentType) {
		requestHeaders["content-type"] = "application/json";
	}
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
		console.log(`Fetching endpoint "${endpointLabel}"`, {
			method,
			url: resolvedUrl,
			headers: requestHeaders,
			body: requestBody,
		});
		const fetchOptions: RequestInit = {
			method,
			headers: requestHeaders,
			body: requestBody,
			signal: context.signal,
		};

		if (allowSsl) {
			(fetchOptions as any).tls = {
				rejectUnauthorized: false,
			};
		}

		response = await fetch(resolvedUrl, fetchOptions);
	} catch (error) {
		console.error(
			`Error fetching endpoint "${endpointLabel}" (${method} ${resolvedUrl}):`,
			error,
		);
		throw new Error(
			`Failed to fetch endpoint "${endpointLabel}" (${method} ${resolvedUrl}): ${
				getErrorMessage(error)
			}`,
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
		console.error(
			`Non-OK response for endpoint "${endpointLabel}" (${method} ${resolvedUrl}):`,
			{
				status: response.status,
				statusText: response.statusText,
				body: rawResponse,
			},
		);
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

function resolveHeaders(
	endpoint: EndpointDefinition,
	context: EndpointResolutionContext,
) {
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
	if (
		auth && !Object.keys(headers).some((key) =>
			key.toLowerCase() === "authorization"
		)
	) {
		headers.Authorization = auth;
	}

	return headers;
}

function resolveBody(
	endpoint: EndpointDefinition,
	context: EndpointResolutionContext,
	method: string,
) {
	if (["GET", "HEAD"].includes(method)) return null;

	const rawBody = endpoint.body;
	if (rawBody === undefined || rawBody === null) return null;

	const resolvedBody = resolveComputedFieldValue(rawBody, context as any);
	return typeof resolvedBody === "string"
		? resolvedBody
		: JSON.stringify(resolvedBody);
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
			mapped[target] = resolveMappedNode(source, {
				root: body as Record<string, any>,
				current: body as Record<string, any>,
				groupBy: typeof endpoint.group_by === "string"
					? endpoint.group_by
					: undefined,
			});
		}
	}

	return mapped;
}

type MappingContext = {
	root: Record<string, any>;
	current: any;
	groupBy?: string;
	index?: number;
};

function resolveMappedNode(node: any, context: MappingContext): any {
	if (node === undefined || node === null) return node;
	if (typeof node === "string") return resolveMappedString(node, context);
	if (typeof node === "number" || typeof node === "boolean") return node;
	if (isPlainObject(node) && typeof node.operation === "string") {
		return resolveMappedOperation(node, context);
	}
	if (Array.isArray(node)) {
		const merged: Record<string, any> = {};
		for (const entry of node) {
			const resolved = resolveMappedNode(entry, context);
			if (
				resolved && typeof resolved === "object" &&
				!Array.isArray(resolved)
			) {
				Object.assign(merged, resolved);
			}
		}
		return merged;
	}

	if (!isPlainObject(node)) return node;

	if (
		typeof node.iterate === "string" ||
		typeof node.iterate_over === "string"
	) {
		const iteratePath = typeof node.iterate === "string"
			? node.iterate
			: node.iterate_over;
		const source =
			getNestedValue(
				context.current as Record<string, any>,
				iteratePath,
			) ??
				getNestedValue(context.root, iteratePath);
		const items = Array.isArray(source)
			? source
			: source && typeof source === "object"
			? Object.values(source)
			: [];
		const slice = typeof node.slice === "string"
			? parseSlice(node.slice)
			: null;
		const sliced = slice ? items.slice(slice.start, slice.end) : items;
		const mappingShape = isPlainObject(node.mappingProperties)
			? node.mappingProperties
			: isPlainObject(node.properties)
			? node.properties
			: isPlainObject(node.fields)
			? node.fields
			: node;
		return sliced.map((item, index) =>
			resolveMappingProperties(mappingShape, {
				root: context.root,
				current: item,
				groupBy: context.groupBy,
				index,
			})
		);
	}

	if (typeof node.aggregate_over === "string") {
		const source =
			getNestedValue(
				context.current as Record<string, any>,
				node.aggregate_over,
			) ??
				getNestedValue(context.root, node.aggregate_over);
		const items = Array.isArray(source)
			? source
			: source && typeof source === "object"
			? Object.values(source)
			: [];

		if (context.groupBy && items.length > 0) {
			const groups = new Map<string, any[]>();
			for (const item of items) {
				const groupKey = String(
					getNestedValue(
						item as Record<string, any>,
						context.groupBy,
					) ?? "",
				);
				const nextGroup = groups.get(groupKey) ?? [];
				nextGroup.push(item);
				groups.set(groupKey, nextGroup);
			}

			const output: Record<string, any> = {};
			for (const [groupKey, groupItems] of groups.entries()) {
				output[groupKey] = resolveMappingProperties(node, {
					root: context.root,
					current: groupItems,
					groupBy: context.groupBy,
					index: 0,
				});
			}
			return output;
		}

		return resolveMappingProperties(node, {
			root: context.root,
			current: items,
			groupBy: context.groupBy,
			index: 0,
		});
	}

	return resolveMappingProperties(node, context);
}

function resolveMappingProperties(
	node: Record<string, any>,
	context: MappingContext,
	index = 0,
) {
	const output: Record<string, any> = {};
	for (const [key, value] of Object.entries(node)) {
		if (
			[
				"iterate",
				"iterate_over",
				"mappingProperties",
				"aggregate_over",
				"slice",
				"group_by",
			].includes(key)
		) {
			continue;
		}
		output[key] = resolveMappedNode(value, {
			root: context.root,
			current: context.current,
			groupBy: context.groupBy,
			index: context.index ?? index,
		});
	}
	return output;
}

function resolveMappedString(template: string, context: MappingContext) {
	const interpolated = template.replace(/\$\{([^}]+)\}/g, (_, key) => {
		const expr = key.trim();
		if (expr === "_index") return String(context.index ?? 0);
		const fromCurrent = getNestedValue(
			context.current as Record<string, any>,
			expr,
		);
		if (fromCurrent !== undefined && fromCurrent !== null) {
			return String(fromCurrent);
		}
		const fromRoot = getNestedValue(context.root, expr);
		if (fromRoot !== undefined && fromRoot !== null) {
			return String(fromRoot);
		}
		return "";
	});

	const trimmed = interpolated.trim();
	if (!trimmed) return "";

	const currentValue = getNestedValue(
		context.current as Record<string, any>,
		trimmed,
	);
	if (currentValue !== undefined) return currentValue;

	const rootValue = getNestedValue(context.root, trimmed);
	if (rootValue !== undefined) return rootValue;

	return trimmed;
}

function resolveMappedOperation(
	node: Record<string, any>,
	context: MappingContext,
) {
	const operation = String(node.operation ?? "").trim().toLowerCase();
	const source = node.field !== undefined ? node.field : node.value;
	const fallback = node.fallback;
	const transform = typeof node.transform === "string" ? node.transform : "";

	if (operation === "avg") {
		const list = Array.isArray(context.current) ? context.current : [];
		const values = list
			.map((item) =>
				resolveMappedNode(source, { ...context, current: item })
			)
			.map((value) => Number(value))
			.filter((value) => Number.isFinite(value));
		if (values.length === 0) return fallback;
		let result: any = values.reduce((sum, value) => sum + value, 0) /
			values.length;
		if (transform) result = applyMappedTransform(transform, result);
		return result;
	}

	if (operation === "nth_from_end") {
		const list = Array.isArray(context.current) ? context.current : [];
		const offset = Number(node.offset ?? 0);
		const index = list.length - 1 - (Number.isFinite(offset) ? offset : 0);
		if (index < 0 || index >= list.length) return fallback;
		let result = resolveMappedNode(source, {
			...context,
			current: list[index],
		});
		if (transform) result = applyMappedTransform(transform, result);
		return result === undefined || result === null ? fallback : result;
	}

	if (operation === "coalesce") {
		const fields = Array.isArray(node.fields) ? node.fields : [];
		for (const field of fields) {
			const resolved = resolveMappedNode(field, context);
			if (
				resolved !== undefined && resolved !== null &&
				String(resolved).trim() !== ""
			) {
				return resolved;
			}
		}
		return fallback;
	}

	const resolved = resolveMappedNode(source, context);
	if (transform) return applyMappedTransform(transform, resolved);
	return resolved === undefined || resolved === null ? fallback : resolved;
}

function applyMappedTransform(transform: string, value: any) {
	const normalized = transform.replace(/\bround\b/g, "Math.round");
	try {
		// eslint-disable-next-line no-new-func
		return new Function("value", `return (${normalized});`)(value);
	} catch {
		return value;
	}
}

function parseSlice(slice: string) {
	const match = slice.match(/^(\d+)\s*:\s*(\d+)?$/);
	if (!match) return null;
	return {
		start: Number(match[1]),
		end: match[2] ? Number(match[2]) : undefined,
	};
}

function resolveStringValue(
	template: string,
	context: EndpointResolutionContext,
) {
	return template.replace(/\$\{([^}]+)\}/g, (_, key) => {
		const expr = key.trim();

		// Simple variable or dotted path like VAR or VAR.sub.prop or VAR[0]
		if (/^[A-Za-z_][A-Za-z0-9_.\[\]]*$/.test(expr)) {
			const base = expr.split(/[.\[]/)[0];
			const raw = context.env[base];
			if (raw === undefined || raw === null) return "";

			const path = expr.slice(base.length);
			if (!path) return String(raw);

			const normalizedPath = path.replace(/^\./, "");

			let parsed: any = raw;
			if (typeof raw === "string") {
				try {
					parsed = JSON.parse(raw);
				} catch {
					parsed = raw;
				}
			}

			if (typeof parsed === "object" && parsed !== null) {
				const nested = getNestedValue(
					parsed as Record<string, any>,
					normalizedPath,
				);
				return nested === undefined || nested === null
					? ""
					: String(nested);
			}

			return String(raw);
		}

		// For computed expressions (e.g. if(...)), defer to the computed-field resolver
		try {
			const resolved = resolveComputedFieldValue(expr, context as any);
			return resolved === undefined || resolved === null
				? ""
				: String(resolved);
		} catch {
			return "";
		}
	});
}

function formatEnvValue(value: unknown) {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
