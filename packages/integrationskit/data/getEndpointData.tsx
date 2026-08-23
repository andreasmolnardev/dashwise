// dashwise-integrationskit/data/getEndpointData.tsx
//
// Endpoint fetching lives in the integrations kit for integration-backed
// widgets. The helpers here resolve request config, execute the fetch, and
// return a normalized response object that computed fields can consume.

import { getNestedValue, resolveComputedFieldValue } from "./getComputedField";
import type {
  EndpointRuntimeCacheAdapter,
  ResolvedEndpointData,
} from "../types";
export type { EndpointRuntimeCacheAdapter, ResolvedEndpointData } from "../types";

export type EndpointDefinition = Record<string, any>;

export type EndpointResolutionContext = {
	env: Record<string, string>;
	scope?: Record<string, any>;
	signal?: AbortSignal;
	cache?: EndpointRuntimeCacheAdapter;
	rateLimit?: EndpointRateLimitConfig | null;
};

export type EndpointRateLimitConfig = {
	key: string;
	requestsPerSecond: number;
};

const inFlightEndpointRequests = new Map<string, Promise<ResolvedEndpointData>>();
const endpointRateLimitQueues = new Map<string, Promise<void>>();
const endpointRateLimitNextAt = new Map<string, number>();

export type EndpointCurlRequest = {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
};

export function getEndpointCurl(request: EndpointCurlRequest) {
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

/**
 * Gets all of an integrations endpoint data
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

		let resolvedEndpoint: ResolvedEndpointData | null = null;
		if (endpointKey && context.cache) {
			resolvedEndpoint = context.cache.get(endpointKey);
		}

		if (!resolvedEndpoint) {
			await waitForEndpointRateLimit(context.rateLimit, context.signal);

			resolvedEndpoint = await getEndpointData(endpoint, {
				...context,
				env: nextEnv,
				scope: {
					...(context.scope ?? {}),
					endpoints: resolved,
				},
			}, allowInsecureEndpoints);

			const expiresAt = resolveEndpointInvalidatesAt(endpoint, Date.now());
			if (endpointKey && context.cache && expiresAt !== null) {
				context.cache.set(endpointKey, resolvedEndpoint, expiresAt);
			}
		}

		const key = resolvedEndpoint.id ?? resolvedEndpoint.name;
		if (key) resolved[key] = resolvedEndpoint;

		setEndpointResponseEnv(endpoint, resolvedEndpoint, nextEnv);
	}

	return { endpoints: resolved, env: nextEnv };
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
	const requestKey = createEndpointRequestKey({
		method,
		resolvedUrl,
		requestHeaders,
		requestBody,
		allowSsl: allowSsl === true,
	});

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

	const endpointPromise = getOrCreateEndpointFetchPromise(
		requestKey,
		async () => {
			try {
				const now = new Date().toLocaleTimeString("en-GB", { hour12: false });
				const fetchOptions: RequestInit = {
					method,
					headers: requestHeaders,
					body: requestBody,
				};

				if (allowSsl) {
					(fetchOptions as any).tls = {
						rejectUnauthorized: false,
					};
				}

					const response = await fetch(resolvedUrl, fetchOptions);
					const contentType = response.headers.get("content-type") ?? "";
					const rawResponse = contentType.includes("application/json")
						? await response.json().catch(async () => await response.text())
						: await response.text();

					if (response.status === 401 && hasAuthorizationHeader(requestHeaders)) {
						const retryHeaders = withoutAuthorizationHeader(requestHeaders);
						const retryResponse = await fetch(resolvedUrl, {
							...fetchOptions,
							headers: retryHeaders,
						});
						const retryContentType = retryResponse.headers.get("content-type") ?? "";
						const retryRawResponse = retryContentType.includes("application/json")
							? await retryResponse.json().catch(async () => await retryResponse.text())
							: await retryResponse.text();

						if (retryResponse.ok) {
							return {
								id: typeof endpoint.id === "string" ? endpoint.id : null,
								name: typeof endpoint.name === "string" ? endpoint.name : null,
								method,
								url: typeof endpoint.url === "string" ? endpoint.url : "",
								resolvedUrl,
								requestHeaders: retryHeaders,
								requestBody,
								rawResponse: retryRawResponse,
								mappedResponse: mapResponseBody(retryRawResponse, endpoint, context.env),
							};
						}

						return throwEndpointFetchError({
							endpointLabel,
							method,
							resolvedUrl,
							response: retryResponse,
							rawResponse: retryRawResponse,
						});
					}

					if (!response.ok) {
						return throwEndpointFetchError({
							endpointLabel,
							method,
							resolvedUrl,
							response,
							rawResponse,
						});
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
					mappedResponse: mapResponseBody(rawResponse, endpoint, context.env),
				};
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
		},
	);

	return await waitForEndpointFetch(endpointPromise, context.signal);
}

function setEndpointResponseEnv(
	endpoint: EndpointDefinition,
	resolvedEndpoint: ResolvedEndpointData,
	env: Record<string, string>,
) {
	const responseDirective = isPlainObject(endpoint.response)
		? endpoint.response
		: null;
	const dataSetEnv = typeof responseDirective?.data_set_env === "string"
		? responseDirective.data_set_env
		: null;
	const dataPath = typeof responseDirective?.data_path === "string"
		? responseDirective.data_path
		: undefined;

	if (!dataSetEnv) return;

	let nextValue: unknown = undefined;

	if (dataPath) {
		if (isPlainObject(resolvedEndpoint.mappedResponse)) {
			nextValue = getNestedValue(
				resolvedEndpoint.mappedResponse as Record<string, any>,
				dataPath,
			);
		}

		if (nextValue === undefined) {
			if (isPlainObject(resolvedEndpoint.rawResponse)) {
				nextValue = getNestedValue(
					resolvedEndpoint.rawResponse as Record<string, any>,
					dataPath,
				);
			}
			if (nextValue === undefined && resolvedEndpoint.mappedResponse !== undefined) {
				nextValue = resolvedEndpoint.mappedResponse;
			}
		}
	} else {
		nextValue = resolvedEndpoint.mappedResponse ?? resolvedEndpoint.rawResponse;
	}

	if (nextValue !== undefined && nextValue !== null) {
		env[dataSetEnv] = formatEnvValue(nextValue);
	}
}

function selectNextEndpointIndex(
	work: EndpointDefinition[],
	env: Record<string, string>,
) {
	const readyIndex = work.findIndex((endpoint) => {
		const reads = endpointReadVars(endpoint);
		return [...reads].every((readVar) => {
			const val = env[readVar];
			return val !== undefined && val !== null && String(val) !== "";
		});
	});

	if (readyIndex !== -1) return readyIndex;

	const producerIndex = work.findIndex((endpoint) => endpointProducedVar(endpoint) !== null);
	return producerIndex !== -1 ? producerIndex : 0;
}

function endpointReadVars(endpoint: EndpointDefinition) {
	const vars = new Set<string>();
	collectEnvVars(endpoint.url, vars);
	collectEnvVars(endpoint.auth, vars);
	collectEnvVars(endpoint.method, vars);
	collectEnvVars(endpoint.body, vars);
	collectEnvVars(endpoint.headers ?? endpoint.custom_headers, vars);
	return vars;
}

function collectEnvVars(value: unknown, vars: Set<string>) {
	for (const envVar of extractEnvVarsFromValue(value)) {
		vars.add(envVar);
	}
}

function endpointProducedVar(endpoint: EndpointDefinition) {
	const responseDirective = isPlainObject(endpoint.response)
		? endpoint.response
		: null;
	return typeof responseDirective?.data_set_env === "string"
		? responseDirective.data_set_env
		: null;
}

function extractEnvVarsFromValue(value: unknown): Set<string> {
	const result = new Set<string>();
	if (value === undefined || value === null) return result;

	let text = "";
	if (typeof value === "string") {
		text = value;
	} else {
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

	for (const match of text.matchAll(/\$\{([^}]+)\}/g)) {
		if (!match[1]) continue;
		const expr = match[1].trim();
		if (/^[A-Za-z_][A-Za-z0-9_.\[\]]*$/.test(expr)) {
			result.add(expr);
			const base = expr.split(/[.\[]/)[0];
			if (base) result.add(base);
			continue;
		}

		for (const tok of expr.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
			const name = tok[0];
			if (!keywordBlacklist.has(name)) result.add(name);
		}
	}
	return result;
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

function resolveEndpointInvalidatesAt(
	endpoint: EndpointDefinition,
	now: number,
): number | null {
	const responseDirective = isPlainObject(endpoint.response)
		? endpoint.response
		: null;
	const invalidate = isPlainObject(responseDirective?.invalidate)
		? responseDirective.invalidate
		: null;
	const after = parseCacheDuration(
		invalidate?.after ?? invalidate?.duration ?? endpoint.invalidate_after ?? endpoint.cache_ttl,
	);
	if (after !== null) return now + after * 1000;

	const every = parseCacheInterval(
		invalidate?.every ?? invalidate?.schedule ?? endpoint.invalidate_every,
	);
	return every ? getNextCacheBoundary(every, now) : null;
}

type CacheInterval = {
	count: number;
	unit: "second" | "minute" | "hour" | "day" | "week" | "month";
};

function parseCacheDuration(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) && value > 0 ? value : null;
	}

	if (typeof value !== "string") return null;
	const match = value.trim().toLowerCase().match(
		/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|mo|month|months)$/,
	);
	if (!match) return null;

	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return null;
	const unit = match[2];
	const multiplier = /^s/.test(unit) || unit === "second" || unit === "seconds"
		? 1
		: /^(m|min)/.test(unit) || unit === "minute" || unit === "minutes"
		? 60
		: /^(h|hr)/.test(unit) || unit === "hour" || unit === "hours"
		? 60 * 60
		: /^(d|day)/.test(unit)
		? 24 * 60 * 60
		: /^(w|week)/.test(unit)
		? 7 * 24 * 60 * 60
		: 30 * 24 * 60 * 60;
	return amount * multiplier;
}

function parseCacheInterval(value: unknown): CacheInterval | null {
	if (typeof value !== "string") return null;
	const match = value.trim().toLowerCase().replace(/^every\s+/, "").match(
		/^(\d+(?:\.\d+)?)?\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks|mo|month|months)$/,
	);
	if (!match) return null;

	const count = match[1] ? Number(match[1]) : 1;
	if (!Number.isFinite(count) || count <= 0) return null;
	const rawUnit = match[2];
	const unit: CacheInterval["unit"] = /^(s|sec|secs|second|seconds)$/.test(rawUnit)
		? "second"
		: /^(m|min|mins|minute|minutes)$/.test(rawUnit)
		? "minute"
		: /^(h|hr|hrs|hour|hours)$/.test(rawUnit)
		? "hour"
		: /^(d|day|days)$/.test(rawUnit)
		? "day"
		: /^(w|week|weeks)$/.test(rawUnit)
		? "week"
		: "month";
	return { count, unit };
}

function getNextCacheBoundary(interval: CacheInterval, now: number) {
	const date = new Date(now);
	if (interval.unit === "month") {
		const monthIndex = date.getFullYear() * 12 + date.getMonth();
		const nextMonth = Math.floor(monthIndex / interval.count + 1) * interval.count;
		return new Date(Math.floor(nextMonth / 12), nextMonth % 12, 1).getTime();
	}

	if (interval.unit === "day") {
		const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + interval.count);
		return next.getTime();
	}

	if (interval.unit === "week") {
		const mondayOffset = (date.getDay() + 6) % 7;
		const next = new Date(
			date.getFullYear(),
			date.getMonth(),
			date.getDate() - mondayOffset + interval.count * 7,
		);
		return next.getTime();
	}

	const unitMs = interval.unit === "second"
		? 1000
		: interval.unit === "minute"
		? 60 * 1000
		: 60 * 60 * 1000;
	const next = Math.floor(now / (unitMs * interval.count) + 1) * unitMs * interval.count;
	return next > now ? next : now + unitMs;
}

function getOrCreateEndpointFetchPromise(
	requestKey: string,
	createFetchPromise: () => Promise<ResolvedEndpointData>,
) {
	const existing = inFlightEndpointRequests.get(requestKey);
	if (existing) {
		return existing;
	}

	const pending = createFetchPromise().finally(() => {
		const current = inFlightEndpointRequests.get(requestKey);
		if (current === pending) {
			inFlightEndpointRequests.delete(requestKey);
		}
	});

	inFlightEndpointRequests.set(requestKey, pending);
	return pending;
}

function waitForEndpointFetch(
	endpointPromise: Promise<ResolvedEndpointData>,
	signal?: AbortSignal,
) {
	if (!signal) {
		return endpointPromise;
	}

	if (signal.aborted) {
		return Promise.reject(abortError());
	}

	return Promise.race([
		endpointPromise,
		new Promise<ResolvedEndpointData>((_, reject) => {
			const onAbort = () => {
				signal.removeEventListener("abort", onAbort);
				reject(abortError());
			};

			signal.addEventListener("abort", onAbort, { once: true });
		}),
	]);
}

async function waitForEndpointRateLimit(
	rateLimit?: EndpointRateLimitConfig | null,
	signal?: AbortSignal,
) {
	if (!rateLimit || !rateLimit.key || rateLimit.requestsPerSecond <= 0) return;

	const intervalMs = Math.ceil(1000 / rateLimit.requestsPerSecond);
	const previous = endpointRateLimitQueues.get(rateLimit.key) ?? Promise.resolve();

	const next = previous.catch(() => {}).then(async () => {
		if (signal?.aborted) throw abortError();

		const now = Date.now();
		const availableAt = endpointRateLimitNextAt.get(rateLimit.key) ?? now;
		const delayMs = Math.max(0, availableAt - now);

		if (delayMs > 0) {
			await delayWithAbort(delayMs, signal);
		}

		endpointRateLimitNextAt.set(rateLimit.key, Date.now() + intervalMs);
	});

	endpointRateLimitQueues.set(rateLimit.key, next.finally(() => {
		if (endpointRateLimitQueues.get(rateLimit.key) === next) {
			endpointRateLimitQueues.delete(rateLimit.key);
		}
	}));

	await next;
}

function delayWithAbort(ms: number, signal?: AbortSignal) {
	if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
	if (signal.aborted) return Promise.reject(abortError());

	return new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			signal.removeEventListener("abort", onAbort);
			reject(abortError());
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function abortError() {
	return new Error("Endpoint fetch aborted");
}

function createEndpointRequestKey(input: {
	method: string;
	resolvedUrl: string;
	requestHeaders: Record<string, string>;
	requestBody: string | null;
	allowSsl: boolean;
}) {
	const requestHeaders = Object.entries(input.requestHeaders)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => [key, value]);

	return JSON.stringify({
		method: input.method,
		resolvedUrl: input.resolvedUrl,
		requestBody: input.requestBody,
		requestHeaders,
		allowSsl: input.allowSsl,
	});
}

function hasAuthorizationHeader(headers: Record<string, string>) {
	return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

function withoutAuthorizationHeader(headers: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(headers).filter(([key]) => key.toLowerCase() !== "authorization"),
	);
}

function throwEndpointFetchError(input: {
	endpointLabel: string;
	method: string;
	resolvedUrl: string;
	response: Response;
	rawResponse: unknown;
}): never {
	const responseSummary = typeof input.rawResponse === "string"
		? input.rawResponse.trim()
		: JSON.stringify(input.rawResponse);
	const suffix = responseSummary ? ` - ${responseSummary}` : "";
	console.error(
		`Non-OK response for endpoint "${input.endpointLabel}" (${input.method} ${input.resolvedUrl}):`,
		{
			status: input.response.status,
			statusText: input.response.statusText,
			body: input.rawResponse,
		},
	);
	throw new Error(
		`Failed to fetch endpoint "${input.endpointLabel}" (${input.method} ${input.resolvedUrl}): ${input.response.status} ${input.response.statusText}${suffix}`,
	);
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
		const resolved = resolveStringValue(String(value ?? ""), context).trim();
		if (!resolved) continue;
		if (key.toLowerCase() === "authorization" && isEmptyAuthorizationHeader(resolved)) continue;
		headers[key] = resolved;
	}

	const auth = resolveAuthHeaderValue(endpoint.auth, context);
	if (auth && !Object.keys(headers).some((key) => key.toLowerCase() === "authorization")) {
		headers.Authorization = auth;
	}

	if (!Object.keys(headers).some((key) => key.toLowerCase() === "user-agent")) {
		headers["User-Agent"] = "Dashwise";
	}

	return headers;
}

function isEmptyAuthorizationHeader(value: string) {
	return /^(bearer|token|basic)\s*$/i.test(value.trim());
}

function resolveAuthHeaderValue(
	authDefinition: unknown,
	context: EndpointResolutionContext,
) {
	if (authDefinition === undefined || authDefinition === null) return "";

	if (typeof authDefinition === "string") {
		const auth = resolveStringValue(authDefinition, context).trim();
		if (!auth || /^(bearer|basic|token)$/i.test(auth)) return "";
		return auth;
	}

	if (!isPlainObject(authDefinition)) return "";

	const type = String(authDefinition.type ?? "").trim().toLowerCase();
	if (type === "bearer" || type === "token") {
		const token = resolveStringValue(String(authDefinition.token ?? ""), context).trim();
		return token ? `Bearer ${token}` : "";
	}

	if (type === "basic") {
		const username = resolveStringValue(String(authDefinition.username ?? ""), context);
		const password = resolveStringValue(String(authDefinition.password ?? ""), context);
		return username || password ? `Basic ${btoa(`${username}:${password}`)}` : "";
	}

	return "";
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

function mapResponseBody(body: unknown, endpoint: EndpointDefinition, env: Record<string, string> = {}) {
	const responseDirective = isPlainObject(endpoint.response)
		? endpoint.response
		: null;
	const dataPath = typeof responseDirective?.data_path === "string"
		? responseDirective.data_path
		: "";

	const responseRoot = dataPath
		? getNestedValue(body as Record<string, any>, dataPath)
		: body;

	const mappings = Array.isArray(endpoint.response_mappings)
		? endpoint.response_mappings
		: isPlainObject(endpoint.response_mapping)
		? [endpoint.response_mapping]
		: [];

	if (mappings.length === 0) {
		return responseRoot;
	}

	let wrappedBody: unknown;
	if (Array.isArray(responseRoot)) {
		if (dataPath) {
			const parts = String(dataPath).split('.');
			const key = parts[parts.length - 1] || 'response';
			wrappedBody = { [key]: responseRoot };
		} else {
			wrappedBody = { response: responseRoot };
		}
	} else {
		wrappedBody = responseRoot;
	}

	if (!isPlainObject(wrappedBody)) {
		return responseRoot;
	}

	const discardFlag = String(endpoint.discard_unmapped).toLowerCase();
	const discardUnmapped = discardFlag === "false" ? false : true;
	const mapped: Record<string, any> = discardUnmapped
		? {}
		: { ...(wrappedBody as Record<string, any>) };

	for (const mapping of mappings) {
		if (!isPlainObject(mapping)) continue;
		for (const [target, source] of Object.entries(mapping)) {
				mapped[target] = resolveMappedNode(source, {
					root: wrappedBody as Record<string, any>,
					current: wrappedBody as Record<string, any>,
					groupBy: typeof endpoint.group_by === "string"
						? endpoint.group_by
						: undefined,
					env,
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
	env?: Record<string, string>;
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

	// Handle iterate: for mapping array responses
	// - iterate: "items" looks for an "items" key in the response: { items: [...] }
	// - iterate: "response" works with direct array responses: [...] (automatically wrapped)
	// See packages/assets/integrations/ for integration examples
	if (
		typeof node.iterate === "string" ||
		typeof node.iterate_over === "string"
	) {
		const iteratePath = typeof node.iterate === "string"
			? node.iterate
			: node.iterate_over;
		const source = getNestedValue(
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
			const filtered = typeof node.filter === "string"
				? sliced.filter((item, index) => evaluateMappedFilter(node.filter, {
					root: context.root,
					current: item,
					groupBy: context.groupBy,
					index,
					env: context.env,
				}))
				: sliced;
			const mappingShape = isPlainObject(node.mappingProperties)
				? node.mappingProperties
			: isPlainObject(node.properties)
			? node.properties
			: isPlainObject(node.fields)
			? node.fields
			: node;
			return filtered.map((item, index) =>
				resolveMappingProperties(mappingShape, {
					root: context.root,
					current: item,
					groupBy: context.groupBy,
					index,
					env: context.env,
				})
			);
	}

	if (typeof node.aggregate_over === "string") {
		const source = getNestedValue(
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
					"filter",
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
			env: context.env,
		});
	}
	return output;
}

function evaluateMappedFilter(filter: string, context: MappingContext): boolean {
	const resolved = filter.replace(/\$\{([^}]+)\}/g, (_, key) => {
		const expr = String(key).trim();
		const mapped = resolveMappedPathFromContext(expr, context);
		if (mapped !== undefined && mapped !== null) return String(mapped);
		return context.env?.[expr] ?? "";
	}).trim();

	const andParts = resolved.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
	if (andParts.length > 1) {
		return andParts.every((part) => evaluateMappedFilter(part, context));
	}

	const comparison = resolved.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*'?([^']+)'?\s*$/);
	if (!comparison) return Boolean(resolveMappedPathFromContext(resolved, context) ?? resolved);

	const left = normalizeMappedFilterValue(resolveMappedPathFromContext(comparison[1].trim(), context) ?? comparison[1]);
	const right = normalizeMappedFilterValue(comparison[3]);

	switch (comparison[2]) {
		case "==": return left === right;
		case "!=": return left !== right;
		case ">=": return left >= right;
		case "<=": return left <= right;
		case ">": return left > right;
		case "<": return left < right;
		default: return false;
	}
}

function normalizeMappedFilterValue(value: unknown) {
	const raw = String(value ?? "").replace(/^['"](.*)['"]$/, "$1").trim();
	const timestamp = Date.parse(raw);
	if (Number.isFinite(timestamp)) return timestamp;
	const number = Number(raw);
	if (Number.isFinite(number)) return number;
	return raw;
}

function resolveMappedString(template: string, context: MappingContext) {
	const hasTemplatePlaceholders = template.includes("${");

	if (!hasTemplatePlaceholders) {
		const expr = template.trim();
		if (!expr) return "";
		const resolved = resolveMappedPathFromContext(expr, context);
		return resolved === undefined || resolved === null ? "" : resolved;
	}

	const interpolated = template.replace(/\$\{([^}]+)\}/g, (_, key) => {
		const expr = key.trim();
		const resolved = resolveMappedPathFromContext(expr, context);
		if (resolved !== undefined && resolved !== null) {
			return String(resolved);
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

function resolveMappedPathFromContext(
	expr: string,
	context: MappingContext,
) {
	const trimmedExpr = expr.trim();
	if (!trimmedExpr) return undefined;
	if (trimmedExpr === "_index") return context.index ?? 0;

	const fromCurrent = getNestedValue(
		context.current as Record<string, any>,
		trimmedExpr,
	);
	if (fromCurrent !== undefined && fromCurrent !== null) {
		return fromCurrent;
	}

	const fromRoot = getNestedValue(context.root, trimmedExpr);
	if (fromRoot !== undefined && fromRoot !== null) {
		return fromRoot;
	}

	// Beszel and some APIs nest compact metric keys under `info`.
	// If token/path is unresolved at current/root level, try `info.<token>`.
	if (!trimmedExpr.startsWith("info.")) {
		const infoExpr = `info.${trimmedExpr}`;
		const fromCurrentInfo = getNestedValue(
			context.current as Record<string, any>,
			infoExpr,
		);
		if (fromCurrentInfo !== undefined && fromCurrentInfo !== null) {
			return fromCurrentInfo;
		}

		const fromRootInfo = getNestedValue(context.root, infoExpr);
		if (fromRootInfo !== undefined && fromRootInfo !== null) {
			return fromRootInfo;
		}
	}

	return undefined;
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

	if (operation === "count" || operation === "length") {
		const resolved = resolveMappedNode(source, context);
		if (Array.isArray(resolved) || typeof resolved === "string") return resolved.length;
		if (resolved && typeof resolved === "object") return Object.keys(resolved).length;
		return fallback ?? 0;
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
