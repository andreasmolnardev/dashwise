// dashwise-integrationskit/data/getComputedField.tsx
//
// The integrations kit owns widget-level computed-field resolution for
// integration-backed widgets. The helpers here are shared by endpoint loading,
// computed-field evaluation, and widget rendering.

export type ComputedResolutionContext = {
	env: Record<string, string>;
	scope?: Record<string, any>;
};

export function getNestedValue(obj: Record<string, any>, path: string): any {
	if (!path) return undefined;

	const tokens = tokenizePath(path);
	return walkPath(obj, tokens);
}

export function flattenToEnv(
	obj: Record<string, any>,
	prefix = "",
): Record<string, string> {
	const out: Record<string, string> = {};

	for (const [key, value] of Object.entries(obj ?? {})) {
		const nextKey = prefix ? `${prefix}.${key}` : key;
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			Object.assign(out, flattenToEnv(value as Record<string, any>, nextKey));
		} else {
			out[nextKey] = value === null || value === undefined ? "" : String(value);
		}
	}

	return out;
}

export function interpolateString(template: string, env: Record<string, string>): string {
	return template.replace(/\$\{([^}]+)\}/g, (_, key) => env[key.trim()] ?? "");
}

export function resolveComputedFieldValue(
	value: any,
	context: ComputedResolutionContext,
): any {
	if (value === undefined || value === null) return value;
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "string") return resolveStringValue(value, context);
	if (Array.isArray(value)) {
		return value.map((entry) => resolveComputedFieldValue(entry, context));
	}

	if (typeof value === "object") {
		if (typeof value.operation === "string") {
			return resolveOperationValue(value, context);
		}

		const resolved: Record<string, any> = {};
		for (const [key, entry] of Object.entries(value)) {
			resolved[key] = resolveComputedFieldValue(entry, context);
		}
		return resolved;
	}

	return value;
}

export function resolveComputedFields(
	definitions: Record<string, any> | undefined,
	context: ComputedResolutionContext,
): Record<string, any> {
	const resolved: Record<string, any> = {};
	if (!definitions || typeof definitions !== "object") return resolved;

	for (const [key, definition] of Object.entries(definitions)) {
		const nextContext: ComputedResolutionContext = {
			...context,
			scope: {
				...(context.scope ?? {}),
				computed: resolved,
			},
		};
		resolved[key] = resolveComputedFieldValue(definition, nextContext);
	}

	return resolved;
}

function resolveStringValue(value: string, context: ComputedResolutionContext): any {
	const segments = value.split("???").map((segment) => segment.trim());
	let lastResolved: any = segments[segments.length - 1] ?? value;

	for (const segment of segments) {
		const resolved = resolveSegment(segment, context);
		if (resolved !== undefined && resolved !== null && `${resolved}`.trim() !== "") {
			return resolved;
		}
		lastResolved = resolved;
	}

	return lastResolved;
}

function resolveSegment(segment: string, context: ComputedResolutionContext): any {
	if (!segment) return "";

	const interpolated = interpolateString(segment, context.env).trim();
	if (!interpolated) return "";

	const direct = resolvePathReference(interpolated, context.scope ?? {});
	if (direct !== undefined) {
		return direct;
	}

	return parseMaybeJson(interpolated);
}

function resolvePathReference(path: string, scope: Record<string, any>): any {
	const normalized = path.replace(/^this\./, "");
	if (!isLikelyPathReference(normalized)) {
		return undefined;
	}

	if (normalized.startsWith("computed.")) {
		return getNestedValue(scope.computed ?? {}, normalized.slice("computed.".length));
	}

	if (normalized.startsWith("endpoints.")) {
		return getNestedValue(scope.endpoints ?? {}, normalized.slice("endpoints.".length));
	}

	return getNestedValue(scope, normalized);
}

function resolveOperationValue(def: Record<string, any>, context: ComputedResolutionContext): any {
	const operation = String(def.operation ?? "").trim().toLowerCase();
	const resolvedInputs = resolveComputedFieldValue(def.inputs ?? {}, context) as Record<string, any>;
	const fallback = def.fallback;

	if (operation === "join") {
		const raw = resolveComputedFieldValue(def.value, context);
		const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
		const separator = typeof def.separator === "string" ? def.separator : ", ";
		const transform = typeof def.transform === "string" ? def.transform : null;

		const joined = values
			.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
			.map((entry) => {
				if (transform && transform.includes("humanBytes")) {
					return humanBytes(entry);
				}
				return entry === null || entry === undefined ? "" : String(entry);
			})
			.filter(Boolean)
			.join(separator);

		return joined || fallback;
	}

	if (operation === "avg") {
		const raw = resolveComputedFieldValue(def.field ?? def.value, context);
		const values = Array.isArray(raw)
			? raw.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]))
			: [];
		const numeric = values
			.map((entry) => Number(entry))
			.filter((entry) => Number.isFinite(entry));

		if (numeric.length === 0) return fallback;
		return numeric.reduce((sum, entry) => sum + entry, 0) / numeric.length;
	}

	if (operation === "human_bytes") {
		const raw = resolveComputedFieldValue(def.value, context);
		return humanBytes(raw) || fallback;
	}

	if (operation === "index_lookup") {
		const source = resolveComputedFieldValue(def.source, context);
		const indexValue = resolveComputedFieldValue(def.index, context);
		const index = typeof indexValue === "number" ? indexValue : Number(indexValue);

		if (Array.isArray(source) && Number.isFinite(index)) {
			return source[index] ?? fallback;
		}

		if (source && typeof source === "object" && indexValue !== undefined && indexValue !== null) {
			return (source as Record<string, any>)[String(indexValue)] ?? fallback;
		}

		return fallback;
	}

	if (operation === "expr") {
		const expression = typeof def.expression === "string" ? def.expression : "";
		if (!expression) return fallback;

		try {
			const normalizedExpression = expression
				.replace(/\bor\b/g, "||")
				.replace(/\band\b/g, "&&")
				.replace(/\bnot\b/g, "!");
			const evaluator = new Function(
				...Object.keys(resolvedInputs),
				"round",
				"clamp",
				"humanBytes",
				"length",
				"isNaN",
				`return (${normalizedExpression});`,
			);
			return evaluator(
				...Object.values(resolvedInputs),
				Math.round,
				clamp,
				humanBytes,
				(value: any) => (Array.isArray(value) || typeof value === "string" ? value.length : 0),
				Number.isNaN,
			);
		} catch {
			return fallback;
		}
	}

	if (operation === "compute_health") {
		const raw = resolveComputedFieldValue(def.inputs?.value ?? def.value, context);
		return raw !== undefined && raw !== null ? raw : fallback;
	}

	const directValue = resolveComputedFieldValue(def.value ?? def.field ?? def.source, context);
	return directValue !== undefined && directValue !== null ? directValue : fallback;
}

function parseMaybeJson(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return value;
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;

	try {
		return JSON.parse(trimmed);
	} catch {
		return value;
	}
}

function humanBytes(value: any) {
	const bytes = Number(value);
	if (!Number.isFinite(bytes)) return value === undefined || value === null ? "" : String(value);
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let next = Math.abs(bytes);
	let unit = 0;

	while (next >= 1024 && unit < units.length - 1) {
		next /= 1024;
		unit += 1;
	}

	const sign = bytes < 0 ? "-" : "";
	const rounded = next >= 10 ? Math.round(next) : Math.round(next * 10) / 10;
	return `${sign}${rounded} ${units[unit]}`;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function tokenizePath(path: string) {
	const tokens: Array<string | number | "*"> = [];
	const pattern = /[^.\[\]]+|\[(\d+|\*)\]/g;
	for (const match of path.matchAll(pattern)) {
		const token = match[1] ?? match[0];
		if (token === "*") {
			tokens.push("*");
		} else if (/^\d+$/.test(token)) {
			tokens.push(Number(token));
		} else {
			tokens.push(token.replace(/^\[(.*)\]$/, "$1"));
		}
	}
	return tokens;
}

function walkPath(current: any, tokens: Array<string | number | "*">): any {
	if (tokens.length === 0) return current;

	const [token, ...rest] = tokens;
	if (token === "*") {
		if (!Array.isArray(current)) return undefined;
		return current.map((entry) => walkPath(entry, rest));
	}

	if (current === null || current === undefined) return undefined;

	if (Array.isArray(current)) {
		if (typeof token !== "number") return undefined;
		return walkPath(current[token], rest);
	}

	if (typeof current !== "object") return undefined;
	return walkPath((current as Record<string, any>)[String(token)], rest);
}

function isLikelyPathReference(value: string) {
	return /^(?:this\.)?(?:computed|endpoints|[A-Za-z_$][\w$-]*)(?:\.[A-Za-z_$][\w$-]*|\[(?:\d+|\*)\])*$/u.test(
		value.trim(),
	);
}
