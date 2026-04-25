// dashwise-integrationskit/data/getComputedField.tsx
//
// The integrations kit owns widget-level computed-field resolution for
// integration-backed widgets. The helpers here are shared by endpoint loading,
// computed-field evaluation, and widget rendering.

import getLookupTableValue from "./resolvers/lookupTable";
import { ExpressionParser, resolveMathOperation, tokenizeExpression } from "./resolvers/math";

export type ComputedResolutionContext = {
	env: Record<string, string>;
	scope?: Record<string, any>;
	current?: Record<string, any>;
	currentKey?: string;
	currentField?: string;
	aliases?: Record<string, any>;
};

export function getNestedValue(
	obj: Record<string, any>,
	path: string,
	context?: ComputedResolutionContext,
): any {
	if (!path) return undefined;

	const tokens = tokenizePath(path);
	return walkPath(obj, tokens, context);
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

export function interpolateString(
	template: string,
	env: Record<string, string>,
	context?: ComputedResolutionContext,
): string {
	let result = template;
	let passes = 0;
	const placeholderPattern = /\$\{([^${}]*)\}/g;

	// Resolve innermost placeholders first so nested tokens like
	// ${system[${prop.property}]} are expanded in two passes.
	while (passes < 20 && result.includes("${")) {
		let didReplace = false;
		result = result.replace(placeholderPattern, (_, key) => {
			didReplace = true;
			const trimmed = String(key).trim();
			if (Object.prototype.hasOwnProperty.call(env, trimmed)) {
				return env[trimmed] ?? "";
			}

			if (context) {
				const resolved = resolvePathReference(trimmed, context);
				return resolved === undefined || resolved === null ? "" : String(resolved);
			}

			return "";
		});

		if (!didReplace) {
			break;
		}

		passes += 1;
	}

	return result;
}

function normalizeComputedExpression(expression: string) {
	return expression.replace(/\bnow\(\)/g, String(Date.now()));
}

function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
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

function coerceComparableValue(value: any) {
	if (typeof value === "number") return value;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (value === undefined || value === null) return value;

	const numeric = Number(value);
	if (Number.isFinite(numeric)) return numeric;

	const parsed = Date.parse(String(value));
	if (Number.isFinite(parsed)) return parsed;

	return value;
}

export function  resolveComputedFieldValue(
	value: any,
	context: ComputedResolutionContext,
): any {
	if (value === undefined || value === null) return value;
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "string") return resolveStringValue(value, context);
	if (Array.isArray(value)) {
		return value.map((entry) => resolveComputedFieldValue(entry, context));
	}
	if (isPlainObject(value)) {
		return resolveObjectValue(value, context);
	}
	return value;
}

function resolveObjectValue(
	value: Record<string, any>,
	context: ComputedResolutionContext,
) {
	const operation = typeof value.operation === "string"
		? value.operation.trim().toLowerCase()
		: undefined;

	if (operation === "expand" && value.on !== undefined) {
		return resolveExpandedComputedValue(value, context);
	}

	if (value.iterate_over !== undefined) {
		return resolveIteratedComputedValue(value, context);
	}

	if (operation) {
		return resolveOperationValue(value, context);
	}

	const resolved: Record<string, any> = {};
	for (const [key, entry] of Object.entries(value)) {
		resolved[key] = resolveComputedFieldValue(entry, context);
	}
	return resolved;
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
		const ifResult = resolveInlineIfExpression(segment, context);
		if (ifResult !== undefined) {
			if (ifResult !== null && `${ifResult}`.trim() !== "") {
				return ifResult;
			}
			lastResolved = ifResult;
			continue;
		}

		const interpolated = interpolateString(segment, context.env, context).trim();
		if (interpolated !== "") {
			const direct = resolvePathReference(interpolated, context);
			if (direct !== undefined) return direct;
		}

		const resolved = resolveSegment(segment, context);
		if (resolved !== undefined && resolved !== null && `${resolved}`.trim() !== "") {
			return resolved;
		}
		lastResolved = resolved;
	}

	return lastResolved;
}

function resolveInlineIfExpression(segment: string, context: ComputedResolutionContext): any {
	const trimmed = segment.trim();
	const match = trimmed.match(/^if\s*\((.*)\)$/is);
	if (!match) return undefined;

	const parts = splitTopLevelArguments(match[1]);
	if (parts.length < 3) return undefined;

	const condition = parts[0] ?? "";
	const whenTrue = parts[1] ?? "";
	const whenFalse = parts.slice(2).join(",");
	const resolvedCondition = interpolateString(condition.trim(), context.env, context).trim();
	const result = evaluateInlineCondition(resolvedCondition, context);
	return result ? resolveSegment(whenTrue, context) : resolveSegment(whenFalse, context);
}

function evaluateInlineCondition(condition: string, context: ComputedResolutionContext): boolean {
	const trimmed = condition.trim();
	if (!trimmed) return false;
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;

	const notContains = trimmed.match(/^(.+?)\s+not\s+contains\s+'?([^']+)'?\s*$/i);
	if (notContains) {
		const lhs = String(resolveSegment(notContains[1].trim(), context) ?? notContains[1]).toLowerCase();
		return !lhs.includes(notContains[2].toLowerCase());
	}

	const contains = trimmed.match(/^(.+?)\s+contains\s+'?([^']+)'?\s*$/i);
	if (contains) {
		const lhs = String(resolveSegment(contains[1].trim(), context) ?? contains[1]).toLowerCase();
		return lhs.includes(contains[2].toLowerCase());
	}

	const comparison = trimmed.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
	if (comparison) {
		const left = resolveSegment(comparison[1].trim(), context);
		const right = resolveSegment(comparison[3].trim(), context);
		return compareConditionValues(left, right, comparison[2]);
	}

	const resolved = resolveSegment(trimmed, context);
	if (typeof resolved === "boolean") return resolved;
	if (resolved === undefined || resolved === null) return false;
	return `${resolved}`.trim() !== "" && `${resolved}` !== "0";
}

function compareConditionValues(left: any, right: any, operator: string) {
	const a = coerceComparableValue(left);
	const b = coerceComparableValue(right);

	switch (operator) {
		case ">":
			return a > b;
		case "<":
			return a < b;
		case ">=":
			return a >= b;
		case "<=":
			return a <= b;
		case "!=":
			return a !== b;
		default:
			return a === b;
	}
}

function splitTopLevelArguments(value: string) {
	const parts: string[] = [];
	let current = "";
	let depth = 0;
	let quote: string | null = null;

	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (quote) {
			current += char;
			if (char === "\\" && index + 1 < value.length) {
				current += value[index + 1];
				index += 1;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}

		if (char === "(") {
			depth += 1;
			current += char;
			continue;
		}

		if (char === ")") {
			depth = Math.max(0, depth - 1);
			current += char;
			continue;
		}

		if (char === "," && depth === 0) {
			parts.push(current.trim());
			current = "";
			continue;
		}

		current += char;
	}

	if (current.trim()) parts.push(current.trim());
	return parts;
}

function resolveSegment(segment: string, context: ComputedResolutionContext): any {
	if (!segment) return "";

	const interpolated = interpolateString(segment, context.env, context).trim();
	if (!interpolated) return "";

	const direct = resolvePathReference(interpolated, context);
	if (direct !== undefined) {
		return direct;
	}

	return parseMaybeJson(interpolated);
}

function resolvePathReference(path: string, context: ComputedResolutionContext): any {
	const scope = context.scope ?? {};
	let normalized = path.replace(/^this\./, "");
	const currentKey = context.currentKey ?? context.current?.id ?? context.current?.name;
	if (normalized.includes("[]") && currentKey !== undefined && currentKey !== null) {
		normalized = normalized.replace(/\[\]/g, `[${String(currentKey)}]`);
	}
	if (!isLikelyPathReference(normalized)) {
		return undefined;
	}

	const aliases: Record<string, any> = {
		...(scope.aliases ?? {}),
		...(context.aliases ?? {}),
	};

	for (const [aliasName, aliasValue] of Object.entries(aliases)) {
		if (
			normalized === aliasName ||
			normalized.startsWith(`${aliasName}.`) ||
			normalized.startsWith(`${aliasName}[`)
		) {
			const remainder = normalized.slice(aliasName.length);
			const lookupPath = remainder.startsWith(".") ? remainder.slice(1) : remainder;
			return lookupPath
				? getNestedValue(aliasValue, lookupPath, context)
				: aliasValue;
		}
	}

	if (normalized.startsWith("computed.")) {
		return getNestedValue(scope.computed ?? {}, normalized.slice("computed.".length), context);
	}

	if (normalized.startsWith("endpoints.")) {
		return getNestedValue(scope.endpoints ?? {}, normalized.slice("endpoints.".length), context);
	}

	if (context.current !== undefined) {
		const currentValue = getNestedValue(context.current, normalized, context);
		if (currentValue !== undefined) {
			return currentValue;
		}
	}

	if (scope.current !== undefined) {
		const currentValue = getNestedValue(scope.current, normalized, context);
		if (currentValue !== undefined) {
			return currentValue;
		}
	}

	return getNestedValue(scope, normalized, context);
}

function resolveIteratedComputedValue(
	def: Record<string, any>,
	context: ComputedResolutionContext,
): any {
	const { entries, alias } = resolveIterateeEntries(def.iterate_over, context);
	const fieldDefinitions = isPlainObject(def.fields) ? def.fields : {};

	if (def.initial_value !== undefined) {
		let accumulator = resolveComputedFieldValue(def.initial_value, context);
		const reductionDef = { ...def, iterate_over: undefined, initial_value: undefined };

		for (const [index, entry] of entries.entries()) {
			const item = entry.value;
			const itemKey = entry.key ?? String(index);
			const itemEnv = isPlainObject(item) ? flattenToEnv(item) : {};
			let itemAliases = alias
				? { ...(context.aliases ?? {}), [alias]: item }
				: context.aliases;

			if (context.currentField && itemAliases) {
				const patchedAliases: Record<string, any> = { ...itemAliases };
				for (const [aliasName, aliasValue] of Object.entries(itemAliases)) {
					if (isPlainObject(aliasValue)) {
						patchedAliases[aliasName] = {
							...aliasValue,
							[context.currentField]: accumulator,
						};
					}
				}
				itemAliases = patchedAliases;
			}

			const itemContext: ComputedResolutionContext = {
				...context,
				env: {
					...context.env,
					...itemEnv,
					...(context.currentField
						? { [context.currentField]: accumulator === undefined || accumulator === null ? "" : String(accumulator) }
						: {}),
				},
				scope: {
					...(context.scope ?? {}),
					current: item,
					item,
					currentKey: itemKey,
					computed: context.currentField ? { [context.currentField]: accumulator } : {},
					aliases: itemAliases,
				},
				current: isPlainObject(item) ? item : undefined,
				currentKey: itemKey,
				aliases: itemAliases,
			};

			if (def.filter !== undefined && !evaluateComputedFilter(def.filter, itemContext)) {
				continue;
			}

			const nextValue = resolveComputedFieldValue(reductionDef, itemContext);
			if (nextValue !== undefined && nextValue !== null) {
				accumulator = nextValue;
			}
		}

		return accumulator;
	}

	const resolved: Record<string, any> = {};

	for (const [index, entry] of entries.entries()) {
		const item = entry.value;
		const itemKey = entry.key ?? String(index);
		const itemEnv = isPlainObject(item) ? flattenToEnv(item) : {};
		const resolvedFields: Record<string, any> = {};
		const itemAliases = alias
			? { ...(context.aliases ?? {}), [alias]: item }
			: context.aliases;
		const itemContext: ComputedResolutionContext = {
			...context,
			env: {
				...context.env,
				...itemEnv,
			},
			scope: {
				...(context.scope ?? {}),
				current: item,
				item,
				currentKey: itemKey,
				computed: resolvedFields,
				aliases: itemAliases,
			},
			current: isPlainObject(item) ? item : undefined,
			currentKey: itemKey,
			aliases: itemAliases,
		};

		if (def.filter !== undefined && !evaluateComputedFilter(def.filter, itemContext)) {
			continue;
		}

		for (const [fieldKey, fieldDefinition] of Object.entries(fieldDefinitions)) {
			resolvedFields[fieldKey] = resolveComputedFieldValue(fieldDefinition, {
				...itemContext,
				currentField: fieldKey,
				scope: {
					...(itemContext.scope ?? {}),
					computed: resolvedFields,
					aliases: itemAliases,
				},
			});
		}

		const resolvedKey = resolveComputedFieldValue(def.key, itemContext);
		const stableKey =
			resolvedKey !== undefined && resolvedKey !== null && String(resolvedKey).trim() !== ""
				? String(resolvedKey)
				: itemKey;
		resolved[stableKey] = resolvedFields;
	}

	return resolved;
}

function resolveExpandedComputedValue(
	def: Record<string, any>,
	context: ComputedResolutionContext,
): Record<string, any> {
	const { entries, alias } = resolveIterateeEntries(def.on, context);
	const resolved: Record<string, any> = {};
	const fieldDefinitions = isPlainObject(def.fields) ? def.fields : {};

	for (const [index, entry] of entries.entries()) {
		const item = entry.value;
		const itemKey = entry.key ?? String(index);
		const itemEnv = isPlainObject(item) ? flattenToEnv(item) : {};
		const resolvedFields: Record<string, any> = {};
		const itemAliases = alias
			? { ...(context.aliases ?? {}), [alias]: item }
			: context.aliases;
		const itemContext: ComputedResolutionContext = {
			...context,
			env: {
				...context.env,
				...itemEnv,
			},
			scope: {
				...(context.scope ?? {}),
				current: item,
				item,
				currentKey: itemKey,
				computed: resolvedFields,
				aliases: itemAliases,
			},
			current: isPlainObject(item) ? item : undefined,
			currentKey: itemKey,
			aliases: itemAliases,
		};

		if (def.filter !== undefined && !evaluateComputedFilter(def.filter, itemContext)) {
			continue;
		}

		for (const [fieldKey, fieldDefinition] of Object.entries(fieldDefinitions)) {
			resolvedFields[fieldKey] = resolveComputedFieldValue(fieldDefinition, {
				...itemContext,
				currentField: fieldKey,
				scope: {
					...(itemContext.scope ?? {}),
					computed: resolvedFields,
					aliases: itemAliases,
				},
			});
		}

		const resolvedKey = resolveComputedFieldValue(def.key, itemContext);
		const stableKey =
			resolvedKey !== undefined && resolvedKey !== null && String(resolvedKey).trim() !== ""
				? String(resolvedKey)
				: itemKey;
		resolved[stableKey] = isPlainObject(item) ? { ...item, ...resolvedFields } : resolvedFields;
	}

	return resolved;
}

function resolveIterateeEntries(
	path: unknown,
	context: ComputedResolutionContext,
): { entries: Array<{ key: string; value: any }>; alias?: string } {
	if (path === undefined || path === null) return { entries: [] };

	const resolvedPath = typeof path === "string" ? resolveStringValue(path, context) : path;
	const { path: actualPath, alias } = parseAliasedPath(
		typeof resolvedPath === "string" ? resolvedPath : "",
	);
	const value =
		typeof actualPath === "string" && actualPath
			? resolvePathReference(actualPath, context) ?? parseMaybeJson(actualPath)
			: actualPath;

	if (Array.isArray(value)) {
		return { entries: value.map((entry, index) => ({ key: String(index), value: entry })), alias };
	}

	if (value && typeof value === "object") {
		return {
			entries: Object.entries(value).map(([key, entry]) => ({ key, value: entry })),
			alias,
		};
	}

	return { entries: [], alias };
}

function parseAliasedPath(path: string): { path: string; alias?: string } {
	const match = path.trim().match(/^(.*)\s+as\s+([A-Za-z_$][\w$-]*)$/i);
	if (!match) return { path };
	return { path: match[1].trim(), alias: match[2] };
}

function evaluateComputedFilter(value: any, context: ComputedResolutionContext): boolean {
	if (value === undefined || value === null) return true;
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") {
		const resolved = resolveComputedFieldValue(value, context);
		return Boolean(resolved);
	}

	const expression = normalizeComputedExpression(interpolateString(value, context.env, context)).trim();
	if (!expression) return false;

	try {
		const tokens = tokenizeExpression(expression);
		const parser = new ExpressionParser(tokens, context);
		return Boolean(parser.parseExpression());
	} catch {
		return false;
	}
}

function resolveOperationValue(def: Record<string, any>, context: ComputedResolutionContext): any {
	const operation = String(def.operation ?? "").trim().toLowerCase();
	const resolvedInputs = resolveComputedFieldValue(def.inputs ?? {}, context) as Record<string, any>;
	const fallback = resolveComputedFieldValue(def.fallback, context);

	if (operation === "if") {
		const condition = evaluateIfCondition(def, context);
		const trueBranch = def.then ?? def.whenTrue ?? def.true ?? def.valueIfTrue;
		const falseBranch = def.else ?? def.whenFalse ?? def.false ?? def.valueIfFalse;
		const selectedBranch = condition ? trueBranch : falseBranch;
		const result = resolveIfBranch(selectedBranch, context, fallback);
		return result !== undefined && result !== null ? result : fallback;
	}

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

	if (operation === "lookup" || operation === "lookup_table") {
		const tableName = resolveComputedFieldValue(def.table, context);
		const keyValue = resolveComputedFieldValue(def.key, context);
		const fieldName = typeof def.field === "string" ? def.field : undefined;

		let table: any = undefined;
		if (typeof tableName === "string") {
			table = getNestedValue(context.scope ?? {}, `lookup_tables.${tableName}`) ?? (context.scope ?? {})[tableName];
		} else {
			table = tableName;
		}

		const result = getLookupTableValue(table, keyValue, fieldName);
		return result === undefined ? fallback : result;
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

	if (operation === "math") {
		return resolveMathOperation(def, context, fallback, {
			resolveComputedFieldValue,
			resolvePathReference,
			interpolateString,
			normalizeComputedExpression,
		});
	}

	if (operation === "expr") {
		const expression = typeof def.expression === "string" ? def.expression : "";
		if (!expression) return fallback;

		try {
			const normalizedExpression = normalizeComputedExpression(expression)
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
				"now",
				`return (${normalizedExpression});`,
			);
			return evaluator(
				...Object.values(resolvedInputs),
				Math.round,
				clamp,
				humanBytes,
				(value: any) => (Array.isArray(value) || typeof value === "string" ? value.length : 0),
				Number.isNaN,
				() => Date.now(),
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

function evaluateIfCondition(def: Record<string, any>, context: ComputedResolutionContext): boolean {
	const baseCondition = evaluateConditionSource(def.condition ?? def.test ?? def.value, context);
	const andCondition = evaluateConditionGroup(def.and, context, true);
	const orCondition = evaluateConditionGroup(def.or, context, false);

	if (def.or !== undefined) {
		return (baseCondition && andCondition) || orCondition;
	}

	return baseCondition && andCondition;
}

function evaluateConditionSource(value: any, context: ComputedResolutionContext): boolean {
	if (value === undefined || value === null) return false;
	if (Array.isArray(value)) {
		return value.every((entry) => evaluateConditionSource(entry, context));
	}
	if (typeof value === "string") {
		return evaluateComputedFilter(value, context);
	}
	return Boolean(resolveComputedFieldValue(value, context));
}

function evaluateConditionGroup(value: any, context: ComputedResolutionContext, defaultValue: boolean): boolean {
	if (value === undefined || value === null) return defaultValue;
	if (Array.isArray(value)) {
		return value.every((entry) => evaluateConditionSource(entry, context));
	}
	return evaluateConditionSource(value, context);
}

function resolveIfBranch(value: any, context: ComputedResolutionContext, fallback: any): any {
	if (value === undefined || value === null) return fallback;

	if (typeof value === "string") {
		const expressionResult = tryResolveExpressionString(value, context);
		return expressionResult !== undefined ? expressionResult : resolveComputedFieldValue(value, context);
	}

	if (Array.isArray(value)) {
		return resolveComputedFieldValue(value, context);
	}

	if (typeof value === "object") {
		const conditionalKeys = ["condition", "test", "then", "else", "and", "or"];
		const hasConditionalShape = conditionalKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
		if (hasConditionalShape && value.operation === undefined) {
			return resolveOperationValue({ ...value, operation: "if" }, context);
		}
	}

	return resolveComputedFieldValue(value, context);
}

function tryResolveExpressionString(
	value: string,
	context: ComputedResolutionContext,
): any {
	const expression = normalizeComputedExpression(interpolateString(value, context.env, context)).trim();
	if (!expression) return undefined;

	// Only attempt expression parsing for obvious operators; otherwise treat as literal/path.
	if (!/[+\-*/()<>!=]/.test(expression)) {
		return undefined;
	}

	try {
		const tokens = tokenizeExpression(expression);
		const parser = new ExpressionParser(tokens, context as any);
		const resolved = parser.parseExpression();
		if (typeof resolved === "number" && Number.isNaN(resolved)) {
			return undefined;
		}
		return resolved;
	} catch {
		return undefined;
	}
}

type PathToken = string | number | { bracket: string } | "*";

function tokenizePath(path: string) {
	const tokens: PathToken[] = [];
	const pattern = /[^.\[\]]+|\[([^\]]*)\]/g;
	for (const match of path.matchAll(pattern)) {
		const isBracket = match[1] !== undefined;
		const token = isBracket ? match[1] : match[0];
		if (token === "*") {
			tokens.push("*");
		} else if (/^\d+$/.test(token)) {
			tokens.push(Number(token));
		} else if (token === "") {
			tokens.push("*");
		} else if (isBracket) {
			tokens.push({ bracket: token });
		} else {
			tokens.push(token);
		}
	}
	return tokens;
}

function walkPath(current: any, tokens: PathToken[], context?: ComputedResolutionContext): any {
	if (tokens.length === 0) return current;

	const [token, ...rest] = tokens;
	if (token === "*") {
		if (!Array.isArray(current)) return undefined;
		return current.map((entry) => walkPath(entry, rest, context));
	}

	if (current === null || current === undefined) return undefined;

	if (Array.isArray(current)) {
		if (typeof token !== "number") return undefined;
		return walkPath(current[token], rest, context);
	}

	if (typeof current !== "object") return undefined;

	if (typeof token === "object" && "bracket" in token) {
		const resolvedKey = context ? resolveSegment(token.bracket, context) : token.bracket;
		if (resolvedKey === undefined || resolvedKey === null) return undefined;
		const key = String(resolvedKey);
		const directValue = (current as Record<string, any>)[key];
		if (directValue !== undefined) {
			return walkPath(directValue, rest, context);
		}

		if (typeof resolvedKey === "string" && /[.\[]/.test(resolvedKey)) {
			const nestedValue = getNestedValue(current as Record<string, any>, resolvedKey, context);
			if (nestedValue !== undefined) {
				return walkPath(nestedValue, rest, context);
			}
		}

		return undefined;
	}

	return walkPath((current as Record<string, any>)[String(token)], rest, context);
}

function isLikelyPathReference(value: string) {
	return /^(?:this\.)?(?:computed|endpoints|[A-Za-z_$][\w$-]*)(?:\.[A-Za-z_$][\w$-]*|\[[^\]]*\])*$/u.test(
		value.trim(),
	);
}
