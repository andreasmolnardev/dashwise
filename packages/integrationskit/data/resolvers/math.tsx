export type MathResolverDeps<Ctx extends { env: Record<string, string> }> = {
	resolveComputedFieldValue: (value: any, context: Ctx) => any;
	resolvePathReference: (path: string, context: Ctx) => any;
	interpolateString: (
		template: string,
		env: Record<string, string>,
		context?: Ctx,
	) => string;
	normalizeComputedExpression: (expression: string) => string;
};

	export type MathExpressionContext = {
		env: Record<string, string>;
		scope?: Record<string, any>;
		current?: Record<string, any>;
		currentKey?: string;
		currentField?: string;
		aliases?: Record<string, any>;
	};

export function resolveMathOperation<Ctx extends { env: Record<string, string> }>(
	def: Record<string, any>,
	context: Ctx,
	fallback: any,
	deps: MathResolverDeps<Ctx>,
) {
	const expression = buildMathExpression(def, context, deps).trim();
	if (!expression) return fallback;

	const result = evaluateMathExpression(expression, context, deps);
	if (typeof result === "number" && Number.isNaN(result)) {
		return fallback ?? expression;
	}
	return result ?? fallback ?? expression;
}

function buildMathExpression<Ctx extends { env: Record<string, string> }>(
	def: Record<string, any>,
	context: Ctx,
	deps: MathResolverDeps<Ctx>,
) {
	const explicit = typeof def.expression === "string"
		? def.expression
		: typeof def.value === "string"
		? def.value
		: "";
	if (explicit.trim()) {
		return deps.normalizeComputedExpression(explicit);
	}

	const from = def.from ?? def.base ?? def.left;
	const subtract = def.subtract ?? def.susbtract ?? def.minus;
	if (from !== undefined && subtract !== undefined) {
		return deps.normalizeComputedExpression(
			`(${resolveMathOperandExpression(from, context, deps)}) - (${resolveMathOperandExpression(subtract, context, deps)})`,
		);
	}

	const add = def.add ?? def.plus;
	if (from !== undefined && add !== undefined) {
		return deps.normalizeComputedExpression(
			`(${resolveMathOperandExpression(from, context, deps)}) + (${resolveMathOperandExpression(add, context, deps)})`,
		);
	}

	return "";
}

function resolveMathOperandExpression<Ctx extends { env: Record<string, string> }>(
	value: any,
	context: Ctx,
	deps: MathResolverDeps<Ctx>,
) {
	if (typeof value === "string") return value;
	const resolved = deps.resolveComputedFieldValue(value, context);
	if (resolved === undefined || resolved === null) return "0";
	return typeof resolved === "string" ? resolved : String(resolved);
}

function evaluateMathExpression<Ctx extends { env: Record<string, string> }>(
	expression: string,
	context: Ctx,
	deps: MathResolverDeps<Ctx>,
) {
	const prepared = prepareMathExpression(expression, context, deps);
	if (!prepared) return NaN;
	if (!/^[0-9+\-*/().\s]+$/.test(prepared)) {
		return NaN;
	}

	const evaluator = new Function(`return (${prepared});`);
	return evaluator();
}

function prepareMathExpression<Ctx extends { env: Record<string, string> }>(
	expression: string,
	context: Ctx,
	deps: MathResolverDeps<Ctx>,
) {
	const interpolated = deps.interpolateString(expression, context.env, context);
	const identifierPattern = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$-]*|\[[^\]]+\])*/g;

	const replaced = interpolated.replace(identifierPattern, (token) => {
		const normalized = token.trim();
		if (!normalized) return token;
		if (["true", "false", "null", "undefined", "and", "or", "not", "contains"].includes(normalized)) {
			return token;
		}

		const resolved = deps.resolvePathReference(normalized, context);
		if (resolved === undefined || resolved === null || resolved === "") {
			return "0";
		}

		if (typeof resolved === "number") {
			return Number.isFinite(resolved) ? String(resolved) : "0";
		}
		if (typeof resolved === "boolean") {
			return resolved ? "1" : "0";
		}

		const numeric = Number(resolved);
		if (Number.isFinite(numeric)) {
			return String(numeric);
		}

		return "0";
	});

	return replaced.replace(/\s+/g, " ").trim();
}

export type ExpressionToken =
	| { type: "number"; value: number }
	| { type: "string"; value: string }
	| { type: "identifier"; value: string }
	| { type: "operator"; value: string }
	| { type: "paren"; value: "(" | ")" }
	| { type: "eof" };

export function tokenizeExpression(expression: string): ExpressionToken[] {
	const tokens: ExpressionToken[] = [];
	let index = 0;

	while (index < expression.length) {
		const char = expression[index];
		if (/\s/.test(char)) {
			index += 1;
			continue;
		}

		if (char === "-" && /\d/.test(expression[index + 1] ?? "")) {
			let end = index + 1;
			while (end < expression.length && /[\d.]/.test(expression[end])) {
				end += 1;
			}
			const raw = expression.slice(index, end);
			tokens.push({ type: "number", value: Number(raw) });
			index = end;
			continue;
		}

		if (/[A-Za-z_$]/.test(char)) {
			let end = index + 1;
			let allowHyphen = false;
			while (end < expression.length) {
				const current = expression[end];
				if (/\s/.test(current) || ["(", ")", ">", "<", "=", "!", "&", "|", "+", "-", "*", "/", ","].includes(current)) {
					break;
				}
				if (current === "-") {
					if (!allowHyphen) break;
				}
				if (current === "." || current === "[" || current === "]") {
					allowHyphen = true;
				}
				end += 1;
			}

			const raw = expression.slice(index, end);
			const lower = raw.toLowerCase();
			if (["and", "or", "not", "contains"].includes(lower)) {
				tokens.push({ type: "operator", value: lower });
			} else {
				tokens.push({ type: "identifier", value: raw });
			}
			index = end;
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
			if (/\s/.test(current) || ["(", ")", ">", "<", "=", "!", "&", "|", "+", "-", "*", "/", ","].includes(current)) {
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

export class ExpressionParser {
	private readonly tokens: ExpressionToken[];
	private readonly context: MathExpressionContext;
	private index = 0;

	constructor(tokens: ExpressionToken[], context: MathExpressionContext) {
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

function resolveOperand(value: string, context: MathExpressionContext): any {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (trimmed === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);

	const resolved = resolveContextValue(trimmed, context);
	return resolved === undefined ? trimmed : resolved;
}

function resolveContextValue(path: string, context: MathExpressionContext): any {
	return resolveContextValueWithDepth(path, context, 0);
}

type PathToken = string | number | { bracket: string } | "*";

function resolveContextValueWithDepth(path: string, context: MathExpressionContext, depth: number): any {
	if (depth > 8) return undefined;
	const scope = context.scope ?? {};
	const normalized = path.replace(/^this\./, "").trim();
	if (!normalized || !isLikelyPathReference(normalized)) {
		return undefined;
	}

	const aliases: Record<string, any> = {
		...((scope as Record<string, any>).aliases ?? {}),
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
				? getNestedValue(aliasValue, lookupPath, context, depth + 1)
				: aliasValue;
		}
	}

	if (normalized.startsWith("computed.")) {
		return getNestedValue((scope as Record<string, any>).computed ?? {}, normalized.slice("computed.".length), context, depth + 1);
	}

	if (normalized.startsWith("endpoints.")) {
		return getNestedValue((scope as Record<string, any>).endpoints ?? {}, normalized.slice("endpoints.".length), context, depth + 1);
	}

	if (context.current !== undefined) {
		const currentValue = getNestedValue(context.current, normalized, context, depth + 1);
		if (currentValue !== undefined) {
			return currentValue;
		}
	}

	if ((scope as Record<string, any>).current !== undefined) {
		const currentValue = getNestedValue((scope as Record<string, any>).current, normalized, context, depth + 1);
		if (currentValue !== undefined) {
			return currentValue;
		}
	}

	return getNestedValue(scope, normalized, context, depth + 1);
}

function getNestedValue(
	obj: Record<string, any>,
	path: string,
	context: MathExpressionContext,
	depth: number,
): any {
	if (!path) return undefined;
	const tokens = tokenizePath(path);
	return walkPath(obj, tokens, context, depth);
}

function tokenizePath(path: string): PathToken[] {
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

function walkPath(
	current: any,
	tokens: PathToken[],
	context: MathExpressionContext,
	depth: number,
): any {
	if (tokens.length === 0) return current;

	const [token, ...rest] = tokens;
	if (token === "*") {
		if (!Array.isArray(current)) return undefined;
		return current.map((entry) => walkPath(entry, rest, context, depth + 1));
	}

	if (current === null || current === undefined) return undefined;

	if (Array.isArray(current)) {
		if (typeof token !== "number") return undefined;
		return walkPath(current[token], rest, context, depth + 1);
	}

	if (typeof current !== "object") return undefined;

	if (typeof token === "object" && "bracket" in token) {
		const resolvedKey = resolveBracketKey(token.bracket, context, depth + 1);
		if (resolvedKey === undefined || resolvedKey === null) return undefined;
		const key = String(resolvedKey);
		const directValue = (current as Record<string, any>)[key];
		if (directValue !== undefined) {
			return walkPath(directValue, rest, context, depth + 1);
		}

		if (typeof resolvedKey === "string" && /[.\[]/.test(resolvedKey)) {
			const nestedValue = getNestedValue(current as Record<string, any>, resolvedKey, context, depth + 1);
			if (nestedValue !== undefined) {
				return walkPath(nestedValue, rest, context, depth + 1);
			}
		}

		return undefined;
	}

	return walkPath((current as Record<string, any>)[String(token)], rest, context, depth + 1);
}

function resolveBracketKey(raw: string, context: MathExpressionContext, depth: number): any {
	const trimmed = raw.trim();
	if (!trimmed) return undefined;

	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}

	if (/^-?\d+$/.test(trimmed)) {
		return Number(trimmed);
	}

	const resolved = resolveContextValueWithDepth(trimmed, context, depth + 1);
	return resolved === undefined ? trimmed : resolved;
}

function isLikelyPathReference(value: string) {
	return /^(?:this\.)?(?:computed|endpoints|[A-Za-z_$][\w$-]*)(?:\.[A-Za-z_$][\w$-]*|\[[^\]]*\])*$/u.test(
		value.trim(),
	);
}

function compareValues(left: any, right: any, operator: string) {
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
