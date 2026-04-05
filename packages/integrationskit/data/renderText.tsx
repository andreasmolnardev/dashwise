import React from "react";

export type TextFormatters = {
	formatTemperature?: (value: number | null | undefined, inputUnit?: string, opts?: { includeUnit?: boolean; decimals?: number }) => string;
	formatTime?: (date?: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
	formatDate?: (date?: Date | string | number, overrideFormat?: string) => string;
};

type TypedTextPayload = {
	type?: string;
	value?: unknown;
	args?: unknown[];
};

const TYPED_TEXT_PREFIX = "__DWCAST__";

export function encodeTypedText(type: string, value: unknown, args: unknown[] = []) {
	return `${TYPED_TEXT_PREFIX}${encodeURIComponent(JSON.stringify({ type, value, args }))}__`;
}

export function renderLocalizedText(
	value: string | string[] | undefined | null,
	formatters?: TextFormatters,
) {
	if (value === undefined || value === null) return value;

	if (Array.isArray(value)) {
		return value.map((entry, index) => (
			<React.Fragment key={index}>
				{index > 0 ? " · " : null}
				{renderLocalizedText(entry, formatters)}
			</React.Fragment>
		));
	}

	if (typeof value !== "string" || !value.includes(TYPED_TEXT_PREFIX)) {
		return value;
	}

	const nodes: React.ReactNode[] = [];
	let cursor = 0;
	let markerIndex = 0;
	const markerPattern = /__DWCAST__(.+?)__/g;
	let match: RegExpExecArray | null;

	while ((match = markerPattern.exec(value)) !== null) {
		const [marker, payloadText] = match;
		const start = match.index;
		if (start > cursor) {
			nodes.push(value.slice(cursor, start));
		}

		nodes.push(renderTypedPayload(payloadText, formatters, `${markerIndex}`));
		markerIndex += 1;
		cursor = start + marker.length;
	}

	if (cursor < value.length) {
		nodes.push(value.slice(cursor));
	}

	return nodes.length > 0 ? nodes : value;
}

function renderTypedPayload(payloadText: string, formatters: TextFormatters | undefined, key: string) {
	const payload = decodeTypedPayload(payloadText);
	if (!payload) return <React.Fragment key={key} />;

	const castType = String(payload.type ?? "").toLowerCase();
	const args = Array.isArray(payload.args) ? payload.args : [];

	if (castType === "temp" || castType === "temperature") {
		const inputUnit = typeof args[0] === "string" && args[0].trim() ? args[0].trim() : "c";
		return <React.Fragment key={key}>{formatters?.formatTemperature?.(toNumber(payload.value), inputUnit) ?? String(payload.value ?? "")}</React.Fragment>;
	}

	if (castType === "time") {
		const timeZone = typeof args[0] === "string" && args[0].trim() ? args[0].trim() : undefined;
		return <React.Fragment key={key}>{formatters?.formatTime?.(payload.value as Date | string | number, timeZone ? { timeZone } : undefined) ?? String(payload.value ?? "")}</React.Fragment>;
	}

	if (castType === "date") {
		const overrideFormat = typeof args[0] === "string" && args[0].trim() ? args[0].trim() : undefined;
		return <React.Fragment key={key}>{formatters?.formatDate?.(payload.value as Date | string | number, overrideFormat) ?? String(payload.value ?? "")}</React.Fragment>;
	}

	if (castType === "datetime") {
		const overrideFormat = typeof args[0] === "string" && args[0].trim() ? args[0].trim() : undefined;
		return <React.Fragment key={key}>{formatters?.formatDate?.(payload.value as Date | string | number, overrideFormat) ?? String(payload.value ?? "")}</React.Fragment>;
	}

	return <React.Fragment key={key}>{String(payload.value ?? "")}</React.Fragment>;
}

function decodeTypedPayload(payloadText: string): TypedTextPayload | null {
	try {
		return JSON.parse(decodeURIComponent(payloadText)) as TypedTextPayload;
	} catch {
		return null;
	}
}

function toNumber(value: unknown) {
	if (typeof value === "number") return value;
	if (typeof value === "string" && value.trim()) return Number(value);
	return Number(value);
}