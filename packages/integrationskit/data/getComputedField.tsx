// dashwise-integrationskit/data/getComputedField.tsx
//
// The integrations kit owns widget-level computed-field resolution for
// integration-backed widgets. The helpers here are shared by endpoint loading,
// computed-field evaluation, and widget rendering.

import getLookupTableValue from "./getLookupTableValue";

export type ComputedResolutionContext = {
	env: Record<string, string>;
	scope?: Record<string, any>;
	current?: Record<string, any>;
	currentKey?: string;
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
		if (typeof value.iterate_over === "string" || value.iterate_over !== undefined) {
			return resolveIteratedComputedValue(value, context);
		}

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
		const ifResult = resolveInlineIfExpression(segment, context);
		if (ifResult !== undefined) {
			if (ifResult !== null && `${ifResult}`.trim() !== "") {
				return ifResult;
			}
			lastResolved = ifResult;
			continue;
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
	const resolvedCondition = interpolateString(condition.trim(), context.env).trim();
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
	const leftNumber = Number(left);
	const rightNumber = Number(right);
	const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
	const a = numeric ? leftNumber : left;
	const b = numeric ? rightNumber : right;

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

	const interpolated = interpolateString(segment, context.env).trim();
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

	if (normalized.startsWith("computed.")) {
		return getNestedValue(scope.computed ?? {}, normalized.slice("computed.".length));
	}

	if (normalized.startsWith("endpoints.")) {
		return getNestedValue(scope.endpoints ?? {}, normalized.slice("endpoints.".length));
	}

	if (context.current !== undefined) {
		const currentValue = getNestedValue(context.current, normalized);
		if (currentValue !== undefined) {
			return currentValue;
		}
	}

	if (scope.current !== undefined) {
		const currentValue = getNestedValue(scope.current, normalized);
		if (currentValue !== undefined) {
			return currentValue;
		}
	}

	return getNestedValue(scope, normalized);
}

function resolveIteratedComputedValue(
	def: Record<string, any>,
	context: ComputedResolutionContext,
): Record<string, any> {
	const entries = resolveIterateeEntries(def.iterate_over, context);
	const resolved: Record<string, any> = {};
	const fieldDefinitions = isPlainObject(def.fields) ? def.fields : {};

	for (const [index, entry] of entries.entries()) {
		const item = entry.value;
		const itemKey = entry.key ?? String(index);
		const itemEnv = isPlainObject(item) ? flattenToEnv(item) : {};
		const resolvedFields: Record<string, any> = {};
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
			},
			current: isPlainObject(item) ? item : undefined,
			currentKey: itemKey,
		};

		if (def.filter !== undefined && !evaluateComputedFilter(def.filter, itemContext)) {
			continue;
		}

		for (const [fieldKey, fieldDefinition] of Object.entries(fieldDefinitions)) {
			resolvedFields[fieldKey] = resolveComputedFieldValue(fieldDefinition, {
				...itemContext,
				scope: {
					...(itemContext.scope ?? {}),
					computed: resolvedFields,
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

function resolveIterateeEntries(
	path: unknown,
	context: ComputedResolutionContext,
): Array<{ key: string; value: any }> {
	if (path === undefined || path === null) return [];

	const resolvedPath = typeof path === "string" ? resolveStringValue(path, context) : path;
	const value =
		typeof resolvedPath === "string"
			? resolvePathReference(resolvedPath, context) ?? parseMaybeJson(resolvedPath)
			: resolvedPath;

	if (Array.isArray(value)) {
		return value.map((entry, index) => ({ key: String(index), value: entry }));
	}

	if (value && typeof value === "object") {
		return Object.entries(value).map(([key, entry]) => ({ key, value: entry }));
	}

	return [];
}

function evaluateComputedFilter(value: any, context: ComputedResolutionContext): boolean {
	if (value === undefined || value === null) return true;
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") {
		const resolved = resolveComputedFieldValue(value, context);
		return Boolean(resolved);
	}

	const expression = interpolateString(value, context.env).trim();
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

	if (operation === "lookup") {
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

function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ExpressionToken =
	| { type: "number"; value: number }
	| { type: "string"; value: string }
	| { type: "identifier"; value: string }
	| { type: "operator"; value: string }
	| { type: "paren"; value: "(" | ")" }
	| { type: "eof" };

function tokenizeExpression(expression: string): ExpressionToken[] {
	const tokens: ExpressionToken[] = [];
	let index = 0;

	while (index < expression.length) {
		const char = expression[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}

		if (char === "(" || char === ")") {
			tokens.push({ type: "paren", value: char });
			index += 1;
			continue;
		}

		const twoChar = expression.slice(index, index + 2);
		if ([">=", "<=", "==", "!=", "&&", "||"].includes(twoChar)) {
			tokens.push({ type: "operator", value: twoChar });
			index += 2;
			continue;
		}

		if ([">", "<", "+", "-", "*", "/", "!"].includes(char)) {
			tokens.push({ type: "operator", value: char });
			index += 1;
			continue;
		}

		if (char === "'" || char === '"') {
			const quote = char;
			let next = index + 1;
			let text = "";
			while (next < expression.length) {
				const current = expression[next];
				if (current === "\\" && next + 1 < expression.length) {
					text += expression[next + 1];
					next += 2;
					continue;
				}
				if (current === quote) break;
				text += current;
				next += 1;
			}
			tokens.push({ type: "string", value: text });
			index = Math.min(expression.length, next + 1);
			continue;
		}

		let end = index;
		while (end < expression.length) {
			const current = expression[end];
			if (/\s/.test(current) || ["(", ")", ">", "<", "=", "!", "&", "|", "+", "*", "/"].includes(current)) {
				break;
			}
			end += 1;
		}

		const raw = expression.slice(index, end);
		const lower = raw.toLowerCase();
		if (["and", "or", "not", "contains"].includes(lower)) {
			tokens.push({ type: "operator", value: lower });
		} else if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
			tokens.push({ type: "number", value: Number(raw) });
		} else {
			tokens.push({ type: "identifier", value: raw });
		}
		index = end;
	}

	tokens.push({ type: "eof" });
	return tokens;
}

class ExpressionParser {
	private readonly tokens: ExpressionToken[];
	private readonly context: ComputedResolutionContext;
	private index = 0;

	constructor(tokens: ExpressionToken[], context: ComputedResolutionContext) {
		this.tokens = tokens;
		this.context = context;
	}

	parseExpression(): any {
		return this.parseOr();
	}

	private parseOr(): any {
		let left = this.parseAnd();
		while (this.matchOperator("or") || this.matchOperator("||")) {
			this.consume();
			left = Boolean(left) || Boolean(this.parseAnd());
		}
		return left;
	}

	private parseAnd(): any {
		let left = this.parseNot();
		while (this.matchOperator("and") || this.matchOperator("&&")) {
			this.consume();
			left = Boolean(left) && Boolean(this.parseNot());
		}
		return left;
	}

	private parseNot(): any {
		if (this.matchOperator("not") || this.matchOperator("!")) {
			this.consume();
			return !Boolean(this.parseNot());
		}
		return this.parseComparison();
	}

	private parseComparison(): any {
		let left = this.parseAdditive();

		while (true) {
			if (this.matchOperator("contains")) {
				this.consume();
				const right = this.parseAdditive();
				left = String(left ?? "").toLowerCase().includes(String(right ?? "").toLowerCase());
				continue;
			}

			const operator = this.peek();
			if (operator.type !== "operator" || ![">", "<", ">=", "<=", "==", "!="].includes(operator.value)) {
				break;
			}
			this.consume();
			const right = this.parseAdditive();
			left = compareValues(left, right, operator.value);
		}

		return left;
	}

	private parseAdditive(): any {
		let left = this.parseMultiplicative();
		while (this.matchOperator("+") || this.matchOperator("-")) {
			const operatorToken = this.consume();
			if (operatorToken.type !== "operator") break;
			const operator = operatorToken.value;
			const right = this.parseMultiplicative();
			left = operator === "+" ? Number(left) + Number(right) : Number(left) - Number(right);
		}
		return left;
	}

	private parseMultiplicative(): any {
		let left = this.parsePrimary();
		while (this.matchOperator("*") || this.matchOperator("/")) {
			const operatorToken = this.consume();
			if (operatorToken.type !== "operator") break;
			const operator = operatorToken.value;
			const right = this.parsePrimary();
			left = operator === "*" ? Number(left) * Number(right) : Number(left) / Number(right);
		}
		return left;
	}

	private parsePrimary(): any {
		const token = this.consume();
		if (token.type === "number") return token.value;
		if (token.type === "string") return token.value;
		if (token.type === "identifier") return resolveOperand(token.value, this.context);
		if (token.type === "paren" && token.value === "(") {
			const value = this.parseExpression();
			this.expectParen(")");
			return value;
		}
		return undefined;
	}

	private expectParen(value: ")") {
		const token = this.consume();
		if (token.type !== "paren" || token.value !== value) {
			throw new Error(`Expected ${value}`);
		}
	}

	private matchOperator(...values: string[]) {
		const token = this.peek();
		return token.type === "operator" && values.includes(token.value);
	}

	private peek(): ExpressionToken {
		return this.tokens[this.index] ?? { type: "eof" };
	}

	private consume(): ExpressionToken {
		const token = this.peek();
		if (token.type !== "eof") this.index += 1;
		return token;
	}
}

function resolveOperand(value: string, context: ComputedResolutionContext): any {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);

	const resolved = resolveStringValue(trimmed, context);
	return resolved === undefined ? trimmed : resolved;
}

function compareValues(left: any, right: any, operator: string) {
	const leftNumber = Number(left);
	const rightNumber = Number(right);
	const numeric = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
	const a = numeric ? leftNumber : left;
	const b = numeric ? rightNumber : right;

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

function tokenizePath(path: string) {
	const tokens: Array<string | number | "*"> = [];
	const pattern = /[^.\[\]]+|\[([^\]]*)\]/g;
	for (const match of path.matchAll(pattern)) {
		const token = match[1] ?? match[0];
		if (token === "*") {
			tokens.push("*");
		} else if (/^\d+$/.test(token)) {
			tokens.push(Number(token));
		} else if (token === "") {
			tokens.push("*");
		} else {
			tokens.push(token);
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
	return /^(?:this\.)?(?:computed|endpoints|[A-Za-z_$][\w$-]*)(?:\.[A-Za-z_$][\w$-]*|\[[^\]]*\])*$/u.test(
		value.trim(),
	);
}
